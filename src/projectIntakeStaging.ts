import { redis } from "./redis";

// Short-lived staging area for the Phase 4 "upload-first" project creation flow: documents are
// uploaded and analyzed before any Project row exists, tracked here by a session id, then
// migrated to permanent storage only once the user confirms. Abandoned sessions expire on their
// own via Redis TTL - no separate purge job needed.
const SESSION_TTL_SECONDS = 2 * 60 * 60;

export interface StagedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  extractedText: string;
}

export interface StagingSession {
  id: string;
  tenantId: string;
  userId: string;
  files: StagedFile[];
  suggestedFields: Record<string, any> | null;
  createdAt: string;
}

function randomId(prefix: string): string {
  return `${prefix}_` + Math.random().toString(36).substring(2, 11);
}

function sessionKey(id: string): string {
  return `intake:${id}:meta`;
}

function fileBufferKey(sessionId: string, fileId: string): string {
  return `intake:${sessionId}:file:${fileId}`;
}

async function saveSession(session: StagingSession): Promise<void> {
  await redis.set(sessionKey(session.id), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
}

export async function createSession(tenantId: string, userId: string): Promise<StagingSession> {
  const session: StagingSession = {
    id: randomId("intake"),
    tenantId,
    userId,
    files: [],
    suggestedFields: null,
    createdAt: new Date().toISOString(),
  };
  await saveSession(session);
  return session;
}

export async function getSession(id: string): Promise<StagingSession | undefined> {
  const raw = await redis.get(sessionKey(id));
  return raw ? JSON.parse(raw) : undefined;
}

export async function addFile(
  sessionId: string,
  file: { filename: string; mimeType: string; size: number; buffer: Buffer; extractedText: string }
): Promise<StagingSession> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error("Staging session not found or expired.");
  }

  const fileId = randomId("file");
  await redis.set(fileBufferKey(sessionId, fileId), file.buffer, "EX", SESSION_TTL_SECONDS);
  session.files.push({ id: fileId, filename: file.filename, mimeType: file.mimeType, size: file.size, extractedText: file.extractedText });
  await saveSession(session);
  return session;
}

export async function removeFile(sessionId: string, fileId: string): Promise<StagingSession | undefined> {
  const session = await getSession(sessionId);
  if (!session) return undefined;

  session.files = session.files.filter((f) => f.id !== fileId);
  await redis.del(fileBufferKey(sessionId, fileId));
  await saveSession(session);
  return session;
}

export async function getFileBuffer(sessionId: string, fileId: string): Promise<Buffer | null> {
  return redis.getBuffer(fileBufferKey(sessionId, fileId));
}

export async function setSuggestedFields(sessionId: string, fields: Record<string, any>): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error("Staging session not found or expired.");
  }
  session.suggestedFields = fields;
  await saveSession(session);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (session) {
    for (const f of session.files) {
      await redis.del(fileBufferKey(sessionId, f.id));
    }
  }
  await redis.del(sessionKey(sessionId));
}
