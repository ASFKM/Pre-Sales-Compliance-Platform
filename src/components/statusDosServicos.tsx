// O bloco de status dos serviços LOCAIS desta instalação — portado de
// web/src/components/statusDosServicos.tsx do CMSaaS, que por sua vez veio do `system-status` do
// catálogo (~/projects/ui/components), `system-status-block` do @preetsuthar17.
//
// A diferença para o original: lá a série vem do heartbeat de uma instalação REMOTA
// (InstallationServiceCheck no banco do CMSaaS); aqui os quatro serviços (banco, cache,
// armazenamento, autenticação) são OS PRÓPRIOS deste processo, medidos por
// `coletarStatusDosServicos()` (server/utils/fleetLicense.ts) a cada 15s pelo mesmo laço que já
// coleta CPU/memória/disco (server/utils/hardwareLocalHistory.ts).
//
// O quarto estado do original (`unknown`, "não consegui verificar" — nem operacional nem fora)
// se manteve: um check que estourou não é o mesmo que um serviço fora do ar.
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";

export interface ServicoLocal {
  key: string;
  label: string;
  status: "operational" | "degraded" | "down" | "unknown";
  latency_ms?: number;
  detail?: string;
}

const APARENCIA: Record<
  ServicoLocal["status"],
  { corTexto: string; corFundo: string; rotuloPt: string; rotuloEn: string; Icone: typeof CheckCircle2 }
> = {
  operational: { corTexto: "text-success-700", corFundo: "bg-success-100", rotuloPt: "No ar", rotuloEn: "Up", Icone: CheckCircle2 },
  degraded: { corTexto: "text-warning-700", corFundo: "bg-warning-100", rotuloPt: "Degradado", rotuloEn: "Degraded", Icone: AlertTriangle },
  down: { corTexto: "text-danger-700", corFundo: "bg-danger-100", rotuloPt: "Fora", rotuloEn: "Down", Icone: XCircle },
  unknown: { corTexto: "text-slate-500", corFundo: "bg-slate-100", rotuloPt: "Sem resposta", rotuloEn: "No response", Icone: HelpCircle },
};

// A pior situação entre os serviços é o que o cabeçalho mostra: quem olha de relance precisa ver
// "tem coisa fora do ar", não a média de tudo. `unknown` NÃO conta como pior que `degraded` — não
// saber é ruim, mas afirmar que está pior do que se sabe seria inventar.
const GRAVIDADE: Record<ServicoLocal["status"], number> = { down: 3, degraded: 2, unknown: 1, operational: 0 };

export function resumoDosServicos(servicos: ServicoLocal[]): { status: ServicoLocal["status"]; texto: string } {
  if (servicos.length === 0) return { status: "unknown", texto: "—" };
  const pior = servicos.reduce((acc, s) => (GRAVIDADE[s.status] > GRAVIDADE[acc] ? s.status : acc), "operational" as ServicoLocal["status"]);
  const noAr = servicos.filter((s) => s.status === "operational").length;
  return { status: pior, texto: `${noAr}/${servicos.length}` };
}

const TRACOS_PADRAO = 30;

const COR_DO_TRACO: Record<ServicoLocal["status"], string> = {
  operational: "var(--color-success-600)",
  down: "var(--color-danger-600)",
  degraded: "var(--color-warning-600)",
  unknown: "var(--color-slate-300)",
};

/** A barra de disponibilidade de UM serviço — um traço por leitura, mais recente à direita.
 * `tracos` é configurável porque o popup de histórico (mais largo) mostra mais leituras que o
 * cartão compacto da Visão Geral. */
function BarraDeDisponibilidade({ leituras, tracos = TRACOS_PADRAO }: { leituras: (ServicoLocal["status"] | null)[]; tracos?: number }) {
  const vazios = Math.max(0, tracos - leituras.length);
  const preenchida: (ServicoLocal["status"] | null)[] = [...Array<null>(vazios).fill(null), ...leituras.slice(-tracos)];
  return (
    <div className="flex gap-px mt-0.5" aria-hidden="true">
      {preenchida.map((estado, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: 8,
            minWidth: 2,
            background: estado === null ? "var(--color-slate-100)" : COR_DO_TRACO[estado],
            opacity: estado === null ? 0.6 : 1,
          }}
        />
      ))}
    </div>
  );
}

export function ListaDeServicosLocal({
  servicos,
  historico,
  locale,
  tracos,
}: {
  servicos: ServicoLocal[];
  historico: { medido_em: string; servicos: ServicoLocal[] }[];
  locale: "en" | "pt";
  tracos?: number;
}) {
  if (servicos.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center px-2">
        <p className="text-[10px] text-slate-400">
          {locale === "pt" ? "Nenhum serviço monitorado." : "No service monitored."}
        </p>
      </div>
    );
  }

  const historicoDe = (key: string): (ServicoLocal["status"] | null)[] =>
    historico.map((leitura) => leitura.servicos.find((s) => s.key === key)?.status ?? null);

  const ultimaLeitura = historico.length > 0 ? historico[historico.length - 1] : null;

  return (
    <div className="h-full flex flex-col justify-between gap-1 overflow-y-auto">
      <ul className="flex flex-col gap-1.5">
        {servicos.map((s) => {
          const aparencia = APARENCIA[s.status] ?? APARENCIA.unknown;
          const Icone = aparencia.Icone;
          const serie = historicoDe(s.key);
          return (
            <li key={s.key}>
              <div className="flex items-center gap-1.5">
                <Icone size={12} className={`shrink-0 ${aparencia.corTexto}`} />
                <span className="text-[10px] text-slate-700 truncate flex-1" title={s.detail || s.label}>
                  {s.label}
                </span>
                {s.latency_ms !== undefined && s.status !== "down" && (
                  <span className="text-[10px] font-mono tabular-nums text-slate-400 shrink-0">{s.latency_ms}ms</span>
                )}
                <span className={`text-[9px] font-bold px-1 rounded shrink-0 ${aparencia.corFundo} ${aparencia.corTexto}`}>
                  {locale === "pt" ? aparencia.rotuloPt : aparencia.rotuloEn}
                </span>
              </div>
              <BarraDeDisponibilidade leituras={serie} tracos={tracos} />
            </li>
          );
        })}
      </ul>
      {ultimaLeitura && (
        <p className="text-[9px] text-slate-400 text-right shrink-0">
          {historico.length} {locale === "pt" ? "leituras" : "readings"} ·{" "}
          {new Date(ultimaLeitura.medido_em).toLocaleString(locale === "pt" ? "pt-BR" : "en-US", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
