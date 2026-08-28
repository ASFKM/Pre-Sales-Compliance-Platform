import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileX2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import ApiClient from "../lib/api";
import { CrmPurgeExecutionSummary } from "../types";

// CDC 16 — Fase 7. O REGISTRO do expurgo em cascata (D35), do lado de quem
// trabalha na fila.
//
// Ele existe por uma frase do plano: "sem o registro, apagar de um lado só é
// conformidade de mentira". Mas a tela não é só para a auditoria — é para quem
// abriu um projeto e não achou mais o edital. Sem ela, um documento que sumiu
// por retenção do CRM parece defeito do produto, e a pessoa passa a tarde
// procurando um arquivo que foi apagado de propósito.
//
// Não há botão que apague nada aqui, e a ausência é a decisão: o expurgo é
// pedido pelo CRM, pela porta de máquina, e um registro que o próprio produto
// sabe apagar não prova coisa nenhuma.

const MOTIVO: Record<string, { rotulo: string; explica: string }> = {
  retention: {
    rotulo: "Retenção",
    explica: "A política de retenção do CRM alcançou o prazo daquele dado.",
  },
  data_subject_request: {
    rotulo: "Pedido do titular",
    explica: "Alguém pediu ao CRM a remoção dos próprios dados, e o pedido veio em cascata.",
  },
};

function dataHora(valor: string): string {
  return new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

interface Props {
  onChanged?: () => void;
}

export default function DemandPurgePanel({ onChanged }: Props) {
  const [execucoes, setExecucoes] = useState<CrmPurgeExecutionSummary[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await ApiClient.get<CrmPurgeExecutionSummary[]>("/api/demands/purges");
      setExecucoes(Array.isArray(dados) ? dados : []);
    } catch (e: any) {
      setErro(e?.message || "Não foi possível ler o registro de expurgos.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="space-y-4" data-testid="demand-purge-panel">
      {erro && <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erro}</div>}

      <section className="bg-white border border-slate-200 rounded-lg shadow-sm">
        <header className="flex items-center justify-between gap-3 p-4 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-slate-500" /> Expurgos executados ({execucoes.length})
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              O que o CRM mandou apagar daqui, e o que de fato saiu. O trabalho feito sobre o projeto — análise,
              precificação, proposta — nunca é apagado; a cópia do documento, sim.
            </p>
          </div>
          <button
            onClick={() => {
              void carregar();
              onChanged?.();
            }}
            disabled={carregando}
            data-testid="purge-atualizar"
            className="inline-flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer"
          >
            <RefreshCw size={13} className={carregando ? "animate-spin" : ""} /> Atualizar
          </button>
        </header>

        <div className="p-4">
          {execucoes.length === 0 ? (
            <div className="text-center py-6 text-slate-400">
              <FileX2 size={24} className="mx-auto mb-2 opacity-40" />
              <div className="text-xs font-semibold text-slate-500">Nenhum expurgo executado</div>
              <div className="text-[11px] mt-1">
                O CRM ainda não pediu a remoção de nenhum documento nem de nenhuma empresa.
              </div>
            </div>
          ) : (
            <ul className="space-y-3" data-testid="purge-lista">
              {execucoes.map((e) => (
                <li key={e.id} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <Trash2 size={12} className="text-danger-600" />
                        {MOTIVO[e.reason]?.rotulo ?? e.reason} · {dataHora(e.executed_at)}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{MOTIVO[e.reason]?.explica ?? ""}</div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">{e.crm_installation_id}</div>
                    </div>
                    <div className="text-[11px] text-slate-600 text-right shrink-0">
                      <div>
                        <strong>{e.documents_deleted}</strong> documento(s) · <strong>{e.files_deleted}</strong> arquivo(s)
                      </div>
                      <div>
                        <strong>{e.demands_deleted}</strong> demanda(s) · <strong>{e.projects_unlinked}</strong> projeto(s)
                        sem referência
                      </div>
                    </div>
                  </div>

                  <ul className="mt-2 space-y-1.5">
                    {e.results.map((r, i) => (
                      <li key={`${r.crm_id}-${i}`} className="bg-slate-50 border border-slate-200 rounded-md p-2">
                        <div className="text-[11px] font-semibold text-slate-700">
                          {r.kind === "company" ? "Empresa" : "Documento"} <span className="font-mono">{r.crm_id}</span> ·{" "}
                          {r.deleted} registro(s)
                        </div>
                        {r.error && (
                          <div className="text-[11px] text-danger-700 mt-1 flex items-start gap-1">
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                            {r.error}
                          </div>
                        )}
                        {r.documents.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {r.documents.map((d) => (
                              <li key={d.document_ref} className="text-[11px] text-slate-500 font-mono truncate">
                                {d.document_ref} · {d.sha256.slice(0, 12)}…
                                {d.file_deleted ? " · arquivo apagado" : " · sem arquivo para apagar"}
                                {d.materialized ? " · estava no projeto" : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.demands.length > 0 && (
                          <div className="text-[11px] text-slate-500 font-mono mt-1 truncate">
                            demandas: {r.demands.join(", ")}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* O nome do arquivo NÃO aparece aqui, e não é esquecimento. */}
      <p className="text-[11px] text-slate-400 px-1">
        O registro guarda o identificador do CRM, a referência do documento e o hash — nunca o nome do arquivo nem o
        texto extraído. Num pedido do titular, o nome do arquivo pode ser exatamente o dado que se pediu para apagar.
      </p>
    </div>
  );
}
