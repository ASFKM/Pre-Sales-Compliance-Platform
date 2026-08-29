-- PreSales F6: valores aprovados das variaveis livres do template de proposta.
-- Aditiva e anulavel: NULL significa "esta proposta nao tem nenhum campo customizado",
-- que e o estado de toda proposta gerada antes desta fase.
ALTER TABLE "proposals" ADD COLUMN "template_field_values" JSONB;
