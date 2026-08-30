-- Fase 13 — as colunas de credencial saem de `users`.
--
-- Senha, segundo fator e troca obrigatória passaram a ser do Keycloak (realm `cloudmountain`,
-- compartilhado com o CMCRM e o CMSaaS), com política mais forte do que a que havia aqui: 12
-- caracteres com histórico de 5, contra 8, mais WebAuthn e códigos de recuperação.
--
-- `password_hash` guardava dois formatos: scrypt e, em contas antigas, SHA-256 SEM SALT. Manter
-- isso num banco que ninguém mais consulta para autenticar seria conservar o risco sem a função —
-- um vazamento continuaria expondo credencial de gente real, para autenticar em nada.
--
-- ORDEM DE APLICAÇÃO: esta migration é DESTRUTIVA, então roda DEPOIS do deploy — nunca antes.
-- O código novo já não lê nem escreve nenhuma destas colunas; rodar a migration primeiro deixaria
-- o código VELHO, ainda no ar, procurando coluna que sumiu.
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_enabled";
ALTER TABLE "users" DROP COLUMN IF EXISTS "mfa_totp_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password";
