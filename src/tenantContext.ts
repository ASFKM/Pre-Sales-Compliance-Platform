import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  // Set when a vendor-support user is deliberately operating inside a tenant that
  // isn't their own. The Prisma extension doesn't change behavior based on this flag
  // (scoping is always by tenantId) - it exists so callers can log a stronger audit
  // entry when it's true. The actual support workflow/UI is built in a later phase;
  // this flag just keeps the door open without weakening scoping today.
  crossTenantSupport?: boolean;
  // Phase 3 (RBAC + record ownership): who's making the request, needed by the Prisma
  // extension to apply the project-visibility rule (owner, manager-of-owner, or approver).
  userId?: string;
  roleId?: string;
  // True bypasses the visibility rule entirely (currently granted via the "project:read_all"
  // permission - seeded on Administrator, but not hardcoded to that role name since roles are
  // tenant-customizable).
  canSeeAllProjects?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function getCurrentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}
