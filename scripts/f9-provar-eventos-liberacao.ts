/**
 * PreSales F9 — prova por EXECUÇÃO REAL de que a liberação/aprovação/rejeição de proposta
 * dispara o EVENTO de timeline (D30) que a F9 ligou, e que ele chega mesmo na demanda certa
 * através de versões (F8).
 *
 * PROVA_PASSWORD=<senha> PROVA_DEMAND_REF=<demand_ref já seedado no CMCRM> npx tsx scripts/f9-provar-eventos-liberacao.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { hashPassword } from "../server/utils/security";
import { randomId } from "../src/idGenerator";

const TENANT = "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const DEMAND_REF = process.env.PROVA_DEMAND_REF;
const INSTALLATION_ID = "inst_bed57121b7635e0c";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];
function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) { passou++; linhas.push(`  OK    ${rotulo} — ${detalhe}`); }
  else { falhou++; linhas.push(`  FALHA ${rotulo} — ${detalhe}`); }
}

async function garantirUsuario(email: string, papel: string, nome: string, senha: string) {
  const existente = await prisma.user.findFirst({ where: { email } });
  if (existente) {
    return prisma.user.update({ where: { id: existente.id }, data: { roleId: papel, passwordHash: hashPassword(senha), status: "ACTIVE", mustChangePassword: false, mfaEnabled: false } });
  }
  return prisma.user.create({ data: { id: randomId("usr"), tenantId: TENANT, name: nome, email, passwordHash: hashPassword(senha), roleId: papel, status: "ACTIVE" } });
}

async function entrar(email: string, senha: string): Promise<Record<string, string> | null> {
  const resp = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: senha }) });
  const corpo: any = await resp.json().catch(() => ({}));
  const token = corpo?.token || corpo?.session_token || corpo?.data?.token;
  if (!token) { linhas.push(`  (login de ${email} falhou: status=${resp.status})`); return null; }
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const TABELA = [{ item_id: "f9-item-1", product_or_service: "Switch 24 portas PoE", specification: "24 portas, PoE+", quantity: 5, unit: "un", unit_price: 4000, total_price: 20000, currency: "BRL", is_optional: false, discount: 0 }];

async function gerarProposta(sessao: Record<string, string>, projectId: string, templateId: string, marcador: string) {
  const antes = await prisma.proposal.findMany({ where: { projectId }, select: { id: true } });
  const idsAntes = new Set(antes.map((p) => p.id));
  const resp = await fetch(`${BASE}/api/projects/${projectId}/proposals/commercial`, {
    method: "POST", headers: sessao,
    body: JSON.stringify({ template_id: templateId, language: "Portuguese", manual_pricing_table: TABELA, payment_terms: `30/60/90 (${marcador})`, delivery_terms: "45 dias", proposal_validity: "2026-12-31" }),
  });
  if (resp.status !== 202) { linhas.push(`  (geração recusada: status=${resp.status} corpo=${(await resp.text()).slice(0, 300)})`); return null; }
  for (let i = 0; i < 60; i++) {
    const nova = await prisma.proposal.findFirst({ where: { projectId, id: { notIn: [...idsAntes] } }, orderBy: { generatedAt: "desc" } });
    if (nova) return nova;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function esperarEventoNaFila(demandId: string, event: string, apos: Date, timeoutMs = 20000): Promise<any> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const linha = await prisma.demandOutboundEvent.findFirst({
      where: { demandId, kind: "event", event, occurredAt: { gte: apos } },
      orderBy: { occurredAt: "desc" },
    });
    if (linha) return linha;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente");
  if (!DEMAND_REF) throw new Error("PROVA_DEMAND_REF ausente — precisa já existir em presales_demands no CMCRM");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const gerente = await garantirUsuario("prova-f9-gerente@local.invalid", "r2", "Gerente da prova F9 (Sales Manager)", senha);
    const tecnico = await garantirUsuario("prova-f9-tecnico@local.invalid", "r3", "Aprovador técnico da prova F9", senha);
    const executivo = await garantirUsuario("prova-f9-executivo@local.invalid", "r1", "Aprovador executivo da prova F9", senha);

    const projectId = `f9-e2e-projeto-${Date.now()}`;
    const projeto = await prisma.project.create({
      data: {
        id: projectId, tenantId: TENANT, name: "Prova PreSales F9", customerName: "Cliente da Prova F9",
        opportunityName: "OPP-F9-E2E", vertical: "Infrastructure", description: "Projeto dedicado à prova F9 (eventos de liberação).",
        status: "waiting_internal", deadline: new Date("2026-12-01T00:00:00.000Z"), proposalValidityDate: new Date("2026-12-31T00:00:00.000Z"),
        ownerUserId: gerente.id, outputLanguage: "Portuguese", proposalLanguage: "Portuguese", aiOrientationMode: "Vendor-neutral", aiOrientationText: "",
        selectedApprovalWorkflowId: "w1",
      },
    });

    const demanda = await prisma.demand.create({
      data: {
        id: randomId("dem"), tenantId: TENANT, demandRef: DEMAND_REF, crmCompanyId: "crm-comp-f9",
        companyName: "Cliente da Prova F9", crmOpportunityId: "1da401d7-9005-43dc-a572-f37d62032811", opportunityName: "Oportunidade Aprovacoes E2E",
        title: "Prova PreSales F9", vertical: "Infrastructure", description: "demanda dedicada à prova F9, espelhada no CMCRM",
        deadline: new Date("2026-12-01T00:00:00.000Z"), proposalValidityDate: new Date("2026-12-31T00:00:00.000Z"),
        aiOrientationMode: "Vendor-neutral", sentAt: new Date(), pairCrmInstallationId: INSTALLATION_ID, projectId: projeto.id, status: "in_analysis",
      },
    });
    checar("projeto e demanda (espelhada no CMCRM) criados", !!projeto && !!demanda, `projeto=${projeto.id} demanda=${demanda.id} demandRef=${DEMAND_REF}`);

    const template = await prisma.proposalTemplate.findFirst({ where: { tenantId: TENANT, active: true, templateType: "commercial" } });
    if (!template) throw new Error("nenhum template ATIVO do tipo 'commercial' no tenant");

    const sessaoGerente = await entrar("prova-f9-gerente@local.invalid", senha);
    const sessaoTecnico = await entrar("prova-f9-tecnico@local.invalid", senha);
    const sessaoExecutivo = await entrar("prova-f9-executivo@local.invalid", senha);
    checar("login real dos 3 aprovadores dedicados (r1/r2/r3)", !!sessaoGerente && !!sessaoTecnico && !!sessaoExecutivo, `base=${BASE}`);
    if (!sessaoGerente || !sessaoTecnico || !sessaoExecutivo) return;

    const fluxo = await prisma.approvalWorkflow.findUnique({ where: { id: "w1" }, include: { stages: { orderBy: { order: "asc" } } } });
    const etapas = (fluxo?.stages ?? []).filter((e) => e.mandatory !== false);
    const sessaoPorPapel: Record<string, { sessao: Record<string, string>; userId: string }> = {
      r3: { sessao: sessaoTecnico, userId: tecnico.id },
      r2: { sessao: sessaoGerente, userId: gerente.id },
      r1: { sessao: sessaoExecutivo, userId: executivo.id },
    };

    // ═══════════════════ CAMINHO A: aprovar as 3 etapas → proposal_ready → liberar → proposal_sent ═══
    linhas.push("== Caminho A: aprovação completa → liberação ==");
    const antesA = new Date();
    const propA = await gerarProposta(sessaoGerente, projeto.id, template.id, "caminho A");
    checar("proposta A gerada", !!propA, `id=${propA?.id}`);
    if (!propA) return;

    const submeterA = await fetch(`${BASE}/api/proposals/${propA.id}/approval/submit`, { method: "POST", headers: sessaoGerente });
    checar("submissão A aceita", submeterA.status === 200, `status=${submeterA.status}`);

    for (const etapa of etapas) {
      const quem = sessaoPorPapel[etapa.approverRoleId as string];
      if (!quem) { checar(`aprovador da etapa ${etapa.name} existe`, false, `role=${etapa.approverRoleId}`); continue; }
      const r = await fetch(`${BASE}/api/proposals/${propA.id}/approval/decision`, {
        method: "POST", headers: { ...quem.sessao, "x-user-id": quem.userId, "x-role-id": etapa.approverRoleId as string },
        body: JSON.stringify({ decision: "approved", comments: `Etapa ${etapa.name} aprovada na prova F9.`, stage_id: etapa.id }),
      });
      checar(`etapa ${etapa.name} aprovada`, r.status === 200, `status=${r.status}`);
    }
    const aprovadaA = await prisma.proposal.findUnique({ where: { id: propA.id } });
    checar("proposta A chegou a `approved`", aprovadaA?.status === "approved", `status=${aprovadaA?.status}`);

    const eventoReadyA = await esperarEventoNaFila(demanda.id, "proposal_ready", antesA);
    checar("evento `proposal_ready` (v1) foi ENFILEIRADO ao aprovar", !!eventoReadyA, `linha=${eventoReadyA?.id ?? "(nenhuma)"}`);

    const liberarA = await fetch(`${BASE}/api/proposals/${propA.id}/release`, { method: "POST", headers: sessaoGerente });
    checar("release A aceito (200)", liberarA.status === 200, `status=${liberarA.status}`);
    const liberadaA = await prisma.proposal.findUnique({ where: { id: propA.id } });
    checar("proposta A está `released`", liberadaA?.status === "released", `status=${liberadaA?.status}`);

    const eventoSentA = await esperarEventoNaFila(demanda.id, "proposal_sent", antesA);
    checar("evento `proposal_sent` (v1) foi ENFILEIRADO ao liberar", !!eventoSentA, `linha=${eventoSentA?.id ?? "(nenhuma)"}`);

    // Espera a entrega real (drenador roda a cada 20s, `tentarAgora` já tentou imediato)
    for (let i = 0; i < 30; i++) {
      const pendentes = await prisma.demandOutboundEvent.count({ where: { demandId: demanda.id, kind: "event", status: { not: "enviado" } } });
      if (pendentes === 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const entreguesA = await prisma.demandOutboundEvent.findMany({ where: { demandId: demanda.id, kind: "event" }, orderBy: { occurredAt: "asc" } });
    checar("todos os eventos do caminho A saíram como `enviado`", entreguesA.every((e) => e.status === "enviado"), entreguesA.map((e) => `${e.event}=${e.status}`).join(", "));

    // ═══════════════════ CAMINHO B: rejeitar v1 → proposal_rejected → reabrir → v2 → proposal_ready/sent ═══
    linhas.push("");
    linhas.push("== Caminho B: rejeição → reabertura → liberação da v2 ==");
    const antesB = new Date();
    const propB = await gerarProposta(sessaoGerente, projeto.id, template.id, "caminho B");
    checar("proposta B gerada", !!propB, `id=${propB?.id}`);
    if (!propB) return;

    const submeterB = await fetch(`${BASE}/api/proposals/${propB.id}/approval/submit`, { method: "POST", headers: sessaoGerente });
    checar("submissão B aceita", submeterB.status === 200, `status=${submeterB.status}`);

    const primeiraEtapa = etapas[0];
    const quemRejeita = sessaoPorPapel[primeiraEtapa.approverRoleId as string];
    const rejeitar = await fetch(`${BASE}/api/proposals/${propB.id}/approval/decision`, {
      method: "POST", headers: { ...quemRejeita.sessao, "x-user-id": quemRejeita.userId, "x-role-id": primeiraEtapa.approverRoleId as string },
      body: JSON.stringify({ decision: "rejected", comments: "Rejeitada de propósito na prova F9 para testar o evento e a reabertura.", stage_id: primeiraEtapa.id }),
    });
    checar("rejeição da v1 aceita", rejeitar.status === 200, `status=${rejeitar.status}`);
    const v1 = await prisma.proposal.findUnique({ where: { id: propB.id } });
    checar("v1 ficou `rejected`", v1?.status === "rejected", `status=${v1?.status}`);

    const eventoRejectedV1 = await esperarEventoNaFila(demanda.id, "proposal_rejected", antesB);
    checar("evento `proposal_rejected` (v1) foi ENFILEIRADO", !!eventoRejectedV1, `linha=${eventoRejectedV1?.id ?? "(nenhuma)"}`);

    const reabrir = await fetch(`${BASE}/api/proposals/${propB.id}/reopen`, { method: "POST", headers: sessaoGerente });
    const corpoReabrir: any = await reabrir.json().catch(() => ({}));
    checar("reopen aceito (201)", reabrir.status === 201, `status=${reabrir.status}`);
    const v2Id = corpoReabrir?.proposal_id;
    if (!v2Id) return;
    const v2 = await prisma.proposal.findUnique({ where: { id: v2Id } });
    checar("v2 nasce draft, version+1, mesmo grupo, aponta pra v1", v2?.status === "draft" && v2?.version === (v1?.version ?? 0) + 1 && v2?.proposalGroupId === v1?.proposalGroupId && v2?.previousVersionId === v1?.id, `v2=${JSON.stringify({ status: v2?.status, version: v2?.version, grupo: v2?.proposalGroupId })}`);

    const submeterV2 = await fetch(`${BASE}/api/proposals/${v2Id}/approval/submit`, { method: "POST", headers: sessaoGerente });
    checar("submissão da v2 aceita", submeterV2.status === 200, `status=${submeterV2.status}`);
    const antesV2 = new Date();
    for (const etapa of etapas) {
      const quem = sessaoPorPapel[etapa.approverRoleId as string];
      const r = await fetch(`${BASE}/api/proposals/${v2Id}/approval/decision`, {
        method: "POST", headers: { ...quem.sessao, "x-user-id": quem.userId, "x-role-id": etapa.approverRoleId as string },
        body: JSON.stringify({ decision: "approved", comments: `Etapa ${etapa.name} aprovada na v2 (prova F9).`, stage_id: etapa.id }),
      });
      checar(`etapa ${etapa.name} da v2 aprovada`, r.status === 200, `status=${r.status}`);
    }
    const eventoReadyV2 = await esperarEventoNaFila(demanda.id, "proposal_ready", antesV2);
    checar("evento `proposal_ready` (v2) foi ENFILEIRADO — demanda certa, sem colidir com o da v1", !!eventoReadyV2 && eventoReadyV2.id !== eventoReadyA?.id, `linha=${eventoReadyV2?.id}`);

    const liberarV2 = await fetch(`${BASE}/api/proposals/${v2Id}/release`, { method: "POST", headers: sessaoGerente });
    checar("release da v2 aceito", liberarV2.status === 200, `status=${liberarV2.status}`);
    const eventoSentV2 = await esperarEventoNaFila(demanda.id, "proposal_sent", antesV2);
    checar("evento `proposal_sent` (v2) foi ENFILEIRADO — demanda certa, sem colidir com o da v1", !!eventoSentV2 && eventoSentV2.id !== eventoSentA?.id, `linha=${eventoSentV2?.id}`);

    for (let i = 0; i < 30; i++) {
      const pendentes = await prisma.demandOutboundEvent.count({ where: { demandId: demanda.id, kind: "event", status: { not: "enviado" } } });
      if (pendentes === 0) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const todosEventos = await prisma.demandOutboundEvent.findMany({ where: { demandId: demanda.id, kind: "event" }, orderBy: { occurredAt: "asc" }, select: { event: true, status: true, idempotencyKey: true, occurredAt: true } });
    checar("todos os eventos (v1 + v2) saíram `enviado`, sem duplicar chave", todosEventos.every((e) => e.status === "enviado") && new Set(todosEventos.map((e) => e.idempotencyKey)).size === todosEventos.length, todosEventos.map((e) => `${e.event}@${e.occurredAt.toISOString()}`).join(" | "));

    console.log(`\ndemandId=${demanda.id} demandRef=${DEMAND_REF} projeto=${projeto.id} propA=${propA.id} v1=${v1?.id} v2=${v2Id}`);
  });
}

main()
  .then(() => { console.log(linhas.join("\n")); console.log(`\n${passou} OK, ${falhou} FALHA`); process.exit(falhou > 0 ? 1 : 0); })
  .catch((err) => { console.log(linhas.join("\n")); console.error("\nERRO:", err); process.exit(1); });
