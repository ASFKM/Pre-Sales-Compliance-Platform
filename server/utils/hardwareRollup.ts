// Job de rollup do historico de hardware (F11): uma vez por hora, agrega amostras brutas
// (hardware_samples) com mais de 7 dias em hardware_samples_hourly (media dos numericos, pior
// status por servico) e apaga as brutas que entraram no agregado. Mantem hardware_samples com
// tamanho limitado (~7 dias * 1440 amostras/dia), em vez de crescer pra sempre.
//
// Cada bucket de hora e processado numa transacao propria: se o processo cair no meio, o proximo
// disparo encontra as brutas daquele bucket ainda intactas (o create do agregado foi desfeito
// junto) e reprocessa do zero - nao ha "meio caminho" persistido que duplique ou perca dado.
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import type { ServicoLocal } from "./hardwareLocalHistory";

const INTERVALO_MS = 60 * 60 * 1000;
const RETENCAO_BRUTA_MS = 7 * 24 * 60 * 60 * 1000;

const GRAVIDADE: Record<ServicoLocal["status"], number> = { down: 3, degraded: 2, unknown: 1, operational: 0 };

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
  return Math.round((validos.reduce((a, b) => a + b, 0) / validos.length) * 100) / 100;
}

function chaveDaHora(d: Date): string {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}
function inicioDaHora(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

let executando = false;

export async function rodarRollupDeHardware(): Promise<{ buckets: number; amostrasApagadas: number }> {
  if (executando) return { buckets: 0, amostrasApagadas: 0 };
  executando = true;
  try {
    const corte = new Date(Date.now() - RETENCAO_BRUTA_MS);
    const antigas = await prisma.hardwareSample.findMany({
      where: { measuredAt: { lt: corte } },
      orderBy: { measuredAt: "asc" },
    });
    if (antigas.length === 0) return { buckets: 0, amostrasApagadas: 0 };

    const porHora = new Map<string, typeof antigas>();
    for (const amostra of antigas) {
      const chave = chaveDaHora(amostra.measuredAt);
      const lista = porHora.get(chave) ?? [];
      lista.push(amostra);
      porHora.set(chave, lista);
    }

    let amostrasApagadas = 0;
    for (const [, amostrasDaHora] of porHora) {
      const inicio = inicioDaHora(amostrasDaHora[0].measuredAt);
      const ids = amostrasDaHora.map((a) => a.id);

      await prisma.$transaction(async (tx) => {
        const jaExiste = await tx.hardwareSampleHourly.findUnique({ where: { bucketStart: inicio } });
        if (!jaExiste) {
          await tx.hardwareSampleHourly.create({
            data: {
              id: randomId("hwhour"),
              bucketStart: inicio,
              cpuLoadPercent: media(amostrasDaHora.map((a) => a.cpuLoadPercent)),
              memoryUsedMb: media(amostrasDaHora.map((a) => a.memoryUsedMb)),
              totalMemoryMb: media(amostrasDaHora.map((a) => a.totalMemoryMb)),
              diskUsedMb: media(amostrasDaHora.map((a) => a.diskUsedMb)),
              diskTotalMb: media(amostrasDaHora.map((a) => a.diskTotalMb)),
              servicesSummary: piorServicoPorChave(amostrasDaHora.map((a) => (a.services as unknown as ServicoLocal[]) ?? [])) as any,
              sampleCount: amostrasDaHora.length,
            },
          });
        }
        await tx.hardwareSample.deleteMany({ where: { id: { in: ids } } });
      });

      amostrasApagadas += ids.length;
    }

    return { buckets: porHora.size, amostrasApagadas };
  } finally {
    executando = false;
  }
}

let intervalo: ReturnType<typeof setInterval> | null = null;

export function iniciarRollupDeHardware(): void {
  if (intervalo) return;
  void rodarRollupDeHardware();
  intervalo = setInterval(() => void rodarRollupDeHardware(), INTERVALO_MS);
  intervalo.unref?.();
}
