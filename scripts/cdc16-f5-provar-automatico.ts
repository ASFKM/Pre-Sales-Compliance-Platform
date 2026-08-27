/**
 * CDC 16 — Fase 5. Prova por execução real, ETAPA 2b: a distribuição automática e a medição.
 *
 * Roda DEPOIS de a ETAPA 2 ligar a política `automatico` e de a ETAPA 1b entregar mais uma
 * demanda — nessa ordem, porque a distribuição acontece no ATO DA CHEGADA (D16). Uma demanda que
 * chegasse antes da política ligada, ou depois de um varredor, não provaria a coisa certa.
 *
 *   PROVA_PASSWORD=… REF_AUTOMATICA=… npx tsx scripts/cdc16-f5-provar-automatico.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { calcularCargas } from "../server/utils/demandSla";
import { equipeDePreVendas } from "../server/utils/demandSlaService";
import {
  PAPEIS_DA_PROVA,
  chamarRota,
  entrarComo,
  esperarSaidaDe,
  papelDaProva,
} from "./cdc16-f5-comum";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const PREFIXO = "prova-cdc16-f5-";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    passou++;
    linhas.push(`  OK   ${rotulo} — ${detalhe}`);
  } else {
    falhou++;
    linhas.push(`  FALHA ${rotulo} — ${detalhe}`);
  }
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  const refAuto = process.env.REF_AUTOMATICA;
  if (!senha) throw new Error("PROVA_PASSWORD ausente");
  if (!refAuto) throw new Error("REF_AUTOMATICA ausente (sai da ETAPA 1b)");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const papelAdmin = await papelDaProva("Prova F5 — administrador", PAPEIS_DA_PROVA.admin);
    const admin = await entrarComo("Admin da prova F5", `${PREFIXO}admin@local.invalid`, papelAdmin.id, senha, checar);
    if (!admin) return;

    // ═══════════════════════════════════════════════ 7. distribuição automática (D16 + D40)
    linhas.push("== 7. A distribuição automática por menor carga (D40) ==");
    const demanda = await prisma.demand.findFirst({
      where: { demandRef: refAuto },
      include: { assignedUser: { select: { name: true } } },
    });
    checar("a demanda entregue pela ETAPA 1b chegou", !!demanda, `ref=${refAuto.slice(-16)}`);
    if (!demanda) return;

    checar(
      "e chegou JÁ ASSUMIDA: a distribuição acontece no ato da chegada, e não num varredor",
      demanda.status === "assigned" && !!demanda.assignedUserId,
      `status=${demanda.status} para=${demanda.assignedUser?.name}`,
    );
    // A conferência mede a RÉGUA, e não nomeia uma pessoa. Nomear "Bruno" foi a primeira versão
    // desta linha e ela falhou pelo motivo certo: esta instalação tem outras pessoas com
    // `demand:assume` — as do seed, e as das provas anteriores —, e várias delas também estavam
    // com carga zero. O produto escolheu uma delas, corretamente. O que se prova aqui é que quem
    // recebeu tinha a MENOR carga ponderada entre os elegíveis, que é o que a D40 decide.
    const elegiveis = await equipeDePreVendas();
    const abertasDeTodos = await prisma.demand.findMany({
      where: {
        status: { in: ["assigned", "in_analysis"] },
        assignedUserId: { in: elegiveis.map((u) => u.id) },
        // A própria demanda distribuída sai da conta: ela é o RESULTADO da decisão, e incluí-la
        // mediria o mundo depois de a escolha já ter sido feita.
        id: { not: demanda.id },
      },
      select: { assignedUserId: true, deadline: true },
    });
    const agora = new Date();
    const cargas = calcularCargas(
      elegiveis.map((u) => ({
        userId: u.id,
        abertas: abertasDeTodos.filter((d) => d.assignedUserId === u.id).map((d) => ({ deadline: d.deadline, assignedAt: null })),
      })),
      agora,
    );
    const menor = Math.min(...cargas.map((c) => c.carga));
    const cargaDeQuemRecebeu = cargas.find((c) => c.userId === demanda.assignedUserId)?.carga;
    checar(
      "quem recebeu tinha a MENOR carga ponderada entre os elegíveis (D40)",
      cargaDeQuemRecebeu === menor,
      `recebeu=${demanda.assignedUser?.name} carga=${cargaDeQuemRecebeu} menor=${menor} elegíveis=${elegiveis.length}`,
    );
    const comCargaMaior = cargas.filter((c) => c.carga > menor);
    checar(
      "e havia quem tivesse mais carga: a escolha não foi por falta de alternativa",
      comCargaMaior.length > 0,
      `pessoas com carga maior=${comCargaMaior.length} (maior=${Math.max(...cargas.map((c) => c.carga))})`,
    );
    checar(
      "a demanda registra que quem escolheu foi o PRODUTO, e não uma pessoa",
      demanda.assignmentSource === "auto" && demanda.assignedByUserId === null,
      `origem=${demanda.assignmentSource} por=${demanda.assignedByUserId}`,
    );
    checar(
      "e o projeto nasceu com quem recebeu",
      !!demanda.projectId &&
        (await prisma.project.findUnique({ where: { id: demanda.projectId } }))?.ownerUserId === demanda.assignedUserId,
      `projeto=${demanda.projectId}`,
    );

    const saidaAuto = await esperarSaidaDe(demanda.id, "assigned");
    checar(
      "o CRM é avisado, com a nota dizendo que foi automático",
      saidaAuto?.status === "enviado" && String((saidaAuto.payload as any)?.note ?? "").includes("automaticamente"),
      `status=${saidaAuto?.status} nota=${(saidaAuto?.payload as any)?.note}`,
    );
    checar(
      "e o prazo que viaja é o da etapa NOVA (a análise), não o de assumir",
      typeof (saidaAuto?.payload as any)?.due_at === "string" &&
        (saidaAuto?.payload as any).due_at === new Date(demanda.assignedAt!.getTime() + 2 * 3600_000).toISOString(),
      `due_at=${(saidaAuto?.payload as any)?.due_at}`,
    );

    // ═══════════════════════════════════════════════ 8. a medição por pessoa (D20)
    linhas.push("== 8. O desempenho por pessoa, que existe SÓ deste lado (D20) ==");
    const desempenho = await chamarRota(admin, "GET", "/api/demands/performance");
    checar(
      "a medição agregada da equipe existe, com o denominador ao lado",
      desempenho.status === 200 &&
        desempenho.corpo?.team?.total > 0 &&
        typeof desempenho.corpo?.team?.amostraAteAssumir === "number",
      `total=${desempenho.corpo?.team?.total} amostra=${desempenho.corpo?.team?.amostraAteAssumir} média=${desempenho.corpo?.team?.mediaAteAssumirSegundos}s`,
    );
    const pessoas: any[] = desempenho.corpo?.people ?? [];
    checar(
      "e o recorte POR PESSOA aparece, com nome",
      pessoas.length >= 2 && pessoas.every((p) => typeof p.name === "string" && p.name.length > 0),
      `pessoas=${pessoas.map((p) => `${p.name}:${p.total}`).join(", ")}`,
    );
    checar(
      "a soma das demandas por pessoa não passa do total da equipe",
      pessoas.reduce((a, p) => a + p.total, 0) <= desempenho.corpo?.team?.total,
      `soma=${pessoas.reduce((a, p) => a + p.total, 0)} total=${desempenho.corpo?.team?.total}`,
    );

    // ═══════════════════════════════════════════════ 9. desligar volta ao estado de antes
    linhas.push("== 9. Desligar o SLA devolve a instalação ao comportamento da F1 ==");
    await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: false,
      assume_hours: Number.parseInt(process.env.SLA_ASSUME_HORAS ?? "1", 10),
      analysis_hours: 2,
      proposal_hours: 8,
      assignment_policy: "auto_servico",
    });
    const desligado = await chamarRota(admin, "GET", "/api/demands?status=queued,assigned,in_analysis");
    checar(
      "nenhuma demanda tem prazo com o SLA desligado",
      (desligado.corpo as any[]).length > 0 && (desligado.corpo as any[]).every((d) => d.due_at === null),
      `demandas=${(desligado.corpo as any[]).length}`,
    );
    const varreduraDesligada = await chamarRota(admin, "POST", "/api/demands/sla/scan");
    checar(
      "e a varredura não encontra nada para alertar",
      varreduraDesligada.corpo?.vencidas === 0 && varreduraDesligada.corpo?.novas === 0,
      `vencidas=${varreduraDesligada.corpo?.vencidas} novas=${varreduraDesligada.corpo?.novas}`,
    );

    // Volta a ligar: a ETAPA 3 e a prova visual leem o estado configurado.
    await chamarRota(admin, "PUT", "/api/demands/sla-settings", {
      enabled: true,
      assume_hours: Number.parseInt(process.env.SLA_ASSUME_HORAS ?? "1", 10),
      analysis_hours: 2,
      proposal_hours: 8,
      assignment_policy: "auto_servico",
    });

    console.log(linhas.join("\n"));
    console.log(`\nETAPA 2b: ${passou} passaram, ${falhou} falharam.`);
  });

  await prisma.$disconnect();
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.log(linhas.join("\n"));
  console.error("FALHOU:", err?.stack || err?.message || err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
