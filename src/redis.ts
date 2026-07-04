import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  throw new Error("REDIS_URL must be configured - sessions are stored in Redis.");
}

export const redis = new Redis(REDIS_URL);
