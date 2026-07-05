import { PrismaClient } from "@prisma/client";
import { getTenantContext, TenantContext } from "./tenantContext";

// Models that carry a tenant_id column (every model except Tenant itself). Scoping is
// enforced here, once, instead of every route/dbStore call site remembering to add a
// WHERE clause - that's the whole point: the category of bug (forgot the tenant filter)
// becomes structurally impossible for anything routed through this client.
const TENANT_SCOPED_MODELS = new Set([
  "aIAnalysisJob", "analysisResult", "approvalDecision", "approvalWorkflow", "approvalStage",
  "auditLog", "brandingSettings", "conversationMessage", "debugLog", "document",
  "documentContent", "integrationConnector", "platformSettings", "project", "promptTemplate",
  "proposal", "proposalTemplate", "role", "task", "user", "teamMembership",
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

  if (model === "Project") {
    return {
      OR: [
        { ownerUserId: userId },
        { owner: { teamMemberships: { some: { managerId: userId } } } },
        { proposals: { some: { decisions: { some: { approverUserId: userId } } } } },
        { proposals: { some: { approvalWorkflow: { stages: { some: approverOr } } } } },
      ],
    };
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

  return null;
}

const basePrisma = new PrismaClient();

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
          a.where = { ...(a.where || {}), tenantId };
          a.create = { ...(a.create || {}), tenantId: a.create?.tenantId ?? tenantId };
        }

        if (visibility && UNIQUE_TO_FIRST[operation]) {
          return (basePrisma as any)[modelKey][UNIQUE_TO_FIRST[operation]](a);
        }

        return query(a);
      },
    },
  },
});
