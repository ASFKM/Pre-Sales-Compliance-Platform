import fs from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Storage as GCSClient } from "@google-cloud/storage";
import { decryptSecret } from "./security";
import { logger } from "./logger";

export interface StorageAdapter {
  uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string>;
  deleteFile(storagePath: string): Promise<boolean>;
  readFile(storagePath: string): Promise<Buffer>;
  // Cheap existence check (metadata only, no data transfer) - for callers that just need a
  // yes/no (e.g. "is this proposal's file still there before releasing it") without paying for a
  // full download.
  exists(storagePath: string): Promise<boolean>;
  // Cheap connectivity check (no data transfer) - safe to call on every readiness probe.
  checkReachable(): Promise<boolean>;
}

// 1. Local Filesystem Storage Adapter
export class LocalStorageAdapter implements StorageAdapter {
  private baseUploadDir: string;

  constructor(baseUploadDir?: string) {
    const configuredDir = baseUploadDir && baseUploadDir.trim() ? baseUploadDir.trim() : "uploads";
    this.baseUploadDir = path.isAbsolute(configuredDir)
      ? configuredDir
      : path.resolve(process.cwd(), configuredDir);
    // Directory creation deferred to uploadFile (the only method that actually needs it to
    // exist) - a constructor can't be async, and createStorageAdapter() is called fresh on every
    // request, so a sync existsSync/mkdirSync here used to block the event loop on every single
    // storage operation, not just the first one.
  }

  private resolveStoragePath(storagePath: string): string {
    if (storagePath.startsWith("local://")) {
      return storagePath.replace("local://", "");
    }

    const normalized = path
      .normalize(storagePath)
      .replace(/^(\/|\\)+/, "")
      .replace(/^(\.\.(\/|\\))+/, "");

    return path.resolve(process.cwd(), normalized);
  }

  async uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
    void mimeType;

    // Defense in depth: projectId ids look like "p_<16 hex chars>" (src/idGenerator.ts), so this
    // is never legitimately rejecting a real project. Callers are expected to have already
    // confirmed projectId belongs to the caller's tenant before reaching here - this check exists
    // so that a caller who forgets that (as server/routes/documents.ts's upload route once did)
    // can't turn this join into a path traversal out of baseUploadDir.
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
      throw new Error(`Invalid projectId for storage: ${JSON.stringify(projectId)}`);
    }

    const projectDir = path.join(this.baseUploadDir, projectId);
    // recursive: true is idempotent (no error if the path already exists), so this doesn't need
    // an existsSync check first - one non-blocking call covers both "first upload ever" and
    // "directory already there".
    await fs.promises.mkdir(projectDir, { recursive: true });

    const extension = path.extname(originalFilename).toLowerCase();
    const uniqueName = `${crypto.randomBytes(16).toString("hex")}${extension}`;
    const fullPath = path.join(projectDir, uniqueName);

    await fs.promises.writeFile(fullPath, fileBuffer);

    return `local://${fullPath}`;
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveStoragePath(storagePath);
      await fs.promises.unlink(fullPath);
      return true;
    } catch (err: any) {
      if (err.code !== "ENOENT") logger.error({ err, storagePath }, "Failed to delete local file");
      return false;
    }
  }

  async readFile(storagePath: string): Promise<Buffer> {
    const fullPath = this.resolveStoragePath(storagePath);
    return await fs.promises.readFile(fullPath);
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await fs.promises.access(this.resolveStoragePath(storagePath));
      return true;
    } catch {
      return false;
    }
  }

  async checkReachable(): Promise<boolean> {
    try {
      await fs.promises.mkdir(this.baseUploadDir, { recursive: true });
      await fs.promises.access(this.baseUploadDir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// 2. AWS S3 Storage Adapter
export class S3StorageAdapter implements StorageAdapter {
  private bucketName: string;
  private client: S3Client;

  constructor(bucketName: string, region?: string, accessKeyId?: string, secretAccessKey?: string) {
    this.bucketName = bucketName;
    this.client = new S3Client({
      region: region || "us-east-1",
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
  }

  async uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
    const extension = path.extname(originalFilename).toLowerCase();
    const key = `${projectId}/${crypto.randomBytes(16).toString("hex")}${extension}`;

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    }));

    return `s3://${this.bucketName}/${key}`;
  }

  private parseKey(storagePath: string): string {
    const withoutScheme = storagePath.replace(/^s3:\/\//, "");
    const slashIndex = withoutScheme.indexOf("/");
    return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: this.parseKey(storagePath) }));
      return true;
    } catch (err) {
      logger.error({ err, storagePath }, "Failed to delete S3 object");
      return false;
    }
  }

  async readFile(storagePath: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: this.parseKey(storagePath) }));
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: this.parseKey(storagePath) }));
      return true;
    } catch {
      return false;
    }
  }

  async checkReachable(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      return true;
    } catch {
      return false;
    }
  }
}

// 3. Google Cloud Storage Adapter
export class GCSStorageAdapter implements StorageAdapter {
  private bucketName: string;
  private client: GCSClient;

  constructor(bucketName: string, projectId?: string, serviceAccountKeyJson?: string) {
    this.bucketName = bucketName;
    this.client = new GCSClient({
      projectId: projectId || undefined,
      credentials: serviceAccountKeyJson ? JSON.parse(serviceAccountKeyJson) : undefined,
    });
  }

  private parseObjectName(storagePath: string): string {
    const withoutScheme = storagePath.replace(/^gs:\/\//, "");
    const slashIndex = withoutScheme.indexOf("/");
    return slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
  }

  async uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
    const extension = path.extname(originalFilename).toLowerCase();
    const objectName = `${projectId}/${crypto.randomBytes(16).toString("hex")}${extension}`;

    const file = this.client.bucket(this.bucketName).file(objectName);
    await file.save(fileBuffer, { contentType: mimeType });

    return `gs://${this.bucketName}/${objectName}`;
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    try {
      await this.client.bucket(this.bucketName).file(this.parseObjectName(storagePath)).delete();
      return true;
    } catch (err) {
      logger.error({ err, storagePath }, "Failed to delete GCS object");
      return false;
    }
  }

  async readFile(storagePath: string): Promise<Buffer> {
    const [content] = await this.client.bucket(this.bucketName).file(this.parseObjectName(storagePath)).download();
    return content;
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      const [exists] = await this.client.bucket(this.bucketName).file(this.parseObjectName(storagePath)).exists();
      return exists;
    } catch {
      return false;
    }
  }

  async checkReachable(): Promise<boolean> {
    try {
      const [exists] = await this.client.bucket(this.bucketName).exists();
      return exists;
    } catch {
      return false;
    }
  }
}

export function createStorageAdapter(settings?: {
  storage_mode?: "local" | "s3" | "gcs";
  local_storage_path?: string;
  s3_bucket?: string;
  s3_region?: string;
  s3_access_key_id?: string;
  s3_secret_access_key_encrypted?: string;
  gcs_bucket?: string;
  gcs_project_id?: string;
  gcs_service_account_key_encrypted?: string;
}): StorageAdapter {
  const mode = settings?.storage_mode || "local";

  if (mode === "s3") {
    const secretAccessKey = settings?.s3_secret_access_key_encrypted
      ? decryptSecret(settings.s3_secret_access_key_encrypted)
      : undefined;

    return new S3StorageAdapter(
      settings?.s3_bucket || "commercial-assistant-s3",
      settings?.s3_region,
      settings?.s3_access_key_id,
      secretAccessKey
    );
  }

  if (mode === "gcs") {
    const serviceAccountKeyJson = settings?.gcs_service_account_key_encrypted
      ? decryptSecret(settings.gcs_service_account_key_encrypted)
      : undefined;

    return new GCSStorageAdapter(
      settings?.gcs_bucket || "commercial-assistant-gcs",
      settings?.gcs_project_id,
      serviceAccountKeyJson
    );
  }

  return new LocalStorageAdapter(settings?.local_storage_path || "./uploads");
}

// File Validation Helpers
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv", ".txt"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain"
];
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export function validateUploadedFile(originalFilename: string, mimeType: string, fileSize: number): FileValidationResult {
  const ext = path.extname(originalFilename).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `File extension ${ext} is not allowed. Only PDF, DOCX, XLSX, CSV, and TXT are supported.` };
  }

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { valid: false, error: `MIME type ${mimeType} is invalid.` };
  }

  if (fileSize > MAX_FILE_SIZE) {
    return { valid: false, error: `File exceeds maximum size of 25MB (Received: ${(fileSize / (1024 * 1024)).toFixed(2)}MB).` };
  }

  return { valid: true };
}
