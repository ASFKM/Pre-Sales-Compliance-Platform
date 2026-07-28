-- CreateTable
CREATE TABLE "diagnostics_outbox_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "message" TEXT NOT NULL,
    "exception_type" TEXT,
    "stack_trace" TEXT,
    "route" TEXT,
    "http_method" TEXT,
    "http_status" INTEGER,
    "operation" TEXT,
    "correlation_id" TEXT,
    "session_id" TEXT,
    "metadata_json" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "diagnostics_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diagnostics_outbox_events_tenant_id_sent_at_idx" ON "diagnostics_outbox_events"("tenant_id", "sent_at");

-- AddForeignKey
ALTER TABLE "diagnostics_outbox_events" ADD CONSTRAINT "diagnostics_outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
