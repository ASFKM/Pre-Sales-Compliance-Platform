import crypto from "crypto";
import { isProductionRuntime } from "../config/runtime";

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

// Memory-based session store mapping session tokens to user records
export interface Session {
  token: string;
  userId: string;
  roleId: string;
  mfaVerified: boolean;
  createdAt: Date;
  expiresAt: Date;
}

const sessionStore = new Map<string, Session>();

export function createSession(userId: string, roleId: string, mfaRequired: boolean): Session {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + getSessionTtlMs());
  const session: Session = {
    token,
    userId,
    roleId,
    mfaVerified: !mfaRequired,
    createdAt: new Date(),
    expiresAt,
  };
  sessionStore.set(token, session);
  return session;
}

export function getSession(token: string): Session | undefined {
  const session = sessionStore.get(token);
  if (!session) return undefined;
  if (session.expiresAt < new Date()) {
    sessionStore.delete(token);
    return undefined;
  }
  return session;
}

export function deleteSession(token: string): void {
  sessionStore.delete(token);
}

export function verifySessionMfa(token: string): boolean {
  const session = sessionStore.get(token);
  if (session) {
    session.mfaVerified = true;
    return true;
  }
  return false;
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
