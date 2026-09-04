import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ApiClient from "../lib/api";
import { DemandPerformance, Project } from "../types";
import { duracao } from "./demandFormat";

// CDC 16 — Fase 10. Os dois gráficos da Início.
//
// O de DESEMPENHO é o item 7 do escopo: "é onde o pré-vendas vê o dele". A rota
// já sabia recortar desde a F9 — o gerente lê o time, quem não é gerente lê só
// a própria linha, e `scope` viaja no corpo para a tela não rotular errado —,
// então o que faltava era exatamente isto: a tela.
//
// A fronteira da D20 continua dita em voz alta, palavra por palavra: o recorte
// por pessoa existe só neste produto. A média da EQUIPE vai para os dois papéis
// porque é agregado e não recorte de gente, e a própria D20 já a manda até para
// o CRM. Quem quiser o número por pessoa do time o encontra em
// Configurações › SLA e Prazos, que é onde a F9 o pôs (a seção se chamava
// "Demandas" até a F3 de 09/2026, que renomeou só o rótulo).
//
// A PIZZA é o item 6, e a razão de ela existir é do dono: ela entra no lugar do
// gráfico de barras por setor. `recharts` já estava no produto (a Precificação
// o usa desde a fase de histórico de preço), então o custo era o desenho.
//
// UMA regra atravessa os dois: `isAnimationActive={false}`. Não é preferência
// estética — é o que torna a captura reprodutível. Com a animação ligada, o
// primeiro quadro de um gráfico `recharts` é VAZIO, e uma tela capturada nele
// sai sem gráfico nenhum enquanto a asserção de texto passa.

const CORES_DA_PIZZA = [
  "var(--color-brand-600)",
  "var(--color-brand-400)",
  "var(--color-brand-800)",
  "var(--color-brand-300)",
  "var(--color-brand-700)",
  "var(--color-brand-200)",
];

export function VerticalPieChart({ projects, locale }: { projects: Project[]; locale: "en" | "pt" }) {
  const dados = Object.entries(
    projects.reduce((acc, p) => {
      acc[p.vertical] = (acc[p.vertical] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  )
    .map(([vertical, count]) => ({ vertical, count: count as number }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4" data-testid="grafico-verticais">
      <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-brand-500"></span>
        {locale === "pt" ? "Licitações por Setor / Vertical" : "Bids by Industry Vertical"}
      </h3>
      {dados.length === 0 ? (
        <p className="text-xs text-slate-400 italic text-center py-6">
          {locale === "pt" ? "Nenhuma licitação registrada" : "No bids registered"}
        </p>
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={dados}
                dataKey="count"
                nameKey="vertical"
                innerRadius="45%"
                outerRadius="75%"
                paddingAngle={2}
                isAnimationActive={false}
                // O rótulo com o PERCENTUAL é o que a captura espera para saber
                // que o gráfico desenhou: esperar pelo `<svg>` acusaria pronto
                // um quadro ainda sem fatia nenhuma.
                label={({ vertical, percent }: any) => `${vertical} ${Math.round((percent ?? 0) * 100)}%`}
                labelLine={false}
              >
                {dados.map((d, i) => (
                  <Cell key={d.vertical} fill={CORES_DA_PIZZA[i % CORES_DA_PIZZA.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: any, n: any) => [`${v} ${Number(v) === 1 ? "licitação" : "licitações"}`, n]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const ETAPAS = [
  { chave: "mediaAteAssumirSegundos", amostra: "amostraAteAssumir", rotulo: "Até assumir" },
  { chave: "mediaAteAnaliseSegundos", amostra: "amostraAteAnalise", rotulo: "Até a análise" },
  { chave: "mediaAteConcluirSegundos", amostra: "amostraAteConcluir", rotulo: "Até concluir" },
] as const;

/** Segundos em horas, com uma casa: é a unidade que o eixo consegue rotular. */
function horas(segundos: number | null): number | null {
  if (segundos === null || segundos === undefined) return null;
  return Math.round((segundos / 3600) * 10) / 10;
}

export function DemandPerformanceChart({ currentUserId }: { currentUserId: string }) {
  const [dados, setDados] = useState<DemandPerformance | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    ApiClient.get<DemandPerformance>("/api/demands/performance")
      .then(setDados)
      .catch((e: any) => setErro(e?.message || "Não foi possível carregar o desempenho."));
  }, []);

  if (erro) {
    return (
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm" data-testid="grafico-desempenho">
        <p className="text-xs text-danger-700">{erro}</p>
      </div>
    );
  }

  // `scope` é o que separa "o time tem uma pessoa só" de "esta pessoa só vê a
  // si mesma". Sem ele o rótulo mentiria — foi por isso que a F9 o pôs no corpo.
  const souGerente = dados?.scope === "team";
  const minhaLinha = (dados?.people ?? []).find((p) => p.user_id === currentUserId) ?? null;

  const serie = ETAPAS.map((e) => ({
    etapa: e.rotulo,
    equipe: horas((dados?.team as any)?.[e.chave] ?? null),
    voce: horas((minhaLinha as any)?.[e.chave] ?? null),
  }));

  const temAlgumNumero = serie.some((s) => s.equipe !== null || s.voce !== null);

  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3" data-testid="grafico-desempenho">
      <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-brand-500"></span>
        Tempo de resposta {souGerente ? "— a equipe" : "— o seu"}
      </h3>
      <p className="text-[11px] text-slate-500">
        Últimos {dados?.days ?? 180} dias, em horas. O recorte por pessoa existe só aqui: o CRM vê o tempo da demanda
        dele e a média da equipe, e nunca o desempenho de quem trabalha nesta fila.
        {souGerente
          ? " O número de cada pessoa do time fica em Configurações › SLA e Prazos."
          : " As barras claras são a média da equipe, que não é recorte de ninguém."}
      </p>

      {!temAlgumNumero ? (
        <p className="text-xs text-slate-400 italic text-center py-6" data-testid="desempenho-sem-dados">
          Nenhuma demanda medida na janela — o tempo aparece quando a primeira for assumida.
        </p>
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={serie} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-neutral-200)" vertical={false} />
              <XAxis dataKey="etapa" tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-neutral-500)" }} width={44} unit="h" />
              <Tooltip formatter={(v: any) => duracao(v === null ? null : Number(v) * 3600)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="voce" name="Você" fill="var(--color-brand-600)" isAnimationActive={false} radius={[3, 3, 0, 0]} />
              <Bar dataKey="equipe" name="Equipe" fill="var(--color-brand-200)" isAnimationActive={false} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {dados && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1" data-testid="desempenho-numeros">
          {ETAPAS.map((e) => (
            <div key={e.chave} className="border border-slate-200 rounded-lg p-2">
              <div className="text-[10px] uppercase font-mono text-slate-400">{e.rotulo}</div>
              <div className="text-xs font-bold text-slate-800 mt-0.5">
                {duracao((minhaLinha as any)?.[e.chave] ?? (dados.team as any)[e.chave])}
              </div>
              {/* A amostra fica ao lado do número: "12 h" sobre uma demanda só
                  não é uma média, e sem o denominador ninguém consegue saber. */}
              <div className="text-[10px] text-slate-400">
                {(minhaLinha as any)?.[e.amostra] ?? (dados.team as any)[e.amostra]} demanda(s)
              </div>
            </div>
          ))}
          <div className="border border-slate-200 rounded-lg p-2">
            <div className="text-[10px] uppercase font-mono text-slate-400">Devolvidas</div>
            <div className="text-xs font-bold text-slate-800 mt-0.5">
              {minhaLinha ? minhaLinha.devolvidas : dados.team.devolvidas}
            </div>
            <div className="text-[10px] text-slate-400">de {minhaLinha ? minhaLinha.total : dados.team.total} recebida(s)</div>
          </div>
        </div>
      )}
    </div>
  );
}
