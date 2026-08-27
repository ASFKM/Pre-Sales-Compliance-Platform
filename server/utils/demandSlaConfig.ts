import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import type { ConfiguracaoDeSla } from "./demandSla";

// CDC 16 — Fase 5. A leitura e a escrita da configuração de SLA da instalação.
//
// Módulo próprio, e não uma função dentro de `demandSlaService.ts`, por uma
// razão mecânica: a fila de saída precisa do prazo para montar o `due_at` que
// viaja, e o serviço de varredura precisa da fila de saída para emitir
// `sla_breached`. Os dois no mesmo arquivo fariam um ciclo de importação. Este
// arquivo não importa nenhum dos dois.

/**
 * Lê a configuração de SLA do tenant.
 *
 * `null` é o estado de toda instalação que existe hoje, e significa exatamente
 * o que a F1 entregou: sem prazo, sem alerta, auto-serviço. Nenhum caminho
 * desta fase inventa um padrão quando a linha não existe — inventar seria
 * ligar prazo em instalação que ninguém configurou, que é o oposto de "o
 * administrador da instalação configura" (D19).
 */
export async function lerSla(): Promise<
  (ConfiguracaoDeSla & { assignmentPolicy: string }) | null
> {
  const linha = await prisma.demandSlaSettings.findFirst();
  if (!linha) return null;
  return {
    enabled: linha.enabled,
    assumeHours: linha.assumeHours,
    analysisHours: linha.analysisHours,
    proposalHours: linha.proposalHours,
    assignmentPolicy: linha.assignmentPolicy,
  };
}

/** A política vigente. Sem linha configurada, auto-serviço — o padrão de hoje (D16). */
export async function politicaDeAtribuicao(): Promise<
  "auto_servico" | "direcionamento" | "automatico"
> {
  const sla = await lerSla();
  return (sla?.assignmentPolicy as any) ?? "auto_servico";
}

/**
 * Grava a configuração.
 *
 * Select-then-write, e não `upsert`: a extensão de tenant de `src/prisma.ts`
 * **lança** em `.upsert()` para modelo recortado por tenant, porque não sabe
 * injetar o `tenantId` no `where` de forma segura. É a mesma troca que a F3
 * teve de fazer nos dois modelos dela.
 */
export async function gravarSla(
  tenantId: string,
  dados: {
    enabled: boolean;
    assumeHours: number;
    analysisHours: number;
    proposalHours: number;
    assignmentPolicy: "auto_servico" | "direcionamento" | "automatico";
  }
) {
  const atual = await prisma.demandSlaSettings.findFirst();
  if (atual) {
    return prisma.demandSlaSettings.update({ where: { id: atual.id }, data: dados });
  }
  return prisma.demandSlaSettings.create({
    data: { id: randomId("dsla"), tenantId, ...dados },
  });
}
