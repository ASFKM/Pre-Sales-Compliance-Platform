-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_tenant_id_type_version_key" ON "prompt_templates"("tenant_id", "type", "version");

