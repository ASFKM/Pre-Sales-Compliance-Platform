-- Fase 11 de `docs/cdc/16-integracao-cmcrm-presales.md` — itens 05/06/31/34.

-- Item 31: "79% do consumo de IA do PreSales não tem dono recuperável" (medido no Demo em
-- 28/08/2026: 526 chamadas em ai_usage_logs, 111 com dono via caminho indireto de tarefa de
-- fundo, 415 sem dono nenhum). A coluna vale de frente - o histórico não é retroagido, e
-- server/utils/aiOrchestrator.ts (recordAiUsage) passa a gravá-la em toda chamada nova. Nullable
-- de propósito: as 526 linhas existentes ficam com user_id NULL para sempre, e a tela de
-- relatórios precisa dizer isso, não escondê-lo.
ALTER TABLE "ai_usage_logs" ADD COLUMN "user_id" TEXT;
CREATE INDEX "ai_usage_logs_user_id_idx" ON "ai_usage_logs" ("user_id");

-- Item 06/34: o add-on de IA deixou de existir - toda chamada de IA roteia pelo Fleet Manager
-- agora (server/utils/aiProviders.ts), e provedores personalizados morreram junto com ele, por
-- decisão do dono na F8. A única linha configurada (medida em 28/08/2026: "perplexity" /
-- "Perplexity Sonar", tenant_default) é removida aqui - é remoção de CONFIGURAÇÃO REAL de uma
-- instalação viva, não de código morto.
--
-- Backup completo do banco antes desta migration:
-- /home/sakae/cdc16-f11-backup-20260828_170104/commercial_assistant.dump (conferido pelo
-- conteúdo: pg_restore --list, 64 tabelas com dados, ai_provider_configs presente).
--
-- A tabela em si NÃO é apagada (aposentar não é apagar, mesmo padrão do enum ModuleName do
-- CMSaaS) - fica vazia, pronta para o dia em que um mecanismo equivalente reaparecer do lado do
-- Fleet Manager, se algum dia isso for decidido.
DELETE FROM "ai_provider_configs" WHERE "provider_key" = 'perplexity' AND "tenant_id" = 'tenant_default';
