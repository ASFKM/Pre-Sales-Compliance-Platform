-- F1 (31/08/2026) - as colunas de credencial VOLTAM para `users`.
--
-- Decisao do dono em 31/08/2026: sai o Keycloak compartilhado; PreSales, CMSaaS e CMCRM voltam a
-- gerenciar os proprios usuarios. Esta migration desfaz o efeito de estrutura de
-- `20260830051000_f13_credencial_vai_para_o_keycloak`, que removeu as quatro colunas.
--
-- Ela e ADITIVA: so cria coluna, nao apaga nem reescreve nada. Pode rodar antes do deploy sem
-- risco - o codigo antigo simplesmente ignora colunas que nao conhece.
--
-- OS DADOS NAO VOLTAM. A migration de 30/08 foi DROP COLUMN: os hashes de senha e os segredos
-- TOTP dos 28 usuarios existentes foram destruidos e nao ha copia. Todo mundo nasce aqui sem
-- senha (`password_hash` nulo), o que significa que ninguem consegue entrar ate ganhar uma - e
-- `comparePasswords` recusa hash vazio, entao isso e recusa, nao brecha. O administrador master
-- recebe a dele por `scripts/f1-restaurar-administrador-master.ts`; os outros 27 ficam para
-- depois, por decisao do dono.
--
-- `mfa_enabled` volta com default `false`, e nao com o valor que a conta tinha: o segredo TOTP
-- correspondente foi destruido junto, e reativar o segundo fator sem o segredo trancaria a conta
-- fora do produto sem que ninguem conseguisse provar o codigo.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfa_totp_secret" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
