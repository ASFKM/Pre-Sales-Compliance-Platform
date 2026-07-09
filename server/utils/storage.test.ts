import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { validateUploadedFile, LocalStorageAdapter } from "./storage";

describe("validateUploadedFile", () => {
  it("accepts a valid PDF under the size limit", () => {
    const result = validateUploadedFile("spec.pdf", "application/pdf", 1024);
    expect(result.valid).toBe(true);
  });

  it("rejects a disallowed extension", () => {
    const result = validateUploadedFile("payload.exe", "application/octet-stream", 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  it("rejects a mismatched MIME type for an allowed extension", () => {
    const result = validateUploadedFile("spec.pdf", "application/octet-stream", 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });

  it("rejects a file over the size limit", () => {
    const result = validateUploadedFile("spec.pdf", "application/pdf", 11 * 1024 * 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/exceeds maximum size/i);
  });
});

describe("LocalStorageAdapter", () => {
  let tmpDir: string;
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
    adapter = new LocalStorageAdapter(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uploads a file and can read it back with matching content", async () => {
    const content = Buffer.from("hello world");
    const storagePath = await adapter.uploadFile("proj1", content, "notes.txt", "text/plain");

    expect(storagePath).toMatch(/^local:\/\//);
    const readBack = await adapter.readFile(storagePath);
    expect(readBack.toString("utf8")).toBe("hello world");
  });

  it("never trusts the original filename for the stored path (path traversal safe)", async () => {
    const storagePath = await adapter.uploadFile("proj1", Buffer.from("x"), "../../../etc/passwd", "text/plain");
    const resolved = storagePath.replace("local://", "");

    expect(resolved.startsWith(tmpDir)).toBe(true);
    expect(resolved).not.toContain("etc/passwd");
  });

  it("deletes an uploaded file", async () => {
    const storagePath = await adapter.uploadFile("proj1", Buffer.from("bye"), "temp.txt", "text/plain");
    expect(await adapter.deleteFile(storagePath)).toBe(true);
    await expect(adapter.readFile(storagePath)).rejects.toThrow();
  });

  it("reports false when deleting a file that doesn't exist", async () => {
    expect(await adapter.deleteFile("local://" + path.join(tmpDir, "proj1", "missing.txt"))).toBe(false);
  });

  it("checkReachable reports true for a writable directory", async () => {
    expect(await adapter.checkReachable()).toBe(true);
  });

  it("exists reports true for an uploaded file and false after deletion", async () => {
    const storagePath = await adapter.uploadFile("proj1", Buffer.from("x"), "notes.txt", "text/plain");
    expect(await adapter.exists(storagePath)).toBe(true);

    await adapter.deleteFile(storagePath);
    expect(await adapter.exists(storagePath)).toBe(false);
  });

  it("exists reports false for a path that was never uploaded", async () => {
    expect(await adapter.exists("local://" + path.join(tmpDir, "proj1", "missing.txt"))).toBe(false);
  });
});
