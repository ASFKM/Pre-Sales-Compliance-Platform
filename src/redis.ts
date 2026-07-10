import fs from "fs";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error("REDIS_URL must be configured - sessions are stored in Redis.");
}

// Fase 1 of the Zero Trust rollout (SSL on Redis). Only enabled when REDIS_SSL_CA_PATH is set,
// pointing at the internal CA's public cert (not a secret) - same pattern as src/prisma.ts's
// DATABASE_SSL_CA_PATH, keeps CI/dev without that CA working unchanged. When set, REDIS_URL is
// also expected to use rediss:// and point at Redis's tls-port, not the plain port.
const tlsConfig = process.env.REDIS_SSL_CA_PATH
  ? { ca: fs.readFileSync(process.env.REDIS_SSL_CA_PATH, "utf8"), rejectUnauthorized: true }
  : undefined;

export const redis = new Redis(REDIS_URL, tlsConfig ? { tls: tlsConfig } : {});
