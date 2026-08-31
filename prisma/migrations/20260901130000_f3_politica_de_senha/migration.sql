-- F3 (01/09/2026) - a politica de senha deixa de ser constante no codigo e passa a morar no banco.
--
-- Programa "a autenticacao volta para dentro de cada produto", fase 3 (o plano esta em
-- docs/cdc/17-autenticacao-volta-para-os-produtos.md, no repositorio do CMSaaS). Ate aqui o unico
-- criterio era TAMANHO_MINIMO_DE_SENHA = 12, escrito em server/utils/security.ts e repetido a mao
-- em src/components/Login.tsx. As duas copias saem.
--
-- ADITIVA - so CREATE TABLE e ADD COLUMN IF NOT EXISTS. Pode rodar antes do deploy sem quebrar o
-- codigo anterior, que simplesmente ignora as tabelas novas.
--
-- UMA LINHA POR TENANT (unique em tenant_id): este produto e multi-tenant e cada instalacao tem o
-- proprio administrador. A linha NAO e semeada de proposito: ausencia significa "padrao de
-- fabrica" (12, numero, especial, historico 5, sem validade), definido em POLITICA_PADRAO, e uma
-- linha semeada por migration seria uma segunda definicao do padrao, livre para divergir.
CREATE TABLE IF NOT EXISTS "password_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "comprimento_minimo" INTEGER NOT NULL DEFAULT 12,
    "exigir_maiuscula" BOOLEAN NOT NULL DEFAULT false,
    "exigir_minuscula" BOOLEAN NOT NULL DEFAULT false,
    "exigir_numero" BOOLEAN NOT NULL DEFAULT true,
    "exigir_especial" BOOLEAN NOT NULL DEFAULT true,
    "historico_de_reuso" INTEGER NOT NULL DEFAULT 5,
    "validade_em_dias" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" TEXT,

    CONSTRAINT "password_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_policies_tenant_id_key" ON "password_policies"("tenant_id");

ALTER TABLE "password_policies" DROP CONSTRAINT IF EXISTS "password_policies_tenant_id_fkey";
ALTER TABLE "password_policies" ADD CONSTRAINT "password_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- password_history guarda HASHES DE SENHAS ANTIGAS, e um hash antigo continua sendo material de
-- senha: nenhuma rota devolve esta coluna, e ela so e lida dentro de senhaJaFoiUsada.
--
-- A tabela cresce sem limite se nada podar - por isso registrarSenhaNoHistorico apaga, a cada
-- troca, tudo que exceder historico_de_reuso entradas por pessoa. O indice (user_id, created_at)
-- serve as duas coisas que a tabela faz: buscar as N mais recentes de alguem, e sair inteira junto
-- quando o usuario e apagado (ON DELETE CASCADE sem indice varre a tabela).
CREATE TABLE IF NOT EXISTS "password_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "password_history_user_id_created_at_idx" ON "password_history"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "password_history_tenant_id_idx" ON "password_history"("tenant_id");

ALTER TABLE "password_history" DROP CONSTRAINT IF EXISTS "password_history_user_id_fkey";
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "password_history" DROP CONSTRAINT IF EXISTS "password_history_tenant_id_fkey";
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quando a senha atual foi definida - e o que a VALIDADE mede. Nulo em toda conta existente, e
-- isso e a verdade: a F1 devolveu as colunas de credencial vazias e so o administrador master
-- recebeu senha. senhaExpirada() trata nulo como VENCIDA quando ha validade configurada; como a
-- validade nasce em 0 (desligada), ninguem e barrado por isto no dia da migration - so depois de
-- alguem ligar a validade na tela, que e exatamente quando deve valer.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMP(3);
