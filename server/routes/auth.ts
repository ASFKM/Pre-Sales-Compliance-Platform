import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
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
  decryptSecret,
  createRefreshFamily,
  rotateRefreshToken,
  revokeRefreshToken,
  REFRESH_TOKEN_COOKIE_NAME
} from "../utils/security";
import { logDebugMessage, loginRateLimiter } from "../middleware/security";
import { isProductionRuntime, isDemoRuntime } from "../config/runtime";
import { runWithTenant } from "../../src/tenantContext";
import { isLockedOut, recordFailedAttempt, clearFailedAttempts } from "../utils/lockout";
import { checkLicenseEnforcement, getFleetLicenseStatus } from "../utils/fleetLicense";

const router = express.Router();

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProductionRuntime(),
    sameSite: "lax",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: "/api/auth",
  });
}

function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(REFRESH_TOKEN_COOKIE_NAME.length + 1)) : undefined;
}

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

// Async because enabled_modules comes from the cached, signature-verified Fleet Manager
// heartbeat (server/utils/fleetLicense.ts) - the same source AdminConsole's "Assinatura e
// Licença" already reads, just no longer gated behind admin:settings, so any authenticated user
// gets the module list needed to decide whether to render add-on nav tabs (e.g. Gestão de POC).
async function buildSessionUser(user: any, role: any) {
  const license = await getFleetLicenseStatus(user.tenant_id);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mfa_enabled: user.mfa_enabled,
    role_id: user.role_id,
    role: role?.name || "Unknown Role",
    permissions: role?.permissions || [],
    enabled_modules: license.modules
  };
}

interface RequireAuthOptions {
  // The fleet license status endpoint needs to stay reachable under full_lockout - otherwise an
  // admin has no way to see *why* they're blocked (plan, contract, block_mode) once the same
  // enforcement that's supposed to lock out real usage also locks out the screen explaining it.
  allowWhileLicenseBlocked?: boolean;
}

// Session validation middleware to protect modular endpoints
// `options` MUST carry a default value (not just be TypeScript-optional with `?`) - Function.length
// only counts parameters before the first one with a default, so this keeps requireAuth.length at
// 3. Express uses that raw JS arity to decide whether a middleware is regular (<=3 params) or
// error-handling (exactly 4, `(err, req, res, next)`) when it's registered directly in a route's
// handler array (e.g. `router.get("/", requireAuth, handler)`), as opposed to being called through
// requirePermission()/requireModule()'s own wrapper closures (which always have arity 3 and invoke
// requireAuth as a plain function call, unaffected by this). A bare `options?: RequireAuthOptions`
// silently made requireAuth.length === 4, which made Express treat it as error-handling middleware
// and skip it entirely for every normal (non-error) request on any route using it directly - a
// real, live authentication bypass, not a hypothetical: confirmed via production logs that
// requireAuth's own body never executed at all for GET /api/projects, on ALL 27 routes across the
// codebase that reference requireAuth directly rather than through requirePermission/requireModule.
export async function requireAuth(req: Request, res: Response, next: NextFunction, options: RequireAuthOptions = {}) {
  const authHeader = req.headers["authorization"];
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-unknown";

  // EventSource (used for the Phase 1 task-progress stream) can't set custom headers, so it's
  // the one legitimate case for passing the token as a query param instead of Authorization.
  // Every other client already sends it via the header, so this fallback doesn't change
  // behavior for them.
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : queryToken;

  if (!token) {
    return res.status(401).json({ success: false, message: "Authorization token required." });
  }

  try {
    const session = await getSession(token);

    if (!session) {
      return res.status(401).json({ success: false, message: "Invalid or expired session token.", correlationId });
    }

    // Defensive: a session (or a refresh-token-derived one, in particular) with no roleId is
    // corrupt, not just unauthenticated - dbStore.getRoleById(undefined) below would otherwise
    // throw a raw, unhandled PrismaClientValidationError instead of a clean 401 (confirmed live,
    // 2026-07-15: 72 identical 500s on /api/messages from one such session over about an hour).
    // Same recovery as any other invalid session: force a real login instead of crashing.
    if (!session.roleId) {
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

    // Unscoped lookup: we don't know the tenant until we resolve the session's user.
    const user = await dbStore.getUserById(session.userId);
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid or expired session token.", correlationId });
    }

    const role = await dbStore.getRoleById(session.roleId);
    const canSeeAllProjects = role?.permissions.includes("project:read_all") ?? false;

    // Phase 7 (fleet/license management): only ever blocks on an explicit, currently-valid,
    // signature-verified "suspended" status from the fleet manager - no cached status (never
    // registered, or the fleet manager has been unreachable) always allows through (fail-open).
    const enforcement = await checkLicenseEnforcement(user.tenant_id);
    if (enforcement.blocked && !options?.allowWhileLicenseBlocked) {
      return res.status(403).json({ success: false, code: "LICENSE_SUSPENDED", message: enforcement.message });
    }
    if (enforcement.readOnly && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return res.status(403).json({ success: false, code: "LICENSE_READ_ONLY", message: enforcement.message });
    }

    // Roadmap (segurança): true right after creation or after an admin resets the password -
    // blocks every requireAuth-protected route uniformly, same as MFA_REQUIRED above. No escape
    // hatch option here on purpose - the one route that must stay reachable
    // (POST /api/auth/change-password) doesn't go through requireAuth at all, it reads the login
    // token directly out of the request body, mirroring /mfa/enroll and /mfa/verify's own design.
    if (user.must_change_password) {
      return res.status(403).json({
        success: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "A senha precisa ser trocada antes de continuar."
      });
    }

    // Bind session info to request headers for downstream endpoint use
    req.headers["x-user-id"] = session.userId;
    req.headers["x-role-id"] = session.roleId;
    req.headers["x-session-token"] = token;
    req.headers["x-tenant-id"] = user.tenant_id;

    // Enrich the request-scoped logger (attached by pino-http in server.ts, present on every
    // request regardless of AsyncLocalStorage) the moment identity is actually known - every log
    // line from here on for this request carries userId/tenantId/roleId without each call site
    // having to pass them explicitly.
    if (req.log) {
      req.log = req.log.child({ userId: session.userId, tenantId: user.tenant_id, roleId: session.roleId });
    }

    runWithTenant(
      { tenantId: user.tenant_id, userId: session.userId, roleId: session.roleId, canSeeAllProjects },
      () => next()
    );
  } catch (err) {
    next(err);
  }
}

// RBAC Authorization Middleware creator
export function requirePermission(permission: string, options?: RequireAuthOptions) {
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
    }, options);
  };
}

// Add-on gating (Fase 6): defense in depth alongside hiding the nav tab on the frontend - a
// tenant without the module entitled gets a real 403 from the API, not just an invisible tab.
// Always chained after requirePermission/requireAuth so req.headers["x-tenant-id"] is already set.
export function requireModule(moduleName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, async () => {
      try {
        const tenantId = req.headers["x-tenant-id"] as string;
        const license = await getFleetLicenseStatus(tenantId);
        if (!license.modules.includes(moduleName)) {
          return res.status(403).json({
            success: false,
            message: `Forbidden: the "${moduleName}" module is not enabled for this installation.`
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
router.post("/login", loginRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-auth";
  const startTime = Date.now();

  try {
    await ensurePasswordHashes();
    const { email, password } = req.body;
    const ip = req.ip || "127.0.0.1";

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    if (await isLockedOut("pwd", email, ip)) {
      logDebugMessage({
        operation: "User Authentication",
        message: `Login blocked: account+IP locked out after repeated failures for email: ${email}`,
        status: "WARN",
        durationMs: Date.now() - startTime,
        correlationId
      });
      return res.status(429).json({ success: false, message: "Too many failed login attempts. Try again in 15 minutes." });
    }

    const user = await dbStore.getUserByEmail(email.toLowerCase().trim());
    const passwordHash = user ? await dbStore.getUserPasswordHash(user.id) : null;

    if (!user || !comparePasswords(password, passwordHash || "")) {
      await recordFailedAttempt("pwd", email, ip);
      logDebugMessage({
        operation: "User Authentication",
        message: `Failed login attempt for email: ${email}`,
        status: "WARN",
        durationMs: Date.now() - startTime,
        correlationId
      });
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    await clearFailedAttempts("pwd", email, ip);

    // Everything from here on knows the user, and therefore the tenant.
    await runWithTenant({ tenantId: user.tenant_id }, async () => {
      // Phase 7 (fleet/license management): full_lockout blocks the login itself, not just
      // authenticated calls after the fact - requireAuth alone can't cover this, since a brand
      // new session doesn't go through it yet. read_only intentionally isn't checked here: it
      // still allows login (see requireAuth's own GET/HEAD/OPTIONS carve-out for the rest).
      const enforcement = await checkLicenseEnforcement(user.tenant_id);
      if (enforcement.blocked) {
        await dbStore.addAuditLog({
          user_id: user.id,
          action: "Blocked Login For Suspended License",
          entity_type: "Authentication",
          entity_id: user.id,
          ip_address: req.ip || "127.0.0.1",
          user_agent: req.headers["user-agent"] || "unknown",
          metadata: JSON.stringify({ email: user.email })
        });

        res.status(403).json({
          success: false,
          code: "LICENSE_SUSPENDED",
          message: enforcement.message
        });
        return;
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

        res.status(403).json({
          success: false,
          message: "User account is not active."
        });
        return;
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

        res.status(403).json({
          success: false,
          message: "Default demo credentials are disabled in production runtime."
        });
        return;
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
        user_id: user.id,
        action: "Credential Challenge Passed",
        entity_type: "User",
        entity_id: user.id,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({ email: user.email, mfa_required: mfaRequired })
      });

      // No MFA needed - the user is fully authenticated right now, so start the refresh token
      // family here. If MFA IS required, the family only starts once /mfa/verify succeeds -
      // a password alone shouldn't grant a renewable session.
      if (!mfaRequired) {
        const refreshToken = await createRefreshFamily(user.id, user.role_id);
        setRefreshCookie(res, refreshToken);
      }

      res.json({
        success: true,
        mfa_required: mfaRequired,
        must_change_password: user.must_change_password,
        token: session.token,
        user: await buildSessionUser(user, role)
      });
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

    await runWithTenant({ tenantId: user.tenant_id }, async () => {
      if (!user.mfa_enabled) {
        res.status(400).json({ success: false, message: "MFA is not enabled for this account." });
        return;
      }

      const existingSecret = await dbStore.getUserMfaSecretEncrypted(user.id);
      if (existingSecret && !session.mfaVerified) {
        res.status(403).json({
          success: false,
          message: "MFA is already configured for this account. Complete MFA verification to re-enroll, or ask an administrator to reset it."
        });
        return;
      }

      const secret = generateTotpSecret();
      const otpauthUrl = buildTotpEnrollmentUri(user.email, secret);
      const qrCode = await buildTotpQrCodeDataUrl(otpauthUrl);

      await dbStore.setUserMfaSecret(user.id, encryptSecret(secret));

      await dbStore.addAuditLog({
        user_id: user.id,
        action: existingSecret ? "MFA TOTP Re-enrolled" : "MFA TOTP Enrolled",
        entity_type: "User",
        entity_id: user.id,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({})
      });

      res.json({ success: true, secret, otpauth_url: otpauthUrl, qr_code: qrCode });
    });
  } catch (err) {
    next(err);
  }
});

// PASSWORD CHANGE ENDPOINT (roadmap, segurança) - self-service, covers both the mandatory
// first-change flow (new user or admin password reset) and a user voluntarily changing their own
// password later. Uses the login token directly (like /mfa/enroll and /mfa/verify above), not
// requireAuth, since a user with must_change_password=true cannot pass requireAuth at all - this
// is the one route that stays reachable in that state.
router.post("/change-password", async (req: Request, res: Response, next: NextFunction) => {
  const correlationId = (req.headers["x-correlation-id"] as string) || "corr-auth";
  try {
    const { token, current_password, new_password } = req.body;

    if (!token || !current_password || !new_password) {
      return res.status(400).json({ success: false, message: "Token, senha atual e nova senha são obrigatórios." });
    }
    if (typeof new_password !== "string" || new_password.length < 8) {
      return res.status(400).json({ success: false, message: "A nova senha precisa ter pelo menos 8 caracteres." });
    }

    const session = await getSession(token);
    if (!session) {
      return res.status(401).json({ success: false, message: "Invalid or expired session token.", correlationId });
    }

    const user = await dbStore.getUserById(session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    await runWithTenant({ tenantId: user.tenant_id }, async () => {
      const passwordHash = await dbStore.getUserPasswordHash(user.id);
      if (!comparePasswords(current_password, passwordHash || "")) {
        res.status(401).json({ success: false, message: "Senha atual incorreta." });
        return;
      }
      if (comparePasswords(new_password, passwordHash || "")) {
        res.status(400).json({ success: false, message: "A nova senha precisa ser diferente da senha atual." });
        return;
      }

      await dbStore.updateUser(user.id, { password_hash: hashPassword(new_password), must_change_password: false });

      await dbStore.addAuditLog({
        user_id: user.id,
        action: "Password Changed",
        entity_type: "User",
        entity_id: user.id,
        ip_address: req.ip || "127.0.0.1",
        user_agent: req.headers["user-agent"] || "unknown",
        metadata: JSON.stringify({})
      });

      res.json({ success: true });
    });
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

    const ip = req.ip || "127.0.0.1";
    const sessionUser = await dbStore.getUserById(session.userId);
    const lockoutEmail = sessionUser?.email || session.userId;

    // Same full_lockout gap as /login: this session exists but hasn't gone through requireAuth
    // yet, so nothing else would catch a lockout that started between password step and MFA step.
    if (sessionUser) {
      const enforcement = await checkLicenseEnforcement(sessionUser.tenant_id);
      if (enforcement.blocked) {
        return res.status(403).json({ success: false, code: "LICENSE_SUSPENDED", message: enforcement.message });
      }
    }

    if (await isLockedOut("mfa", lockoutEmail, ip)) {
      logDebugMessage({
        operation: "MFA Verification",
        message: `MFA verification blocked: account+IP locked out after repeated failures for user: ${session.userId}`,
        status: "WARN",
        durationMs: Date.now() - startTime,
        correlationId,
        userId: session.userId
      });
      return res.status(429).json({ success: false, message: "Too many failed MFA attempts. Try again in 15 minutes." });
    }

    // Real TOTP if the account has enrolled a secret; demo codes only remain valid as a
    // bootstrapping/testing fallback for accounts that haven't enrolled a real secret yet.
    const encryptedSecret = await dbStore.getUserMfaSecretEncrypted(session.userId);
    let mfaAccepted = false;

    if (encryptedSecret) {
      mfaAccepted = await verifyTotpCode(decryptSecret(encryptedSecret), code);
    } else if (isDemoRuntime()) {
      mfaAccepted = code === "123456" || code === "000000" || code === "111111";
    }

    if (!mfaAccepted) {
      await recordFailedAttempt("mfa", lockoutEmail, ip);
    } else {
      await clearFailedAttempts("mfa", lockoutEmail, ip);
      await verifySessionMfa(token);

      const user = await dbStore.getUserById(session.userId);

      if (user) {
        const refreshToken = await createRefreshFamily(user.id, user.role_id);
        setRefreshCookie(res, refreshToken);
      }

      const result = await (user ? runWithTenant({ tenantId: user.tenant_id }, async () => {
        await dbStore.setUserLastLogin(user.id);

        await dbStore.addAuditLog({
          user_id: user.id,
          action: "MFA Multi-Factor Challenge Verified",
          entity_type: "User",
          entity_id: session.userId,
          ip_address: req.ip || "127.0.0.1",
          user_agent: req.headers["user-agent"] || "unknown",
          metadata: JSON.stringify({ mfa_verified: true })
        });

        const role = await dbStore.getRoleById(user.role_id);
        return await buildSessionUser(user, role);
      }) : Promise.resolve(null));

      logDebugMessage({
        operation: "MFA Verification",
        message: `MFA verification passed for session of user: ${session.userId}`,
        status: "SUCCESS",
        durationMs: Date.now() - startTime,
        correlationId,
        userId: session.userId
      });

      return res.json({
        success: true,
        verified: true,
        must_change_password: user?.must_change_password,
        user: result
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
    await deleteSession(token);

    const refreshToken = readRefreshCookie(req);
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: "/api/auth" });

    await dbStore.addAuditLog({
      user_id: userId,
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

// Silent refresh: the frontend calls this before the short-lived access token expires. The
// refresh token itself is never visible to the frontend - it travels only as the httpOnly
// cookie set at login/MFA-verify, sent automatically by the browser.
router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = readRefreshCookie(req);
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: "No refresh token present." });
    }

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: "/api/auth" });
      return res.status(401).json({ success: false, message: "Refresh token is invalid, reused, or expired. Please log in again." });
    }

    setRefreshCookie(res, rotated.refreshToken);
    res.json({ success: true, token: rotated.session.token });
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
      user: await buildSessionUser(user, role)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
