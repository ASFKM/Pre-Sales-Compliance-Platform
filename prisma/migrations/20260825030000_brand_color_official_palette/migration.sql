-- ═══════════════════════════════════════════════════════════════════════════════
-- Fase 8 do programa de identidade visual — a cor de marca sai do verde aposentado e a
-- interface passa a poder usá-la. Ver docs/roadmap/IDENTIDADE_VISUAL_2026-08.md.
--
-- Esta é a PRIMEIRA migration do programa que mexe em dado gravado, e ela segue a regra
-- registrada em feedback_migration_seed_nunca_afrouxa_default: semear ancorando no valor
-- REAL de cada linha, nunca aplicar em massa o default do desenho.
--
-- Por que uma condição por valor, e não um UPDATE geral:
--   `branding_settings.primary_color` não tem default no schema — quem semeia é o bootstrap
--   de tenant (prisma/seed.ts e scripts/setup-installation.ts). Um tenant pode estar com
--   (a) o verde que o código usava como fallback histórico, que ninguém escolheu, ou
--   (b) uma cor que um administrador escolheu na tela "Identidade Visual".
--   Trocar (b) apagaria uma decisão de cliente sem ninguém pedir — o tipo de mudança que
--   não gera sintoma e só aparece numa auditoria meses depois.
--
-- Idempotente por construção: as condições casam apenas os dois hex da marca aposentada,
-- que deixam de existir depois da primeira execução. Rodar de novo não altera nada.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) A interface passa a poder ser pintada com a cor do tenant. Nasce DESLIGADO para toda
--    linha existente, e é deliberado: essas linhas foram gravadas quando a cor só alimentava
--    o DOCX gerado. Ligar em massa mudaria a aparência do produto para todo mundo que um dia
--    escolheu uma cor com outra finalidade.
ALTER TABLE "branding_settings" ADD COLUMN "apply_to_ui" BOOLEAN NOT NULL DEFAULT false;

-- 2) A cor de marca aposentada vira a cor oficial — só onde ela ainda está.
--    #059669 era o fallback de leitura do código (App.tsx) e #10b981 o default de criação de
--    um estilo novo (AdminConsole.tsx); os dois saem do código nesta mesma mudança.
UPDATE "branding_settings"
   SET "primary_color" = '#236cc7'
 WHERE lower("primary_color") IN ('#059669', '#10b981');

UPDATE "branding_settings"
   SET "accent_color" = '#288bf9'
 WHERE lower("accent_color") IN ('#059669', '#10b981');

UPDATE "brand_styles"
   SET "primary_color" = '#236cc7'
 WHERE lower("primary_color") IN ('#059669', '#10b981');

-- 3) Quem foi migrado no passo 2 está agora EXATAMENTE na cor da marca, e para essas linhas
--    ligar a aplicação na interface é um no-op visual: a rampa derivada de #236cc7 é a
--    própria rampa oficial de src/index.css (provado em src/brandTheme.test.ts). Elas ganham
--    a promessa da tela sem mudar um pixel. Quem tem cor própria segue desligado até o
--    administrador optar por aplicá-la.
UPDATE "branding_settings"
   SET "apply_to_ui" = true
 WHERE "primary_color" = '#236cc7';
