import crypto from "crypto";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { isProductionRuntime } from "../config/runtime";
import { redis } from "../../src/redis";

const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_HASH_KEY_LENGTH = 64;
const PASSWORD_HASH_SALT_LENGTH = 16;

function legacySha256PasswordHash(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function safeEqualHex(leftHex: string, rightHex: string): boolean {
  try {
    const left = Buffer.from(leftHex, "hex");
    const right = Buffer.from(rightHex, "hex");

    if (left.length !== right.length) {
      return false;
    }

    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(PASSWORD_HASH_SALT_LENGTH).toString("hex");
  const derived = crypto.scryptSync(password, salt, PASSWORD_HASH_KEY_LENGTH).toString("hex");
  return `${PASSWORD_HASH_ALGORITHM}$${salt}$${derived}`;
}

export function isLegacyPasswordHash(hashed: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hashed);
}

export function comparePasswords(passwordInput: string, hashed: string): boolean {
  if (!hashed) return false;

  if (hashed.startsWith(`${PASSWORD_HASH_ALGORITHM}$`)) {
    const parts = hashed.split("$");
    if (parts.length !== 3) return false;

    const [, salt, storedDerived] = parts;
    const derived = crypto.scryptSync(passwordInput, salt, PASSWORD_HASH_KEY_LENGTH).toString("hex");
    return safeEqualHex(derived, storedDerived);
  }

  if (isLegacyPasswordHash(hashed)) {
    return safeEqualHex(legacySha256PasswordHash(passwordInput), hashed);
  }

  return false;
}

function getSessionTtlMs(): number {
  const raw = process.env.SESSION_TTL_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : 60;

  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 1440) {
    return 60 * 60 * 1000;
  }

  return parsed * 60 * 1000;
}

// Sessions: a signed JWT carries only an opaque session id (sid). The actual session
// state (who, which role, whether MFA is verified) lives in Redis keyed by that sid,
// with a TTL matching the JWT expiry. This lets the client keep reusing the same token
// across the pre-MFA and post-MFA phases (mfaVerified flips server-side in Redis),
// lets logout truly revoke a token (delete the Redis key), and lets sessions survive
// an app restart / work across multiple instances - none of which a bare in-memory
// Map nor a fully stateless JWT (which can't be revoked or mutated) could do.
export interface Session {
  token: string;
  userId: string;
  roleId: string;
  mfaVerified: boolean;
  createdAt: Date;
  expiresAt: Date;
}

interface SessionRecord {
  userId: string;
  roleId: string;
  mfaVerified: boolean;
  createdAt: string;
  expiresAt: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SESSION_SECRET must be configured with a strong value.");
  }
  return secret;
}

function sessionRedisKey(sid: string): string {
  return `session:${sid}`;
}

function decodeSid(token: string): string | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sid?: string };
    return payload.sid || null;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, roleId: string, mfaRequired: boolean): Promise<Session> {
  const sid = crypto.randomUUID();
  const ttlMs = getSessionTtlMs();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlMs);

  const record: SessionRecord = {
    userId,
    roleId,
    mfaVerified: !mfaRequired,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await redis.set(sessionRedisKey(sid), JSON.stringify(record), "PX", ttlMs);

  const token = jwt.sign({ sid }, getJwtSecret(), { expiresIn: Math.floor(ttlMs / 1000) });

  return { token, userId, roleId, mfaVerified: record.mfaVerified, createdAt, expiresAt };
}

export async function getSession(token: string): Promise<Session | undefined> {
  const sid = decodeSid(token);
  if (!sid) return undefined;

  const raw = await redis.get(sessionRedisKey(sid));
  if (!raw) return undefined;

  const record: SessionRecord = JSON.parse(raw);
  return {
    token,
    userId: record.userId,
    roleId: record.roleId,
    mfaVerified: record.mfaVerified,
    createdAt: new Date(record.createdAt),
    expiresAt: new Date(record.expiresAt),
  };
}

export async function deleteSession(token: string): Promise<void> {
  const sid = decodeSid(token);
  if (!sid) return;
  await redis.del(sessionRedisKey(sid));
}

export async function verifySessionMfa(token: string): Promise<boolean> {
  const sid = decodeSid(token);
  if (!sid) return false;

  const key = sessionRedisKey(sid);
  const raw = await redis.get(key);
  if (!raw) return false;

  const record: SessionRecord = JSON.parse(raw);
  record.mfaVerified = true;

  const remainingTtlMs = await redis.pttl(key);
  if (remainingTtlMs > 0) {
    await redis.set(key, JSON.stringify(record), "PX", remainingTtlMs);
  } else {
    await redis.set(key, JSON.stringify(record));
  }

  return true;
}

// Encrypt and mask sensitive keys
const DEFAULT_SECRET_ENCRYPTION_KEY = "commercial-assistant-secret-key-32";

function getSecretEncryptionKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;

  if (isProductionRuntime() && (!raw || raw === DEFAULT_SECRET_ENCRYPTION_KEY || raw.length < 32)) {
    throw new Error("SECRET_ENCRYPTION_KEY must be configured with a strong value in production runtime.");
  }

  const effective = raw || DEFAULT_SECRET_ENCRYPTION_KEY;
  return crypto.createHash("sha256").update(effective).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const key = getSecretEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  return `v2:${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptSecret(encryptedText: string): string {
  if (!encryptedText) return "";

  if (encryptedText.startsWith("v2:")) {
    const [, ivHex, authTagHex, encryptedHex] = encryptedText.split(":");

    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error("Invalid encrypted secret format.");
    }

    const key = getSecretEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  if (!encryptedText.includes(":")) {
    return encryptedText;
  }

  // Legacy AES-CBC compatibility for secrets saved before authenticated encryption.
  const [ivHex, encryptedHex] = encryptedText.split(":");
  const key = getSecretEncryptionKey();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(ivHex, "hex"));

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "********";
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
}

export function sanitizeAndMaskObject(obj: any): any {
  if (!obj) return obj;
  const cloned = JSON.parse(JSON.stringify(obj));
  
  const sensitiveKeys = [
    "password", "token", "apiKey", "api_key", "secret", "privateKey", 
    "private_key", "authorization", "cookie", "session"
  ];
  
  const mask = (item: any) => {
    if (typeof item !== "object" || item === null) return;
    for (const key in item) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        if (typeof item[key] === "string") {
          item[key] = maskSecret(item[key]);
        }
      } else if (typeof item[key] === "object") {
        mask(item[key]);
      }
    }
  };
  
  mask(cloned);
  return cloned;
}

// Real TOTP MFA (RFC 6238), compatible with Google Authenticator / Authy / 1Password etc.
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildTotpEnrollmentUri(email: string, secret: string): string {
  return authenticator.keyuri(email, "Commercial Assistant AI", secret);
}

export async function buildTotpQrCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}
