// Módulo de Precificação: centraliza a fórmula de preço final/margem, usada no import de BOM
// (Fase 4, desconto inicial 0%), na edição manual de desconto (Fase 4) e na otimização de budget
// (Fase 6) - uma única definição evita a fórmula divergir entre esses três pontos.
//
// Leitura adotada (única forma coerente sem um campo de custo separado no schema):
// currentListPrice é o preço de aquisição/lista - o que a empresa paga ao fabricante/
// distribuidor. markupMin/markupMax definem a faixa de markup aceitável sobre esse preço para
// chegar no valor de venda ao cliente final. discountPercent é aplicado a partir do teto
// (markupMax), não a partir do preço de lista puro - descontar 0% vende no markup máximo.
export interface LinePricingInput {
  listPrice: number;
  markupMin: number;
  markupMax: number;
  discountPercent: number;
}

export interface LinePricingResult {
  finalUnitPrice: number;
  marginPercent: number;
  withinMarkupRange: boolean;
}

export function computeLinePricing({ listPrice, markupMin, markupMax, discountPercent }: LinePricingInput): LinePricingResult {
  const ceilingPrice = listPrice * (1 + markupMax / 100);
  const floorPrice = listPrice * (1 + markupMin / 100);
  const finalUnitPrice = ceilingPrice * (1 - discountPercent / 100);
  const marginPercent = listPrice > 0 ? ((finalUnitPrice - listPrice) / listPrice) * 100 : 0;
  const withinMarkupRange = finalUnitPrice >= floorPrice && finalUnitPrice <= ceilingPrice + 1e-9;
  return { finalUnitPrice, marginPercent, withinMarkupRange };
}
