import express, { Request, Response, NextFunction } from "express";
import { dbStore } from "../../src/dbStore";
import { 
  createSession, 
  getSession, 
  deleteSession, 
  comparePasswords, 
  hashPassword,
  verifySessionMfa
} from "../utils/security";
import { logDebugMessage } from "../middleware/security";
import { isProductionRuntime, isDemoRuntime } from "../config/runtime";

const router = express.Router();

// Seed password hashes for initial users if they do not exist
function ensurePasswordHashes() {
  if (isProductionRuntime()) {
    return;
  }

  const users = dbStore.getData().users;
  users.forEach((u: any) => {
    if (!u.password_hash) {
      // Demo-only seeded password. Never auto-created in production runtime.
      u.password_hash = hashPassword("password123");
    }
  });
}

// Session validation middleware to protect modular endpoints
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-unknown";

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Authorization token required." });
  }

  const token = authHeader.split(" ")[1];
  const session = getSession(token);

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
}

// Admin validation middleware
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    const roleId = req.headers["x-role-id"] as string;
    const role = dbStore.getData().roles.find(r => r.id === roleId);

    if (!role || role.name !== "Administrator") {
      return res.status(403).json({ 
        success: false, 
        message: "Access Denied: Administrator privileges required." 
      });
    }
    next();
  });
}

// RBAC Authorization Middleware creator
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      const roleId = req.headers["x-role-id"] as string;
      const role = dbStore.getData().roles.find(r => r.id === roleId);

      if (!role || !role.permissions.includes(permission)) {
        return res.status(403).json({ 
          success: false, 
          message: `Forbidden: Missing required permission [${permission}]` 
        });
      }
      next();
    });
  };
}

// LOGIN ENDPOINT
router.post("/login", (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-auth";
  const startTime = Date.now();
  
  try {
    ensurePasswordHashes();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = dbStore.getData().users.find((u: any) => u.email === email.toLowerCase().trim());
    if (!user || !comparePasswords(password, (user as any).password_hash)) {
      logDebugMessage({
        operation: "User Authentication",
        message: `Failed login attempt for email: ${email}`,
        status: "WARN",
        durationMs: Date.now() - startTime,
        correlationId
      });
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    if ((user as any).status && (user as any).status !== "ACTIVE") {
      dbStore.addAuditLog({
        user_id: user.id,
        action: "Blocked Login For Non-Active User",
        entity_type: "Authentication",
        entity_id: user.id,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ email: user.email, status: (user as any).status })
      });

      return res.status(403).json({
        success: false,
        message: "User account is not active."
      });
    }

    if (isProductionRuntime() && comparePasswords("password123", (user as any).password_hash)) {
      dbStore.addAuditLog({
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
    const session = createSession(user.id, user.role_id, mfaRequired);

    logDebugMessage({
      operation: "User Authentication",
      message: `Successful credentials check for ${user.name}. MFA Required: ${mfaRequired}`,
      status: "SUCCESS",
      durationMs: Date.now() - startTime,
      correlationId,
      userId: user.id
    });

    // Create Audit Log
    dbStore.addAuditLog({
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
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        mfa_enabled: user.mfa_enabled,
        role_id: user.role_id,
        role: user.role_id === "r1" ? "Administrator" : (user.role_id === "r2" ? "Sales Manager" : "Pre-Sales Engineer")
      }
    });

  } catch (err) {
    next(err);
  }
});

// MFA VERIFY ENDPOINT
router.post("/mfa/verify", (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-mfa";
  const startTime = Date.now();

  try {
    const { token, code } = req.body;

    if (!token || !code) {
      return res.status(400).json({ success: false, message: "Token and verification code are required." });
    }

    // Real MFA verification step: Accept placeholder valid code '123456' or '000000'
    const session = getSession(token);
    if (!session) {
      return res.status(401).json({ success: false, message: "Invalid or expired login session." });
    }

    const demoMfaAccepted = isDemoRuntime() && (code === "123456" || code === "000000" || code === "111111");

    if (demoMfaAccepted) {
      verifySessionMfa(token);
      
      const user = dbStore.getData().users.find(u => u.id === session.userId);
      if (user) {
        user.last_login_at = new Date().toISOString();
      }

      logDebugMessage({
        operation: "MFA Verification",
        message: `MFA verification passed for session of user: ${session.userId}`,
        status: "SUCCESS",
        durationMs: Date.now() - startTime,
        correlationId,
        userId: session.userId
      });

      dbStore.addAuditLog({
        user_id: user?.name || session.userId,
        action: "MFA Multi-Factor Challenge Verified",
        entity_type: "User",
        entity_id: session.userId,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ mfa_verified: true })
      });

      return res.json({
        success: true,
        verified: true,
        user: user ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role_id: user.role_id,
          role: user.role_id === "r1" ? "Administrator" : (user.role_id === "r2" ? "Sales Manager" : "Pre-Sales Engineer")
        } : null
      });
    }

    return res.status(400).json({
      success: false,
      message: isProductionRuntime()
        ? "MFA verification is not configured for production runtime."
        : "Invalid MFA verification code."
    });
  } catch (err) {
    next(err);
  }
});

// LOGOUT ENDPOINT
router.post("/logout", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers["x-session-token"] as string;
  const userId = req.headers["x-user-id"] as string;
  const user = dbStore.getData().users.find(u => u.id === userId);

  try {
    deleteSession(token);
    
    dbStore.addAuditLog({
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
router.get("/me", (req: Request, res: Response) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthenticated." });
  }

  const token = authHeader.split(" ")[1];
  const session = getSession(token);

  if (!session) {
    return res.status(401).json({ success: false, message: "Session expired or invalid." });
  }

  const user = dbStore.getData().users.find(u => u.id === session.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found." });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mfa_enabled: user.mfa_enabled,
      role_id: user.role_id,
      role: user.role_id === "r1" ? "Administrator" : (user.role_id === "r2" ? "Sales Manager" : "Pre-Sales Engineer")
    }
  });
});

export default router;
