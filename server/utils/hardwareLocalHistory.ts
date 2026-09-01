// Historico curto de hardware E servicos DESTA instalacao, para os quatro cartoes simetricos da
// Visao Geral do AdminConsole (CPU, Memoria, Disco, Servicos) verem a mesma pergunta que o CMSaaS
// ve de fora, so que sem depender do heartbeat: o processo local ja sabe as proprias metricas,
// coletadas com as MESMAS `collectSystemInfo()` e `coletarStatusDosServicos()` que ja montam o
// heartbeat (server/utils/fleetLicense.ts) - reaproveitadas, nao duplicadas, para as duas leituras
// (a que sai para o CMSaaS e a que a propria tela mostra) nunca divergirem.
//
// So em memoria, de proposito: e um indicador de "esta maquina esta bem agora", nao um relatorio
// historico que precise sobreviver a um restart - reinicia junto com o processo, como o
// uptime_seconds que `admin/system/status` ja expõe.
import { collectSystemInfo, coletarStatusDosServicos } from "./fleetLicense";

export interface ServicoLocal {
  key: string;
  label: string;
  status: "operational" | "degraded" | "down" | "unknown";
  latency_ms?: number;
  detail?: string;
}

export interface PontoDeHardwareLocal {
  medido_em: string;
  cpu_load_percent: number | null;
  memory_used_mb: number | null;
  total_memory_mb: number | null;
  disk_used_mb: number | null;
  disk_total_mb: number | null;
  servicos: ServicoLocal[];
}

const INTERVALO_MS = 15_000;
// 15s * 60 pontos = 15 minutos de janela, o mesmo horizonte curto que a Visao Geral já assume nos
// demais cartões (nenhum outro dado desta tela olha mais longe que "agora").
const MAX_PONTOS = 60;

const historico: PontoDeHardwareLocal[] = [];
let intervalo: ReturnType<typeof setInterval> | null = null;
// Os checks de servico fazem I/O real (query no banco, ping no Redis, verificação de storage) e
// podem, em tese, ainda estar rodando quando o próximo tick dispara - a trava evita dois ciclos
// sobrepostos escrevendo no mesmo array fora de ordem.
let amostrando = false;

async function amostrar(): Promise<void> {
  if (amostrando) return;
  amostrando = true;
  try {
    const [info, servicos] = await Promise.all([
      Promise.resolve().then(() => collectSystemInfo()),
      coletarStatusDosServicos().catch(() => []),
    ]);
    historico.push({
      medido_em: new Date().toISOString(),
      cpu_load_percent: info.cpu_load_percent ?? null,
      memory_used_mb: info.memory_used_mb ?? null,
      total_memory_mb: info.total_memory_mb ?? null,
      disk_used_mb: info.disk_used_mb ?? null,
      disk_total_mb: info.disk_total_mb ?? null,
      servicos,
    });
    if (historico.length > MAX_PONTOS) {
      historico.splice(0, historico.length - MAX_PONTOS);
    }
  } catch {
    // Uma amostra perdida não derruba a série - a próxima tentativa acontece em INTERVALO_MS.
  } finally {
    amostrando = false;
  }
}

// Inicio preguicoso: a primeira chamada a getHistoricoDeHardwareLocal() liga o laco, em vez do
// boot do servidor pagar por um recurso que uma instalacao pode nunca abrir esta aba para ver.
// A promise da primeira amostra fica guardada para a rota poder esperar por ela - sem isso, a
// PRIMEIRA chamada (servidor recem-subido) devolveria `pontos: []`, porque `coletarStatusDosServicos()`
// faz I/O real e nao termina no mesmo tick sincrono da requisicao.
let primeiraAmostra: Promise<void> | null = null;

function garantirAmostragem(): Promise<void> {
  if (!primeiraAmostra) {
    primeiraAmostra = amostrar();
    intervalo = setInterval(() => void amostrar(), INTERVALO_MS);
    intervalo.unref?.();
  }
  return primeiraAmostra;
}

export async function getHistoricoDeHardwareLocal(): Promise<PontoDeHardwareLocal[]> {
  await garantirAmostragem();
  return historico;
}
