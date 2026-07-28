ALTER TABLE "projects" ADD COLUMN "brand_style_id" TEXT;

CREATE TABLE "brand_styles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "logo_data_url" TEXT,
    "primary_color" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_styles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brand_styles_tenant_id_idx" ON "brand_styles"("tenant_id");
CREATE UNIQUE INDEX "brand_styles_tenant_id_name_key" ON "brand_styles"("tenant_id", "name");

ALTER TABLE "brand_styles" ADD CONSTRAINT "brand_styles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
