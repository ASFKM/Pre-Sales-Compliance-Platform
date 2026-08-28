// CDC 16 — Fase 10. O que a fila e os cards da Início desenham IGUAL.
//
// Nasceu de uma extração, não de um projeto: até a F9 estes rótulos, cores e
// formatadores viviam dentro de `DemandQueue.tsx`, que era a única tela de
// demanda do produto. A F10 cria a segunda — os dois cards da Início —, e uma
// lista de estados copiada de um lado para o outro diverge na primeira mudança:
// quem valida serve a lista, e aqui quem desenha é um só.
//
// Nada aqui é novo. O texto, as classes e as regras são os mesmos que a fila
// usa desde a F1, movidos sem reescrita para que o diff desta fase mostre
// mudança de LUGAR e não de comportamento.

export const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  assigned: "Assumida",
  in_analysis: "Em análise",
  returned: "Devolvida",
  cancelled: "Cancelada",
  completed: "Concluída",
};

export const STATUS_COLOR: Record<string, string> = {
  queued: "bg-brand-50 text-brand-700",
  assigned: "bg-warning-50 text-warning-700",
  in_analysis: "bg-warning-50 text-warning-700",
  returned: "bg-danger-50 text-danger-700",
  cancelled: "bg-slate-100 text-slate-600",
  completed: "bg-success-50 text-success-700",
};

export function dataCurta(valor?: string | null): string {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export function moeda(valor?: number | null, currency?: string): string {
  if (valor === null || valor === undefined) return "—";
  try {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: currency || "BRL", maximumFractionDigits: 0 });
  } catch {
    return String(valor);
  }
}

// Quantos dias faltam para o prazo do edital. O sinal é o que decide a cor: uma
// fila de auto-serviço sem urgência visível vira ordem de chegada disfarçada.
export function diasAtePrazo(prazo?: string | null): number | null {
  if (!prazo) return null;
  const d = new Date(prazo);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

// O prazo do SLA e o prazo do edital são coisas diferentes, e as duas telas
// mostram os dois lado a lado justamente por isso: um é a promessa desta equipe
// (D19), o outro é a data em que a licitação fecha. Confundi-los faria a fila
// cobrar a coisa errada.
export function estadoDoPrazo(dueAt?: string | null): { texto: string; classe: string; vencido: boolean } | null {
  if (!dueAt) return null;
  const restante = new Date(dueAt).getTime() - Date.now();
  if (Number.isNaN(restante)) return null;
  const vencido = restante < 0;
  const s = Math.abs(Math.round(restante / 1000));
  const dias = Math.floor(s / 86400);
  const horas = Math.floor((s % 86400) / 3600);
  const minutos = Math.floor((s % 3600) / 60);
  const dur = dias > 0 ? `${dias}d ${horas}h` : horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;
  return {
    texto: vencido ? `vencido há ${dur}` : `faltam ${dur}`,
    classe: vencido ? "text-danger-600" : restante < 4 * 60 * 60 * 1000 ? "text-warning-700" : "text-slate-400",
    vencido,
  };
}

/** Uma duração em segundos, do jeito que o painel de desempenho já a escrevia. */
export function duracao(segundos: number | null): string {
  if (segundos === null) return "—";
  const s = Math.max(0, segundos);
  const dias = Math.floor(s / 86400);
  const horas = Math.floor((s % 86400) / 3600);
  const minutos = Math.floor((s % 3600) / 60);
  if (dias > 0) return horas > 0 ? `${dias}d ${horas}h` : `${dias}d`;
  if (horas > 0) return minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`;
  return `${minutos}min`;
}

export function Campo({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div>
      <dt className="text-[10px] uppercase font-mono text-slate-400">{rotulo}</dt>
      <dd className="text-slate-700">{valor || "—"}</dd>
    </div>
  );
}
