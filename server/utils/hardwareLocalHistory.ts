// Historico persistente de hardware E servicos DESTA instalacao (F11), para os quatro cartoes da
// Visao Geral e para o popup de periodo/granularidade. Reaproveita as MESMAS
// `collectSystemInfo()`/`coletarStatusDosServicos()` que ja montam o heartbeat
// (server/utils/fleetLicense.ts), para as duas leituras (a que sai para o CMSaaS e a que fica
// local) nunca divergirem.
//
// Duas tabelas (ver prisma/schema.prisma, F11): `hardware_samples` guarda uma linha por minuto,
// pelos ultimos 7 dias; o job de rollup (hardwareRollup.ts) agrega o que passa de 7 dias em
// `hardware_samples_hourly` (media dos numericos, pior status por servico) e apaga a bruta. Nenhum
// tenant_id: CPU/memoria/disco/servicos sao dado da INSTALACAO, nao de um tenant.
import { collectSystemInfo, coletarStatusDosServicos } from "./fleetLicense";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";

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

export type Granularidade = "minute" | "hour" | "day";

const INTERVALO_DE_AMOSTRAGEM_MS = 60_000;
const RETENCAO_BRUTA_MS = 7 * 24 * 60 * 60 * 1000;
const TETO_DE_PONTOS = 1000;

let intervalo: ReturnType<typeof setInterval> | null = null;
let amostrando = false;

async function amostrar(): Promise<void> {
  if (amostrando) return;
  amostrando = true;
  try {
    const [info, servicos] = await Promise.all([
      Promise.resolve().then(() => collectSystemInfo()),
      coletarStatusDosServicos().catch(() => [] as ServicoLocal[]),
    ]);
    await prisma.hardwareSample.create({
      data: {
        id: randomId("hwsample"),
        cpuLoadPercent: info.cpu_load_percent ?? null,
        memoryUsedMb: info.memory_used_mb ?? null,
        totalMemoryMb: info.total_memory_mb ?? null,
        diskUsedMb: info.disk_used_mb ?? null,
        diskTotalMb: info.disk_total_mb ?? null,
        services: servicos as any,
      },
    });
  } catch {
    // Uma amostra perdida nao derruba a serie - a proxima tentativa acontece em 1 minuto.
  } finally {
    amostrando = false;
  }
}

// Inicio preguicoso: a primeira chamada a consultarHistoricoDeHardware() liga o laco, em vez do
// boot do servidor pagar por um recurso que uma instalacao pode nunca abrir esta aba para ver.
let primeiraAmostra: Promise<void> | null = null;

export function garantirAmostragemDeHardware(): Promise<void> {
  if (!primeiraAmostra) {
    primeiraAmostra = amostrar();
    intervalo = setInterval(() => void amostrar(), INTERVALO_DE_AMOSTRAGEM_MS);
    intervalo.unref?.();
  }
  return primeiraAmostra;
}

function pontoDeBruta(row: {
  measuredAt: Date; cpuLoadPercent: number | null; memoryUsedMb: number | null;
  totalMemoryMb: number | null; diskUsedMb: number | null; diskTotalMb: number | null; services: unknown;
}): PontoDeHardwareLocal {
  return {
    medido_em: row.measuredAt.toISOString(),
    cpu_load_percent: row.cpuLoadPercent,
    memory_used_mb: row.memoryUsedMb,
    total_memory_mb: row.totalMemoryMb,
    disk_used_mb: row.diskUsedMb,
    disk_total_mb: row.diskTotalMb,
    servicos: (row.services as ServicoLocal[]) ?? [],
  };
}

function pontoDeHoraria(row: {
  bucketStart: Date; cpuLoadPercent: number | null; memoryUsedMb: number | null;
  totalMemoryMb: number | null; diskUsedMb: number | null; diskTotalMb: number | null; servicesSummary: unknown;
}): PontoDeHardwareLocal {
  return {
    medido_em: row.bucketStart.toISOString(),
    cpu_load_percent: row.cpuLoadPercent,
    memory_used_mb: row.memoryUsedMb,
    total_memory_mb: row.totalMemoryMb,
    disk_used_mb: row.diskUsedMb,
    disk_total_mb: row.diskTotalMb,
    // O resumo por hora guarda so o PIOR status de cada servico, ja no mesmo formato de
    // ServicoLocal (ver hardwareRollup.ts) - da pra desenhar a barra de disponibilidade sem saber
    // se a fonte foi bruta ou agregada.
    servicos: (row.servicesSummary as ServicoLocal[]) ?? [],
  };
}

const GRAVIDADE: Record<ServicoLocal["status"], number> = { down: 3, degraded: 2, unknown: 1, operational: 0 };

/** Reduz uma lista de snapshots de servicos ao pior status de cada chave - mesma regra usada no
 * resumo do cartao (ver src/components/statusDosServicos.tsx no front). */
function piorServicoPorChave(listasDeServicos: ServicoLocal[][]): ServicoLocal[] {
  const porChave = new Map<string, ServicoLocal>();
  for (const lista of listasDeServicos) {
    for (const s of lista) {
      const atual = porChave.get(s.key);
      if (!atual || GRAVIDADE[s.status] > GRAVIDADE[atual.status]) {
        porChave.set(s.key, s);
      }
    }
  }
  return [...porChave.values()];
}

function media(valores: (number | null)[]): number | null {
  const validos = valores.filter((v): v is number => v !== null && Number.isFinite(v));
  if (validos.length === 0) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

/** Agrupa pontos (brutos ou ja horarios) num bucket mais grosso (hora ou dia), tirando media dos
 * numericos e o pior status dos servicos - mesma logica do job de rollup, aqui aplicada em
 * memoria a pedido de uma consulta, nao gravada. */
function reagrupar(pontos: PontoDeHardwareLocal[], chaveDoBucket: (data: Date) => string, inicioDoBucket: (chave: string) => Date): PontoDeHardwareLocal[] {
  const porBucket = new Map<string, PontoDeHardwareLocal[]>();
  for (const p of pontos) {
    const chave = chaveDoBucket(new Date(p.medido_em));
    const lista = porBucket.get(chave) ?? [];
    lista.push(p);
    porBucket.set(chave, lista);
  }
  return [...porBucket.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([chave, lista]) => ({
      medido_em: inicioDoBucket(chave).toISOString(),
      cpu_load_percent: media(lista.map((p) => p.cpu_load_percent)),
      memory_used_mb: media(lista.map((p) => p.memory_used_mb)),
      total_memory_mb: media(lista.map((p) => p.total_memory_mb)),
      disk_used_mb: media(lista.map((p) => p.disk_used_mb)),
      disk_total_mb: media(lista.map((p) => p.disk_total_mb)),
      servicos: piorServicoPorChave(lista.map((p) => p.servicos)),
    }));
}

function chaveHora(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}
function inicioDaHora(chave: string): Date {
  const [ano, mes, dia, hora] = chave.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, dia, hora));
}
function chaveDia(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function inicioDoDia(chave: string): Date {
  const [ano, mes, dia] = chave.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, dia));
}

export async function consultarHistoricoDeHardware({
  from,
  to,
  granularity,
}: {
  from: Date;
  to: Date;
  granularity: Granularidade;
}): Promise<PontoDeHardwareLocal[]> {
  // Chamado de novo aqui e idempotente (primeiraAmostra ja memoizada) - existe pra cobrir quem
  // chamar esta funcao direto, sem passar pela rota (que ja chama garantirAmostragemDeHardware()
  // ANTES de calcular `to`, evitando a amostra recem-criada cair fora do proprio filtro dela).
  await garantirAmostragemDeHardware();

  const cutoff = new Date(Date.now() - RETENCAO_BRUTA_MS);
  // Simplificacao deliberada: um periodo que comeca antes do corte de 7 dias le SEMPRE da tabela
  // horaria, mesmo que a ponta final ainda esteja na janela bruta - evita misturar duas
  // resolucoes na mesma serie, e "granularidade minuto" so faz sentido justamente porque o
  // pedido nunca cruza essa fronteira (o front restringe as opcoes pelo periodo escolhido).
  const usaBruta = from >= cutoff;

  let pontos: PontoDeHardwareLocal[];
  if (usaBruta) {
    const linhas = await prisma.hardwareSample.findMany({
      where: { measuredAt: { gte: from, lte: to } },
      orderBy: { measuredAt: "asc" },
      take: TETO_DE_PONTOS,
    });
    pontos = linhas.map(pontoDeBruta);
  } else {
    const linhas = await prisma.hardwareSampleHourly.findMany({
      where: { bucketStart: { gte: from, lte: to } },
      orderBy: { bucketStart: "asc" },
      take: TETO_DE_PONTOS,
    });
    pontos = linhas.map(pontoDeHoraria);
  }

  if (granularity === "hour" && usaBruta) {
    pontos = reagrupar(pontos, chaveHora, inicioDaHora);
  } else if (granularity === "day") {
    pontos = reagrupar(pontos, chaveDia, inicioDoDia);
  }

  return pontos.length > TETO_DE_PONTOS ? pontos.slice(-TETO_DE_PONTOS) : pontos;
}
