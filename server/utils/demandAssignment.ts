import { prisma } from "../../src/prisma";
import { logger } from "./logger";
import { assumirDemanda } from "./demands";
import { empurrarMarcoDaDemanda } from "./crmOutbox";
import { politicaDeAtribuicao } from "./demandSlaConfig";
import { escolherPorMenorCarga } from "./demandSlaService";

// CDC 16 — Fase 5. A distribuição automática por menor carga (D16, política
// `automatico`; a régua é a D40).
//
// Arquivo próprio porque ele amarra três coisas que já existem — a política, a
// régua e o ato de assumir — e nenhuma delas deveria conhecer as outras duas.

/**
 * Distribui a demanda recém-criada, se a política for `automatico`.
 *
 * Roda no ato da CHEGADA, dentro da rota que recebe a demanda do CRM, e não num
 * varredor à parte: uma demanda que fica minutos na fila esperando um
 * distribuidor é uma demanda que não foi distribuída, e a política existe para
 * que ninguém precise olhar a fila.
 *
 * Devolve a demanda atualizada, ou `null` quando nada foi feito. E "nada foi
 * feito" é resposta legítima em três casos, cada um com sua razão:
 *
 * - a política não é `automatico` (o padrão, e o de toda instalação hoje);
 * - não há ninguém elegível — sem gente com `demand:assume` ativa, distribuir
 *   seria inventar um dono. A demanda fica na fila, e o auto-serviço continua
 *   ligado neste modo justamente para que ela não fique presa;
 * - a corrida foi perdida para alguém que assumiu no mesmo instante.
 *
 * NUNCA lança. A entrega da demanda é um fato do outro lado; uma falha em
 * escolher quem trabalha não pode transformar um `201` em `500` e fazer o CRM
 * retentar uma criação que já aconteceu.
 */
export async function distribuirDemandaNova(demandaId: string, tenantId: string): Promise<any | null> {
  try {
    if ((await politicaDeAtribuicao()) !== "automatico") return null;

    const escolhido = await escolherPorMenorCarga(new Date());
    if (!escolhido) {
      logger.info({ tenantId, demandaId }, "cdc16 F5: política automática sem ninguém elegível; a demanda fica na fila");
      return null;
    }

    const resultado = await assumirDemanda(demandaId, escolhido, { byUserId: null, source: "auto" });
    if (!resultado.ok) {
      logger.info({ tenantId, demandaId, motivo: resultado.motivo }, "cdc16 F5: distribuição automática não aplicada");
      return null;
    }

    const quem = await prisma.user.findUnique({ where: { id: escolhido }, select: { name: true } });
    logger.info(
      { tenantId, demandaId, escolhido, projectId: resultado.projectId },
      "cdc16 F5: demanda distribuída automaticamente por menor carga"
    );

    // O CRM precisa saber, e é o MESMO evento do auto-serviço: do lado de lá,
    // "alguém assumiu" é o fato, e como essa pessoa foi escolhida é assunto
    // desta instalação. A nota diz o critério, porque um vendedor que vê a
    // demanda ser assumida em dois segundos merece saber que foi o distribuidor
    // e não um humano de plantão.
    await empurrarMarcoDaDemanda({
      tenantId,
      demanda: resultado.demand,
      event: "assigned",
      occurredAt: resultado.demand.assignedAt ?? new Date(),
      actor: { name: quem?.name ?? "Pré-vendas", presales_user_id: escolhido },
      note: "Distribuída automaticamente por menor carga.",
      projectId: resultado.projectId,
    });

    return resultado.demand;
  } catch (err) {
    logger.error({ err, tenantId, demandaId }, "cdc16 F5: falha na distribuição automática");
    return null;
  }
}
