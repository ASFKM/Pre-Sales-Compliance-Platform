-- Item 18 do catalogo Reforma CloudMountain: a resposta do CLIENTE depois da liberacao.
--
-- ADITIVA: cria um enum novo e quatro colunas NULAVEIS. Nenhuma linha existente muda, e uma
-- versao anterior do codigo continua funcionando contra este banco (as colunas simplesmente
-- ficam nulas) -- por isso a ordem segura aqui e backup -> migration -> deploy.
CREATE TYPE "ClientDecision" AS ENUM ('accepted', 'declined');

ALTER TABLE "proposals"
  ADD COLUMN "client_decision"            "ClientDecision",
  ADD COLUMN "client_decision_at"         TIMESTAMP(3),
  ADD COLUMN "client_decision_by_user_id" TEXT,
  ADD COLUMN "client_decision_note"       TEXT;

-- A consulta que a tela faz e "propostas liberadas ainda sem resposta do cliente". Sem indice
-- parcial isso vira varredura da tabela inteira conforme o historico cresce; com ele, o indice
-- so guarda as linhas que ainda interessam e encolhe sozinho quando a resposta chega.
CREATE INDEX "proposals_aguardando_resposta_do_cliente_idx"
  ON "proposals" ("tenant_id")
  WHERE "status" = 'released' AND "client_decision" IS NULL;
