-- CreateEnum
CREATE TYPE "PocStatus" AS ENUM ('planned', 'in_progress', 'blocked', 'completed_won', 'completed_lost');

-- CreateTable
CREATE TABLE "pocs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_id" TEXT,
    "standalone_customer_name" TEXT,
    "standalone_contact_name" TEXT,
    "standalone_contact_email" TEXT,
    "standalone_contact_phone" TEXT,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" "PocStatus" NOT NULL DEFAULT 'planned',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "customer_contact_name" TEXT NOT NULL,
    "customer_contact_role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pocs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pocs_tenant_id_idx" ON "pocs"("tenant_id");

-- AddForeignKey
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pocs" ADD CONSTRAINT "pocs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

