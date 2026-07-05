import { PrismaClient } from "@prisma/client";
import { getCurrentTenantId } from "./tenantContext";

// Models that carry a tenant_id column (every model except Tenant itself). Scoping is
// enforced here, once, instead of every route/dbStore call site remembering to add a
// WHERE clause - that's the whole point: the category of bug (forgot the tenant filter)
// becomes structurally impossible for anything routed through this client.
const TENANT_SCOPED_MODELS = new Set([
  "aIAnalysisJob", "analysisResult", "approvalDecision", "approvalWorkflow", "approvalStage",
  "auditLog", "brandingSettings", "conversationMessage", "debugLog", "document",
  "documentContent", "integrationConnector", "platformSettings", "project", "promptTemplate",
  "proposal", "proposalTemplate", "role", "task", "user",
]);

const READ_OPS = new Set(["findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "findMany", "count", "aggregate", "groupBy"]);
const WHERE_MUTATION_OPS = new Set(["update", "updateMany", "delete", "deleteMany"]);

const basePrisma = new PrismaClient();

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = getCurrentTenantId();

        // No tenant in context: pass through unscoped. The only legitimate case for this
        // today is the login route's initial lookup-by-email, which runs before we know
        // which tenant the user belongs to - that's how the tenant gets discovered at all.
        if (!tenantId || !TENANT_SCOPED_MODELS.has(model.charAt(0).toLowerCase() + model.slice(1))) {
          return query(args);
        }

        const a = args as Record<string, any>;

        if (READ_OPS.has(operation) || WHERE_MUTATION_OPS.has(operation)) {
          a.where = { ...(a.where || {}), tenantId };
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

        return query(a);
      },
    },
  },
});
