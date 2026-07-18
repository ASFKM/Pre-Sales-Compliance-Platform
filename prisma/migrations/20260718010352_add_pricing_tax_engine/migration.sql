-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('simples_nacional', 'lucro_presumido', 'lucro_real');

-- CreateTable
CREATE TABLE "tenant_tax_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "origin_uf" TEXT NOT NULL,
    "tax_regime" "TaxRegime" NOT NULL,
    "simples_anexo" TEXT,
    "simples_revenue_bracket" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icms_interstate_rate_table" (
    "id" TEXT NOT NULL,
    "origin_uf" TEXT NOT NULL,
    "destination_uf" TEXT NOT NULL,
    "rate_percent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "icms_interstate_rate_table_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_tax_profiles_tenant_id_key" ON "tenant_tax_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "icms_interstate_rate_table_origin_uf_destination_uf_key" ON "icms_interstate_rate_table"("origin_uf", "destination_uf");

-- AddForeignKey
ALTER TABLE "tenant_tax_profiles" ADD CONSTRAINT "tenant_tax_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
