-- CreateTable: verticals - admin-managed list of industry verticals for project creation,
-- replacing what used to be a hardcoded 5-option <select>.
CREATE TABLE "verticals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verticals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verticals_tenant_id_name_key" ON "verticals"("tenant_id", "name");
CREATE INDEX "verticals_tenant_id_idx" ON "verticals"("tenant_id");

ALTER TABLE "verticals" ADD CONSTRAINT "verticals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
