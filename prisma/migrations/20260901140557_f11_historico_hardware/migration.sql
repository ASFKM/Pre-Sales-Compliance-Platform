-- CreateTable
CREATE TABLE "hardware_samples" (
    "id" TEXT NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpu_load_percent" DOUBLE PRECISION,
    "memory_used_mb" INTEGER,
    "total_memory_mb" INTEGER,
    "disk_used_mb" INTEGER,
    "disk_total_mb" INTEGER,
    "services" JSONB NOT NULL,

    CONSTRAINT "hardware_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hardware_samples_hourly" (
    "id" TEXT NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,
    "cpu_load_percent" DOUBLE PRECISION,
    "memory_used_mb" INTEGER,
    "total_memory_mb" INTEGER,
    "disk_used_mb" INTEGER,
    "disk_total_mb" INTEGER,
    "services_summary" JSONB NOT NULL,
    "sample_count" INTEGER NOT NULL,

    CONSTRAINT "hardware_samples_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hardware_samples_measured_at_idx" ON "hardware_samples"("measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "hardware_samples_hourly_bucket_start_key" ON "hardware_samples_hourly"("bucket_start");
