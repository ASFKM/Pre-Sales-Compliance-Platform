-- CreateTable
CREATE TABLE "team_memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "manager_id" TEXT NOT NULL,
    "engineer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "team_memberships_tenant_id_idx" ON "team_memberships"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_manager_id_engineer_id_key" ON "team_memberships"("manager_id", "engineer_id");

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
