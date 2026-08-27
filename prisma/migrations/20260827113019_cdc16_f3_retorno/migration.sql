-- CreateTable
CREATE TABLE "crm_pair_keys" (
    "tenant_id" TEXT NOT NULL,
    "key_encrypted" TEXT NOT NULL,
    "key_hint" TEXT NOT NULL,
    "crm_installation_id" TEXT NOT NULL,
    "callback_base_url" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "verify_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pair_keys_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "demand_outbound_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "demand_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "event" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_status" INTEGER,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_outbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demand_outbound_events_tenant_id_status_next_attempt_at_idx" ON "demand_outbound_events"("tenant_id", "status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "demand_outbound_events_tenant_id_demand_id_idx" ON "demand_outbound_events"("tenant_id", "demand_id");

-- CreateIndex
CREATE UNIQUE INDEX "demand_outbound_events_tenant_id_idempotency_key_key" ON "demand_outbound_events"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "crm_pair_keys" ADD CONSTRAINT "crm_pair_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_outbound_events" ADD CONSTRAINT "demand_outbound_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_outbound_events" ADD CONSTRAINT "demand_outbound_events_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
