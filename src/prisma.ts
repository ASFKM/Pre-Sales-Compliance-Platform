// Prisma 6's bundled Rust query engine used to auto-load a .env file next to schema.prisma on its
// own, independent of whatever the Node process itself had loaded - a well-known Prisma
// convenience that "just worked" for any ad-hoc CLI usage (npm run prisma:seed, npx prisma
// studio, etc.) without anyone needing to export DATABASE_URL manually. Prisma 7's driver-adapter
// model has no such engine to do that anymore - the adapter just takes whatever
// process.env.DATABASE_URL already is at construction time. Production (systemd's
// EnvironmentFile=) and CI (an explicit workflow env var) both already set it directly, so this
// line is a no-op safety net for those two, and the actual fix for local/manual CLI usage.
import "dotenv/config";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getTenantContext, TenantContext } from "./tenantContext";

// Models that carry a tenant_id column (every model except Tenant itself). Scoping is
// enforced here, once, instead of every route/dbStore call site remembering to add a
// WHERE clause - that's the whole point: the category of bug (forgot the tenant filter)
// becomes structurally impossible for anything routed through this client.
//
// Exported (not just used internally) so prisma.test.ts can cross-check it against the schema's
// real DMMF and fail loudly the moment a new tenantId-bearing model is added here without also
// being added to this set - the exact gap that let 5 models (including this file's own upsert()
// bug) go unscoped for most of this project's history.
export const TENANT_SCOPED_MODELS = new Set([
  "aIAnalysisJob", "aiProviderConfig", "aiUsageLog", "analysisResult", "approvalDecision",
  "approvalWorkflow", "approvalStage", "auditLog", "backgroundTask", "brandingSettings", "brandStyle",
  "budgetOptimizationRun",
  "conversationMessage", "debugLog", "document", "documentContent", "iaKbBillingSnapshot",
  "iaKbTaskConfig", "integrationConnector", "itemAliasMapping",
  "knowledgeBaseDocument", "knowledgeBaseEntry", "platformSettings", "poc", "pocAcceptance",
  "pocEquipmentItem", "pocFinalReportQuestion", "pocSuccessCriterion", "pocTask", "pocTestCase",
  "priceCatalogExtractionDraft", "priceCatalogItem", "priceHistoryEntry", "priceListUpload",
  "project", "projectPricingLine", "projectPricingSheet",
  "promptTemplate", "proposal", "proposalTemplate", "proposalOpinionRun",
  "proposalAiOpinionItem", "role", "systemMessage", "systemUpdateState", "systemUpdateHistory", "task",
  "tenantPricingSettings", "tenantTaxProfile", "user", "teamMembership", "vertical",
]);

const READ_OPS = new Set(["findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const WHERE_MUTATION_OPS = new Set(["update", "updateMany", "delete", "deleteMany"]);

// Phase 3 (RBAC + record ownership): which projects a user can see, embedded in the same
// extension as tenant scoping - one central place instead of a WHERE clause repeated per route.
// A user sees a project if they own it, they manage the owner (Manager -> Engineer team), they've
// ever decided on one of its proposals, or their role/user id is configured as the approver on
// any stage of a workflow used by one of its proposals - visibility that starts before a decision
// is made and never goes away afterward, even if the role granting it later changes. Proposals and
// decisions don't have their own ownership - they inherit the containing project's visibility, so
// each gets the same rule with the relation path adjusted to reach the project from that model.
function buildVisibilityFilter(model: string, context: TenantContext): Record<string, any> | null {
  if (context.canSeeAllProjects || !context.userId) {
    return null;
  }

  const { userId, roleId } = context;
  const approverOr = { OR: [{ approverUserId: userId }, ...(roleId ? [{ approverRoleId: roleId }] : [])] };

  // Same 4 conditions as "who can see a Project" (below) - extracted so every model that hangs
  // directly off a project (Document, AIAnalysisJob, AnalysisResult, ConversationMessage) can
  // reuse it wrapped in `project: { OR: ... }` instead of re-deriving it. Any of these 4 models
  // reachable in the future the same way should be added to the AUD-002 case further down, not
  // left to fall through to the tenant-only filter (that's the exact IDOR class this closes -
  // was confirmed real via GET /projects/:projectId/documents returning any project's documents
  // to any authenticated user of the same tenant, not just this project's team).
  const projectVisibilityOr = [
    { ownerUserId: userId },
    { owner: { teamMemberships: { some: { managerId: userId } } } },
    { proposals: { some: { decisions: { some: { approverUserId: userId } } } } },
    { proposals: { some: { approvalWorkflow: { stages: { some: approverOr } } } } },
  ];

  if (model === "Project") {
    return { OR: projectVisibilityOr };
  }

  // AUD-002 (auditoria de segurança, 2026-07-19): estes 4 modelos ficavam de fora da visibilidade
  // por projeto, recebendo só o filtro de tenant - qualquer usuário autenticado do tenant podia
  // ler/alterar documentos, resultados de análise, jobs e mensagens de conversa de QUALQUER
  // projeto do tenant, não só dos projetos que ele pode ver. Mesma regra de "quem vê o projeto",
  // um nível abaixo via a relação project direta que os 4 já têm no schema.
  if (model === "Document" || model === "AIAnalysisJob" || model === "AnalysisResult" || model === "ConversationMessage") {
    return { project: { OR: projectVisibilityOr } };
  }

  if (model === "Proposal") {
    return {
      OR: [
        { project: { ownerUserId: userId } },
        { project: { owner: { teamMemberships: { some: { managerId: userId } } } } },
        { decisions: { some: { approverUserId: userId } } },
        { approvalWorkflow: { stages: { some: approverOr } } },
      ],
    };
  }

  if (model === "ApprovalDecision") {
    return {
      OR: [
        { proposal: { project: { ownerUserId: userId } } },
        { proposal: { project: { owner: { teamMemberships: { some: { managerId: userId } } } } } },
        { approverUserId: userId },
        { stage: approverOr },
      ],
    };
  }

  // Same inherited-visibility rule as Proposal/ApprovalDecision above, relation path adjusted to
  // reach the project from these two models (ProposalOpinionRun -> Proposal -> Project,
  // ProposalAiOpinionItem -> ProposalOpinionRun -> Proposal -> Project) - neither has its own
  // ownership, a user who can't see the proposal shouldn't see its AI opinion panel either.
  if (model === "ProposalOpinionRun") {
    return {
      OR: [
        { proposal: { project: { ownerUserId: userId } } },
        { proposal: { project: { owner: { teamMemberships: { some: { managerId: userId } } } } } },
        { proposal: { decisions: { some: { approverUserId: userId } } } },
        { proposal: { approvalWorkflow: { stages: { some: approverOr } } } },
      ],
    };
  }

  if (model === "ProposalAiOpinionItem") {
    return {
      OR: [
        { run: { proposal: { project: { ownerUserId: userId } } } },
        { run: { proposal: { project: { owner: { teamMemberships: { some: { managerId: userId } } } } } } },
        { run: { proposal: { decisions: { some: { approverUserId: userId } } } } },
        { run: { proposal: { approvalWorkflow: { stages: { some: approverOr } } } } },
      ],
    };
  }

  return null;
}

// Prisma 7 removed the bundled Rust query engine that used to read the schema's datasource url
// automatically - the generated client now needs an explicit driver adapter with its own
// connection string (see prisma.config.ts for the CLI/migrate side of this same change).
// Fase 1 of the Zero Trust rollout (SSL on Postgres). Only enabled when DATABASE_SSL_CA_PATH is
// set, pointing at the internal CA's public cert (not a secret) - keeps CI and any environment
// without that CA (which only exists on this deployment) working unchanged with a plain
// connection, while production connects with server-cert verification. Postgres itself still
// accepts non-SSL connections too (ssl=on doesn't force hostssl in pg_hba.conf) - deliberately
// not tightened further yet, since this DB is loopback-only already; see Fase 1.7 log.
const sslConfig = process.env.DATABASE_SSL_CA_PATH
  ? { ca: fs.readFileSync(process.env.DATABASE_SSL_CA_PATH, "utf8"), rejectUnauthorized: true }
  : undefined;
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
});
const basePrisma = new PrismaClient({ adapter });

// findUnique/findUniqueOrThrow, and the singular update/delete, all require the unique field
// (e.g. id) as a top-level `where` key - Prisma rejects it being nested inside an AND alongside
// the visibility OR-clause. findFirst has no such restriction, so reads redirect there directly.
// update/delete have no "first" equivalent, so once visibility applies they go through the
// *Many variant instead (which does accept arbitrary where shapes) scoped to that one id, then
// (for update) re-fetch the row to keep returning what callers of `update` normally get back.
const UNIQUE_TO_FIRST: Record<string, string> = {
  findUnique: "findFirst",
  findUniqueOrThrow: "findFirstOrThrow",
};

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const context = getTenantContext();
        const tenantId = context?.tenantId;

        // No tenant in context: pass through unscoped. The only legitimate case for this
        // today is the login route's initial lookup-by-email, which runs before we know
        // which tenant the user belongs to - that's how the tenant gets discovered at all.
        if (!tenantId || !TENANT_SCOPED_MODELS.has(model.charAt(0).toLowerCase() + model.slice(1))) {
          return query(args);
        }

        const a = args as Record<string, any>;
        const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
        let visibility: Record<string, any> | null = null;

        if (READ_OPS.has(operation) || WHERE_MUTATION_OPS.has(operation)) {
          const originalWhere = { ...(a.where || {}) };
          a.where = { ...originalWhere, tenantId };
          visibility = buildVisibilityFilter(model, context!);

          if (visibility && (operation === "update" || operation === "delete")) {
            const scopedWhere = { AND: [a.where, visibility] };
            const manyOp = operation === "update" ? "updateMany" : "deleteMany";
            const result = await (basePrisma as any)[modelKey][manyOp]({ where: scopedWhere, data: a.data });
            if (result.count === 0) {
              throw new Error(`No ${model} found matching this id, tenant, and visibility scope.`);
            }
            return operation === "update"
              ? (basePrisma as any)[modelKey].findFirst({ where: { id: originalWhere.id, tenantId } })
              : { id: originalWhere.id };
          }

          if (visibility) {
            a.where = { AND: [a.where, visibility] };
          }
        }

        if (operation === "create") {
          a.data = { ...(a.data || {}), tenantId: a.data?.tenantId ?? tenantId };
        }

        if (operation === "createMany" && Array.isArray(a.data)) {
          a.data = a.data.map((item: Record<string, any>) => ({ ...item, tenantId: item.tenantId ?? tenantId }));
        }

        if (operation === "upsert") {
          // Bit us 3 times already: injecting tenantId into upsert's `where` only works if the
          // model's unique constraint already includes tenantId (e.g. Vertical's
          // @@unique([tenantId, name])). For every other model (a bare @id on `id`, or a unique
          // on some other single column), the combined where matches no real DB constraint,
          // Prisma can't locate the existing row, and it silently falls through to `create` -
          // failing on the first required field with no default. Rather than re-derive per model
          // whether that's safe, every call site in this codebase already uses
          // findUnique()+create()/update() instead (see comments in dbStore.ts/fleetLicense.ts) -
          // so upsert() through this scoped client is disallowed outright, turning the old silent
          // failure into an immediate, obvious error at the call site.
          throw new Error(
            `prisma.${modelKey}.upsert() is disallowed on tenant-scoped models - the tenant-scoping ` +
            `extension cannot safely inject tenantId into an upsert's where clause unless it's part ` +
            `of the model's own unique constraint. Use findUnique() + create()/update() instead.`
          );
        }

        if (visibility && UNIQUE_TO_FIRST[operation]) {
          return (basePrisma as any)[modelKey][UNIQUE_TO_FIRST[operation]](a);
        }

        return query(a);
      },
    },
  },
});
