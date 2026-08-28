import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRightLeft, ArrowUp, ChevronLeft, ChevronRight, Inbox, ListChecks, RefreshCw, Search } from "lucide-react";
import ApiClient from "../lib/api";
import { Demand, DemandPage, DemandSlaSettings } from "../types";
import DemandDetailDrawer from "./DemandDetailDrawer";
import { dataCurta, diasAtePrazo, estadoDoPrazo, moeda } from "./demandFormat";

// CDC 16 — Fase 10. A fila de pré-vendas na Início, em dois cards.
//
// Substitui a PONTE provisória que a F9 deixou — um bloco com a contagem e um
// botão — pela coisa que o dono pediu (resposta E): "Card das novas + card
// 'Minhas demandas'". A ponte só podia sair depois destes cards existirem, e é
// por isso que ela existiu: tirar sem repor troca um defeito por um buraco.
//
// TRÊS decisões governam este arquivo, e nenhuma é de gosto:
//
// 1. **A D15 continua valendo.** A fila é única e visível para toda a equipe.
//    "Minhas demandas" é uma vista de CONVENIÊNCIA sobre a mesma fila, e o card
//    das novas mostra o que ninguém assumiu — de todo mundo, não o meu recorte.
//    Dois cards não podem virar fila por pessoa, e a prova desta fase afirma os
//    dois lados: o colega vê as mesmas novas, e não vê as minhas.
//
// 2. **Os contadores vêm do TOTAL do recorte, nunca da página.** É a dívida que
//    a F9 nomeou ao pedir `limit=200` de propósito: com cinco linhas por vez,
//    um aviso contado sobre as linhas carregadas passa a subcontar, e aviso que
//    subconta é pior do que aviso nenhum, porque parece resolvido. Os números da
//    faixa de avisos vêm de `counts`, que a rota calcula sobre o recorte inteiro.
//
// 3. **A régua de exibição é a mesma da ponte, D06 inclusive.** Quem decide se
//    estes cards aparecem é `App.tsx`, com a condição que a aba tinha desde a
//    F1: revogar o par CONGELA o que já chegou, não apaga da tela.

const LINHAS_POR_PAGINA = 5;

/** Uma ordem de coluna que a rota conhece, com o rótulo que a tela desenha. */
const COLUNAS: Array<{ chave: string; rotulo: string; alinhamento: string }> = [
  { chave: "title", rotulo: "Demanda", alinhamento: "" },
  { chave: "value", rotulo: "Valor", alinhamento: "text-right" },
  { chave: "deadline", rotulo: "Prazo do edital", alinhamento: "" },
  { chave: "sla_due", rotulo: "Prazo do SLA", alinhamento: "" },
];

// Os recortes por estado, como BOTÕES em cada card (resposta G: "nos dois
// cards, como botões de recorte"). Cada card tem os SEUS: os cinco filtros que
// moravam na tela da fila não cabem iguais nos dois, porque uma demanda
// devolvida ou em análise tem dono por definição e nunca aparece no card das
// novas. Repetir os cinco em cima daria três botões que sempre respondem vazio.
const RECORTES_NOVAS: Array<{ chave: string; rotulo: string }> = [
  { chave: "queued", rotulo: "Na fila" },
  { chave: "cancelled,completed", rotulo: "Encerradas sem dono" },
  { chave: "queued,assigned,in_analysis,returned,cancelled,completed", rotulo: "Tudo" },
];

const RECORTES_MINHAS: Array<{ chave: string; rotulo: string }> = [
  { chave: "assigned,in_analysis,returned", rotulo: "Em aberto" },
  { chave: "assigned", rotulo: "Assumidas" },
  { chave: "in_analysis", rotulo: "Em análise" },
  { chave: "returned", rotulo: "Devolvidas" },
  { chave: "queued,assigned,in_analysis,returned,cancelled,completed", rotulo: "Tudo" },
];

interface HomeDemandCardsProps {
  hasPermission: (permission: string) => boolean;
  currentUserId: string;
  onDemandAssumed: (projectId: string) => void;
  onQueueChanged?: () => void;
  /** A fila completa continua existindo, com as colunas que não cabem aqui. */
  onAbrirFila: () => void;
}

export default function HomeDemandCards({
  hasPermission,
  currentUserId,
  onDemandAssumed,
  onQueueChanged,
  onAbrirFila,
}: HomeDemandCardsProps) {
  const [config, setConfig] = useState<DemandSlaSettings | null>(null);
  const [avisos, setAvisos] = useState<DemandPage["counts"] | null>(null);
  const [recarga, setRecarga] = useState(0);
  const souGerente = hasPermission("demand:manage");

  // Os avisos são pedidos NUMA CONSULTA PRÓPRIA, sobre a fila aberta inteira, e
  // não sobre o recorte de um card: uma devolução esperando o gerente é de uma
  // demanda que TEM dono, e por isso nunca cairia no card das novas; e uma
  // atualização pendente minha não aparece se eu estiver olhando "Encerradas".
  // `limit=1` porque o que interessa aqui é `counts`, não as linhas.
  const carregarAvisos = useCallback(async () => {
    try {
      const pagina = await ApiClient.get<DemandPage>(
        "/api/demands?limit=1&status=queued,assigned,in_analysis,returned"
      );
      setAvisos(pagina?.counts ?? null);
      setConfig(await ApiClient.get<DemandSlaSettings>("/api/demands/sla-settings"));
    } catch {
      setAvisos(null);
    }
  }, []);

  useEffect(() => {
    void carregarAvisos();
  }, [carregarAvisos, recarga]);

  const mudou = async () => {
    setRecarga((n) => n + 1);
    onQueueChanged?.();
  };

  return (
    <div className="space-y-4" data-testid="home-demandas">
      {(avisos?.my_pending_updates ?? 0) > 0 || (avisos?.my_cancellations ?? 0) > 0 ? (
        <div
          className="bg-brand-50 border border-brand-200 text-brand-800 text-xs rounded-lg p-3 flex items-start gap-2"
          data-testid="aviso-ciclo-de-vida"
        >
          <ArrowRightLeft size={14} className="mt-0.5 shrink-0" />
          <div>
            {(avisos?.my_pending_updates ?? 0) > 0 && (
              <>
                <span className="font-bold">
                  {avisos?.my_pending_updates} demanda(s) sua(s) com atualização do CRM aguardando decisão.
                </span>{" "}
                Nada foi escrito no seu projeto: abra a demanda para ver o antes e o depois.{" "}
              </>
            )}
            {(avisos?.my_cancellations ?? 0) > 0 && (
              <span className="font-bold">
                {avisos?.my_cancellations} com pedido de cancelamento aprovado no CRM.
              </span>
            )}
          </div>
        </div>
      ) : null}

      {souGerente && (avisos?.return_pending ?? 0) > 0 && (
        <div
          className="bg-warning-50 border border-warning-200 text-warning-800 text-xs rounded-lg p-3 flex items-start gap-2"
          data-testid="aviso-devolucoes"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">{avisos?.return_pending} devolução(ões) aguardando sua aprovação.</span>{" "}
            Abra a demanda para ler o motivo e decidir.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CardDeDemandas
          testid="card-novas-demandas"
          titulo="Novas demandas"
          descricao="O que o CRM enviou e ninguém assumiu. A fila é de toda a equipe."
          icone={<Inbox size={20} />}
          recorteDono="none"
          recortes={RECORTES_NOVAS}
          ordemPadrao="deadline"
          config={config}
          hasPermission={hasPermission}
          currentUserId={currentUserId}
          onDemandAssumed={onDemandAssumed}
          onMudou={mudou}
          recarga={recarga}
          onAbrirFila={onAbrirFila}
        />
        <CardDeDemandas
          testid="card-minhas-demandas"
          titulo="Minhas demandas"
          descricao="O que você assumiu e ainda está aberto. É uma vista sua da mesma fila, não uma fila sua."
          icone={<ListChecks size={20} />}
          recorteDono="me"
          recortes={RECORTES_MINHAS}
          ordemPadrao="sla_due"
          config={config}
          hasPermission={hasPermission}
          currentUserId={currentUserId}
          onDemandAssumed={onDemandAssumed}
          onMudou={mudou}
          recarga={recarga}
          onAbrirFila={onAbrirFila}
        />
      </div>
    </div>
  );
}

interface CardProps {
  testid: string;
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
  recorteDono: "none" | "me";
  recortes: Array<{ chave: string; rotulo: string }>;
  ordemPadrao: string;
  config: DemandSlaSettings | null;
  hasPermission: (permission: string) => boolean;
  currentUserId: string;
  onDemandAssumed: (projectId: string) => void;
  onMudou: () => void | Promise<void>;
  recarga: number;
  onAbrirFila: () => void;
}

function CardDeDemandas({
  testid,
  titulo,
  descricao,
  icone,
  recorteDono,
  recortes,
  ordemPadrao,
  config,
  hasPermission,
  currentUserId,
  onDemandAssumed,
  onMudou,
  recarga,
  onAbrirFila,
}: CardProps) {
  const [recorte, setRecorte] = useState(recortes[0].chave);
  const [ordem, setOrdem] = useState(ordemPadrao);
  const [direcao, setDirecao] = useState<"asc" | "desc">("asc");
  const [offset, setOffset] = useState(0);
  const [busca, setBusca] = useState("");
  const [minValor, setMinValor] = useState("");
  const [maxValor, setMaxValor] = useState("");
  const [pagina, setPagina] = useState<DemandPage | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<Demand | null>(null);

  // Clicar no título da coluna: primeira vez ordena crescente, segunda inverte.
  // Trocar de coluna volta para crescente em vez de herdar a direção anterior —
  // herdar faria um clique em "Valor" depois de um "Prazo ↓" abrir o card pelo
  // menor valor sem que ninguém tivesse pedido isso.
  //
  // Ordenar por VALOR é decisão consciente do dono, registrada no §8 item 33 do
  // plano: a D40 recusou o valor como medida de CARGA e continua valendo
  // palavra por palavra — ela governa quem o produto escolhe na distribuição
  // automática, não o que a pessoa olha quando trabalha a fila.
  const trocarOrdem = (chave: string) => {
    setOffset(0);
    if (ordem === chave) setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setOrdem(chave);
      setDirecao("asc");
    }
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const busca_ = new URLSearchParams({
        status: recorte,
        sort: ordem,
        dir: direcao,
        limit: String(LINHAS_POR_PAGINA),
        offset: String(offset),
        assigned_user_id: recorteDono,
      });
      if (busca.trim()) busca_.set("q", busca.trim());
      if (minValor.trim()) busca_.set("min_value", minValor.trim());
      if (maxValor.trim()) busca_.set("max_value", maxValor.trim());
      setPagina(await ApiClient.get<DemandPage>(`/api/demands?${busca_.toString()}`));
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar as demandas.");
    } finally {
      setCarregando(false);
    }
  }, [recorte, ordem, direcao, offset, busca, minValor, maxValor, recorteDono, recarga]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const itens = pagina?.items ?? [];
  const total = pagina?.total ?? 0;
  const primeira = total === 0 ? 0 : offset + 1;
  const ultima = Math.min(offset + LINHAS_POR_PAGINA, total);
  const temAnterior = offset > 0;
  const temProxima = offset + LINHAS_POR_PAGINA < total;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col" data-testid={testid}>
      <div className="p-5 border-b border-slate-100 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 shrink-0">
            {icone}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide font-mono">
              {titulo} ({total})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{descricao}</p>
          </div>
          <button
            onClick={() => void carregar()}
            aria-label={`Atualizar ${titulo}`}
            className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0 p-1"
          >
            <RefreshCw size={14} className={carregando ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex items-center flex-wrap gap-1 bg-slate-100 rounded-lg p-1" data-testid={`${testid}-recortes`}>
          {recortes.map((r) => (
            <button
              key={r.chave}
              onClick={() => {
                setRecorte(r.chave);
                setOffset(0);
              }}
              data-testid={`${testid}-recorte-${r.chave}`}
              className={`text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                recorte === r.chave ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {r.rotulo}
            </button>
          ))}
        </div>
      </div>

      {erro && <div className="m-4 bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erro}</div>}

      {/* overflow-x-auto e min-w: em 390px quatro colunas ainda não cabem, e
          "hidden" CORTARIA os dois prazos sem deixar chegar neles. */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full min-w-[560px] text-left text-xs border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
            <tr>
              {COLUNAS.map((c) => (
                <th key={c.chave} className={`p-3 align-top ${c.alinhamento}`}>
                  <button
                    type="button"
                    onClick={() => trocarOrdem(c.chave)}
                    data-testid={`${testid}-ordenar-${c.chave}`}
                    aria-label={`Ordenar por ${c.rotulo}`}
                    className={`inline-flex items-center gap-1 uppercase cursor-pointer transition-colors hover:text-slate-700 ${
                      ordem === c.chave ? "text-brand-700 font-bold" : ""
                    } ${c.alinhamento === "text-right" ? "justify-end w-full" : ""}`}
                  >
                    {c.rotulo}
                    {ordem === c.chave && (direcao === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>

                  {/* O recorte por coluna, no título dela. A F9 pôs a API de pé
                      e deixou só a vertical com controle; estes dois são os que
                      faltavam ganhar tela: a busca livre e a faixa de valor. */}
                  {c.chave === "title" && (
                    <div className="mt-1 flex items-center gap-1 border border-slate-200 rounded px-1 bg-white">
                      <Search size={10} className="text-slate-400 shrink-0" />
                      <input
                        value={busca}
                        onChange={(e) => {
                          setBusca(e.target.value);
                          setOffset(0);
                        }}
                        data-testid={`${testid}-filtro-busca`}
                        aria-label="Filtrar por texto"
                        placeholder="filtrar…"
                        className="w-full min-w-[70px] py-0.5 text-[10px] font-sans normal-case text-slate-600 outline-none"
                      />
                    </div>
                  )}
                  {c.chave === "value" && (
                    <div className="mt-1 flex items-center justify-end gap-1">
                      <input
                        value={minValor}
                        onChange={(e) => {
                          setMinValor(e.target.value);
                          setOffset(0);
                        }}
                        inputMode="numeric"
                        data-testid={`${testid}-filtro-valor-min`}
                        aria-label="Valor mínimo"
                        placeholder="mín."
                        className="w-14 border border-slate-200 rounded px-1 py-0.5 text-[10px] font-sans normal-case text-right text-slate-600 bg-white outline-none"
                      />
                      <input
                        value={maxValor}
                        onChange={(e) => {
                          setMaxValor(e.target.value);
                          setOffset(0);
                        }}
                        inputMode="numeric"
                        data-testid={`${testid}-filtro-valor-max`}
                        aria-label="Valor máximo"
                        placeholder="máx."
                        className="w-14 border border-slate-200 rounded px-1 py-0.5 text-[10px] font-sans normal-case text-right text-slate-600 bg-white outline-none"
                      />
                    </div>
                  )}
                </th>
              ))}
              <th className="p-3 text-right align-top">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {itens.map((d) => {
              const dias = diasAtePrazo(d.deadline);
              const prazoSla = estadoDoPrazo(d.due_at);
              return (
                <tr key={d.id} className="hover:bg-slate-50/50">
                  <td className="p-3">
                    <div className="font-semibold text-slate-800">{d.title}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{d.demand_ref}</div>
                  </td>
                  <td className="p-3 text-right text-slate-700 font-mono whitespace-nowrap">
                    {moeda(d.opportunity.value, d.opportunity.currency)}
                  </td>
                  <td className="p-3">
                    <div className="text-slate-700">{dataCurta(d.deadline)}</div>
                    {dias !== null && (
                      <div
                        className={`text-[10px] font-semibold ${
                          dias < 0 ? "text-danger-600" : dias <= 3 ? "text-warning-700" : "text-slate-400"
                        }`}
                      >
                        {dias < 0 ? `vencido há ${Math.abs(dias)}d` : `faltam ${dias}d`}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    {prazoSla ? (
                      <div data-testid={`sla-prazo-${d.demand_ref}`}>
                        <div className="text-slate-700">{dataCurta(d.due_at)}</div>
                        <div className={`text-[10px] font-semibold ${prazoSla.classe}`}>{prazoSla.texto}</div>
                      </div>
                    ) : (
                      // Traço, e não "vencido": sem SLA configurado ou em estado
                      // terminal, esta demanda não deve etapa nenhuma.
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {/* Resposta H do dono: "Detalhes" no lugar do "Assumir" na
                        linha. O ato continua existindo — mudou para dentro da
                        gaveta, junto do cliente, da vertical e da situação, que
                        são as três colunas que saíram daqui. */}
                    <button
                      onClick={() => setAberta(d)}
                      data-testid={`detalhes-${d.demand_ref}`}
                      className="inline-flex items-center gap-1 border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer"
                    >
                      Detalhes
                    </button>
                  </td>
                </tr>
              );
            })}
            {!carregando && itens.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  <Inbox size={24} className="mx-auto mb-2 opacity-40" />
                  <div className="text-xs font-semibold text-slate-500">Nada neste recorte</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <button
          onClick={onAbrirFila}
          data-testid={`${testid}-abrir-fila`}
          className="text-[11px] text-slate-500 hover:text-brand-700 font-semibold cursor-pointer"
        >
          Abrir a fila completa
        </button>
        {/* "1–5 de 23", e não só as setas: sem o denominador ninguém sabe se a
            página que está vendo é a fila inteira ou o começo dela. */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-mono" data-testid={`${testid}-paginacao`}>
            {primeira}–{ultima} de {total}
          </span>
          <button
            onClick={() => setOffset((o) => Math.max(0, o - LINHAS_POR_PAGINA))}
            disabled={!temAnterior}
            data-testid={`${testid}-pagina-anterior`}
            aria-label="Página anterior"
            className="border border-slate-200 rounded-md p-1 text-slate-500 disabled:opacity-30 disabled:cursor-default hover:bg-slate-50 cursor-pointer"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            onClick={() => setOffset((o) => o + LINHAS_POR_PAGINA)}
            disabled={!temProxima}
            data-testid={`${testid}-proxima-pagina`}
            aria-label="Próxima página"
            className="border border-slate-200 rounded-md p-1 text-slate-500 disabled:opacity-30 disabled:cursor-default hover:bg-slate-50 cursor-pointer"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {aberta && (
        <DemandDetailDrawer
          demanda={aberta}
          config={config}
          hasPermission={hasPermission}
          currentUserId={currentUserId}
          onFechar={() => setAberta(null)}
          onMudou={async () => {
            await carregar();
            await onMudou();
          }}
          onAssumida={onDemandAssumed}
        />
      )}
    </div>
  );
}
