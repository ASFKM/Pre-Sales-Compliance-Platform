import fs from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { Storage as GCSClient } from "@google-cloud/storage";
import { decryptSecret } from "./security";

export interface StorageAdapter {
  uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string>;
  deleteFile(storagePath: string): Promise<boolean>;
  readFile(storagePath: string): Promise<Buffer>;
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

    if (!fs.existsSync(this.baseUploadDir)) {
      fs.mkdirSync(this.baseUploadDir, { recursive: true });
    }
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

    const projectDir = path.join(this.baseUploadDir, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const extension = path.extname(originalFilename).toLowerCase();
    const uniqueName = `${crypto.randomBytes(16).toString("hex")}${extension}`;
    const fullPath = path.join(projectDir, uniqueName);

    await fs.promises.writeFile(fullPath, fileBuffer);

    return `local://${fullPath}`;
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolveStoragePath(storagePath);
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to delete local file:", err);
      return false;
    }
  }

  async readFile(storagePath: string): Promise<Buffer> {
    const fullPath = this.resolveStoragePath(storagePath);
    return await fs.promises.readFile(fullPath);
  }

  async checkReachable(): Promise<boolean> {
    try {
      fs.accessSync(this.baseUploadDir, fs.constants.W_OK);
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
      console.error("Failed to delete S3 object:", err);
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
      console.error("Failed to delete GCS object:", err);
      return false;
    }
  }

  async readFile(storagePath: string): Promise<Buffer> {
    const [content] = await this.client.bucket(this.bucketName).file(this.parseObjectName(storagePath)).download();
    return content;
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
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
    return { valid: false, error: `File exceeds maximum size of 10MB (Received: ${(fileSize / (1024 * 1024)).toFixed(2)}MB).` };
  }

  return { valid: true };
}
