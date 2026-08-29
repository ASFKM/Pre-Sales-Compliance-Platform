import crypto from "crypto";
import jwt from "jsonwebtoken";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
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

// Phase 2 (auth hardening): the access token is now backed by refresh token rotation (below),
// so it can - and should - be short-lived; a silent refresh in the frontend renews it before it
// expires. Bounded to [5, 30] minutes even if overridden - a long-lived "access" token would
// defeat the point of having a separate refresh token at all.
function getSessionTtlMs(): number {
  const raw = process.env.SESSION_TTL_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : 10;

  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 30) {
    return 10 * 60 * 1000;
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

// AUD-006 (auditoria de segurança, 2026-07-19): EventSource não pode setar cabeçalhos
// customizados, então o token de sessão completo (válido por horas) ia direto na query string
// (`?token=...`) - risco real de aparecer em logs de acesso, histórico do navegador e cabeçalho
// Referer. Ticket separado do token de sessão, com uma janela de validade bem mais curta (5 min
// contra horas) reduz drasticamente essa exposição.
//
// Deliberadamente NÃO é de uso único: o EventSource nativo do browser reconecta sozinho usando a
// MESMA URL sempre que a conexão cai (rede instável, deploy, restart do servidor) - um ticket
// consumido na primeira conexão travaria toda reconexão automática depois da primeira, um bug
// pior que o problema original. Reutilizável dentro da janela de 5 min é a troca certa aqui:
// reduz a exposição de "horas" pra "no máximo 5 minutos" sem quebrar a reconexão nativa.
const SSE_TICKET_TTL_MS = 5 * 60_000;

function sseTicketRedisKey(ticket: string): string {
  return `sse-ticket:${ticket}`;
}

export async function issueSseTicket(userId: string, roleId: string): Promise<string> {
  const ticket = crypto.randomBytes(24).toString("hex");
  await redis.set(sseTicketRedisKey(ticket), JSON.stringify({ userId, roleId }), "PX", SSE_TICKET_TTL_MS);
  return ticket;
}

export async function resolveSseTicket(ticket: string): Promise<{ userId: string; roleId: string } | null> {
  const raw = await redis.get(sseTicketRedisKey(ticket));
  if (!raw) return null;
  return JSON.parse(raw);
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

// Phase 2 (auth hardening): refresh token rotation with reuse detection, and an absolute 7-day
// session lifetime independent of activity. A "family" is one continuous login (starting at the
// real credential+MFA check) - every rotation issues a new refresh token but keeps the same
// familyId and the same absolute expiry fixed at family creation. If an already-rotated-away
// refresh token is presented again, that's the signature of a stolen token being replayed (the
// legitimate client would have the *new* one) - so the whole family is revoked, forcing a real
// login, not just the one token.
export const REFRESH_TOKEN_COOKIE_NAME = "ca_refresh_token";
const ABSOLUTE_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
// Old refresh tokens are kept around briefly (rather than deleted outright) after rotation
// specifically so a reuse attempt within this window is still detectable instead of just
// looking like "expired token, please log in again".
const USED_TOKEN_REUSE_DETECTION_WINDOW_MS = 60 * 1000;

interface RefreshFamilyRecord {
  userId: string;
  roleId: string;
  absoluteExpiresAt: string;
}

interface RefreshTokenRecord {
  familyId: string;
  used: boolean;
}

function refreshFamilyKey(familyId: string): string {
  return `reffamily:${familyId}`;
}

function refreshTokenKey(token: string): string {
  return `reftoken:${token}`;
}

async function issueRefreshToken(familyId: string, absoluteExpiresAt: Date): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const ttlMs = absoluteExpiresAt.getTime() - Date.now();
  const record: RefreshTokenRecord = { familyId, used: false };
  await redis.set(refreshTokenKey(token), JSON.stringify(record), "PX", Math.max(ttlMs, 1000));
  return token;
}

// Call once full authentication succeeds (no MFA required, or MFA just verified) - starts a new
// family with a fresh 7-day absolute expiry.
export async function createRefreshFamily(userId: string, roleId: string): Promise<string> {
  const familyId = crypto.randomUUID();
  const absoluteExpiresAt = new Date(Date.now() + ABSOLUTE_SESSION_LIFETIME_MS);
  const record: RefreshFamilyRecord = { userId, roleId, absoluteExpiresAt: absoluteExpiresAt.toISOString() };
  await redis.set(refreshFamilyKey(familyId), JSON.stringify(record), "PX", ABSOLUTE_SESSION_LIFETIME_MS);
  return issueRefreshToken(familyId, absoluteExpiresAt);
}

export async function revokeRefreshFamily(familyId: string): Promise<void> {
  await redis.del(refreshFamilyKey(familyId));
}

// Deliberate logout, as opposed to rotateRefreshToken's theft-detection path - just ends the
// family the presented token belongs to.
export async function revokeRefreshToken(token: string): Promise<void> {
  const raw = await redis.get(refreshTokenKey(token));
  if (!raw) return;
  const record: RefreshTokenRecord = JSON.parse(raw);
  await revokeRefreshFamily(record.familyId);
}

// Rotates a refresh token: returns a new access-token session + new refresh token, or null if
// the token is unknown/expired/reused/the family's absolute lifetime has passed - any of which
// means "the frontend must send the user back through a real login."
function refreshTokenClaimKey(token: string): string {
  return `reftoken-claim:${token}`;
}

export async function rotateRefreshToken(oldToken: string): Promise<{ session: Session; refreshToken: string } | null> {
  const raw = await redis.get(refreshTokenKey(oldToken));
  if (!raw) return null;

  const record: RefreshTokenRecord = JSON.parse(raw);

  // AUD-007 (auditoria de segurança, 2026-07-19): antes, "ler o registro" e "marcar como usado"
  // eram duas operações Redis separadas (GET, depois SET) - duas requisições de refresh
  // concorrentes com o MESMO token podiam ambas passar pela checagem `record.used` antes de
  // qualquer uma delas marcar, e ambas emitiam sessão/refresh token novos (corrida real, não
  // hipotética). SET ... NX é atômico por natureza do Redis - só a PRIMEIRA chamada concorrente
  // consegue gravar a chave de reivindicação, qualquer outra falha na hora, sem essa janela.
  const claimed = await redis.set(refreshTokenClaimKey(oldToken), "1", "PX", USED_TOKEN_REUSE_DETECTION_WINDOW_MS, "NX");
  if (claimed !== "OK" || record.used) {
    // Perdeu a corrida agora (concorrência genuína) ou já tinha sido usado antes (replay de
    // verdade) - os dois casos são tratados igual, como reuso suspeito.
    await revokeRefreshFamily(record.familyId);
    return null;
  }

  const familyRaw = await redis.get(refreshFamilyKey(record.familyId));
  if (!familyRaw) return null;

  const family: RefreshFamilyRecord = JSON.parse(familyRaw);
  const absoluteExpiresAt = new Date(family.absoluteExpiresAt);
  if (absoluteExpiresAt.getTime() <= Date.now()) {
    await revokeRefreshFamily(record.familyId);
    return null;
  }

  await redis.set(
    refreshTokenKey(oldToken),
    JSON.stringify({ ...record, used: true }),
    "PX",
    USED_TOKEN_REUSE_DETECTION_WINDOW_MS
  );

  const newRefreshToken = await issueRefreshToken(record.familyId, absoluteExpiresAt);
  const session = await createSession(family.userId, family.roleId, false);

  return { session, refreshToken: newRefreshToken };
}

// Encrypt and mask sensitive keys
function getSecretEncryptionKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("SECRET_ENCRYPTION_KEY must be configured with a strong value.");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

// 16 bytes (128 bits) is Node's own default when authTagLength is omitted - making it explicit
// (semgrep javascript.node-crypto.security.gcm-no-tag-length) closes the theoretical risk of a
// future Node/OpenSSL default change silently accepting a shorter, weaker tag. No format change:
// getAuthTag() with the default already returns 16 bytes, so this doesn't affect the "v2:"
// encrypted secrets already stored.
const GCM_AUTH_TAG_LENGTH = 16;

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const key = getSecretEncryptionKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_AUTH_TAG_LENGTH });

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
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"), { authTagLength: GCM_AUTH_TAG_LENGTH });
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

// Single source of truth for "this field name means the value is a secret/PII and must never
// reach a log or an exported report in the clear". Matched as a substring of the (lowercased) key
// name, so e.g. "token" alone already covers "refreshToken"/"refresh_token", and "secret" already
// covers "clientSecret"/"webhook_secret" - no need to enumerate every compound name. Exported so
// server/utils/logger.ts's Pino `redact` config derives from this exact list instead of a second,
// independently-maintained copy.
//
// "apikey"/"privatekey" below (lowercase), not "apiKey"/"privateKey" - the match lowercases the
// real key name before comparing, but .includes() itself is case-sensitive, so those two entries
// in their original mixed-case form never actually matched anything
// ("apikey".includes("apiKey") is false). A camelCase field named `apiKey` was silently never
// caught by this sanitizer; the snake_case `api_key` form happened to still work since it had no
// case mismatch.
export const SENSITIVE_KEY_SUBSTRINGS = [
  "password", "token", "apikey", "api_key", "secret", "privatekey",
  "private_key", "authorization", "cookie", "session",
  "totp", // catches mfaTotpSecret/mfa_totp_secret too
  "cpf", "cnpj", "ssn", // Brazilian/US PII identifiers
];

export function sanitizeAndMaskObject(obj: any): any {
  if (!obj) return obj;
  const cloned = JSON.parse(JSON.stringify(obj));

  const mask = (item: any) => {
    if (typeof item !== "object" || item === null) return;
    for (const key in item) {
      if (SENSITIVE_KEY_SUBSTRINGS.some(sk => key.toLowerCase().includes(sk))) {
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
// otplib v13 is a complete rewrite (the old `authenticator` singleton was removed outright) - this
// uses the new functional API. `epochTolerance: 30` (one 30s period each side) reproduces the old
// `authenticator.options = { window: 1 }` behavior, which also allowed one period of clock drift
// each direction.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildTotpEnrollmentUri(email: string, secret: string): string {
  return generateURI({ issuer: "Commercial Assistant AI", label: email, secret });
}

export async function buildTotpQrCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri);
}

// otplib v13's verify() is async (it returns Promise<VerifyResult>, not a boolean) - every caller
// of this function was already inside an async handler, so this just adds an `await`.
export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token: code, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS });
    return result.valid;
  } catch {
    return false;
  }
}
