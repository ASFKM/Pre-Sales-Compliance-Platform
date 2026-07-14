-- CreateTable
CREATE TABLE "iakb_billing_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "markup_percent" DOUBLE PRECISION NOT NULL,
    "cycle_start" TIMESTAMP(3),
    "cycle_billed_cost_usd" DOUBLE PRECISION NOT NULL,
    "cycle_call_count" INTEGER NOT NULL,
    "next_due_date" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "iakb_billing_snapshots_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "iakb_billing_snapshots_tenant_id_key" ON "iakb_billing_snapshots"("tenant_id");
-- AddForeignKey
ALTER TABLE "iakb_billing_snapshots" ADD CONSTRAINT "iakb_billing_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
