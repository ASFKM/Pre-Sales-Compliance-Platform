// Módulo de Precificação, Fase 7: motor fiscal opcional. Calcula o que é determinístico e de
// baixo risco de manutenção (ICMS interestadual via IcmsInterstateRateTable, PIS/COFINS por
// regime, ISS se o item for serviço, IPI se o usuário informou a alíquota por NCM). Substituição
// tributária (ST) NÃO é calculada - apenas sinalizada (stFlag) para revisão manual, porque as
// tabelas de MVA por NCM/protocolo/UF dependem de bases fiscais pagas mantidas por terceiros
// (IOB, Systax, Synchro); manter isso atualizado internamente é um projeto de compliance à parte.
//
// Isolado atrás desta função (não espalhado pela rota) para poder, no futuro, trocar por um
// provedor fiscal externo sem mexer no resto do módulo.
import { prisma } from "../../src/prisma";

export interface TaxCalculationInput {
  originUF: string;
  destinationUF: string | null;
  taxRegime: "simples_nacional" | "lucro_presumido" | "lucro_real";
  itemType: "merchandise" | "service" | null;
  ipiRatePercent: number | null;
  issRatePercent: number | null;
  stApplicable: boolean;
}

export interface TaxCalculationResult {
  icmsRatePercent: number | null;
  ipiRatePercent: number | null;
  pisCofinsRatePercent: number | null;
  issRatePercent: number | null;
  stFlag: boolean;
  totalTaxPercent: number;
}

// Regime Simples Nacional já embute PIS/COFINS na alíquota única do DAS - não há uma alíquota
// separada e comparável de PIS/COFINS pra somar aqui (por isso null, não 0 - 0 sugeriria isenção,
// o que não é o caso). Lucro Presumido tipicamente apura pelo regime cumulativo (3,65%); Lucro
// Real, pelo não-cumulativo (9,25%) - simplificação documentada no desenho do módulo.
function pisCofinsRateFor(regime: TaxCalculationInput["taxRegime"]): number | null {
  if (regime === "simples_nacional") return null;
  if (regime === "lucro_presumido") return 3.65;
  return 9.25; // lucro_real
}

export async function calculateTax(input: TaxCalculationInput): Promise<TaxCalculationResult> {
  const pisCofinsRatePercent = pisCofinsRateFor(input.taxRegime);

  if (input.itemType === "service") {
    const issRatePercent = input.issRatePercent ?? null;
    const totalTaxPercent = (issRatePercent ?? 0) + (pisCofinsRatePercent ?? 0);
    return { icmsRatePercent: null, ipiRatePercent: null, pisCofinsRatePercent, issRatePercent, stFlag: false, totalTaxPercent };
  }

  let icmsRatePercent: number | null = null;
  if (input.destinationUF && input.destinationUF !== input.originUF) {
    const row = await prisma.icmsInterstateRateTable.findUnique({
      where: { originUF_destinationUF: { originUF: input.originUF, destinationUF: input.destinationUF } },
    });
    icmsRatePercent = row?.ratePercent ?? null;
  }
  // Operação interna (mesma UF origem/destino): alíquota varia por estado e não está nesta
  // tabela federal - fica null (revisão manual), não um valor inventado.

  const ipiRatePercent = input.ipiRatePercent ?? null;
  const stFlag = input.stApplicable && input.destinationUF !== null && input.destinationUF !== input.originUF;

  const totalTaxPercent = (icmsRatePercent ?? 0) + (ipiRatePercent ?? 0) + (pisCofinsRatePercent ?? 0);

  return { icmsRatePercent, ipiRatePercent, pisCofinsRatePercent, issRatePercent: null, stFlag, totalTaxPercent };
}
