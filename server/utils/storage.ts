import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface StorageAdapter {
  uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string>;
  deleteFile(storagePath: string): Promise<boolean>;
  readFile(storagePath: string): Promise<Buffer>;
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
}

// 2. AWS S3 Storage Adapter scaffold
export class S3StorageAdapter implements StorageAdapter {
  private bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
  }

  async uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
    void fileBuffer;
    void mimeType;

    console.log(`[S3 Scaffold] Uploading ${originalFilename} to S3 bucket ${this.bucketName}`);
    const extension = path.extname(originalFilename).toLowerCase();
    const key = `${projectId}/${crypto.randomBytes(16).toString("hex")}${extension}`;
    return `s3://${this.bucketName}/${key}`;
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    console.log(`[S3 Scaffold] Deleting object from S3: ${storagePath}`);
    return true;
  }

  async readFile(storagePath: string): Promise<Buffer> {
    console.log(`[S3 Scaffold] Reading object from S3: ${storagePath}`);
    return Buffer.from("S3 Mock Extracted Content");
  }
}

// 3. Google Cloud Storage Adapter scaffold
export class GCSStorageAdapter implements StorageAdapter {
  private bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
  }

  async uploadFile(projectId: string, fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
    void fileBuffer;
    void mimeType;

    console.log(`[GCS Scaffold] Uploading ${originalFilename} to GCS bucket ${this.bucketName}`);
    const extension = path.extname(originalFilename).toLowerCase();
    const objectName = `${projectId}/${crypto.randomBytes(16).toString("hex")}${extension}`;
    return `gs://${this.bucketName}/${objectName}`;
  }

  async deleteFile(storagePath: string): Promise<boolean> {
    console.log(`[GCS Scaffold] Deleting object from GCS: ${storagePath}`);
    return true;
  }

  async readFile(storagePath: string): Promise<Buffer> {
    console.log(`[GCS Scaffold] Reading object from GCS: ${storagePath}`);
    return Buffer.from("GCS Mock Extracted Content");
  }
}

export function createStorageAdapter(settings?: {
  storage_mode?: "local" | "s3" | "gcs";
  local_storage_path?: string;
  s3_bucket?: string;
  gcs_bucket?: string;
}): StorageAdapter {
  const mode = settings?.storage_mode || "local";

  if (mode === "s3") {
    return new S3StorageAdapter(settings?.s3_bucket || "commercial-assistant-s3");
  }

  if (mode === "gcs") {
    return new GCSStorageAdapter(settings?.gcs_bucket || "commercial-assistant-gcs");
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
