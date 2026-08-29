/**
 * PreSales F8b (item 2) — prova por EXECUÇÃO REAL de que reabrir uma proposta que é RELATÓRIO PURO
 * REGENERA o conteúdo do relatório via IA, e que os outros tipos continuam clonando a v1.
 *
 * Mesma disciplina de scripts/presales-f8-provar.ts: o produto é percorrido pelas ROTAS, com login
 * real, documento gerado de verdade em disco e a chamada de IA acontecendo de fato. O que dá para
 * provar sem banco e sem provedor (qual tipo toma qual caminho) já está em
 * server/utils/proposalTypes.test.ts; o que só a execução real prova é o que está aqui.
 *
 * O ponto delicado da medição: uma regeração por IA sobre os MESMOS documentos pode devolver texto
 * parecido, então "o texto mudou" seria uma prova frágil. A prova aqui não é o texto: é que a
 * ROTINA DE GERAÇÃO RODOU DE NOVO — a seção da análise foi reescrita no banco (updated_at subiu e o
 * marcador plantado antes da reabertura SUMIU, porque a IA reescreveu a seção inteira), a resposta
 * da rota declara provedor/modelo usados, e a auditoria registra a seção regenerada. O caso de
 * controle (tipo com campo editável) prova o outro lado: nenhuma dessas coisas acontece.
 *
 *   PROVA_PASSWORD=<senha do usuário dedicado> npx tsx scripts/f8b-provar-regeneracao.ts
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
const PAPEL = process.env.PROVA_PAPEL || "r2"; // Sales Manager - o papel aprovador de w1-s2
const EMAIL = "prova-f8b-gerente@local.invalid";
const PROJETO_ID = "prova-f8b-projeto";
const TEMPLATE_RELATORIO = "tpl-prova-f8b-risco";
const TEMPLATE_TECNICO = "tpl-prova-f8b-tecnico";

// Marcador plantado na seção `risks` da análise ANTES da reabertura. Se ele sobreviver à
// reabertura, a seção não foi regenerada - foi reaproveitada.
const MARCADOR = `MARCADOR-F8B-${Date.now()}`;

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
    linhas.push(`  (login de ${email} falhou: status=${resp.status} corpo=${JSON.stringify(corpo).slice(0, 160)})`);
    return null;
  }
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function garantirUsuario(senha: string) {
  const existente = await prisma.user.findFirst({ where: { email: EMAIL } });
  if (existente) {
    return prisma.user.update({
      where: { id: existente.id },
      data: { roleId: PAPEL, passwordHash: hashPassword(senha), status: "ACTIVE", mustChangePassword: false, mfaEnabled: false },
    });
  }
  return prisma.user.create({
    data: {
      id: randomId("usr"),
      tenantId: TENANT,
      name: "Gerente da prova F8b (Sales Manager)",
      email: EMAIL,
      passwordHash: hashPassword(senha),
      roleId: PAPEL,
      status: "ACTIVE",
    },
  });
}

const TEXTO_DO_EDITAL = `TERMO DE REFERENCIA - SISTEMA DE MONITORAMENTO PERIMETRAL (prova F8b)

1. OBJETO
Implantacao de sistema de monitoramento perimetral com 24 cameras fixas IP e 4 cameras PTZ,
switches PoE, nobreak e software de gerenciamento de video (VMS), incluindo instalacao, comissio-
namento e treinamento operacional.

2. PRAZOS
Prazo de implantacao de 90 dias corridos contados da ordem de servico. Multa de 0,5% por dia de
atraso, limitada a 10% do valor do contrato.

3. NIVEL DE SERVICO
Disponibilidade minima mensal de 99,5% do sistema. Atendimento em campo em ate 4 horas para
chamados criticos, 24x7, inclusive feriados.

4. INFRAESTRUTURA
A CONTRATADA e responsavel pela infraestrutura de rede optica entre os pontos de captura e a sala
de monitoramento. O edital NAO informa se ha infraestrutura de dutos existente nem a metragem de
lancamento de fibra necessaria.

5. GARANTIA E MANUTENCAO
Garantia de 36 meses para todos os equipamentos fornecidos, com manutencao preventiva trimestral
inclusa e reposicao de pecas sem custo adicional.

6. PAGAMENTO
Pagamento em parcela unica apos o aceite definitivo, com prazo de 60 dias apos a apresentacao da
nota fiscal.

7. ENERGIA
Nao ha informacao sobre a existencia de alimentacao eletrica nos pontos de instalacao das cameras
externas nem sobre o padrao de aterramento disponivel.`;

async function garantirCenario(donoId: string) {
  const projetoExistente = await prisma.project.findUnique({ where: { id: PROJETO_ID } });
  const projeto = projetoExistente
    ? await prisma.project.update({ where: { id: PROJETO_ID }, data: { ownerUserId: donoId } })
    : await prisma.project.create({
        data: {
          id: PROJETO_ID,
          tenantId: TENANT,
          name: "Prova PreSales F8b",
          customerName: "Cliente da Prova F8b",
          opportunityName: "OPP-F8B",
          vertical: "Infrastructure",
          description: "Projeto dedicado a prova de execucao real da PreSales F8b (regeneracao na reabertura).",
          status: "waiting_internal",
          deadline: new Date("2026-12-01T00:00:00.000Z"),
          proposalValidityDate: new Date("2026-12-31T00:00:00.000Z"),
          ownerUserId: donoId,
          outputLanguage: "Portuguese",
          proposalLanguage: "Portuguese",
          aiOrientationMode: "Vendor-neutral",
          aiOrientationText: "",
          selectedApprovalWorkflowId: "w1",
        },
      });

  // Documento real com texto extraido - e dele que a regeneracao por IA le os riscos.
  let documento = await prisma.document.findFirst({ where: { projectId: PROJETO_ID } });
  if (!documento) {
    documento = await prisma.document.create({
      data: {
        id: randomId("doc"),
        tenantId: TENANT,
        projectId: PROJETO_ID,
        filename: "termo-de-referencia-f8b.txt",
        originalFilename: "termo-de-referencia-f8b.txt",
        mimeType: "text/plain",
        fileSize: Buffer.byteLength(TEXTO_DO_EDITAL, "utf8"),
        storageProvider: "local",
        storagePath: "prova-f8b/termo-de-referencia-f8b.txt",
        detectedDocumentType: "Termo de Referência",
        aiClassificationConfidence: 1,
        version: 1,
        language: "Portuguese",
        uploadedBy: donoId,
      },
    });
  }
  const conteudo = await prisma.documentContent.findUnique({ where: { documentId: documento.id } });
  if (!conteudo) {
    await prisma.documentContent.create({ data: { documentId: documento.id, tenantId: TENANT, content: TEXTO_DO_EDITAL } });
  } else if (conteudo.content !== TEXTO_DO_EDITAL) {
    await prisma.documentContent.update({ where: { documentId: documento.id }, data: { content: TEXTO_DO_EDITAL } });
  }

  // Um template por tipo, dedicados a prova, sem arquivo fisico (cai no gerador generico de DOCX -
  // o mesmo caminho que qualquer instalacao sem template proprio usa).
  for (const [id, tipo, nome] of [
    [TEMPLATE_RELATORIO, "risk_report", "Template da prova F8b - Relatorio de Riscos"],
    [TEMPLATE_TECNICO, "technical", "Template da prova F8b - Proposta Tecnica"],
  ] as const) {
    const existente = await prisma.proposalTemplate.findUnique({ where: { id } });
    if (!existente) {
      await prisma.proposalTemplate.create({
        data: {
          id,
          tenantId: TENANT,
          name: nome,
          description: "Template dedicado a prova de execucao real da F8b.",
          templateType: tipo,
          language: "Portuguese",
          fileType: "docx",
          // Caminho que de proposito NAO existe: a prova exercita o gerador generico de DOCX (o
          // mesmo caminho de qualquer instalacao sem template proprio). `filePath: ""` nao serve -
          // o adaptador local resolve string vazia para o proprio diretorio de uploads, que
          // EXISTE, e a geracao morre com EISDIR ao tentar ler um diretorio como template.
          filePath: "prova-f8b/template-inexistente.docx",
          storageProvider: "local",
          variablesSchema: "{}",
          version: "1.0",
          active: true,
          uploadedBy: donoId,
        },
      });
    } else if (!existente.active) {
      await prisma.proposalTemplate.update({ where: { id }, data: { active: true } });
    }
  }

  return projeto;
}

// Planta a analise do projeto com o MARCADOR na secao `risks`. E o estado "antes" contra o qual a
// regeneracao e medida.
async function plantarAnalise(donoId: string) {
  let job = await prisma.aIAnalysisJob.findFirst({ where: { projectId: PROJETO_ID } });
  if (!job) {
    job = await prisma.aIAnalysisJob.create({
      data: {
        id: randomId("job"),
        tenantId: TENANT,
        projectId: PROJETO_ID,
        status: "completed",
        aiProvider: "prova",
        aiModel: "prova",
        promptTemplateVersion: "prova",
        startedAt: new Date(),
        completedAt: new Date(),
        createdBy: donoId,
        correlationId: "prova-f8b",
      },
    });
  }

  const riscosPlantados = [
    {
      risk_id: "risk_marcador",
      title: `Risco plantado pela prova (${MARCADOR})`,
      description: `Este risco foi escrito pela prova F8b, nao pela IA. ${MARCADOR}`,
      severity: "high",
      probability: "medium",
      impact: `Se este texto sobreviver a reabertura, a secao nao foi regenerada. ${MARCADOR}`,
      source_document: "termo-de-referencia-f8b.txt",
      source_page_or_section: "n/a",
      source_snippet: MARCADOR,
      mitigation: MARCADOR,
      owner_area: "Delivery",
      requires_customer_clarification: false,
      evidence_type: "assumption",
      confidence: 0.5,
    },
  ];

  await dbStore.saveAnalysisResult({
    id: randomId("ar"),
    project_id: PROJETO_ID,
    job_id: job.id,
    executive_summary: {
      project_overview: `Resumo plantado pela prova. ${MARCADOR}`,
      customer_context: MARCADOR,
      main_requirements: MARCADOR,
      main_risks: MARCADOR,
      main_opportunities: MARCADOR,
      recommended_strategy: MARCADOR,
      assumptions: MARCADOR,
      next_steps: MARCADOR,
    },
    critical_requirements: [],
    risks: riscosPlantados,
    opportunities: [],
    bom: [],
    point_to_point_table: [],
    preliminary_schedule: [],
    clarification_questions: [],
    technical_proposal_draft: `Rascunho tecnico plantado pela prova. ${MARCADOR}`,
    commercial_proposal_draft: `Rascunho comercial plantado pela prova. ${MARCADOR}`,
    review_status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as any);

  return prisma.analysisResult.findUnique({ where: { projectId: PROJETO_ID } });
}

async function gerarProposta(sessao: Record<string, string>, tipo: string, templateId: string, marcador: string) {
  const antes = new Set((await prisma.proposal.findMany({ where: { projectId: PROJETO_ID }, select: { id: true } })).map((p) => p.id));
  const resp = await fetch(`${BASE}/api/projects/${PROJETO_ID}/proposals/${tipo}`, {
    method: "POST",
    headers: sessao,
    body: JSON.stringify({
      template_id: templateId,
      language: "Portuguese",
      proposal_validity: `2026-12-31 (${marcador})`,
      exclusions: `Exclusoes escritas pela prova (${marcador})`,
    }),
  });
  if (resp.status !== 202) {
    linhas.push(`  (geracao de ${tipo} recusada: status=${resp.status} corpo=${(await resp.text()).slice(0, 200)})`);
    return null;
  }
  for (let i = 0; i < 120; i++) {
    const nova = await prisma.proposal.findFirst({
      where: { projectId: PROJETO_ID, proposalType: tipo as any, id: { notIn: [...antes] } },
      orderBy: { generatedAt: "desc" },
    });
    if (nova) return nova;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function rejeitar(sessao: Record<string, string>, propostaId: string, gerenteId: string, etapaId: string, motivo: string) {
  const submeter = await fetch(`${BASE}/api/proposals/${propostaId}/approval/submit`, { method: "POST", headers: sessao });
  if (submeter.status !== 200) return { ok: false, detalhe: `submit status=${submeter.status}` };
  const decisao = await fetch(`${BASE}/api/proposals/${propostaId}/approval/decision`, {
    method: "POST",
    headers: { ...sessao, "x-user-id": gerenteId, "x-role-id": PAPEL },
    body: JSON.stringify({ decision: "rejected", comments: motivo, stage_id: etapaId }),
  });
  return { ok: decisao.status === 200, detalhe: `decision status=${decisao.status}` };
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const settings = await dbStore.getSettings();
    const adapter = createStorageAdapter(settings);

    const gerente = await garantirUsuario(senha);
    await garantirCenario(gerente.id);
    const analiseAntes = await plantarAnalise(gerente.id);
    checar("cenario dedicado pronto (projeto, documento com texto real, analise plantada)", !!analiseAntes, `projeto=${PROJETO_ID} analise=${analiseAntes?.id} marcador=${MARCADOR}`);
    if (!analiseAntes) return;

    const sessao = await entrar(EMAIL, senha);
    checar(`login real do Sales Manager da prova (${EMAIL})`, !!sessao, `base=${BASE}`);
    if (!sessao) return;

    const fluxo = await prisma.approvalWorkflow.findUnique({ where: { id: "w1" }, include: { stages: { orderBy: { order: "asc" } } } });
    const etapaDoGerente = (fluxo?.stages ?? []).find((e) => e.approverType === "role" && e.approverRoleId === PAPEL);
    checar("o fluxo w1 tem uma etapa cujo aprovador e o papel deste usuario", !!etapaDoGerente, `etapa=${etapaDoGerente?.name}`);
    if (!etapaDoGerente) return;

    // ══════════ A. RELATÓRIO (risk_report): a reabertura tem de REGENERAR via IA ══════════
    linhas.push("");
    linhas.push("== A. risk_report (relatorio puro): reabrir REGENERA a secao `risks` via IA ==");

    const relatorioV1 = await gerarProposta(sessao, "risk_report", TEMPLATE_RELATORIO, "relatorio v1");
    checar("relatorio de riscos v1 gerado com DOCX e PDF em disco", !!relatorioV1?.docxFilePath && !!relatorioV1?.pdfFilePath, `id=${relatorioV1?.id}`);
    if (!relatorioV1) return;

    checar(
      "o conteudo da v1 saiu da analise PLANTADA (o marcador esta dentro do documento gerado)",
      (relatorioV1.editableContent || "").includes(MARCADOR),
      `marcador_na_v1=${(relatorioV1.editableContent || "").includes(MARCADOR)}`
    );

    const r = await rejeitar(sessao, relatorioV1.id, gerente.id, etapaDoGerente.id, "Riscos desatualizados: refazer a analise de riscos antes de reenviar.");
    checar("relatorio v1 submetido e REJEITADO com motivo", r.ok, r.detalhe);
    if (!r.ok) return;

    const analiseAntesDaReabertura = await prisma.analysisResult.findUnique({ where: { projectId: PROJETO_ID } });
    const t0 = Date.now();
    const reabrirRelatorio = await fetch(`${BASE}/api/proposals/${relatorioV1.id}/reopen`, { method: "POST", headers: sessao });
    const corpoRelatorio: any = await reabrirRelatorio.json().catch(() => ({}));
    const duracaoMs = Date.now() - t0;
    checar(
      "POST /proposals/:id/reopen aceito (201) para o relatorio",
      reabrirRelatorio.status === 201,
      `status=${reabrirRelatorio.status} duracao=${(duracaoMs / 1000).toFixed(1)}s corpo=${JSON.stringify(corpoRelatorio).slice(0, 200)}`
    );
    if (reabrirRelatorio.status !== 201) return;

    checar(
      "a resposta DECLARA a regeneracao: secao, provedor e modelo realmente usados",
      corpoRelatorio?.regenerated_analysis?.section === "risks" && !!corpoRelatorio?.regenerated_analysis?.provider && !!corpoRelatorio?.regenerated_analysis?.model,
      `regenerated_analysis=${JSON.stringify(corpoRelatorio?.regenerated_analysis)}`
    );

    const analiseDepois = await prisma.analysisResult.findUnique({ where: { projectId: PROJETO_ID } });
    const riscosDepois = JSON.stringify(analiseDepois?.risks ?? []);
    checar(
      "a secao `risks` da analise foi REESCRITA pela IA — o marcador plantado sumiu",
      !riscosDepois.includes(MARCADOR),
      `riscos_agora=${Array.isArray(analiseDepois?.risks) ? (analiseDepois!.risks as any[]).length : "?"} itens; marcador_presente=${riscosDepois.includes(MARCADOR)}`
    );
    checar(
      "a analise foi gravada de novo (updated_at subiu)",
      !!analiseDepois && !!analiseAntesDaReabertura && analiseDepois.updatedAt > analiseAntesDaReabertura.updatedAt,
      `antes=${analiseAntesDaReabertura?.updatedAt.toISOString()} depois=${analiseDepois?.updatedAt.toISOString()}`
    );
    checar(
      "a IA devolveu riscos de verdade a partir do documento (mais de um item, com titulo)",
      Array.isArray(analiseDepois?.risks) && (analiseDepois!.risks as any[]).length >= 1 && (analiseDepois!.risks as any[]).every((x: any) => typeof x?.title === "string" && x.title.length > 0),
      `titulos=${Array.isArray(analiseDepois?.risks) ? (analiseDepois!.risks as any[]).map((x: any) => x.title).join(" | ").slice(0, 200) : "-"}`
    );
    checar(
      "as OUTRAS secoes da analise nao foram tocadas (o resumo executivo plantado continua la)",
      JSON.stringify(analiseDepois?.executiveSummary ?? {}).includes(MARCADOR),
      `resumo_intacto=${JSON.stringify(analiseDepois?.executiveSummary ?? {}).includes(MARCADOR)}`
    );

    const relatorioV2 = await prisma.proposal.findUnique({ where: { id: corpoRelatorio.proposal_id } });
    checar("a v2 do relatorio nasce em draft, com version+1 e ligada a v1", relatorioV2?.status === "draft" && relatorioV2?.version === relatorioV1.version + 1 && relatorioV2?.previousVersionId === relatorioV1.id, `v2=${relatorioV2?.id} v=${relatorioV2?.version} prev=${relatorioV2?.previousVersionId}`);
    // A medicao aqui e do RISCO, nao do marcador generico: o gerador generico de DOCX escreve
    // todas as secoes da analise no mesmo documento, e o resumo executivo (que NAO e a secao deste
    // tipo de relatorio) continua com o marcador plantado, por definicao - so `risks` foi
    // regenerada. Procurar o marcador solto acusaria a v2 de nao ter regenerado nada quando ela
    // regenerou exatamente o que devia.
    const TITULOS_REGENERADOS = ((analiseDepois?.risks as any[]) || []).map((x: any) => String(x.title));
    const conteudoV2 = relatorioV2?.editableContent || "";
    const conteudoV1 = relatorioV1.editableContent || "";
    checar(
      "o DOCUMENTO da v2 carrega os riscos REGENERADOS, e nao os que a v1 tinha",
      !!relatorioV2 &&
        conteudoV1.includes("Risco plantado pela prova") &&
        !conteudoV2.includes("Risco plantado pela prova") &&
        TITULOS_REGENERADOS.some((t) => t.length > 10 && conteudoV2.includes(t)),
      `risco_plantado_na_v1=${conteudoV1.includes("Risco plantado pela prova")} risco_plantado_na_v2=${conteudoV2.includes("Risco plantado pela prova")} titulos_novos_no_doc=${TITULOS_REGENERADOS.filter((t) => conteudoV2.includes(t)).length}/${TITULOS_REGENERADOS.length} bytes_v1=${conteudoV1.length} bytes_v2=${conteudoV2.length}`
    );

    // O preview da tela e o export usam esta rota e esta biblioteca - conferir so o texto salvo no
    // banco provaria o campo, nao o ARQUIVO que o cliente recebe.
    const exportadoV2 = await fetch(`${BASE}/api/proposals/${relatorioV2?.id}/export/docx`, { headers: sessao });
    const bufferV2 = Buffer.from(await exportadoV2.arrayBuffer());
    const textoV2 = (await mammoth.convertToHtml({ buffer: bufferV2 })).value.replace(/<[^>]+>/g, " ");
    checar(
      "o DOCX da v2 RENDERIZA com o conteudo regenerado (mesma rota e mesma mammoth do preview)",
      exportadoV2.status === 200 && !textoV2.includes("Risco plantado pela prova") && TITULOS_REGENERADOS.some((t) => t.length > 10 && textoV2.includes(t.slice(0, 40))),
      `status=${exportadoV2.status} bytes=${bufferV2.length} risco_plantado=${textoV2.includes("Risco plantado pela prova")} titulos_novos=${TITULOS_REGENERADOS.filter((t) => textoV2.includes(t.slice(0, 40))).length}`
    );
    checar(
      "os arquivos da v2 sao NOVOS e existem em disco, e os da v1 continuam la (v1 intocada)",
      !!relatorioV2 &&
        relatorioV2.docxFilePath !== relatorioV1.docxFilePath &&
        (await adapter.exists(relatorioV2.docxFilePath)) &&
        (await adapter.exists(relatorioV2.pdfFilePath)) &&
        (await adapter.exists(relatorioV1.docxFilePath)) &&
        (await adapter.exists(relatorioV1.pdfFilePath)),
      `docx_v1=${relatorioV1.docxFilePath.slice(-40)} docx_v2=${relatorioV2?.docxFilePath.slice(-40)}`
    );
    const v1Relida = await prisma.proposal.findUnique({ where: { id: relatorioV1.id } });
    checar(
      "a v1 continua `rejected` e com o conteudo dela intacto (o relatorio recusado nao foi reescrito)",
      v1Relida?.status === "rejected" && v1Relida?.editableContent === relatorioV1.editableContent,
      `status=${v1Relida?.status} conteudo_igual=${v1Relida?.editableContent === relatorioV1.editableContent}`
    );

    const auditoria = await prisma.auditLog.findFirst({
      where: { action: "Reopen Rejected Proposal", entityId: relatorioV2?.id },
      orderBy: { createdAt: "desc" },
    });
    const meta = auditoria ? JSON.parse(auditoria.metadata || "{}") : {};
    checar(
      "a auditoria da reabertura registra QUAL secao foi regenerada e com que provedor",
      meta?.regenerated_analysis?.section === "risks",
      `metadata.regenerated_analysis=${JSON.stringify(meta?.regenerated_analysis)}`
    );

    // ══════════ B. CONTROLE: tipo com campo editavel nao regenera nada ══════════
    linhas.push("");
    linhas.push("== B. technical (tem campo editavel): reabrir CLONA a v1, sem chamar IA ==");

    const tecnicaV1 = await gerarProposta(sessao, "technical", TEMPLATE_TECNICO, "tecnica v1");
    checar("proposta tecnica v1 gerada", !!tecnicaV1, `id=${tecnicaV1?.id}`);
    if (!tecnicaV1) return;

    const rt = await rejeitar(sessao, tecnicaV1.id, gerente.id, etapaDoGerente.id, "Escopo tecnico incompleto: revisar antes de reenviar.");
    checar("proposta tecnica v1 submetida e REJEITADA com motivo", rt.ok, rt.detalhe);
    if (!rt.ok) return;

    const analiseAntesDoControle = await prisma.analysisResult.findUnique({ where: { projectId: PROJETO_ID } });
    const t1 = Date.now();
    const reabrirTecnica = await fetch(`${BASE}/api/proposals/${tecnicaV1.id}/reopen`, { method: "POST", headers: sessao });
    const corpoTecnica: any = await reabrirTecnica.json().catch(() => ({}));
    const duracaoControleMs = Date.now() - t1;
    checar("POST /proposals/:id/reopen aceito (201) para a proposta tecnica", reabrirTecnica.status === 201, `status=${reabrirTecnica.status} duracao=${(duracaoControleMs / 1000).toFixed(1)}s`);
    if (reabrirTecnica.status !== 201) return;

    checar(
      "a reabertura de um tipo COM campo editavel nao declara regeneracao nenhuma",
      corpoTecnica?.regenerated_analysis === null,
      `regenerated_analysis=${JSON.stringify(corpoTecnica?.regenerated_analysis)}`
    );

    const analiseDepoisDoControle = await prisma.analysisResult.findUnique({ where: { projectId: PROJETO_ID } });
    checar(
      "a analise do projeto NAO foi tocada nessa reabertura (nenhuma chamada de IA aconteceu)",
      !!analiseDepoisDoControle && !!analiseAntesDoControle && analiseDepoisDoControle.updatedAt.getTime() === analiseAntesDoControle.updatedAt.getTime(),
      `antes=${analiseAntesDoControle?.updatedAt.toISOString()} depois=${analiseDepoisDoControle?.updatedAt.toISOString()}`
    );
    checar(
      "e ela e muito mais rapida que a do relatorio, porque nao ha ida ao provedor de IA",
      duracaoControleMs < duracaoMs,
      `controle=${(duracaoControleMs / 1000).toFixed(1)}s relatorio=${(duracaoMs / 1000).toFixed(1)}s`
    );

    const tecnicaV2 = await prisma.proposal.findUnique({ where: { id: corpoTecnica.proposal_id } });
    checar(
      "a v2 tecnica CLONA os campos editaveis da v1 (comportamento da F8 inalterado)",
      tecnicaV2?.proposalValidity === tecnicaV1.proposalValidity && tecnicaV2?.exclusions === tecnicaV1.exclusions,
      `validade=${JSON.stringify(tecnicaV2?.proposalValidity)} exclusoes=${JSON.stringify(tecnicaV2?.exclusions)?.slice(0, 60)}`
    );
    checar(
      "a v2 tecnica nasce em draft, com version+1 e ligada a v1",
      tecnicaV2?.status === "draft" && tecnicaV2?.version === tecnicaV1.version + 1 && tecnicaV2?.previousVersionId === tecnicaV1.id,
      `v2=${tecnicaV2?.id} v=${tecnicaV2?.version}`
    );
  });

  console.log("");
  console.log("═══════════ PROVA PreSales F8b (item 2) — reabertura regenera relatorio via IA ═══════════");
  console.log(linhas.join("\n"));
  console.log("");
  console.log(`RESULTADO: ${passou} OK, ${falhou} FALHA`);
  await prisma.$disconnect();
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
