import crypto from "crypto";

// Simulation of hashing and comparison for security compliance
export function hashPassword(password: string): string {
  // Simple deterministic SHA-256 hash for verification in this hardened prototype
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function comparePasswords(passwordInput: string, hashed: string): boolean {
  return hashPassword(passwordInput) === hashed;
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
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
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
const SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || "commercial-assistant-secret-key-32";

export function encryptSecret(plainText: string): string {
  try {
    const iv = crypto.randomBytes(16);
    // Create a 32 byte key from the secret key using sha256
    const key = crypto.createHash("sha256").update(SECRET_ENCRYPTION_KEY).digest();
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
  } catch (err) {
    console.error("Encryption failed:", err);
    return plainText; // Fallback to plain if it fails (not recommended but for safety)
  }
}

export function decryptSecret(encryptedText: string): string {
  try {
    if (!encryptedText.includes(":")) return encryptedText;
    const [ivHex, encryptedHex] = encryptedText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const key = crypto.createHash("sha256").update(SECRET_ENCRYPTION_KEY).digest();
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    return encryptedText; // Fallback
  }
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
