// Módulo de Precificação, Fase 6: "chegar no budget". LLMs são pouco confiáveis pra aritmética
// exata sobre várias linhas - em vez de pedir pra IA calcular os números finais, a IA escolhe a
// ESTRATÉGIA (e explica o porquê, guardado em BudgetOptimizationRun.resultSummary), e este
// algoritmo determinístico ("water-filling") calcula os valores exatos, garantindo que nenhuma
// linha passe do markupMin (floor) e que o total bata no budget-alvo sempre que matematicamente
// possível dentro da faixa [minAchievableTotal, maxAchievableTotal].
import { computeLinePricing } from "./pricingMath";

// "equal_percent": mesmo % de desconto em toda linha (peso = valor total da linha - matematicamente
// isso resulta em % igual quando nenhuma linha bate no floor). "equal_amount": mesma redução em R$
// por linha (peso = 1) - na prática dá % maior nos itens de menor valor, então concentra o desconto
// percentual nos itens pequenos/acessórios em vez de nos itens de ticket alto.
export type BudgetStrategy = "equal_percent" | "equal_amount";

export interface OptimizableLine {
  id: string;
  listPrice: number;
  markupMin: number;
  markupMax: number;
  quantity: number;
}

export interface LineSuggestion {
  id: string;
  discountPercent: number;
  finalUnitPrice: number;
  lineTotal: number;
}

export interface OptimizationResult {
  feasible: boolean;
  targetBudget: number;
  achievedTotal: number;
  minAchievableTotal: number;
  maxAchievableTotal: number;
  lines: LineSuggestion[];
}

function ceilingOf(l: OptimizableLine): number {
  return l.listPrice * (1 + l.markupMax / 100);
}
function floorOf(l: OptimizableLine): number {
  return l.listPrice * (1 + l.markupMin / 100);
}

export function optimizeForBudget(lines: OptimizableLine[], targetBudget: number, strategy: BudgetStrategy): OptimizationResult {
  const maxAchievableTotal = lines.reduce((sum, l) => sum + ceilingOf(l) * l.quantity, 0);
  const minAchievableTotal = lines.reduce((sum, l) => sum + floorOf(l) * l.quantity, 0);

  const feasible = targetBudget >= minAchievableTotal && targetBudget <= maxAchievableTotal;
  // Fora da faixa: não finge sucesso - ainda calcula o melhor esforço (0% ou desconto máximo em
  // todas as linhas), mas `feasible: false` avisa o chamador explicitamente.
  const effectiveTarget = Math.min(Math.max(targetBudget, minAchievableTotal), maxAchievableTotal);

  const remainingIds = new Set(lines.map((l) => l.id));
  const discountAt: Record<string, number> = {};
  for (const l of lines) discountAt[l.id] = 0;

  let toRemove = maxAchievableTotal - effectiveTarget;
  let guard = 0;

  while (toRemove > 1e-6 && remainingIds.size > 0 && guard < 20) {
    guard++;
    const active = lines.filter((l) => remainingIds.has(l.id));
    const weightOf = (l: OptimizableLine) => (strategy === "equal_percent" ? ceilingOf(l) * l.quantity : 1);
    const weightSum = active.reduce((s, l) => s + weightOf(l), 0);
    if (weightSum <= 0) break;

    let removedThisPass = 0;
    let anyCapped = false;

    for (const l of active) {
      const share = (weightOf(l) / weightSum) * toRemove;
      const ceiling = ceilingOf(l);
      const floor = floorOf(l);
      const maxRemovableForLine = (ceiling - floor) * l.quantity;
      const currentlyRemoved = ceiling * l.quantity * (discountAt[l.id] / 100);
      const wouldRemove = currentlyRemoved + share;

      if (wouldRemove >= maxRemovableForLine - 1e-9) {
        discountAt[l.id] = ceiling > 0 ? 100 * (1 - floor / ceiling) : 0;
        removedThisPass += maxRemovableForLine - currentlyRemoved;
        remainingIds.delete(l.id);
        anyCapped = true;
      } else {
        discountAt[l.id] = ceiling * l.quantity > 0 ? 100 * (wouldRemove / (ceiling * l.quantity)) : 0;
        removedThisPass += share;
      }
    }

    toRemove -= removedThisPass;
    if (!anyCapped) break;
  }

  const resultLines: LineSuggestion[] = lines.map((l) => {
    const pricing = computeLinePricing({ listPrice: l.listPrice, markupMin: l.markupMin, markupMax: l.markupMax, discountPercent: discountAt[l.id] });
    return {
      id: l.id,
      discountPercent: Math.round(discountAt[l.id] * 100) / 100,
      finalUnitPrice: pricing.finalUnitPrice,
      lineTotal: pricing.finalUnitPrice * l.quantity,
    };
  });

  const achievedTotal = resultLines.reduce((s, l) => s + l.lineTotal, 0);

  return { feasible, targetBudget, achievedTotal, minAchievableTotal, maxAchievableTotal, lines: resultLines };
}
