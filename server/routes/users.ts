import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { dbStore } from "../../src/dbStore";
import { requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import { UserStatus } from "../../src/types";
import { hashPassword } from "../utils/security";
import { getCurrentTenantId } from "../../src/tenantContext";
import {
  PoliticaDeSenha,
  LIMITES_DA_POLITICA,
  violacoesDaPolitica,
  mensagemDeViolacao,
  requisitosDaPolitica,
} from "../utils/politicaDeSenha";
import { lerPolitica, gravarPolitica, registrarSenhaNoHistorico } from "../utils/politicaDeSenhaRepo";

/**
 * F3 (01/09/2026) - o tenant desta requisicao. `requireAuth` ja abriu o contexto antes de chegar
 * aqui (`runWithTenant`), entao ele sempre existe; o lance serve para transformar um contexto
 * ausente em erro alto, e nao numa consulta silenciosamente sem recorte.
 */
function tenantDaRequisicao(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) throw new Error("Rota de usuarios chamada fora do contexto de tenant.");
  return tenantId;
}

const router = express.Router();

const sanitizeUser = (user: any) => {
  if (!user) return user;
  const { password, password_hash, token, session, ...safeUser } = user;
  return safeUser;
};

// Define Zod schemas for validation
const CreateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  email: z.string().email("Invalid email format"),
  role_id: z.string().min(1, "Role ID is required"),
  // F3 (01/09/2026): o criterio nao e mais um numero fixo - a senha inicial tem de caber na
  // POLITICA do tenant, verificada no handler (o Zod nao alcanca o banco).
  initial_password: z.string().min(1).optional(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role_id: z.string().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  mfa_enabled: z.boolean().optional(),
  // F3: mesma coisa do `initial_password` - quem decide o criterio e a politica do tenant.
  password: z.string().min(1).optional(),
  // Roadmap (segurança): só tem efeito junto de `password` - default true (força a troca), o
  // admin desmarca conscientemente na tela se não quiser. Ignorado se nenhuma senha for enviada.
  force_password_change: z.boolean().optional(),
});

/**
 * F3 (01/09/2026) - A POLITICA DE SENHA DO TENANT, EDITAVEL EM ADMINISTRACAO > USUARIOS.
 *
 * DECLARADA ANTES DE `/:id` de proposito: no Express a primeira rota que casa vence, e
 * `PUT /users/password-policy` cairia dentro de `PUT /users/:id` (com `id = "password-policy"`)
 * se viesse depois - um 404 confuso, ou pior, um update tentado num id que nao existe.
 *
 * Mesma permissao que governa criar conta e redefinir senha (`admin:users`): quem pode dar senha
 * a outra pessoa e quem pode dizer como as senhas devem ser.
 */
router.get("/password-policy", requirePermission("admin:users"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const politica = await lerPolitica(tenantDaRequisicao());
    res.json({ success: true, politica, limites: LIMITES_DA_POLITICA, requisitos: requisitosDaPolitica("", politica) });
  } catch (err) {
    next(err);
  }
});

const PoliticaDeSenhaSchema = z.object({
  comprimento_minimo: z.number().int().optional(),
  exigir_maiuscula: z.boolean().optional(),
  exigir_minuscula: z.boolean().optional(),
  exigir_numero: z.boolean().optional(),
  exigir_especial: z.boolean().optional(),
  historico_de_reuso: z.number().int().optional(),
  validade_em_dias: z.number().int().optional(),
});

/**
 * Os valores sao GRAMPEADOS aos limites em `normalizarPolitica`, nao recusados - um front que
 * mande 4 no comprimento recebe 8 de volta e a tela mostra 8. O chao de 8 existe para que a tela
 * nao possa desfazer a decisao de sair dos 8 caracteres de antes da Fase 13.
 */
router.put("/password-policy", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PoliticaDeSenhaSchema.parse(req.body) as Partial<PoliticaDeSenha>;
    const tenantId = tenantDaRequisicao();
    const atorUserId = requireUserId(req);
    const politica = await gravarPolitica(tenantId, validated, atorUserId);

    await dbStore.addAuditLog({
      user_id: atorUserId,
      action: "Update Password Policy",
      entity_type: "PasswordPolicy",
      entity_id: tenantId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(politica)
    });

    res.json({ success: true, politica, limites: LIMITES_DA_POLITICA, requisitos: requisitosDaPolitica("", politica) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

// Protect with users admin permissions
router.get("/", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await dbStore.getUsers();
    res.json(users.map(sanitizeUser));
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateUserSchema.parse(req.body);
    const normalizedEmail = validated.email.toLowerCase().trim();
    const tenantId = tenantDaRequisicao();
    const politica = await lerPolitica(tenantId);

    /**
     * F3 - a senha inicial passa pela MESMA politica que a pessoa tera de cumprir. Vale tambem
     * para o valor padrao usado quando nenhuma senha e informada: se a instalacao endureceu a
     * politica a ponto de recusa-lo, criar a conta assim mesmo produziria uma conta cuja senha
     * inicial a propria rota de troca recusaria - a pessoa entraria e travaria na primeira troca.
     */
    const senhaInicial = validated.initial_password || "TrocarAgora2026!";
    const violacoes = violacoesDaPolitica(senhaInicial, politica);
    if (violacoes.length > 0) {
      return res.status(400).json({
        success: false,
        message: validated.initial_password
          ? mensagemDeViolacao(violacoes)
          : `A senha inicial padrao nao cumpre a politica desta instalacao. Informe uma senha inicial. ${mensagemDeViolacao(violacoes)}`
      });
    }

    const roleExists = await dbStore.getRoleById(validated.role_id);
    if (!roleExists) {
      return res.status(400).json({ success: false, message: "Role does not exist." });
    }

    const duplicatedEmail = await dbStore.getUserByEmail(normalizedEmail);
    if (duplicatedEmail) {
      return res.status(409).json({ success: false, message: "User email already exists." });
    }

    const hashInicial = hashPassword(senhaInicial);
    const newUser = await dbStore.createUser({
      name: validated.name,
      email: normalizedEmail,
      role_id: validated.role_id,
      password_hash: hashInicial,
    });

    // F3 - a senha inicial entra no historico como qualquer outra: sem isto, a primeira troca
    // poderia "trocar" a senha pela mesma senha temporaria que o administrador acabou de ditar.
    await registrarSenhaNoHistorico(tenantId, newUser.id, hashInicial);

    // Audit Log
    await dbStore.addAuditLog({
      user_id: requireUserId(req),
      action: "Create User",
      entity_type: "User",
      entity_id: newUser.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ email: newUser.email, role_id: newUser.role_id })
    });

    res.status(201).json(sanitizeUser(newUser));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.put("/:id", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateUserSchema.parse(req.body);
    const user = await dbStore.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (validated.role_id) {
      const roleExists = await dbStore.getRoleById(validated.role_id);
      if (!roleExists) {
        return res.status(400).json({ success: false, message: "Role does not exist." });
      }
    }

    let normalizedEmail: string | undefined;
    if (validated.email) {
      normalizedEmail = validated.email.toLowerCase().trim();
      const duplicatedEmail = await dbStore.getUserByEmail(normalizedEmail);

      if (duplicatedEmail && duplicatedEmail.id !== req.params.id) {
        return res.status(409).json({ success: false, message: "User email already exists." });
      }
    }

    const { password, force_password_change, ...safeUpdates } = validated;

    // F3 - a senha que um administrador escolhe para outra pessoa passa pela MESMA politica que
    // ela tera de cumprir. Deixar esta rota de fora seria a porta que devolve senhas fracas.
    const tenantId = tenantDaRequisicao();
    let novoHash: string | undefined;
    if (password) {
      const violacoes = violacoesDaPolitica(password, await lerPolitica(tenantId));
      if (violacoes.length > 0) {
        return res.status(400).json({ success: false, message: mensagemDeViolacao(violacoes) });
      }
      novoHash = hashPassword(password);
    }

    const updatedUser = await dbStore.updateUser(req.params.id, {
      ...safeUpdates,
      email: normalizedEmail,
      ...(novoHash ? { password_hash: novoHash, must_change_password: force_password_change !== false } : {}),
    });

    if (novoHash) {
      await registrarSenhaNoHistorico(tenantId, req.params.id, novoHash);
    }

    // Disabling MFA also clears the enrolled TOTP secret so a future re-enable starts fresh
    // instead of silently resurrecting an old secret nobody can prove they still hold.
    if (validated.mfa_enabled === false) {
      await dbStore.setUserMfaSecret(req.params.id, null);
    }

    const auditMetadata = { ...validated } as any;
    if (auditMetadata.password) {
      auditMetadata.password = "[password-updated]";
    }

    await dbStore.addAuditLog({
      user_id: requireUserId(req),
      action: "Update User Record",
      entity_type: "User",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify(auditMetadata)
    });

    res.json(sanitizeUser(updatedUser));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.delete("/:id", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorUserId = requireUserId(req);
    const user = await dbStore.getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (actorUserId === req.params.id) {
      return res.status(400).json({ success: false, message: "Current authenticated user cannot delete own account." });
    }

    await dbStore.deleteUser(req.params.id);

    await dbStore.addAuditLog({
      user_id: actorUserId,
      action: "Delete User Account",
      entity_type: "User",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ deleted_user_id: req.params.id })
    });

    res.json({ success: true, message: "User deleted successfully." });
  } catch (err) {
    next(err);
  }
});

// Phase 3 (RBAC + record ownership): Manager <-> Engineer team assignment. Drives which
// projects a Manager can see (their team's), enforced centrally in the Prisma extension
// (src/prisma.ts) - these routes only manage the membership rows themselves.
const TeamMembershipSchema = z.object({
  manager_id: z.string().min(1),
  engineer_id: z.string().min(1),
});

router.get("/teams", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const memberships = await dbStore.getTeamMemberships();
    res.json(memberships);
  } catch (err) {
    next(err);
  }
});

router.post("/teams", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { manager_id, engineer_id } = TeamMembershipSchema.parse(req.body);

    const manager = await dbStore.getUserById(manager_id);
    const engineer = await dbStore.getUserById(engineer_id);
    if (!manager || !engineer) {
      return res.status(404).json({ success: false, message: "Manager or engineer user not found." });
    }

    const membership = await dbStore.addTeamMembership(manager_id, engineer_id);

    const actorUserId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: actorUserId,
      action: "Add Team Membership",
      entity_type: "TeamMembership",
      entity_id: membership.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ manager_id, engineer_id })
    });

    res.json(membership);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    // Unique constraint on (manager_id, engineer_id) - membership already exists.
    if (err?.code === "P2002") {
      return res.status(409).json({ success: false, message: "This engineer is already on this manager's team." });
    }
    next(err);
  }
});

router.delete("/teams/:id", requirePermission("admin:users"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const removed = await dbStore.removeTeamMembership(req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, message: "Team membership not found." });
    }

    const actorUserId = requireUserId(req);
    await dbStore.addAuditLog({
      user_id: actorUserId,
      action: "Remove Team Membership",
      entity_type: "TeamMembership",
      entity_id: req.params.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ team_membership_id: req.params.id })
    });

    res.json({ success: true, message: "Team membership removed." });
  } catch (err) {
    next(err);
  }
});

export default router;
