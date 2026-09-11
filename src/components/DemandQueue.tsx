import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRightLeft, ArrowUp, ChevronLeft, ChevronRight, FileText, Inbox, RefreshCw } from "lucide-react";
import ApiClient from "../lib/api";
import { Demand, DemandPage, DemandSlaSettings } from "../types";
import DemandDetailDrawer from "./DemandDetailDrawer";
import { STATUS_COLOR, STATUS_LABEL, dataCurta, diasAtePrazo, estadoDoPrazo, moeda } from "./demandFormat";

// CDC 16 — Fase 1. A fila de pré-vendas, do lado de quem trabalha nela.
//
// D15: fila ÚNICA, visível para toda a equipe - não há recorte por pessoa aqui,
// e é de propósito: quem não enxerga o trabalho disponível não se oferece para
// fazê-lo. O filtro por estado existe para separar o que espera do que já anda,
// não para recortar por gente. (O card "Minhas demandas" da Início, que a F10
// criou, é uma VISTA sobre esta mesma fila — não uma fila por pessoa.)
//
// CDC 16 — Fase 5 acrescentou: a coluna de PRAZO do SLA ao lado da do edital
// (são dois prazos diferentes e a tela não pode confundi-los), o
// direcionamento pelo gerente (D16) e a aprovação da devolução (D17).
//
// CDC 16 — Fase 9 tirou daqui as duas OUTRAS vistas. "Prazos e desempenho" e
// "Expurgos" mudaram para a seção Demandas da Administração, por decisão do
// dono na F8. Esta tela voltou a ser o que o nome dela diz: a fila.
//
// CDC 16 — Fase 10 mudou três coisas aqui, e as três vêm da resposta H do dono
// ("só as quatro colunas; o resto no popup"):
//
//  1. a coluna de Ações tem só "Detalhes". Assumir, devolver, direcionar e
//     decidir a atualização mudaram para dentro da GAVETA, que virou o
//     componente `DemandDetailDrawer` e é a mesma que os cards da Início abrem;
//  2. a paginação de verdade chegou. Até a F9 esta tela pedia `limit=200` de
//     propósito, porque os avisos dela eram contados sobre as linhas
//     CARREGADAS — com uma página curta eles subcontariam, e aviso que
//     subconta é pior do que aviso nenhum. O conserto foi na rota: `counts`
//     vem do TOTAL do recorte, e a tela pode paginar sem mentir;
//  3. o recorte por CLIENTE ganhou controle, ao lado do de vertical que a F9
//     deixou. Os dois que faltavam — busca livre e faixa de valor — ganharam
//     tela nos cards da Início.
//
// Esta tela CONTINUA existindo, e mostra o que os cards não mostram: cliente,
// vertical e situação como colunas, a fila inteira de uma vez e o recorte por
// estado com os cinco filtros. Os cards são a porta de entrada; ela é a vista
// completa.

const FILTROS: Array<{ chave: string; rotulo: string }> = [
  { chave: "queued,assigned,in_analysis,returned", rotulo: "Em aberto" },
  { chave: "queued", rotulo: "Na fila" },
  { chave: "assigned,in_analysis", rotulo: "Em andamento" },
  { chave: "returned", rotulo: "Devolvidas" },
  { chave: "queued,assigned,in_analysis,returned,cancelled,completed", rotulo: "Tudo" },
];

interface DemandQueueProps {
  hasPermission: (permission: string) => boolean;
  currentUserId: string;
  onDemandAssumed: (projectId: string) => void;
  onQueueChanged?: () => void;
}

// Vinte e cinco por página, e não cinco: esta é a vista COMPLETA, e cinco
// linhas aqui trocariam uma lista por um carrossel. Os cinco do pedido do dono
// são dos cards da Início, que é onde a fila aparece resumida.
const LINHAS_POR_PAGINA = 25;

const COLUNAS_ORDENAVEIS: Record<string, string> = {
  title: "Demanda",
  company: "Cliente",
  vertical: "Vertical",
  value: "Valor",
  deadline: "Prazo do edital",
  sla_due: "Prazo do SLA",
  status: "Situação",
};

export default function DemandQueue({ hasPermission, currentUserId, onDemandAssumed, onQueueChanged }: DemandQueueProps) {
  const [config, setConfig] = useState<DemandSlaSettings | null>(null);
  const [filtro, setFiltro] = useState(FILTROS[0].chave);
  // F9: a ordem e o recorte por coluna (resposta D do dono: ordenar E filtrar).
  const [ordem, setOrdem] = useState("deadline");
  const [direcao, setDirecao] = useState<"asc" | "desc">("asc");
  const [vertical, setVertical] = useState("");
  const [cliente, setCliente] = useState("");
  const [offset, setOffset] = useState(0);
  const [verticaisDisponiveis, setVerticaisDisponiveis] = useState<Array<{ vertical: string; count: number }>>([]);
  const [total, setTotal] = useState(0);
  const [contadores, setContadores] = useState<DemandPage["counts"] | null>(null);
  const [demandas, setDemandas] = useState<Demand[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<Demand | null>(null);

  const souGerente = hasPermission("demand:manage");
  const filaDirecionada = config?.assignment_policy === "direcionamento";
  // F9: quem alcança a seção Demandas da Administração — a mesma régua que
  // `adminSectionPermissions.demands` aplica em App.tsx. Só serve para decidir
  // se vale a pena dizer PARA ONDE as duas vistas foram: apontar um caminho que
  // a pessoa não pode abrir é pior do que não apontar nenhum.
  const podeAlcancarAdministracao = hasPermission("admin:settings") || hasPermission("demand:manage");

  // Clicar no título da coluna: primeira vez ordena crescente, segunda inverte.
  // Trocar de coluna volta para crescente em vez de herdar a direção anterior —
  // herdar faria um clique em "Valor" depois de um "Prazo ↓" abrir a fila pelo
  // menor valor sem que ninguém tivesse pedido isso.
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
      const busca = new URLSearchParams({
        status: filtro,
        sort: ordem,
        dir: direcao,
        limit: String(LINHAS_POR_PAGINA),
        offset: String(offset),
      });
      if (vertical) busca.set("vertical", vertical);
      if (cliente.trim()) busca.set("company", cliente.trim());
      const [pagina, cfg] = await Promise.all([
        ApiClient.get<DemandPage>(`/api/demands?${busca.toString()}`),
        ApiClient.get<DemandSlaSettings>("/api/demands/sla-settings"),
      ]);
      setDemandas(Array.isArray(pagina?.items) ? pagina.items : []);
      setTotal(pagina?.total ?? 0);
      // F10: os avisos passam a ser contados pelo SERVIDOR, sobre o recorte
      // inteiro. Contá-los aqui, sobre as linhas desta página, era o que
      // obrigava a tela a carregar tudo de uma vez até a F9.
      setContadores(pagina?.counts ?? null);
      // As opções do filtro vêm do SERVIDOR, e não das linhas desta página: uma
      // lista montada com o que está na tela encolheria a cada filtro aplicado,
      // e a pessoa não teria como voltar para a vertical que acabou de sair.
      setVerticaisDisponiveis(Array.isArray(pagina?.verticals) ? pagina.verticals : []);
      setConfig(cfg);
    } catch (e: any) {
      setErro(e.message || "Não foi possível carregar a fila.");
    } finally {
      setCarregando(false);
    }
  }, [filtro, ordem, direcao, vertical, cliente, offset]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const naFila = demandas.filter((d) => d.status === "queued").length;
  const primeira = total === 0 ? 0 : offset + 1;
  const ultima = Math.min(offset + LINHAS_POR_PAGINA, total);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
            Fila de Pré-vendas ({total})
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Pedidos enviados pelo CRM. {naFila > 0 ? `${naFila} aguardando alguém assumir nesta página.` : "Nada aguardando na fila."}
            {filaDirecionada && " As demandas desta instalação são direcionadas pelo gerente de pré-vendas."}
            {config?.assignment_policy === "automatico" && " Novas demandas são distribuídas automaticamente por menor carga."}
          </p>
          {/* A configuração de prazo e o registro de expurgo saíram desta tela na
              F9 e estão na Administração. Dizer para ONDE foram é o que separa
              "mudou de lugar" de "sumiu" — sem esta linha, quem usava as duas
              vistas todo dia abriria um chamado. */}
          {podeAlcancarAdministracao && (
            <p className="text-[11px] text-slate-400 mt-1">
              {/* "Configurações", e não "Administração": é o rótulo que a aba de fato
                  tem no topo (`adminConsole` em App.tsx). Apontar para um menu com
                  outro nome é o mesmo que não apontar — a pessoa procura o que não
                  existe. Encontrado pela captura, que não achou o botão. */}
              Prazos, desempenho e expurgos agora ficam em <span className="font-semibold text-slate-500">Configurações › SLA e Prazos</span>.
            </p>
          )}
        </div>
      </div>

      {/* F10: os três avisos abaixo são contados sobre o RECORTE inteiro, e não
          sobre as linhas desta página. Dois deles são recortados por quem
          pergunta — atualização pendente e cancelamento aberto são trabalho de
          quem assumiu, e um contador global faria cada pessoa ver a pendência
          de todo mundo. */}
      {((contadores?.my_pending_updates ?? 0) > 0 || (contadores?.my_cancellations ?? 0) > 0) && (
        <div
          className="bg-brand-50 border border-brand-200 text-brand-800 text-xs rounded-lg p-3 flex items-start gap-2"
          data-testid="aviso-ciclo-de-vida"
        >
          <ArrowRightLeft size={14} className="mt-0.5 shrink-0" />
          <div>
            {(contadores?.my_pending_updates ?? 0) > 0 && (
              <>
                <span className="font-bold">
                  {contadores?.my_pending_updates} demanda(s) sua(s) com atualização do CRM aguardando decisão.
                </span>{" "}
                Nada foi escrito no seu projeto: abra a demanda para ver o antes e o depois.{" "}
              </>
            )}
            {(contadores?.my_cancellations ?? 0) > 0 && (
              <span className="font-bold">
                {contadores?.my_cancellations} com pedido de cancelamento aprovado no CRM.
              </span>
            )}
          </div>
        </div>
      )}

      {souGerente && (contadores?.return_pending ?? 0) > 0 && (
        <div className="bg-warning-50 border border-warning-200 text-warning-800 text-xs rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-bold">
              {contadores?.return_pending} devolução(ões) aguardando sua aprovação.
            </span>{" "}
            Abra a demanda para ler o motivo e decidir.
          </div>
        </div>
      )}

      <div className="flex items-center justify-end flex-wrap gap-2">
          <div className="flex items-center flex-wrap gap-1 bg-slate-100 rounded-lg p-1">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                onClick={() => { setFiltro(f.chave); setOffset(0); }}
                className={`text-[11px] px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  filtro === f.chave ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
          <button
            onClick={() => void carregar()}
            className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer"
          >
            <RefreshCw size={13} className={carregando ? "animate-spin" : ""} /> Atualizar
          </button>
      </div>

      {erro && (
        <div className="bg-danger-50 border border-danger-200 text-danger-700 text-xs rounded-lg p-3">{erro}</div>
      )}

      {/* overflow-x-auto, e não overflow-hidden: em 390px a tabela não cabe, e
          "hidden" CORTA as colunas da direita - valor, prazo, situação e o botão
          de detalhes - sem deixar chegar nelas. O min-w mantém as colunas
          legíveis e joga a diferença para a rolagem horizontal DESTA caixa, em
          vez de a página inteira andar de lado. */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto shadow-sm">
        <table className="w-full min-w-[820px] text-left text-xs border-collapse">
          <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
            <tr>
              {(["title", "company", "vertical", "value", "deadline", "sla_due", "status"] as const).map((chave) => (
                <th key={chave} className={`p-3 align-top ${chave === "value" ? "text-right" : ""}`}>
                  <button
                    type="button"
                    onClick={() => trocarOrdem(chave)}
                    data-testid={`ordenar-${chave}`}
                    aria-label={`Ordenar por ${COLUNAS_ORDENAVEIS[chave]}`}
                    className={`inline-flex items-center gap-1 uppercase cursor-pointer transition-colors hover:text-slate-700 ${
                      ordem === chave ? "text-brand-700 font-bold" : ""
                    } ${chave === "value" ? "justify-end w-full" : ""}`}
                  >
                    {COLUNAS_ORDENAVEIS[chave]}
                    {ordem === chave && (direcao === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                  </button>
                  {chave === "company" && (
                    <input
                      value={cliente}
                      onChange={(e) => { setCliente(e.target.value); setOffset(0); }}
                      data-testid="filtro-cliente"
                      aria-label="Filtrar por cliente"
                      placeholder="filtrar…"
                      className="mt-1 block w-full max-w-[150px] border border-slate-200 rounded px-1 py-0.5 text-[10px] font-sans normal-case text-slate-600 bg-white"
                    />
                  )}
                  {chave === "vertical" && verticaisDisponiveis.length > 0 && (
                    <select
                      value={vertical}
                      onChange={(e) => { setVertical(e.target.value); setOffset(0); }}
                      data-testid="filtro-vertical"
                      aria-label="Filtrar por vertical"
                      className="mt-1 block w-full max-w-[150px] border border-slate-200 rounded px-1 py-0.5 text-[10px] font-sans normal-case text-slate-600 bg-white cursor-pointer"
                    >
                      <option value="">Todas</option>
                      {verticaisDisponiveis.map((v) => (
                        <option key={v.vertical} value={v.vertical}>
                          {v.vertical} ({v.count})
                        </option>
                      ))}
                    </select>
                  )}
                </th>
              ))}
              <th className="p-3 text-right align-top">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {demandas.map((d) => {
              const dias = diasAtePrazo(d.deadline);
              return (
                <tr key={d.id} className="hover:bg-slate-50/50">
                  <td className="p-3">
                    <button
                      onClick={() => setAberta(d)}
                      className="font-semibold text-slate-800 hover:text-brand-700 text-left cursor-pointer"
                    >
                      {d.title}
                    </button>
                    <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                      {d.demand_ref}
                      {d.documents.length > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <FileText size={9} /> {d.documents.length}
                        </span>
                      )}
                      {d.cross_environment && (
                        <span
                          title="Este par cruza ambientes: dado de um ambiente entrando em outro."
                          className="inline-flex items-center gap-0.5 text-warning-700 bg-warning-50 border border-warning-200 rounded px-1"
                        >
                          <AlertTriangle size={9} /> ambientes cruzados
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-slate-700">
                    {d.company.name}
                    {d.company.tax_id && <div className="text-[10px] text-slate-400 font-mono">{d.company.tax_id}</div>}
                  </td>
                  <td className="p-3 text-slate-600">{d.vertical}</td>
                  <td className="p-3 text-right text-slate-700 font-mono">
                    {moeda(d.opportunity.value, d.opportunity.currency)}
                    {d.opportunity.margin_percent !== null && d.opportunity.margin_percent !== undefined && (
                      <div className="text-[10px] text-slate-400">margem {d.opportunity.margin_percent}%</div>
                    )}
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
                    {(() => {
                      const p = estadoDoPrazo(d.due_at);
                      if (!p) {
                        // Traço, e não "vencido": sem SLA configurado ou em
                        // estado terminal, esta demanda não deve etapa nenhuma.
                        return <span className="text-slate-300">—</span>;
                      }
                      return (
                        <div data-testid={`sla-prazo-${d.demand_ref}`}>
                          <div className="text-slate-700">{dataCurta(d.due_at)}</div>
                          <div className={`text-[10px] font-semibold ${p.classe}`}>{p.texto}</div>
                          <div className="text-[10px] text-slate-400">{d.sla_stage_label}</div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLOR[d.status] || "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABEL[d.status] || d.status}
                    </span>
                    {d.assigned_to && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {d.assigned_to}
                        {d.assignment_source === "auto" && " · automático"}
                        {d.assignment_source === "manager" && " · direcionada"}
                      </div>
                    )}
                    {d.return_requested_at && !d.return_decided_at && (
                      <div className="text-[10px] text-warning-700 font-semibold mt-0.5" data-testid={`devolucao-pendente-${d.demand_ref}`}>
                        devolução aguardando o gerente
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {/* Resposta H do dono: a linha tem "Detalhes", e o ato vive
                        na gaveta. Antes da F10 havia aqui até três botões, e a
                        régua de cada um estava escrita duas vezes — na linha e
                        no rodapé do popup. Duas cópias da mesma regra divergem
                        na primeira mudança: foi exatamente o que a F9 achou na
                        régua de assumir. */}
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
            {!carregando && demandas.length === 0 && (
              <tr>
                <td colSpan={8} className="p-10 text-center text-slate-400">
                  <Inbox size={28} className="mx-auto mb-2 opacity-40" />
                  <div className="text-xs font-semibold text-slate-500">Nenhuma demanda neste filtro</div>
                  <div className="text-[11px] mt-1">Demandas chegam quando o vendedor envia uma oportunidade do CRM para a pré-venda.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* "26–50 de 137", e não só as setas: sem o denominador ninguém sabe se a
          página que está vendo é a fila inteira ou o começo dela — que era
          exatamente o risco do corte silencioso que o aviso de teto cobria até
          a F9. */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] text-slate-400 font-mono" data-testid="fila-paginacao">
          {primeira}–{ultima} de {total}
        </span>
        <button
          onClick={() => setOffset((o) => Math.max(0, o - LINHAS_POR_PAGINA))}
          disabled={offset <= 0}
          data-testid="fila-pagina-anterior"
          aria-label="Página anterior"
          className="border border-slate-200 rounded-md p-1 text-slate-500 disabled:opacity-30 disabled:cursor-default hover:bg-slate-50 cursor-pointer"
        >
          <ChevronLeft size={13} />
        </button>
        <button
          onClick={() => setOffset((o) => o + LINHAS_POR_PAGINA)}
          disabled={offset + LINHAS_POR_PAGINA >= total}
          data-testid="fila-proxima-pagina"
          aria-label="Próxima página"
          className="border border-slate-200 rounded-md p-1 text-slate-500 disabled:opacity-30 disabled:cursor-default hover:bg-slate-50 cursor-pointer"
        >
          <ChevronRight size={13} />
        </button>
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
            onQueueChanged?.();
          }}
          onAssumida={onDemandAssumed}
        />
      )}
    </div>
  );
}
