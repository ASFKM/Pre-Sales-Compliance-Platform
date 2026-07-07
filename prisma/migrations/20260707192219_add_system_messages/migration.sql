-- CreateEnum
CREATE TYPE "SystemMessageSource" AS ENUM ('fleet_manager', 'local');
CREATE TYPE "SystemMessageAudience" AS ENUM ('admin_only', 'all_users');

-- CreateTable
CREATE TABLE "system_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" "SystemMessageSource" NOT NULL,
    "fleet_message_id" TEXT,
    "audience" "SystemMessageAudience" NOT NULL DEFAULT 'all_users',
    "body" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_messages_fleet_message_id_key" ON "system_messages"("fleet_message_id");
CREATE INDEX "system_messages_tenant_id_idx" ON "system_messages"("tenant_id");

ALTER TABLE "system_messages" ADD CONSTRAINT "system_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
