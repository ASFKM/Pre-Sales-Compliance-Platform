import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import {
  createSession,
  getSession,
  deleteSession,
  comparePasswords,
  hashPassword,
  verifySessionMfa,
  generateTotpSecret,
  buildTotpEnrollmentUri,
  buildTotpQrCodeDataUrl,
  verifyTotpCode,
  encryptSecret,
  decryptSecret
} from "../utils/security";
import { logDebugMessage } from "../middleware/security";
import { isProductionRuntime, isDemoRuntime } from "../config/runtime";

const router = express.Router();

// Seed password hashes for initial users if they do not exist
async function ensurePasswordHashes() {
  if (isProductionRuntime()) {
    return;
  }

  const users = await dbStore.getUsers();
  for (const u of users) {
    const existingHash = await dbStore.getUserPasswordHash(u.id);
    if (!existingHash) {
      // Demo-only seeded password. Never auto-created in production runtime.
      await dbStore.updateUser(u.id, { password_hash: hashPassword("password123") });
    }
  }
}

function buildSessionUser(user: any, role: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mfa_enabled: user.mfa_enabled,
    role_id: user.role_id,
    role: role?.name || "Unknown Role",
    permissions: role?.permissions || []
  };
}

// Session validation middleware to protect modular endpoints
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-unknown";

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authorization token required." });
  }

  try {
    const token = authHeader.split(" ")[1];
    const session = await getSession(token);

    if (!session) {
      return res.status(401).json({ success: false, message: "Invalid or expired session token.", correlationId });
    }

    if (!session.mfaVerified) {
      return res.status(401).json({
        success: false,
        code: "MFA_REQUIRED",
        message: "MFA verification is required before accessing this endpoint.",
        correlationId
      });
    }

    // Bind session info to request headers for downstream endpoint use
    req.headers["x-user-id"] = session.userId;
    req.headers["x-role-id"] = session.roleId;
    req.headers["x-session-token"] = token;

    next();
  } catch (err) {
    next(err);
  }
}

// Admin validation middleware
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async () => {
    try {
      const roleId = req.headers["x-role-id"] as string;
      const role = await dbStore.getRoleById(roleId);

      if (!role || role.name !== "Administrator") {
        return res.status(403).json({
          success: false,
          message: "Access Denied: Administrator privileges required."
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  });
}

// RBAC Authorization Middleware creator
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, async () => {
      try {
        const roleId = req.headers["x-role-id"] as string;
        const role = await dbStore.getRoleById(roleId);

        if (!role || !role.permissions.includes(permission)) {
          return res.status(403).json({
            success: false,
            message: `Forbidden: Missing required permission [${permission}]`
          });
        }
        next();
      } catch (err) {
        next(err);
      }
    });
  };
}

// LOGIN ENDPOINT
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-auth";
  const startTime = Date.now();

  try {
    await ensurePasswordHashes();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await dbStore.getUserByEmail(email.toLowerCase().trim());
    const passwordHash = user ? await dbStore.getUserPasswordHash(user.id) : null;

    if (!user || !comparePasswords(password, passwordHash || "")) {
      logDebugMessage({
        operation: "User Authentication",
        message: `Failed login attempt for email: ${email}`,
        status: "WARN",
        durationMs: Date.now() - startTime,
        correlationId
      });
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    if (user.status && user.status !== "ACTIVE") {
      await dbStore.addAuditLog({
        user_id: user.id,
        action: "Blocked Login For Non-Active User",
        entity_type: "Authentication",
        entity_id: user.id,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ email: user.email, status: user.status })
      });

      return res.status(403).json({
        success: false,
        message: "User account is not active."
      });
    }

    if (isProductionRuntime() && comparePasswords("password123", passwordHash || "")) {
      await dbStore.addAuditLog({
        user_id: user.id,
        action: "Blocked Default Demo Credential Login",
        entity_type: "Authentication",
        entity_id: user.id,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ email: user.email })
      });

      return res.status(403).json({
        success: false,
        message: "Default demo credentials are disabled in production runtime."
      });
    }

    // Generate secure session token (MFA required if user profile has mfa_enabled = true)
    const mfaRequired = user.mfa_enabled;
    const session = await createSession(user.id, user.role_id, mfaRequired);
    const role = await dbStore.getRoleById(user.role_id);

    logDebugMessage({
      operation: "User Authentication",
      message: `Successful credentials check for ${user.name}. MFA Required: ${mfaRequired}`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      userId: user.id
    });

    // Create Audit Log
    await dbStore.addAuditLog({
      user_id: user.name,
      action: "Credential Challenge Passed",
      entity_type: "User",
      entity_id: user.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ email: user.email, mfa_required: mfaRequired })
    });

    res.json({
      success: true,
      mfa_required: mfaRequired,
      token: session.token,
      user: buildSessionUser(user, role)
    });

  } catch (err) {
    next(err);
  }
});

// MFA ENROLLMENT ENDPOINT - generates a real TOTP secret for the logged-in-but-not-yet-MFA-verified
// session. Uses the login token directly (like /mfa/verify), not requireAuth, since a user who has
// just entered valid credentials but hasn't completed MFA yet cannot pass requireAuth. Re-enrollment
// (secret already exists) requires the session to already be mfaVerified, so a stolen password alone
// can never be used to silently reset someone's MFA - only an administrator can do that (via user
// update, which clears the secret).
router.post("/mfa/enroll", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: "Token is required." });
    }

    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ success: false, message: "Invalid or expired login session." });
    }

    const user = await dbStore.getUserById(session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (!user.mfa_enabled) {
      return res.status(400).json({ success: false, message: "MFA is not enabled for this account." });
    }

    const existingSecret = await dbStore.getUserMfaSecretEncrypted(user.id);
    if (existingSecret && !session.mfaVerified) {
      return res.status(403).json({
        success: false,
        message: "MFA is already configured for this account. Complete MFA verification to re-enroll, or ask an administrator to reset it."
      });
    }

    const secret = generateTotpSecret();
    const otpauthUrl = buildTotpEnrollmentUri(user.email, secret);
    const qrCode = await buildTotpQrCodeDataUrl(otpauthUrl);

    await dbStore.setUserMfaSecret(user.id, encryptSecret(secret));

    await dbStore.addAuditLog({
      user_id: user.name,
      action: existingSecret ? "MFA TOTP Re-enrolled" : "MFA TOTP Enrolled",
      entity_type: "User",
      entity_id: user.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({})
    });

    res.json({ success: true, secret, otpauth_url: otpauthUrl, qr_code: qrCode });
  } catch (err) {
    next(err);
  }
});

// MFA VERIFY ENDPOINT
router.post("/mfa/verify", async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-mfa";
  const startTime = Date.now();

  try {
    const { token, code } = req.body;

    if (!token || !code) {
      return res.status(400).json({ success: false, message: "Token and verification code are required." });
    }

    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ success: false, message: "Invalid or expired login session." });
    }

    // Real TOTP if the account has enrolled a secret; demo codes only remain valid as a
    // bootstrapping/testing fallback for accounts that haven't enrolled a real secret yet.
    const encryptedSecret = await dbStore.getUserMfaSecretEncrypted(session.userId);
    let mfaAccepted = false;

    if (encryptedSecret) {
      mfaAccepted = verifyTotpCode(decryptSecret(encryptedSecret), code);
    } else if (isDemoRuntime()) {
      mfaAccepted = code === "123456" || code === "000000" || code === "111111";
    }

    if (mfaAccepted) {
      await verifySessionMfa(token);

      const user = await dbStore.getUserById(session.userId);
      if (user) {
        await dbStore.setUserLastLogin(user.id);
      }

      logDebugMessage({
        operation: "MFA Verification",
        message: `MFA verification passed for session of user: ${session.userId}`,
        status: "SUCCESS",
        durationMs: Date.now() - startTime,
        correlationId,
        userId: session.userId
      });

      await dbStore.addAuditLog({
        user_id: user?.name || session.userId,
        action: "MFA Multi-Factor Challenge Verified",
        entity_type: "User",
        entity_id: session.userId,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ mfa_verified: true })
      });

      const role = user ? await dbStore.getRoleById(user.role_id) : null;

      return res.json({
        success: true,
        verified: true,
        user: user ? buildSessionUser(user, role) : null
      });
    }

    return res.status(400).json({
      success: false,
      message: encryptedSecret
        ? "Invalid MFA verification code."
        : "MFA is enabled for this account but not yet enrolled. Call /api/auth/mfa/enroll first."
    });
  } catch (err) {
    next(err);
  }
});

// LOGOUT ENDPOINT
router.post("/logout", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers["x-session-token"] as string;
  const userId = req.headers["x-user-id"] as string;

  try {
    const user = await dbStore.getUserById(userId);
    await deleteSession(token);

    await dbStore.addAuditLog({
      user_id: user?.name || "Unknown",
      action: "Session Terminated",
      entity_type: "User",
      entity_id: userId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({})
    });

    res.json({ success: true, message: "Logged out successfully." });
  } catch (err) {
    next(err);
  }
});

// GET CURRENT SESSION PROFILE
router.get("/me", async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthenticated." });
  }

  try {
    const token = authHeader.split(" ")[1];
    const session = await getSession(token);

    if (!session) {
      return res.status(401).json({ success: false, message: "Session expired or invalid." });
    }

    if (!session.mfaVerified) {
      return res.status(401).json({
        success: false,
        code: "MFA_REQUIRED",
        message: "MFA verification is required before accessing this endpoint."
      });
    }

    const user = await dbStore.getUserById(session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const role = await dbStore.getRoleById(user.role_id);

    res.json({
      success: true,
      user: buildSessionUser(user, role)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
