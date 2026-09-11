-- F5 — Remoção da identidade visual configurável por tenant.
--
-- MIGRATION DESTRUTIVA. Backup validado antes de rodar (dump com as duas tabelas dentro,
-- restaurado num banco descartável e conferido linha a linha).
--
-- O que sai e por quê:
--
--   `branding_settings` e `brand_styles` guardavam logo, cores e textos que só alcançavam
--   DUAS coisas: o cabeçalho do gerador GENÉRICO de proposta (o caminho sem template) e a
--   sobrescrita em runtime dos tokens `--color-brand-*` da interface. O gerador genérico
--   deixou de existir nesta mesma fase — o template .docx virou obrigatório —, e a paleta
--   da interface volta a vir inteira de `@theme static` (src/index.css). O achado que
--   motivou a fase: quando existe um template real, o documento sai inteiro dele e o
--   cabeçalho de marca nunca aparecia. A tela pintava um documento que quase ninguém gerava.
--
--   `projects.brand_style_id` era o ponteiro do projeto para um BrandStyle. Sem BrandStyle,
--   é uma coluna que só pode ser nula.
--
--   A permissão `branding:manage` sai da lista dos papéis JÁ GRAVADOS, e não só do catálogo
--   em server/routes/roles.ts. Escolha deliberada: `roles.permissions` é um text[] lido pelo
--   front para montar menus e pela tela de edição de papéis, que renderiza cada string da
--   lista. Uma permissão que não existe mais no catálogo apareceria ali como item órfão que
--   ninguém consegue explicar nem desmarcar de forma útil. Deixá-la como "lixo inerte"
--   também esconderia o fato de que a capacidade sumiu.

-- 1. A coluna do projeto some antes da tabela para a qual ela apontava.
ALTER TABLE "projects" DROP COLUMN IF EXISTS "brand_style_id";

-- 2. As duas tabelas de identidade visual.
DROP TABLE IF EXISTS "brand_styles";
DROP TABLE IF EXISTS "branding_settings";

-- 3. A permissão sai da lista dos papéis existentes.
UPDATE "roles"
   SET "permissions" = array_remove("permissions", 'branding:manage')
 WHERE 'branding:manage' = ANY("permissions");
