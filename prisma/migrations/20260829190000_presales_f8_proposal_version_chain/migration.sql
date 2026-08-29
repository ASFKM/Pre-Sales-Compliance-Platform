-- PreSales F8 — versionamento de proposta por reabertura pós-rejeição.
--
-- Escrita à mão (não gerada por `prisma migrate dev`) porque a coluna `proposal_group_id` é
-- obrigatória e a tabela já tem linhas: o gerador do Prisma para no "Added the required column
-- without a default value", e um DEFAULT constante seria pior — daria o MESMO grupo a propostas que
-- não têm relação nenhuma entre si. O backfill correto é `proposal_group_id = id`: toda proposta
-- que existe hoje é uma v1 isolada, cabeça da própria cadeia.
--
-- Ordem: adiciona anulável -> preenche -> só então impõe NOT NULL. Adicionar já NOT NULL falharia
-- na primeira linha existente.
--
-- ADITIVA e reversível: nada é apagado, nenhuma coluna existente muda de tipo. O rollback é
-- `ALTER TABLE proposals DROP COLUMN previous_version_id, DROP COLUMN proposal_group_id`
-- (os índices e a FK caem junto com as colunas).

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "proposal_group_id" TEXT;
ALTER TABLE "proposals" ADD COLUMN "previous_version_id" TEXT;

-- Backfill: cada proposta existente é a cabeça da própria cadeia de versões.
UPDATE "proposals" SET "proposal_group_id" = "id" WHERE "proposal_group_id" IS NULL;

ALTER TABLE "proposals" ALTER COLUMN "proposal_group_id" SET NOT NULL;

-- CreateIndex
-- `@unique` no elo para trás: uma versão rejeitada pode gerar no máximo UMA sucessora, e é o banco
-- que garante isso mesmo sob duas reaberturas concorrentes da mesma proposta.
CREATE UNIQUE INDEX "proposals_previous_version_id_key" ON "proposals"("previous_version_id");

-- CreateIndex
CREATE INDEX "proposals_proposal_group_id_idx" ON "proposals"("proposal_group_id");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
