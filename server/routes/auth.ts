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
  REFRESH_TOKEN_COOKIE_NAME,
  issueSseTicket,
  resolveSseTicket
} from "../utils/security";
import { logDebugMessage, loginRateLimiter } from "../middleware/security";
import { isProductionRuntime, isDemoRuntime } from "../config/runtime";
import { runWithTenant } from "../../src/tenantContext";
import { isLockedOut, recordFailedAttempt, clearFailedAttempts } from "../utils/lockout";
import { checkLicenseEnforcement, getFleetLicenseStatus } from "../utils/fleetLicense";

import {
  verificarTokenDoKeycloak,
  emailDoToken,
} from "../utils/keycloakAuth";

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

/**
 * Fase 13 — `ensurePasswordHashes` foi removida junto com o login por senha.
 *
 * Ela semeava a senha de demonstração ("password123") em usuários sem hash, fora de produção.
 * Não há mais hash para semear: quem guarda credencial é o Keycloak, e uma conta de teste ganha
 * senha lá, pelo mesmo caminho que qualquer outra.
 */

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

  // EventSource can't set custom headers, so a query param has always been the one legitimate
  // exception to sending the token via Authorization. AUD-006 (auditoria de segurança,
  // 2026-07-19): passar o TOKEN DE SESSÃO completo (válido por horas) direto na URL era o
  // problema - risco real de aparecer em log de acesso, histórico do navegador, Referer. Agora é
  // um `ticket` de curta duração (5 min, ver issueSseTicket/resolveSseTicket em security.ts -
  // reutilizável dentro da janela de propósito, pra não quebrar a reconexão automática nativa do
  // EventSource) - `?token=` na query ainda funciona por compatibilidade, mas nenhum código deste
  // repositório emite mais URLs assim (ver GET /auth/sse-ticket e os dois EventSource do
  // frontend, atualizados juntos com esta mudança).
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const ticketParam = typeof req.query.ticket === "string" ? req.query.ticket : undefined;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : queryToken;

  if (!token && !ticketParam) {
    return res.status(401).json({ success: false, message: "Authorization token required." });
  }

  try {
    let session: Awaited<ReturnType<typeof getSession>>;
    if (token) {
      /**
       * Fase 13 — a identidade passou a vir do Keycloak (realm `cloudmountain`, compartilhado
       * com o CMCRM e o CMSaaS), e não mais de uma sessão própria em Redis.
       *
       * A ligação entre os dois mundos é o E-MAIL: `users.email` é único no banco inteiro (não
       * por tenant), e é ele que identifica a pessoa e, por tabela, o tenant dela. Tudo o que
       * vem depois desta linha — papel atual, licença, status, `runWithTenant` — continua
       * exatamente como estava, lendo do Postgres.
       *
       * Uma conta que existe no Keycloak mas não aqui recebe a mesma resposta de um token
       * inválido, de propósito: o realm é compartilhado pelos três produtos, então "não tem
       * conta neste produto" é situação esperada, e diferenciá-la contaria a quem perguntasse
       * quais e-mails existem aqui. Não há provisionamento automático — uma conta sem papel
       * atribuído não teria permissão nenhuma de qualquer forma.
       */
      let usuarioDoToken;
      try {
        const claims = await verificarTokenDoKeycloak(token);
        usuarioDoToken = await dbStore.getUserByEmail(emailDoToken(claims));
      } catch {
        usuarioDoToken = null;
      }
      session = usuarioDoToken
        ? {
            token,
            userId: usuarioDoToken.id,
            roleId: usuarioDoToken.role_id,
            // O segundo fator é responsabilidade do Keycloak agora: se ele emitiu o token, o que
            // ele exigia já foi cumprido antes de o produto ver qualquer coisa.
            mfaVerified: true,
            createdAt: new Date(),
            expiresAt: new Date(),
          }
        : undefined;
    } else if (ticketParam) {
      const resolved = await resolveSseTicket(ticketParam);
      // mfaVerified: true - o ticket só existe porque quem o emitiu (GET /auth/sse-ticket) já
      // exigiu requireAuth completo, MFA incluído; reexigir aqui seria redundante, o ticket em si
      // já prova isso (e expira em 5 min, então não é um jeito mais fraco de contornar o MFA - só
      // reaproveita uma verificação que acabou de acontecer há pouco).
      session = resolved
        ? { token: "", userId: resolved.userId, roleId: resolved.roleId, mfaVerified: true, createdAt: new Date(), expiresAt: new Date() }
        : undefined;
    }

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

    // AUD-003 (auditoria de segurança, 2026-07-19): sem isso, um usuário desativado mantinha
    // acesso total até a sessão expirar sozinha - nada aqui revalidava o status a cada
    // requisição, só no momento do login.
    if (user.status !== "ACTIVE") {
      return res.status(401).json({ success: false, message: "Invalid or expired session token.", correlationId });
    }

    // AUD-003: lê o papel ATUAL do usuário (user.role_id, resolvido agora) em vez do papel
    // congelado no momento do login (session.roleId) - sem isso, rebaixar/promover um usuário só
    // fazia efeito na próxima vez que ele fizesse login de novo, não na próxima requisição.
    const role = await dbStore.getRoleById(user.role_id);
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
    // Fase 13 — a troca obrigatória de senha saiu daqui: quem a exige agora é a required action
    // `UPDATE_PASSWORD` do Keycloak, que acontece ANTES de qualquer token ser emitido. Um token
    // válido já é prova de que a pendência foi resolvida, e manter a checagem aqui bloquearia
    // para sempre quem migrou (a coluna continua `true` no banco até a migration removê-la).

    // Bind session info to request headers for downstream endpoint use
    req.headers["x-user-id"] = session.userId;
    req.headers["x-role-id"] = user.role_id;
    req.headers["x-session-token"] = token;
    req.headers["x-tenant-id"] = user.tenant_id;

    // Enrich the request-scoped logger (attached by pino-http in server.ts, present on every
    // request regardless of AsyncLocalStorage) the moment identity is actually known - every log
    // line from here on for this request carries userId/tenantId/roleId without each call site
    // having to pass them explicitly.
    if (req.log) {
      req.log = req.log.child({ userId: session.userId, tenantId: user.tenant_id, roleId: user.role_id });
    }

    runWithTenant(
      { tenantId: user.tenant_id, userId: session.userId, roleId: user.role_id, canSeeAllProjects },
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

// MFA ENROLLMENT ENDPOINT - generates a real TOTP secret for the logged-in-but-not-yet-MFA-verified
// session. Uses the login token directly (like /mfa/verify), not requireAuth, since a user who has
// just entered valid credentials but hasn't completed MFA yet cannot pass requireAuth. Re-enrollment
// (secret already exists) requires the session to already be mfaVerified, so a stolen password alone
// can never be used to silently reset someone's MFA - only an administrator can do that (via user
// update, which clears the secret).

// PASSWORD CHANGE ENDPOINT (roadmap, segurança) - self-service, covers both the mandatory
// first-change flow (new user or admin password reset) and a user voluntarily changing their own
// password later. Uses the login token directly (like /mfa/enroll and /mfa/verify above), not
// requireAuth, since a user with must_change_password=true cannot pass requireAuth at all - this
// is the one route that stays reachable in that state.

// MFA VERIFY ENDPOINT

// LOGOUT ENDPOINT
/**
 * Fase 13 — saíram deste arquivo: `POST /login`, `/mfa/enroll`, `/mfa/verify`,
 * `/change-password` e `/refresh`.
 *
 * Senha, segundo fator, troca obrigatória e renovação de token passaram a ser responsabilidade
 * do Keycloak. A política de senha do realm é mais forte do que a que havia aqui (12 caracteres
 * com histórico de 5, contra 8), e o realm traz WebAuthn, que este produto nunca teve.
 *
 * O mecanismo próprio de refresh — família por login, rotação e detecção de reuso — foi
 * substituído pelo do Keycloak, que faz o mesmo com revogação a cada uso
 * (`revokeRefreshToken`/`refreshTokenMaxReuse: 0` no realm). O cookie `ca_refresh_token` deixa de
 * ser emitido.
 */
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

// AUD-006 (auditoria de segurança, 2026-07-19): emite o ticket de curta duração usado pra abrir
// uma conexão EventSource sem colocar o token de sessão completo na URL - o frontend chama isto
// primeiro (requisição normal, token no header) e usa o `ticket` retornado no `?ticket=` da URL
// do EventSource. Passa por requireAuth de verdade, então herda toda a checagem normal (status,
// MFA, licença, troca de senha obrigatória) antes de emitir o ticket.
router.get("/sse-ticket", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const roleId = req.headers["x-role-id"] as string;
    const ticket = await issueSseTicket(userId, roleId);
    res.json({ success: true, ticket });
  } catch (err) {
    next(err);
  }
});

// Silent refresh: the frontend calls this before the short-lived access token expires. The
// refresh token itself is never visible to the frontend - it travels only as the httpOnly
// cookie set at login/MFA-verify, sent automatically by the browser.

// GET CURRENT SESSION PROFILE
/**
 * Fase 13 — quem identifica a pessoa é o `requireAuth` acima, e ele já publicou `x-user-id`.
 *
 * Esta rota resolvia a sessão por conta própria, no Redis, e por isso continuou dando 401 mesmo
 * depois de a autenticação virar OIDC — achado ao provar o SSO: o Keycloak devolvia a pessoa sem
 * pedir login (o SSO funcionava), e era ESTA rota que a recusava, com a mensagem de sessão
 * expirada. Ler o cabeçalho que o middleware acabou de escrever é a única fonte correta agora.
 */
router.get("/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const user = await dbStore.getUserById(userId);
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
