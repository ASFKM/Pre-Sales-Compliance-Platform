import dotenv from "dotenv";

dotenv.config();

// Fallbacks so unit tests that only touch pure functions (crypto, validation) can run without a
// real .env present - integration-style tests still need real DATABASE_URL/REDIS_URL from the
// environment (CI provides them via service containers).
process.env.SECRET_ENCRYPTION_KEY ||= "test-only-secret-encryption-key-32b";
process.env.JWT_SESSION_SECRET ||= "test-only-jwt-session-secret";
process.env.REDIS_URL ||= "redis://localhost:6379";
