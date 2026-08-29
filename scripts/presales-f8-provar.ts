/**
 * PreSales F8 — prova por EXECUÇÃO REAL, contra a instalação publicada neste host.
 *
 * Não é teste unitário (esses vivem em server/utils/approvalDecision.test.ts e
 * server/utils/proposalVersioning.test.ts, e provam só a parte pura). Aqui o produto é percorrido
 * pelas ROTAS, com login real, DOCX/PDF escritos de verdade em disco e o outbox do CRM observado
 * na tabela — porque foi por chamar função de domínio direto, pulando o handler, que provas
 * anteriores deste repositório se enganaram (ver o cabeçalho de scripts/cdc16-f4-provar-proposta.ts).
 *
 * O que ela mede:
 *   A. Liberação: proposta gerada -> submetida -> APROVADA nas 3 etapas obrigatórias -> liberada.
 *      Confere que POST /proposals/:id/release foi de fato chamado e aceito, que o status virou
 *      `released`, que `empurrarProposta` disparou (linha na fila do CRM com a chave de
 *      idempotência do estado `sent`) e que o DOCX liberado RENDERIZA com o conteúdo certo pelo
 *      mesmo caminho do preview da tela (rota /export/docx + mammoth).
 *   B. Motivo de rejeição obrigatório: rejeição sem motivo e com motivo só de espaços são
 *      RECUSADAS pelo servidor (400); com motivo real é aceita e o motivo fica gravado.
 *   C. Reabertura pós-rejeição: a v2 nasce com version+1, mesmo proposal_group_id,
 *      previous_version_id apontando para a v1, em `draft` e SEM parecer de IA; a v1 não é tocada
 *      em nenhum campo; e — o ponto que mais importa — os arquivos físicos da v1 SOBREVIVEM tanto
 *      à criação da v2 quanto a uma edição normal da v2 pelo PUT (que apaga arquivo antigo).
 *
 *   PROVA_PASSWORD=<senha dos usuários dedicados da prova> npx tsx scripts/presales-f8-provar.ts
 */
import "dotenv/config";
import * as mammoth from "mammoth";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { hashPassword } from "../server/utils/security";
import { randomId } from "../src/idGenerator";
import { dbStore } from "../src/dbStore";
import { createStorageAdapter } from "../server/utils/storage";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
// O usuário PRINCIPAL da prova é um Sales Manager (papel r2 do seed) - o mesmo papel de
// marcus.vance@enterprise.com, que é o aprovador configurado da etapa `w1-s2` do fluxo `w1`.
//
// A senha `password123` do seed NÃO vale mais para marcus.vance nesta instalação (o login devolve
// 401; a conta existe, está ACTIVE e sem MFA, mas o hash foi trocado em algum momento e o
// `prisma/seed.ts` só grava passwordHash no CAMINHO DE CRIAÇÃO, nunca no de update - reexecutar o
// seed não a restauraria). Trocar a senha de uma conta que já existe na instalação só para a prova
// passar seria mexer em conta alheia; a prova cria um usuário DEDICADO com o MESMO PAPEL, e-mail
// que nunca resolve, e é ele que aprova a etapa do Sales Manager e libera a versão final. O que se
// exercita é idêntico: mesmas permissões, mesma etapa do fluxo, login real.
const PAPEL_PRINCIPAL = process.env.PROVA_PAPEL_PRINCIPAL || "r2";
const EMAIL_PRINCIPAL = "prova-presales-f8-gerente@local.invalid";
const PREFIXO_APROVADOR = "prova-presales-f8-aprovador-";

async function garantirUsuario(email: string, papel: string, nome: string, senha: string) {
  const existente = await prisma.user.findFirst({ where: { email } });
  if (existente) {
    return prisma.user.update({
      where: { id: existente.id },
      data: { roleId: papel, passwordHash: hashPassword(senha), status: "ACTIVE", mustChangePassword: false, mfaEnabled: false },
    });
  }
  return prisma.user.create({
    data: { id: randomId("usr"), tenantId: TENANT, name: nome, email, passwordHash: hashPassword(senha), roleId: papel, status: "ACTIVE" },
  });
}

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    passou++;
    linhas.push(`  OK    ${rotulo} — ${detalhe}`);
  } else {
    falhou++;
    linhas.push(`  FALHA ${rotulo} — ${detalhe}`);
  }
}

async function entrar(email: string, senha: string): Promise<Record<string, string> | null> {
  const resp = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  const corpo: any = await resp.json().catch(() => ({}));
  const token = corpo?.token || corpo?.session_token || corpo?.data?.token;
  if (!token) {
    linhas.push(`  (login de ${email} falhou: status=${resp.status})`);
    return null;
  }
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const TABELA = [
  {
    item_id: "f8-item-1",
    product_or_service: "Switch 24 portas PoE",
    specification: "24 portas, PoE+, gerenciável",
    quantity: 10,
    unit: "un",
    unit_price: 5000,
    total_price: 50000,
    currency: "BRL",
    is_optional: false,
    discount: 0,
  },
];

async function gerarProposta(sessao: Record<string, string>, projectId: string, templateId: string, marcador: string) {
  const antes = await prisma.proposal.findMany({ where: { projectId }, select: { id: true } });
  const idsAntes = new Set(antes.map((p) => p.id));

  const resp = await fetch(`${BASE}/api/projects/${projectId}/proposals/commercial`, {
    method: "POST",
    headers: sessao,
    body: JSON.stringify({
      template_id: templateId,
      language: "Portuguese",
      manual_pricing_table: TABELA,
      payment_terms: `30/60/90 dias (${marcador})`,
      delivery_terms: "45 dias após o pedido",
      proposal_validity: "2026-12-31",
    }),
  });
  if (resp.status !== 202) {
    linhas.push(`  (geração recusada: status=${resp.status} corpo=${(await resp.text()).slice(0, 300)})`);
    return null;
  }
  for (let i = 0; i < 60; i++) {
    const nova = await prisma.proposal.findFirst({
      where: { projectId, id: { notIn: [...idsAntes] } },
      orderBy: { generatedAt: "desc" },
    });
    if (nova) return nova;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function sessaoDeAprovador(etapa: { approverType: string; approverRoleId: string | null; approverUserId: string | null }, senha: string) {
  // Cada etapa obrigatória do fluxo exige um PAPEL diferente, e a rota confere isso de verdade
  // (403 para qualquer outro). Cada uma ganha um aprovador DEDICADO com o papel exigido e e-mail
  // que nunca resolve, exatamente como scripts/cdc16-f4-provar-proposta.ts já faz — a etapa do
  // Sales Manager (r2) cai no usuário principal da prova, que é justamente desse papel.
  const papel = etapa.approverRoleId;
  if (etapa.approverType !== "role" || !papel) return null;

  const email = papel === PAPEL_PRINCIPAL ? EMAIL_PRINCIPAL : `${PREFIXO_APROVADOR}${papel}@local.invalid`;
  const nome = papel === PAPEL_PRINCIPAL ? "Gerente da prova F8 (Sales Manager)" : `Aprovador da prova F8 (${papel})`;
  const aprovador = await garantirUsuario(email, papel, nome, senha);
  const s = await entrar(email, senha);
  return s ? { sessao: s, userId: aprovador.id, roleId: papel, nome: aprovador.name, principal: papel === PAPEL_PRINCIPAL } : null;
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const settings = await dbStore.getSettings();
    const adapter = createStorageAdapter(settings);

    // Confere que o papel escolhido é MESMO o do marcus.vance do seed - se um dia ele mudar de
    // papel, a prova deixa de exercitar a etapa que pretendia e precisa saber disso alto.
    const marcus = await prisma.user.findFirst({ where: { email: "marcus.vance@enterprise.com" } });
    checar(
      "o papel do usuário principal da prova é o mesmo de marcus.vance@enterprise.com (aprovador de w1-s2)",
      marcus?.roleId === PAPEL_PRINCIPAL,
      `marcus.role=${marcus?.roleId} prova.role=${PAPEL_PRINCIPAL}`
    );
    const gerente = await garantirUsuario(EMAIL_PRINCIPAL, PAPEL_PRINCIPAL, "Gerente da prova F8 (Sales Manager)", senha);

    linhas.push("== 0. Cenário dedicado: projeto + demanda (a demanda é o endereço do outbox do CRM) ==");
    // O dono é sempre o usuário principal da prova: sem `project:read_all` (que o papel Sales
    // Manager não tem), a visibilidade do projeto sai da posse dele - um projeto de outro dono faz
    // a própria rota de geração responder 404, e não 403.
    const existenteProjeto = await prisma.project.findUnique({ where: { id: "prova-f8-projeto" } });
    const projeto = existenteProjeto
      ? await prisma.project.update({ where: { id: existenteProjeto.id }, data: { ownerUserId: gerente.id } })
      : (await prisma.project.create({
        data: {
          id: "prova-f8-projeto",
          tenantId: TENANT,
          name: "Prova PreSales F8",
          customerName: "Cliente da Prova F8",
          opportunityName: "OPP-F8",
          vertical: "Infrastructure",
          description: "Projeto dedicado à prova de execução real da PreSales F8.",
          status: "waiting_internal",
          deadline: new Date("2026-12-01T00:00:00.000Z"),
          proposalValidityDate: new Date("2026-12-31T00:00:00.000Z"),
          ownerUserId: gerente.id,
          outputLanguage: "Portuguese",
          proposalLanguage: "Portuguese",
          aiOrientationMode: "Vendor-neutral",
          aiOrientationText: "",
          selectedApprovalWorkflowId: "w1",
        },
      }));

    const demanda =
      (await prisma.demand.findFirst({ where: { tenantId: TENANT, projectId: projeto.id } })) ??
      (await prisma.demand.create({
        data: {
          id: randomId("dem"),
          tenantId: TENANT,
          demandRef: `prova-f8-${Date.now()}`,
          crmCompanyId: "crm-comp-f8",
          companyName: "Cliente da Prova F8",
          crmOpportunityId: "crm-opp-f8",
          opportunityName: "OPP-F8",
          title: "Prova PreSales F8",
          vertical: "Infrastructure",
          description: "demanda dedicada à prova F8",
          deadline: new Date("2026-12-01T00:00:00.000Z"),
          proposalValidityDate: new Date("2026-12-31T00:00:00.000Z"),
          aiOrientationMode: "Vendor-neutral",
          sentAt: new Date(),
          pairCrmInstallationId: "prova-f8",
          projectId: projeto.id,
          status: "in_analysis",
        },
      }));
    checar("projeto e demanda dedicados existem", !!projeto && !!demanda, `projeto=${projeto.id} demanda=${demanda.id}`);

    const template = await prisma.proposalTemplate.findFirst({ where: { tenantId: TENANT, active: true, templateType: "commercial" } });
    if (!template) throw new Error("nenhum template ATIVO do tipo 'commercial' no tenant");

    const sessaoGerente = await entrar(EMAIL_PRINCIPAL, senha);
    checar(`login real do Sales Manager da prova (${EMAIL_PRINCIPAL})`, !!sessaoGerente, `base=${BASE} papel=${PAPEL_PRINCIPAL}`);
    if (!sessaoGerente) return;

    const fluxo = await prisma.approvalWorkflow.findUnique({ where: { id: "w1" }, include: { stages: { orderBy: { order: "asc" } } } });
    const obrigatorias = (fluxo?.stages ?? []).filter((e) => e.mandatory !== false);
    checar("o fluxo w1 tem etapas obrigatórias reais", obrigatorias.length > 0, `etapas=${obrigatorias.map((e) => e.name).join(" → ")}`);
    if (obrigatorias.length === 0) return;

    // ═══════════════════════════════ FLUXO A: liberar a versão final ═══════════════════════════
    linhas.push("");
    linhas.push("== A. Gerar -> submeter -> aprovar -> LIBERAR, cada passo pela rota ==");
    const propA = await gerarProposta(sessaoGerente, projeto.id, template.id, "fluxo A");
    checar("a proposta do fluxo A foi gerada com DOCX e PDF em disco", !!propA?.docxFilePath && !!propA?.pdfFilePath, `id=${propA?.id}`);
    if (!propA) return;

    const submeterA = await fetch(`${BASE}/api/proposals/${propA.id}/approval/submit`, { method: "POST", headers: sessaoGerente });
    checar("submeter para aprovação é aceito", submeterA.status === 200, `status=${submeterA.status}`);

    let principalDecidiu = false;
    for (const etapa of obrigatorias) {
      const quem = await sessaoDeAprovador(etapa, senha);
      if (!quem) {
        checar(`o aprovador da etapa "${etapa.name}" consegue entrar`, false, "login falhou");
        continue;
      }
      const decisao = await fetch(`${BASE}/api/proposals/${propA.id}/approval/decision`, {
        method: "POST",
        headers: { ...quem.sessao, "x-user-id": quem.userId, "x-role-id": quem.roleId },
        body: JSON.stringify({ decision: "approved", comments: `Etapa ${etapa.name} conferida na prova F8.`, stage_id: etapa.id }),
      });
      const ok = decisao.status === 200;
      if (ok && quem.principal) principalDecidiu = true;
      checar(
        `etapa "${etapa.name}" aprovada por quem ela exige (${quem.nome})`,
        ok,
        `status=${decisao.status}${ok ? "" : ` corpo=${(await decisao.text()).slice(0, 200)}`}`
      );
    }
    checar("a etapa do Sales Manager (a de marcus.vance no seed) foi decidida por um usuário DESSE papel, com login real", principalDecidiu, `user=${gerente.id} role=${PAPEL_PRINCIPAL}`);

    const aprovadaA = await prisma.proposal.findUnique({ where: { id: propA.id } });
    checar("a proposta chegou a `approved` depois das etapas obrigatórias", aprovadaA?.status === "approved", `status=${aprovadaA?.status}`);

    const liberacao = await fetch(`${BASE}/api/proposals/${propA.id}/release`, { method: "POST", headers: sessaoGerente });
    const corpoLiberacao = await liberacao.text();
    checar("POST /proposals/:id/release foi CHAMADO e aceito (200)", liberacao.status === 200, `status=${liberacao.status} corpo=${corpoLiberacao.slice(0, 160)}`);

    const liberadaA = await prisma.proposal.findUnique({ where: { id: propA.id } });
    checar("o status final no banco é `released`", liberadaA?.status === "released", `status=${liberadaA?.status}`);

    // `empurrarProposta` é disparado sem await dentro do handler — esperar a LINHA aparecer é o
    // único jeito honesto de medir isso sem correr na frente do próprio produto.
    let saidaSent = null as any;
    for (let i = 0; i < 40; i++) {
      saidaSent = await prisma.demandOutboundEvent.findFirst({
        where: { demandId: demanda.id, kind: "proposal", idempotencyKey: `prop-${propA.id}-v${propA.version}-sent` },
      });
      if (saidaSent) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    checar(
      "empurrarProposta DISPAROU na liberação — linha na fila do CRM com a chave do estado `sent`",
      !!saidaSent,
      `chave=prop-${propA.id}-v${propA.version}-sent linha=${saidaSent?.id ?? "(nenhuma)"} entrega=${saidaSent?.status ?? "-"}`
    );
    const todasSaidasA = await prisma.demandOutboundEvent.findMany({
      where: { demandId: demanda.id, kind: "proposal", idempotencyKey: { startsWith: `prop-${propA.id}-` } },
      select: { idempotencyKey: true },
    });
    checar(
      "cada estado da proposta A virou uma mensagem própria na fila",
      todasSaidasA.length >= 4,
      `chaves=${todasSaidasA.map((s) => s.idempotencyKey.replace(`prop-${propA.id}-`, "")).join(", ")}`
    );

    // O preview da tela usa exatamente esta rota e exatamente esta biblioteca (mammoth) — olhar só
    // o status HTTP provaria que o arquivo existe, não que o DOCUMENTO liberado é o esperado.
    const exportado = await fetch(`${BASE}/api/proposals/${propA.id}/export/docx`, { headers: sessaoGerente });
    const buffer = Buffer.from(await exportado.arrayBuffer());
    const renderizado = await mammoth.convertToHtml({ buffer });
    const texto = renderizado.value.replace(/<[^>]+>/g, " ");
    checar(
      "o DOCX liberado RENDERIZA (mesma rota e mesma mammoth do preview da tela) com o conteúdo desta proposta",
      exportado.status === 200 && texto.includes("Cliente da Prova F8") && texto.includes("fluxo A"),
      `bytes=${buffer.length} tem_cliente=${texto.includes("Cliente da Prova F8")} tem_marcador=${texto.includes("fluxo A")}`
    );

    // ═════════════════ FLUXO B: rejeitar com motivo, reabrir, e não perder a v1 ═════════════════
    linhas.push("");
    linhas.push("== B. Rejeição EXIGE motivo ==");
    const propB = await gerarProposta(sessaoGerente, projeto.id, template.id, "fluxo B");
    checar("a proposta do fluxo B foi gerada", !!propB, `id=${propB?.id}`);
    if (!propB) return;

    const submeterB = await fetch(`${BASE}/api/proposals/${propB.id}/approval/submit`, { method: "POST", headers: sessaoGerente });
    checar("proposta B submetida", submeterB.status === 200, `status=${submeterB.status}`);

    const etapaDoGerente = obrigatorias.find((e) => e.approverType === "role" && e.approverRoleId === PAPEL_PRINCIPAL);
    if (!etapaDoGerente) {
      checar("existe uma etapa cujo aprovador é o papel do Sales Manager", false, `role=${PAPEL_PRINCIPAL}`);
      return;
    }
    const cabecalhosGerente = { ...sessaoGerente, "x-user-id": gerente.id, "x-role-id": PAPEL_PRINCIPAL };

    for (const [rotulo, corpo] of [
      ["sem o campo comments", { decision: "rejected", stage_id: etapaDoGerente.id }],
      ["com comments vazio", { decision: "rejected", comments: "", stage_id: etapaDoGerente.id }],
      ["com comments só de espaços", { decision: "rejected", comments: "   \n\t ", stage_id: etapaDoGerente.id }],
    ] as const) {
      const r = await fetch(`${BASE}/api/proposals/${propB.id}/approval/decision`, {
        method: "POST",
        headers: cabecalhosGerente,
        body: JSON.stringify(corpo),
      });
      const t = await r.text();
      checar(`o servidor RECUSA a rejeição ${rotulo} (400)`, r.status === 400 && t.includes("rejection requires a reason"), `status=${r.status} corpo=${t.slice(0, 140)}`);
    }

    const naoRejeitada = await prisma.proposal.findUnique({ where: { id: propB.id } });
    checar("e a proposta continua `submitted` — nenhuma recusa vazia passou", naoRejeitada?.status === "submitted", `status=${naoRejeitada?.status}`);
    const decisoesVazias = await prisma.approvalDecision.count({ where: { proposalId: propB.id } });
    checar("nenhuma decisão foi gravada pelas tentativas vazias", decisoesVazias === 0, `decisões=${decisoesVazias}`);

    const MOTIVO = "Margem abaixo da alçada: revisar desconto do item de switch e o prazo de entrega.";
    const rejeicao = await fetch(`${BASE}/api/proposals/${propB.id}/approval/decision`, {
      method: "POST",
      headers: cabecalhosGerente,
      body: JSON.stringify({ decision: "rejected", comments: `  ${MOTIVO}  `, stage_id: etapaDoGerente.id }),
    });
    checar("com motivo real, a rejeição é aceita (200)", rejeicao.status === 200, `status=${rejeicao.status}`);
    const decisaoGravada = await prisma.approvalDecision.findFirst({ where: { proposalId: propB.id, stageId: etapaDoGerente.id } });
    checar("o motivo digitado ficou GRAVADO na decisão (e sem as bordas em branco)", decisaoGravada?.comments === MOTIVO, `comments=${JSON.stringify(decisaoGravada?.comments)?.slice(0, 120)}`);

    const v1 = await prisma.proposal.findUnique({ where: { id: propB.id } });
    checar("a proposta ficou `rejected`", v1?.status === "rejected", `status=${v1?.status}`);
    if (!v1) return;

    linhas.push("");
    linhas.push("== C. Reabrir a rejeitada como versão nova, sem destruir a anterior ==");
    const docxV1 = v1.docxFilePath;
    const pdfV1 = v1.pdfFilePath;
    checar("os arquivos da v1 existem no storage ANTES da reabertura", (await adapter.exists(docxV1)) && (await adapter.exists(pdfV1)), `docx=${docxV1}`);

    const reabrir = await fetch(`${BASE}/api/proposals/${v1.id}/reopen`, { method: "POST", headers: sessaoGerente });
    const corpoReabrir: any = await reabrir.json().catch(() => ({}));
    checar("POST /proposals/:id/reopen aceito (201)", reabrir.status === 201, `status=${reabrir.status} corpo=${JSON.stringify(corpoReabrir).slice(0, 200)}`);
    const v2Id: string | undefined = corpoReabrir?.proposal_id;
    if (!v2Id) return;

    const v2 = await prisma.proposal.findUnique({ where: { id: v2Id } });
    checar("a v2 nasce com version = v1.version + 1", v2?.version === v1.version + 1, `v1=${v1.version} v2=${v2?.version}`);
    checar("a v2 compartilha o proposal_group_id da v1", v2?.proposalGroupId === v1.proposalGroupId, `grupo=${v2?.proposalGroupId}`);
    checar("a v2 aponta para a v1 por previous_version_id", v2?.previousVersionId === v1.id, `previous=${v2?.previousVersionId}`);
    checar("a v2 nasce em `draft` (é o que faz o PUT já existente funcionar nela)", v2?.status === "draft", `status=${v2?.status}`);
    checar("a v2 nasce SEM parecer de IA herdado", v2?.latestOpinionRunId === null, `latest_opinion_run_id=${v2?.latestOpinionRunId}`);
    checar("a v2 tem arquivos PRÓPRIOS, diferentes dos da v1", v2?.docxFilePath !== docxV1 && v2?.pdfFilePath !== pdfV1, `docx_v2=${v2?.docxFilePath}`);
    checar("a v2 copiou o conteúdo comercial da v1", v2?.paymentTerms === v1.paymentTerms && v2?.deliveryTerms === v1.deliveryTerms, `pagamento=${v2?.paymentTerms}`);
    checar("os arquivos da v2 existem de verdade no storage", !!v2 && (await adapter.exists(v2.docxFilePath)) && (await adapter.exists(v2.pdfFilePath)), `docx=${v2?.docxFilePath}`);

    const v1DepoisDaReabertura = await prisma.proposal.findUnique({ where: { id: v1.id } });
    checar(
      "a v1 NÃO foi tocada em nenhum campo pela reabertura",
      v1DepoisDaReabertura?.status === "rejected" &&
        v1DepoisDaReabertura?.docxFilePath === docxV1 &&
        v1DepoisDaReabertura?.pdfFilePath === pdfV1 &&
        v1DepoisDaReabertura?.version === v1.version &&
        v1DepoisDaReabertura?.latestOpinionRunId === v1.latestOpinionRunId,
      `status=${v1DepoisDaReabertura?.status} version=${v1DepoisDaReabertura?.version}`
    );
    checar("e os arquivos da v1 continuam em disco DEPOIS da v2 ser criada", (await adapter.exists(docxV1)) && (await adapter.exists(pdfV1)), `docx=${docxV1}`);

    let saidaV2 = null as any;
    for (let i = 0; i < 20; i++) {
      saidaV2 = await prisma.demandOutboundEvent.findFirst({
        where: { demandId: demanda.id, kind: "proposal", idempotencyKey: `prop-${v2Id}-v${v2?.version}-draft` },
      });
      if (saidaV2) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    checar("a v2 também foi anunciada ao CRM (chave própria de idempotência)", !!saidaV2, `chave=prop-${v2Id}-v${v2?.version}-draft`);

    linhas.push("");
    linhas.push("== D. Editar a v2 pelo PUT normal não pode destruir os arquivos da v1 ==");
    const docxV2Antes = v2!.docxFilePath;
    const pdfV2Antes = v2!.pdfFilePath;
    const edicao = await fetch(`${BASE}/api/proposals/${v2Id}`, {
      method: "PUT",
      headers: sessaoGerente,
      body: JSON.stringify({ payment_terms: "À vista, corrigido na v2 depois da rejeição." }),
    });
    checar("PUT num campo estruturado da v2 é aceito (ela nasce draft)", edicao.status === 200, `status=${edicao.status} corpo=${(await edicao.text()).slice(0, 160)}`);

    const v2Depois = await prisma.proposal.findUnique({ where: { id: v2Id } });
    checar("o PUT trocou os arquivos DA V2", v2Depois?.docxFilePath !== docxV2Antes, `antes=${docxV2Antes} depois=${v2Depois?.docxFilePath}`);
    checar("os arquivos ANTIGOS da v2 foram apagados (comportamento esperado do PUT)", !(await adapter.exists(docxV2Antes)) && !(await adapter.exists(pdfV2Antes)), `antigo=${docxV2Antes}`);
    checar(
      "e os arquivos da V1 SOBREVIVERAM à edição da v2 — o ponto inteiro desta fase",
      (await adapter.exists(docxV1)) && (await adapter.exists(pdfV1)),
      `docx_v1=${docxV1} pdf_v1=${pdfV1}`
    );
    const v1Final = await prisma.proposal.findUnique({ where: { id: v1.id } });
    checar("e a v1 continua `rejected` com os mesmos caminhos", v1Final?.status === "rejected" && v1Final?.docxFilePath === docxV1, `status=${v1Final?.status}`);

    linhas.push("");
    linhas.push("== E. Guardas da reabertura ==");
    const reabrirDeNovo = await fetch(`${BASE}/api/proposals/${v1.id}/reopen`, { method: "POST", headers: sessaoGerente });
    const corpoDeNovo: any = await reabrirDeNovo.json().catch(() => ({}));
    checar(
      "reabrir a MESMA v1 duas vezes dá 409 e devolve a versão que já existe (o elo é @unique no banco)",
      reabrirDeNovo.status === 409 && corpoDeNovo?.proposal_id === v2Id,
      `status=${reabrirDeNovo.status} aponta=${corpoDeNovo?.proposal_id}`
    );

    const reabrirDraft = await fetch(`${BASE}/api/proposals/${v2Id}/reopen`, { method: "POST", headers: sessaoGerente });
    const corpoDraft = await reabrirDraft.text();
    checar("reabrir uma proposta que NÃO está rejeitada dá 400", reabrirDraft.status === 400 && corpoDraft.includes("Only rejected proposals"), `status=${reabrirDraft.status}`);

    const reabrirInexistente = await fetch(`${BASE}/api/proposals/prop_que_nao_existe/reopen`, { method: "POST", headers: sessaoGerente });
    checar("reabrir proposta inexistente dá 404", reabrirInexistente.status === 404, `status=${reabrirInexistente.status}`);

    console.log(`\nprojeto=${projeto.id} A=${propA.id} v1=${v1.id} v2=${v2Id}`);
  });
}

main()
  .then(() => {
    console.log(linhas.join("\n"));
    console.log(`\n${passou} OK, ${falhou} FALHA`);
    process.exit(falhou > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.log(linhas.join("\n"));
    console.error("\nERRO:", err);
    process.exit(1);
  });
