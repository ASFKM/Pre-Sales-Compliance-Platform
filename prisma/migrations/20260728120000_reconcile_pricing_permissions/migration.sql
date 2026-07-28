-- Reconcile pricing module permissions for roles that already have poc:manage.
--
-- Roles created via the real installation wizard (not the hardcoded r1/r2/r3 seed ids)
-- never received pricing:read/pricing:manage when that permission pair was added to the
-- catalog, because prisma/seed.ts only touches the hardcoded seed role ids. This backfills
-- any role that has poc:manage but not pricing:manage. Idempotent: once a role has
-- pricing:manage, the WHERE clause excludes it, so re-running is a no-op.
UPDATE "roles"
SET "permissions" = (
  SELECT ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['pricing:read', 'pricing:manage']))
)
WHERE 'poc:manage' = ANY("permissions")
  AND NOT ('pricing:manage' = ANY("permissions"));
