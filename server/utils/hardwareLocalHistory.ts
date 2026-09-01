// Historico curto de hardware DESTA instalacao, para o card "Sistema" da Visao Geral do
// AdminConsole ver a mesma pergunta que o CMSaaS ve de fora (CPU/memoria/disco), so que sem
// depender do heartbeat: o processo local ja sabe as proprias metricas, coletadas com a MESMA
// `collectSystemInfo()` que monta o heartbeat (server/utils/fleetLicense.ts) - reaproveitada, nao
// duplicada, para as duas leituras nunca divergirem.
//
// So em memoria, de proposito: e um indicador de "esta maquina esta bem agora", nao um relatorio
// historico que precise sobreviver a um restart - reinicia junto com o processo, como o
// uptime_seconds que `admin/system/status` ja expõe.
import { collectSystemInfo } from "./fleetLicense";

export interface PontoDeHardwareLocal {
  medido_em: string;
  cpu_load_percent: number | null;
  memory_used_mb: number | null;
  total_memory_mb: number | null;
  disk_used_mb: number | null;
  disk_total_mb: number | null;
}

const INTERVALO_MS = 15_000;
// 15s * 60 pontos = 15 minutos de janela, o mesmo horizonte curto que a Visao Geral já assume nos
// demais cartões (nenhum outro dado desta tela olha mais longe que "agora").
const MAX_PONTOS = 60;

const historico: PontoDeHardwareLocal[] = [];
let intervalo: ReturnType<typeof setInterval> | null = null;

function amostrar(): void {
  try {
    const info = collectSystemInfo();
    historico.push({
      medido_em: new Date().toISOString(),
      cpu_load_percent: info.cpu_load_percent ?? null,
      memory_used_mb: info.memory_used_mb ?? null,
      total_memory_mb: info.total_memory_mb ?? null,
      disk_used_mb: info.disk_used_mb ?? null,
      disk_total_mb: info.disk_total_mb ?? null,
    });
    if (historico.length > MAX_PONTOS) {
      historico.splice(0, historico.length - MAX_PONTOS);
    }
  } catch {
    // Uma amostra perdida não derruba a série - a próxima tentativa acontece em INTERVALO_MS.
  }
}

// Inicio preguicoso: a primeira chamada a getHistoricoDeHardwareLocal() liga o laco, em vez do
// boot do servidor pagar por um recurso que uma instalacao pode nunca abrir esta aba para ver.
function garantirAmostragem(): void {
  if (intervalo) return;
  amostrar();
  intervalo = setInterval(amostrar, INTERVALO_MS);
  intervalo.unref?.();
}

export function getHistoricoDeHardwareLocal(): PontoDeHardwareLocal[] {
  garantirAmostragem();
  return historico;
}
