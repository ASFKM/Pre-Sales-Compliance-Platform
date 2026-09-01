// Faixa de uso e formatação de um medidor de hardware (CPU, memória, disco) — portado de
// web/src/pages/faixaDeUso.ts do CMSaaS (mesmo cálculo usado no card de hardware por instalação),
// adaptado aos tokens deste produto: os semânticos vêm das classes Tailwind success/warning/danger
// já usadas no resto do AdminConsole, não das CSS vars --success/--warning/--danger do CMSaaS.
//
// O ponto do arquivo é o mesmo de lá: ausência de medida (`null`) tem faixa própria
// ("desconhecida") e nunca cai em "tranquila" — um card sem leitura não pode pintar de verde.
export type FaixaDeUso = "tranquila" | "atencao" | "critica" | "desconhecida";

export const CORTE_ATENCAO = 70;
export const CORTE_CRITICO = 90;

export function faixaDeUso(percentual: number | null | undefined): FaixaDeUso {
  if (percentual === null || percentual === undefined || Number.isNaN(percentual)) return "desconhecida";
  if (percentual > CORTE_CRITICO) return "critica";
  if (percentual >= CORTE_ATENCAO) return "atencao";
  return "tranquila";
}

const COR_DA_FAIXA: Record<FaixaDeUso, string> = {
  tranquila: "var(--color-brand-600)",
  atencao: "var(--color-warning-600)",
  critica: "var(--color-danger-600)",
  desconhecida: "var(--color-slate-300)",
};

export function corDaFaixa(faixa: FaixaDeUso): string {
  return COR_DA_FAIXA[faixa];
}

export function percentualDeUso(usado: number | null | undefined, total: number | null | undefined): number | null {
  if (usado === null || usado === undefined || !Number.isFinite(usado)) return null;
  if (total === null || total === undefined || !Number.isFinite(total) || total <= 0) return null;
  if (usado < 0) return null;
  return Math.min(100, (usado / total) * 100);
}

export function formatarMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined || !Number.isFinite(mb)) return "—";
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

// Quantas pílulas de um medidor segmentado acendem para um dado percentual — mesma dupla borda
// do original: `floor` para não fechar a última pílula antes de 100% de verdade, e piso de 1
// para não apagar um uso real (>0%) até a terceira casa decimal.
export function pilulasAcesas(percentual: number | null | undefined, total: number): number {
  if (percentual === null || percentual === undefined || Number.isNaN(percentual)) return 0;
  if (percentual <= 0) return 0;
  if (percentual >= 100) return total;
  return Math.min(total, Math.max(1, Math.floor((percentual / 100) * total)));
}
