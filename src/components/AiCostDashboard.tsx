import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import ApiClient from "../lib/api";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

/**
 * Aba "Custos" da tela IA, Prompts e Custos (F10 do PreSales).
 *
 * A tela tinha um card de custo espremido no meio da CONFIGURAÇÃO de IA, dividindo espaço com o
 * teto mensal e com a lista de prompts. Esta fase separou as duas coisas em abas e deu ao custo a
 * tela inteira, porque o que faltava não cabia num card: histórico ao longo do tempo, com período
 * e granularidade escolhidos por quem lê.
 *
 * O gráfico usa a moldura portada do catálogo local de componentes (`./ui/chart`, ver o cabeçalho
 * de lá). A biblioteca é `recharts`, que já estava no produto desde o histórico de preço da
 * Precificação — a identidade visual é que vem do catálogo.
 */

// Rótulo amigável por tipo de tarefa de IA. É ENFEITE, não fonte: quem decide o que aparece na
// tabela é o dado que voltou do banco, e um tipo ausente deste mapa é exibido pelo próprio slug.
//
// A regra existe porque a lista cresce e já mordeu: até a F6 a geração de proposta não chamava IA
// nenhuma, então `proposal_generation` não estava aqui; a F6 a transformou em tarefa de IA de
// verdade (sugestão de conteúdo para campos de template), com gasto gravado em `AiUsageLog` como
// qualquer outra — e a tabela, que enumerava `Object.keys` DESTE mapa, passou a esconder gasto
// real sem erro nenhum. Enumerar os tipos à mão é o defeito; o mapa continua, só perdeu o poder
// de decidir quem existe.
const AI_TASK_TYPE_LABEL: Record<string, { pt: string; en: string }> = {
  document_analysis: { pt: "Análise de Documentos", en: "Document Analysis" },
  project_intake_analysis: { pt: "Extração de Metadados (Cadastro de Projeto)", en: "Metadata Extraction (Project Intake)" },
  knowledge_base_analysis: { pt: "Análise de Documentos (Base de Conhecimento)", en: "Document Analysis (Knowledge Base)" },
  spec_copilot_chat: { pt: "Copiloto de Especificações (Chat)", en: "Specification Copilot (Chat)" },
  bom_web_search: { pt: "Busca Web de Equipamentos (BOM)", en: "Equipment Web Search (BOM)" },
  kb_suggest: { pt: "Sugestão da Base de Conhecimento", en: "Knowledge Base Suggestion" },
  kb_reconciliation: { pt: "Reconciliação da Base de Conhecimento", en: "Knowledge Base Reconciliation" },
  document_classification: { pt: "Classificação de Documentos", en: "Document Classification" },
  poc_test_generation: { pt: "Geração de Cadernos de Teste (POC)", en: "Test Script Generation (POC)" },
  poc_schedule_generation: { pt: "Sugestão de Cronograma (POC)", en: "Schedule Suggestion (POC)" },
  poc_final_report_generation: { pt: "Relatório Final (POC)", en: "Final Report (POC)" },
  proposal_opinion_panel: { pt: "Pareceres de IA Multi-Perspectiva (Propostas)", en: "Multi-Perspective AI Opinions (Proposals)" },
  pricing_budget_optimization: { pt: "Otimização de Budget (Precificação)", en: "Budget Optimization (Pricing)" },
  pricing_catalog_extraction: { pt: "Extração de Catálogo (Precificação)", en: "Catalog Extraction (Pricing)" },
  proposal_generation: { pt: "Geração de Propostas", en: "Proposal Generation" },
};

function rotuloDoTipo(slug: string, locale: "en" | "pt"): string {
  const rotulo = AI_TASK_TYPE_LABEL[slug];
  return rotulo ? rotulo[locale] : slug;
}

type Granularidade = "day" | "week" | "month";

interface PontoDaSerie {
  bucket: string;
  cost_usd: number;
  call_count: number;
}

interface RespostaDaSerie {
  granularity: Granularidade;
  from: string;
  to: string;
  time_zone: string;
  total_cost_usd: number;
  total_call_count: number;
  points: PontoDaSerie[];
}

export interface AiUsageByUserRow {
  user_id: string;
  user_name: string;
  call_count: number;
  cost_usd: number;
}

/**
 * Data civil de hoje no fuso de quem lê, como 'AAAA-MM-DD'. `en-CA` formata exatamente nesse
 * formato. Passar por `toISOString()` daria a data em UTC e, depois das 21h no Brasil, ofereceria
 * o dia seguinte como "hoje" no filtro.
 */
function hojeCivil(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function civilMenosDias(civil: string, dias: number): string {
  const [a, m, d] = civil.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  base.setUTCDate(base.getUTCDate() - dias);
  return base.toISOString().slice(0, 10);
}

/**
 * Formata o rótulo do balde a partir do TEXTO 'AAAA-MM-DD', sem construir um `Date`.
 * `new Date("2026-08-19")` é meia-noite UTC; formatado no fuso do navegador (UTC-3) ele vira
 * 18/08 — o eixo inteiro andaria um dia para trás, sem erro nenhum.
 */
function rotuloDoBalde(bucket: string, granularidade: Granularidade, locale: "en" | "pt"): string {
  const [ano, mes, dia] = bucket.split("-");
  const mesesPt = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mesesEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const nomeDoMes = (locale === "pt" ? mesesPt : mesesEn)[Number(mes) - 1] ?? mes;

  if (granularidade === "month") return `${nomeDoMes}/${ano}`;
  if (granularidade === "week") return locale === "pt" ? `sem. ${dia}/${mes}` : `wk ${mes}/${dia}`;
  return locale === "pt" ? `${dia}/${mes}` : `${mes}/${dia}`;
}

const GRANULARIDADES: { valor: Granularidade; pt: string; en: string }[] = [
  { valor: "day", pt: "Diária", en: "Daily" },
  { valor: "week", pt: "Semanal", en: "Weekly" },
  { valor: "month", pt: "Mensal", en: "Monthly" },
];

const ATALHOS: { dias: number; granularidade: Granularidade; pt: string; en: string }[] = [
  { dias: 6, granularidade: "day", pt: "7 dias", en: "7 days" },
  { dias: 29, granularidade: "day", pt: "30 dias", en: "30 days" },
  { dias: 89, granularidade: "week", pt: "90 dias", en: "90 days" },
  { dias: 364, granularidade: "month", pt: "12 meses", en: "12 months" },
];

export default function AiCostDashboard({
  locale,
  costUSD,
  exchangeRate,
  costByTaskType,
  costByUser,
  usageOwnership,
}: {
  locale: "en" | "pt";
  costUSD: number;
  exchangeRate: number;
  costByTaskType: Record<string, number>;
  costByUser: AiUsageByUserRow[];
  usageOwnership: { total_calls: number; calls_with_owner: number } | null;
}) {
  const hoje = hojeCivil();
  const [de, setDe] = useState(() => civilMenosDias(hoje, 29));
  const [ate, setAte] = useState(hoje);
  const [granularidade, setGranularidade] = useState<Granularidade>("day");
  const [serie, setSerie] = useState<RespostaDaSerie | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const buscar = useCallback(
    async (deCivil: string, ateCivil: string, gran: Granularidade) => {
      setCarregando(true);
      setErro("");
      try {
        const params = new URLSearchParams({ from: deCivil, to: ateCivil, granularity: gran });
        setSerie(await ApiClient.get<RespostaDaSerie>(`/api/settings/ai-cost-timeseries?${params.toString()}`));
      } catch (e: any) {
        // A recusa por período grande demais vem do servidor com o motivo escrito: mostrar a
        // mensagem dele é melhor do que inventar uma, e é o que diz ao administrador qual
        // granularidade pedir. Zerar a série evita ficar exibindo o resultado do filtro anterior
        // como se fosse o do filtro atual.
        setErro(e?.message || (locale === "pt" ? "Não foi possível carregar o histórico." : "Could not load the history."));
        setSerie(null);
      } finally {
        setCarregando(false);
      }
    },
    [locale],
  );

  useEffect(() => {
    buscar(de, ate, granularidade);
    // Só na montagem: dali em diante quem dispara é o botão/atalho, para o filtro não recarregar
    // a cada tecla digitada no campo de data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dadosDoGrafico = useMemo(
    () =>
      (serie?.points ?? []).map((p) => ({
        balde: rotuloDoBalde(p.bucket, serie!.granularity, locale),
        bucket: p.bucket,
        custo: Number(p.cost_usd.toFixed(4)),
        chamadas: p.call_count,
      })),
    [serie, locale],
  );

  const chartConfig: ChartConfig = {
    custo: { label: locale === "pt" ? "Custo (USD)" : "Cost (USD)", color: "var(--color-brand-600)" },
  };

  // A lista de serviços vem do DADO, não de uma lista escrita à mão: um tipo de tarefa novo
  // aparece aqui sozinho, e o mapa de rótulos só decide como ele se chama na tela.
  const servicosComGasto = useMemo(
    () =>
      Object.entries(costByTaskType)
        .filter(([, valor]) => (valor || 0) > 0)
        .sort((a, b) => b[1] - a[1]),
    [costByTaskType],
  );

  const aplicarAtalho = (dias: number, gran: Granularidade) => {
    const novoDe = civilMenosDias(hoje, dias);
    setDe(novoDe);
    setAte(hoje);
    setGranularidade(gran);
    buscar(novoDe, hoje, gran);
  };

  const rotuloDoPeriodo = serie
    ? `${serie.from.split("-").reverse().join("/")} – ${serie.to.split("-").reverse().join("/")}`
    : "";

  return (
    <div className="w-full space-y-6" data-testid="aba-custos-ia">
      {/* ── Filtro ─────────────────────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
            {locale === "pt" ? "Histórico de Gasto de IA" : "AI Spend History"}
          </h3>
          {serie && (
            <span className="text-xs text-slate-400 font-mono">
              {locale === "pt" ? "Fuso do relatório" : "Report time zone"}: {serie.time_zone}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="custo-de" className="text-xs uppercase font-bold text-slate-400 tracking-wider font-mono">
              {locale === "pt" ? "De" : "From"}
            </label>
            <input
              id="custo-de"
              type="date"
              value={de}
              max={ate}
              onChange={(e) => setDe(e.target.value)}
              className="p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-semibold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="custo-ate" className="text-xs uppercase font-bold text-slate-400 tracking-wider font-mono">
              {locale === "pt" ? "Até" : "To"}
            </label>
            <input
              id="custo-ate"
              type="date"
              value={ate}
              min={de}
              onChange={(e) => setAte(e.target.value)}
              className="p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-semibold text-slate-700"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="custo-granularidade" className="text-xs uppercase font-bold text-slate-400 tracking-wider font-mono">
              {locale === "pt" ? "Granularidade" : "Granularity"}
            </label>
            <select
              id="custo-granularidade"
              value={granularidade}
              onChange={(e) => setGranularidade(e.target.value as Granularidade)}
              className="p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none text-xs font-semibold text-slate-700"
            >
              {GRANULARIDADES.map((g) => (
                <option key={g.valor} value={g.valor}>
                  {locale === "pt" ? g.pt : g.en}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => buscar(de, ate, granularidade)}
            disabled={carregando}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-mono text-xs font-bold py-2 px-4 rounded shadow transition-all cursor-pointer"
          >
            {carregando ? (locale === "pt" ? "Carregando…" : "Loading…") : locale === "pt" ? "Aplicar" : "Apply"}
          </button>
          <div className="flex items-center gap-2 ml-auto">
            {ATALHOS.map((a) => (
              <button
                key={a.dias}
                onClick={() => aplicarAtalho(a.dias, a.granularidade)}
                className="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-mono text-xs font-bold py-1.5 px-3 rounded cursor-pointer"
              >
                {locale === "pt" ? a.pt : a.en}
              </button>
            ))}
          </div>
        </div>

        {erro && (
          <p className="text-xs font-semibold text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2" role="alert">
            {erro}
          </p>
        )}

        {serie && !erro && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="text-xs text-slate-400 block uppercase">{locale === "pt" ? "Gasto no Período (USD)" : "Period Spend (USD)"}</span>
                <span className="text-lg font-bold text-slate-800 mt-1 block">${serie.total_cost_usd.toFixed(2)}</span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="text-xs text-slate-400 block uppercase">{locale === "pt" ? "Gasto no Período (BRL)" : "Period Spend (BRL)"}</span>
                <span className="text-lg font-bold text-slate-800 mt-1 block">R$ {(serie.total_cost_usd * exchangeRate).toFixed(2)}</span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="text-xs text-slate-400 block uppercase">{locale === "pt" ? "Chamadas no Período" : "Calls in Period"}</span>
                <span className="text-lg font-bold text-slate-800 mt-1 block">{serie.total_call_count}</span>
              </div>
            </div>

            {serie.total_call_count === 0 ? (
              <div className="text-xs text-slate-400 italic px-3 py-10 text-center bg-slate-50 border border-slate-100 rounded-lg">
                {locale === "pt"
                  ? `Nenhuma chamada de IA registrada entre ${rotuloDoPeriodo}.`
                  : `No AI calls recorded between ${rotuloDoPeriodo}.`}
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-72 w-full" data-testid="grafico-gasto-ia">
                <BarChart data={dadosDoGrafico} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  {/* `padding` reserva meia barra em cada ponta: sem ele, a barra do primeiro e do último
                      balde é desenhada em cima do eixo e sai cortada ao meio. */}
                  <XAxis dataKey="balde" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} padding={{ left: 8, right: 8 }} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickFormatter={(v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(0)}`}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_rotulo: any, payload: any) => {
                          const ponto = payload?.[0]?.payload;
                          if (!ponto) return "";
                          const chamadas = ponto.chamadas as number;
                          const quando = ponto.bucket.split("-").reverse().join("/");
                          return locale === "pt"
                            ? `${quando} · ${chamadas} ${chamadas === 1 ? "chamada" : "chamadas"}`
                            : `${ponto.bucket} · ${chamadas} ${chamadas === 1 ? "call" : "calls"}`;
                        }}
                        formatter={(valor: any) => (
                          <span className="flex flex-1 items-center justify-between gap-3">
                            <span className="text-slate-500">{locale === "pt" ? "Custo" : "Cost"}</span>
                            <span className="font-mono font-semibold text-slate-800 tabular-nums">${Number(valor).toFixed(4)}</span>
                          </span>
                        )}
                      />
                    }
                  />
                  {/* Sem animação: o primeiro quadro de um gráfico recharts animado é vazio, e uma
                      captura de tela tirada nele sai sem gráfico enquanto o texto já passou. */}
                  <Bar dataKey="custo" fill="var(--color-custo)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ChartContainer>
            )}

            <p className="text-xs text-slate-400">
              {locale === "pt"
                ? `Cada barra é um período fechado no fuso ${serie.time_zone}; períodos sem gasto aparecem zerados, não são omitidos.`
                : `Each bar is a closed bucket in ${serie.time_zone}; periods with no spend show as zero rather than being dropped.`}
            </p>
          </>
        )}
      </div>

      {/* ── Consumo por serviço e por usuário ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
              {locale === "pt" ? "Consumo por Serviço" : "Cost by Service"}
            </h3>
            <span className="text-xs text-slate-400 font-mono uppercase">{locale === "pt" ? "mês atual" : "current month"}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 font-mono text-xs">
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
              <span className="text-xs text-slate-400 block uppercase">{locale === "pt" ? "Consumo Estimado (USD)" : "Estimated Cost (USD)"}</span>
              <span className="text-lg font-bold text-slate-800 mt-1 block">${costUSD.toFixed(2)}</span>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
              <span className="text-xs text-slate-400 block uppercase">{locale === "pt" ? "Consumo Convertido (BRL)" : "Converted Cost (BRL)"}</span>
              <span className="text-lg font-bold text-slate-800 mt-1 block">R$ {(costUSD * exchangeRate).toFixed(2)}</span>
            </div>
          </div>
          {servicosComGasto.length === 0 ? (
            <div className="text-xs text-slate-400 italic px-3 py-4 text-center bg-slate-50 border border-slate-100 rounded-lg">
              {locale === "pt" ? "Nenhum consumo de IA registrado neste mês ainda." : "No AI usage recorded this month yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-xs uppercase text-slate-400 font-mono">
                    <th className="text-left font-bold pb-1.5 pr-2">{locale === "pt" ? "Serviço" : "Service"}</th>
                    <th className="text-right font-bold pb-1.5 pl-2">{locale === "pt" ? "Total" : "Total"}</th>
                  </tr>
                </thead>
                <tbody>
                  {servicosComGasto.map(([taskType, valor]) => (
                    <tr key={taskType} className="border-t border-slate-100">
                      <td className="py-2 pr-2 text-slate-600 font-mono">{rotuloDoTipo(taskType, locale)}</td>
                      <td className="py-2 pl-2 text-right font-mono font-bold text-slate-800">${valor.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
              {locale === "pt" ? "Consumo por Usuário" : "Cost by User"}
            </h3>
            <span className="text-xs text-slate-400 font-mono uppercase">{locale === "pt" ? "mês atual" : "current month"}</span>
          </div>

          {/* O aviso de cobertura é obrigatório e não pode ser suavizado: as chamadas sem dono NÃO
              são dobradas num balde "outros" nem distribuídas entre os usuários com nome — elas
              simplesmente não estão na tabela, e o texto diz quantas são. */}
          {usageOwnership && (
            <div className="text-xs text-slate-500 bg-warning-50 border border-warning-200 rounded-lg px-3 py-2 leading-relaxed">
              {(() => {
                const { total_calls: total, calls_with_owner: comDono } = usageOwnership;
                const semDono = total - comDono;
                const pct = total > 0 ? Math.round((comDono / total) * 100) : 100;
                return locale === "pt"
                  ? `${pct}% das ${total} chamadas de IA já feitas por esta instalação têm um usuário identificado (${comDono} de ${total}). As outras ${semDono} são anteriores a este relatório e não têm dono recuperável: a coluna não existia quando foram gravadas e o histórico não é retroagido. Elas não aparecem na tabela abaixo e não foram redistribuídas entre os usuários com nome.`
                  : `${pct}% of this installation's ${total} AI calls so far have an identified user (${comDono} of ${total}). The other ${semDono} predate this report and have no recoverable owner: the column didn't exist when they were written, and history isn't backfilled. They are absent from the table below and were not redistributed across the named users.`;
              })()}
            </div>
          )}

          {costByUser.length === 0 ? (
            <div className="text-xs text-slate-400 italic px-3 py-4 text-center bg-slate-50 border border-slate-100 rounded-lg">
              {locale === "pt" ? "Nenhuma chamada de IA com usuário identificado neste mês ainda." : "No AI call with an identified user this month yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-xs uppercase text-slate-400 font-mono">
                    <th className="text-left font-bold pb-1.5 pr-2">{locale === "pt" ? "Usuário" : "User"}</th>
                    <th className="text-right font-bold pb-1.5 px-2">{locale === "pt" ? "Chamadas" : "Calls"}</th>
                    <th className="text-right font-bold pb-1.5 pl-2">{locale === "pt" ? "Total" : "Total"}</th>
                  </tr>
                </thead>
                <tbody>
                  {costByUser.map((row) => (
                    <tr key={row.user_id} className="border-t border-slate-100">
                      <td className="py-2 pr-2 text-slate-600 font-mono">{row.user_name}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-500">{row.call_count}</td>
                      <td className="py-2 pl-2 text-right font-mono font-bold text-slate-800">${row.cost_usd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
