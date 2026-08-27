import { z } from "zod";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import type { VerifiedPair } from "./pairKey";

// CDC 16 — Fase 1. A Demanda: validação do envelope, estado e o ato de assumir.
//
// Contrato: fleet-manager:docs/cdc/16-contratos/presales-inbound.v1.yaml.
// O que este arquivo NÃO faz, de propósito: SLA e política de atribuição (F5),
// atualização pós-envio, cancelamento e expurgo (F7).

// ─── O envelope, exatamente como a spec o descreve ──────────────────────────

const AtorRef = z.object({
  crm_user_id: z.string().min(1),
  name: z.string().min(1),
  // "usado só para notificação, nunca para criar conta" (D34).
  email: z.string().optional(),
});

const EmpresaRef = z.object({
  crm_company_id: z.string().min(1),
  name: z.string().min(1),
  legal_name: z.string().optional(),
  tax_id: z.string().optional(),
  cnpj_root: z.string().optional(),
  sector: z.string().optional(),
  segment: z.string().optional(),
  type: z.string().optional(),
});

const RetratoDaOportunidade = z.object({
  crm_opportunity_id: z.string().min(1),
  name: z.string().min(1),
  deal_type: z.string().optional(),
  stage: z.string().optional(),
  value: z.number().optional(),
  currency: z.string().default("BRL"),
  probability: z.number().int().min(0).max(100).optional(),
  margin_percent: z.number().optional(),
  expected_close_date: z.string().optional(),
  risks: z.array(z.string()).optional(),
  origin: z.string().optional(),
});

// A ficha (D09). Os campos obrigatórios aqui são EXATAMENTE os que Project exige
// para nascer - é por isso que "ficha incompleta não envia" é regra do CRM: sem
// eles, assumir não teria como criar o projeto sem perguntar algo a quem assumiu.
const Ficha = z.object({
  title: z.string().min(3),
  vertical: z.string().min(2),
  description: z.string().min(1),
  deadline: z.string().min(4),
  proposal_validity_date: z.string().min(4),
  output_language: z.enum(["Portuguese", "English", "Spanish"]).default("Portuguese"),
  proposal_language: z.enum(["Portuguese", "English", "Spanish"]).default("Portuguese"),
  ai_orientation_mode: z.enum([
    "Vendor-neutral",
    "Preferred manufacturer",
    "Mandatory manufacturer",
    "Existing customer standard",
    "Free AI recommendation",
  ]),
  ai_orientation_text: z.string().optional(),
  procurement_modality: z.string().optional(),
  procurement_subtype: z.string().optional(),
});

const DeclaracaoDeDocumento = z.object({
  document_ref: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "sha256 deve ser hexadecimal de 64 caracteres"),
  extracted_text: z.string().optional(),
  crm_document_id: z.string().optional(),
});

export const DemandCreateSchema = z.object({
  demand_ref: z.string().min(1),
  sequence: z.number().int().positive().optional(),
  company: EmpresaRef,
  opportunity: RetratoDaOportunidade,
  sheet: Ficha,
  objective: z.string().optional(),
  documents: z.array(DeclaracaoDeDocumento).optional(),
  sent_by: AtorRef,
  sent_at: z.string().min(4),
  crm_callback_base_url: z.string().optional(),
});

export type DemandCreateInput = z.infer<typeof DemandCreateSchema>;

// Datas chegam como texto (date ou date-time). Uma data inválida vira erro de
// validação com nome de campo, e não um `Invalid Date` que só apareceria muito
// depois, na tela, como "31/12/1969".
export function dataObrigatoria(valor: string, campo: string): Date {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) {
    throw new z.ZodError([{ code: "custom", path: [campo], message: `${campo} não é uma data válida.` } as any]);
  }
  return d;
}

function dataOpcional(valor: string | undefined, campo: string): Date | null {
  if (!valor) return null;
  return dataObrigatoria(valor, campo);
}

// ─── O estado, como a spec o devolve ────────────────────────────────────────

export interface DemandStatePayload {
  demand_ref: string;
  status: string;
  assigned_to?: string;
  assigned_at?: string;
  due_at?: string;
  presales_project_id?: string;
  returned_reason?: string;
}

export function toDemandState(
  demanda: {
    demandRef: string;
    status: string;
    assignedAt: Date | null;
    projectId: string | null;
    returnedReason: string | null;
    assignedUser?: { name: string } | null;
  },
  /**
   * F5: o prazo da etapa ainda devida (D19), quando a instalação tem SLA.
   *
   * Entra por parâmetro, e não é buscado aqui dentro, para esta função
   * continuar SÍNCRONA e pura — ela é a tradução do estado para o contrato, e
   * quem sabe ler configuração é a rota. `undefined` é o estado de toda
   * instalação sem SLA, e é o que a F1 já entregava.
   */
  dueAt?: string
): DemandStatePayload {
  const estado: DemandStatePayload = { demand_ref: demanda.demandRef, status: demanda.status };
  // O CRM guarda NOME e referência externa; quem assume não precisa de conta lá (D34).
  if (demanda.assignedUser?.name) estado.assigned_to = demanda.assignedUser.name;
  if (demanda.assignedAt) estado.assigned_at = demanda.assignedAt.toISOString();
  if (demanda.projectId) estado.presales_project_id = demanda.projectId;
  if (demanda.returnedReason) estado.returned_reason = demanda.returnedReason;
  // `due_at` só existe quando a instalação configurou SLA (D19). Sem SLA, o
  // campo fica FORA — devolver aqui o prazo do edital seria mentir o nome do
  // campo, que é o que a F1 escreveu neste mesmo lugar e continua valendo.
  if (dueAt) estado.due_at = dueAt;
  return estado;
}

// ─── Criação ────────────────────────────────────────────────────────────────

/**
 * Cria a Demanda e as declarações de documento numa transação só.
 *
 * Precisa rodar dentro do escopo do tenant. Devolve a demanda já com os
 * documentos, para o handler poder responder sem uma segunda consulta.
 */
export async function criarDemanda(entrada: DemandCreateInput, par: VerifiedPair) {
  const demandaId = randomId("dem");

  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.create({
      data: {
        id: demandaId,
        tenantId: par.tenantId,
        demandRef: entrada.demand_ref,
        sequence: entrada.sequence ?? 1,
        status: "queued",

        crmCompanyId: entrada.company.crm_company_id,
        companyName: entrada.company.name,
        companyLegalName: entrada.company.legal_name ?? null,
        companyTaxId: entrada.company.tax_id ?? null,
        companyCnpjRoot: entrada.company.cnpj_root ?? null,
        companySector: entrada.company.sector ?? null,
        companySegment: entrada.company.segment ?? null,
        companyType: entrada.company.type ?? null,

        crmOpportunityId: entrada.opportunity.crm_opportunity_id,
        opportunityName: entrada.opportunity.name,
        dealType: entrada.opportunity.deal_type ?? null,
        stage: entrada.opportunity.stage ?? null,
        value: entrada.opportunity.value ?? null,
        currency: entrada.opportunity.currency || "BRL",
        probability: entrada.opportunity.probability ?? null,
        marginPercent: entrada.opportunity.margin_percent ?? null,
        expectedCloseDate: dataOpcional(entrada.opportunity.expected_close_date, "opportunity.expected_close_date"),
        risks: entrada.opportunity.risks ?? [],
        origin: entrada.opportunity.origin ?? null,

        title: entrada.sheet.title,
        vertical: entrada.sheet.vertical,
        description: entrada.sheet.description,
        deadline: dataObrigatoria(entrada.sheet.deadline, "sheet.deadline"),
        proposalValidityDate: dataObrigatoria(entrada.sheet.proposal_validity_date, "sheet.proposal_validity_date"),
        outputLanguage: entrada.sheet.output_language,
        proposalLanguage: entrada.sheet.proposal_language,
        aiOrientationMode: entrada.sheet.ai_orientation_mode,
        aiOrientationText: entrada.sheet.ai_orientation_text ?? "",
        procurementModality: entrada.sheet.procurement_modality ?? null,
        procurementSubtype: entrada.sheet.procurement_subtype ?? null,
        objective: entrada.objective ?? null,

        sentByCrmUserId: entrada.sent_by.crm_user_id,
        sentByName: entrada.sent_by.name,
        sentByEmail: entrada.sent_by.email ?? null,
        sentAt: dataObrigatoria(entrada.sent_at, "sent_at"),
        crmCallbackBaseUrl: entrada.crm_callback_base_url ?? null,

        // Tirados do PAR, não do corpo: quem envia não escolhe de que instalação
        // diz vir, e é isso que marca a demanda que entrou por um par cruzado (D03).
        pairCrmInstallationId: par.sides.cmcrm.installation_id,
        pairCrossEnvironment: par.crossEnvironment,
      },
    });

    for (const doc of entrada.documents ?? []) {
      await tx.demandDocument.create({
        data: {
          id: randomId("dd"),
          tenantId: par.tenantId,
          demandId: demanda.id,
          documentRef: doc.document_ref,
          crmDocumentId: doc.crm_document_id ?? null,
          filename: doc.filename,
          mimeType: doc.mime_type,
          sizeBytes: doc.size_bytes,
          sha256: doc.sha256.toLowerCase(),
          extractedText: doc.extracted_text ?? null,
        },
      });
    }

    // OrThrow: a demanda acabou de ser criada nesta mesma transação, então
    // "não encontrada" aqui seria bug de escopo, não estado possível.
    return tx.demand.findUniqueOrThrow({
      where: { id: demanda.id },
      include: {
        documents: true,
        assignedUser: { select: { name: true } },
        // Sem estes dois, a resposta diz `assigned_by: null` e
        // `return_requested_by: null` sobre colunas que ESTÃO preenchidas — a
        // tela mostraria "direcionada" sem dizer por quem. Foi a prova da F5
        // que pegou, e é o mesmo defeito que o `mapProject` da F1 teve.
        assignedBy: { select: { name: true } },
        returnRequestedBy: { select: { name: true } },
      },
    });
  });
}

// ─── O ato de assumir ───────────────────────────────────────────────────────

export type ResultadoAssumir =
  | { ok: true; demand: any; projectId: string; documentosMaterializados: number; documentosSemConteudo: number }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "estado_invalido"; status: string }
  | { ok: false; motivo: "ja_assumida" };

/**
 * A Demanda vira Projeto, com dono (§2.2 do plano, passo 7).
 *
 * Tudo numa transação porque são três escritas que não podem existir separadas:
 * a demanda deixa a fila, o projeto nasce e os documentos que já têm conteúdo
 * passam a pendurar nele. Um projeto sem demanda apontando para ele seria
 * trabalho órfão; uma demanda assumida sem projeto seria uma fila mentindo.
 */
export async function assumirDemanda(
  demandaId: string,
  userId: string,
  /**
   * F5 (D16): COMO esta demanda foi parar com esta pessoa.
   *
   * Ausente é o auto-serviço, o padrão de toda instalação no ar: a pessoa se
   * ofereceu, e não há quem tenha decidido por ela. Preenchido, guarda quem
   * decidiu — o gerente que direcionou, ou o próprio produto quando a política
   * automática escolheu por menor carga (D40).
   */
  atribuicao?: { byUserId: string | null; source: "manager" | "auto" }
): Promise<ResultadoAssumir> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId }, include: { documents: true } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoAssumir;
    if (demanda.status !== "queued") {
      return (demanda.status === "assigned" || demanda.status === "in_analysis"
        ? { ok: false, motivo: "ja_assumida" }
        : { ok: false, motivo: "estado_invalido", status: demanda.status }) as ResultadoAssumir;
    }

    // A reivindicação vem ANTES de criar o projeto, e é condicional ao status
    // ainda ser `queued`. Duas pessoas clicando "assumir" no mesmo segundo é o
    // caso normal de uma fila de auto-serviço, e a leitura acima não separa as
    // duas: quem perde a corrida vê count === 0 aqui, e nada foi criado. Criar
    // o projeto primeiro deixaria um projeto órfão para quem perdesse.
    const agora = new Date();
    const reivindicacao = await tx.demand.updateMany({
      where: { id: demandaId, status: "queued" },
      data: {
        status: "assigned",
        assignedUserId: userId,
        assignedAt: agora,
        assignedByUserId: atribuicao?.byUserId ?? null,
        assignmentSource: atribuicao?.source ?? null,
      },
    });
    if (reivindicacao.count !== 1) {
      return { ok: false, motivo: "ja_assumida" } as ResultadoAssumir;
    }

    // Fluxo de aprovação: o primeiro configurado no tenant, se houver. Não é
    // hardcode de "w1" (o id do seed) porque uma instalação real cria os
    // próprios fluxos e não teria esse id.
    const fluxo = await tx.approvalWorkflow.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });

    const projectId = randomId("p");
    await tx.project.create({
      data: {
        id: projectId,
        tenantId: demanda.tenantId,
        name: demanda.title,
        // D31: referência, não cadastro. O nome continua sendo texto, como
        // sempre foi, e os dois ids ao lado são o que torna a referência real.
        customerName: demanda.companyName,
        crmCompanyId: demanda.crmCompanyId,
        crmOpportunityId: demanda.crmOpportunityId,
        opportunityName: demanda.opportunityName,
        vertical: demanda.vertical,
        description: demanda.description,
        status: "draft",
        deadline: demanda.deadline,
        proposalValidityDate: demanda.proposalValidityDate,
        ownerUserId: userId,
        outputLanguage: demanda.outputLanguage,
        proposalLanguage: demanda.proposalLanguage,
        aiOrientationMode: demanda.aiOrientationMode,
        aiOrientationText: demanda.aiOrientationText,
        selectedApprovalWorkflowId: fluxo?.id ?? null,
        procurementModality: demanda.procurementModality,
        procurementSubtype: demanda.procurementSubtype,
      },
    });

    let materializados = 0;
    let semConteudo = 0;
    for (const dd of demanda.documents) {
      if (!dd.storagePath || !dd.storageProvider) {
        // Declarado e sem binário: o upload não chegou (ou falhou). Não vira
        // Document, porque um Document sem arquivo é uma promessa quebrada para
        // toda tela que oferece "baixar". Continua registrado na demanda.
        semConteudo += 1;
        continue;
      }
      const documentId = randomId("d");
      await tx.document.create({
        data: {
          id: documentId,
          tenantId: demanda.tenantId,
          projectId,
          filename: dd.filename,
          originalFilename: dd.filename,
          mimeType: dd.mimeType,
          fileSize: dd.sizeBytes,
          storageProvider: dd.storageProvider,
          storagePath: dd.storagePath,
          // Mesmo par que classifyDocument devolve quando não conseguiu
          // classificar: rótulo neutro e confiança ZERO, visivelmente não um
          // palpite. A reclassificação sob demanda já existe
          // (POST /documents/:id/reclassify) e é o caminho de quem quiser o
          // rótulo real - gastar uma chamada de IA por documento no ato de
          // assumir não está no escopo desta fase, e D36 fala de duas leituras
          // com propósito, não de três.
          detectedDocumentType: "Other",
          aiClassificationConfidence: 0,
          version: 1,
          language: "Portuguese",
          uploadedBy: demanda.sentByName,
        },
      });
      if (dd.extractedText) {
        // O texto que o CRM já extraiu entra como conteúdo do documento: é o que
        // a análise técnica lê, e é por isso que a extração do PDF não se repete
        // deste lado (D36).
        await tx.documentContent.create({
          data: { documentId, tenantId: demanda.tenantId, content: dd.extractedText },
        });
      }
      await tx.demandDocument.update({ where: { id: dd.id }, data: { documentId } });
      materializados += 1;
    }

    await tx.demand.update({ where: { id: demandaId }, data: { projectId } });

    const atualizada = await tx.demand.findUnique({
      where: { id: demandaId },
      include: {
        documents: true,
        assignedUser: { select: { name: true } },
        // Sem estes dois, a resposta diz `assigned_by: null` e
        // `return_requested_by: null` sobre colunas que ESTÃO preenchidas — a
        // tela mostraria "direcionada" sem dizer por quem. Foi a prova da F5
        // que pegou, e é o mesmo defeito que o `mapProject` da F1 teve.
        assignedBy: { select: { name: true } },
        returnRequestedBy: { select: { name: true } },
      },
    });

    return {
      ok: true,
      demand: atualizada,
      projectId,
      documentosMaterializados: materializados,
      documentosSemConteudo: semConteudo,
    } as ResultadoAssumir;
  });
}

// ─── A devolução ────────────────────────────────────────────────────────────

export type ResultadoDevolver =
  | { ok: true; demand: any }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "estado_invalido"; status: string };

/**
 * Devolve a demanda ao vendedor, com motivo escrito (D17).
 *
 * A aprovação do gerente NÃO existe aqui: o papel de gerente de pré-vendas é
 * F5. Enquanto não existir, devolver é ato de quem assumiu, e o motivo é o que
 * torna a devolução útil - sem ele, o vendedor descobre que voltou e não por quê.
 *
 * O projeto criado no ato de assumir NÃO é apagado: ele pode já ter análise,
 * anotação ou proposta em cima. A demanda desencosta dele (projectId volta a
 * null) e o projeto segue existindo como trabalho normal do produto, do jeito
 * que existiria se tivesse nascido pelo intake.
 */
export async function devolverDemanda(demandaId: string, motivo: string): Promise<ResultadoDevolver> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoDevolver;
    if (demanda.status !== "assigned" && demanda.status !== "in_analysis") {
      return { ok: false, motivo: "estado_invalido", status: demanda.status } as ResultadoDevolver;
    }

    const devolvida = await tx.demand.updateMany({
      where: { id: demandaId, status: { in: ["assigned", "in_analysis"] } },
      data: { status: "returned", returnedReason: motivo, returnedAt: new Date() },
    });
    if (devolvida.count !== 1) {
      return { ok: false, motivo: "estado_invalido", status: demanda.status } as ResultadoDevolver;
    }

    const atualizada = await tx.demand.findUnique({
      where: { id: demandaId },
      include: {
        documents: true,
        assignedUser: { select: { name: true } },
        // Sem estes dois, a resposta diz `assigned_by: null` e
        // `return_requested_by: null` sobre colunas que ESTÃO preenchidas — a
        // tela mostraria "direcionada" sem dizer por quem. Foi a prova da F5
        // que pegou, e é o mesmo defeito que o `mapProject` da F1 teve.
        assignedBy: { select: { name: true } },
        returnRequestedBy: { select: { name: true } },
      },
    });
    return { ok: true, demand: atualizada } as ResultadoDevolver;
  });
}

// ─── F5: a devolução que passa pelo gerente (D17) ───────────────────────────

export type ResultadoPedido =
  | { ok: true; demand: any }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "estado_invalido"; status: string }
  | { ok: false; motivo: "ja_pedida" };

/**
 * Registra o PEDIDO de devolução, que fica esperando o gerente (D17).
 *
 * Só existe quando existe gerente. Sem gerente nomeado — o estado de toda
 * instalação no ar —, quem chama vai direto a `devolverDemanda`, e o
 * comportamento é exatamente o que a F1 entregou. A decisão sobre QUAL dos dois
 * caminhos seguir é da rota, e não daqui: é ela que sabe quem é o usuário.
 */
export async function pedirDevolucao(
  demandaId: string,
  userId: string,
  motivo: string
): Promise<ResultadoPedido> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoPedido;
    if (demanda.status !== "assigned" && demanda.status !== "in_analysis") {
      return { ok: false, motivo: "estado_invalido", status: demanda.status } as ResultadoPedido;
    }
    // PENDENTE, e não "já houve um pedido": depois de uma recusa o carimbo do
    // pedido continua na linha (é o histórico), e olhar só para ele trancaria a
    // pessoa para sempre — ela receberia 409 num pedido novo, legítimo, sobre
    // um motivo que o gerente ainda não viu. A prova pegou exatamente isso.
    if (demanda.returnRequestedAt && !demanda.returnDecidedAt) {
      return { ok: false, motivo: "ja_pedida" } as ResultadoPedido;
    }

    // Condicionado ao mesmo par: dois cliques no mesmo segundo é o caso normal,
    // e a leitura acima não separa os dois.
    const pediu = await tx.demand.updateMany({
      where: {
        id: demandaId,
        OR: [{ returnRequestedAt: null }, { returnDecidedAt: { not: null } }],
        status: { in: ["assigned", "in_analysis"] },
      },
      data: {
        returnRequestedAt: new Date(),
        returnRequestedByUserId: userId,
        returnRequestReason: motivo,
        // Uma decisão anterior recusada não pode ficar pendurada num pedido
        // novo: o gerente veria o motivo da recusa passada ao lado do pedido de
        // agora, e leria como se já tivesse respondido este.
        returnDecidedAt: null,
        returnDecidedByUserId: null,
        returnRejectionReason: null,
      },
    });
    if (pediu.count !== 1) return { ok: false, motivo: "ja_pedida" } as ResultadoPedido;

    const atualizada = await tx.demand.findUnique({
      where: { id: demandaId },
      include: {
        documents: true,
        assignedUser: { select: { name: true } },
        // Sem estes dois, a resposta diz `assigned_by: null` e
        // `return_requested_by: null` sobre colunas que ESTÃO preenchidas — a
        // tela mostraria "direcionada" sem dizer por quem. Foi a prova da F5
        // que pegou, e é o mesmo defeito que o `mapProject` da F1 teve.
        assignedBy: { select: { name: true } },
        returnRequestedBy: { select: { name: true } },
      },
    });
    return { ok: true, demand: atualizada } as ResultadoPedido;
  });
}

export type ResultadoRecusa =
  | { ok: true; demand: any }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "sem_pedido" };

/**
 * O gerente RECUSA a devolução: a demanda continua com quem a assumiu.
 *
 * O motivo da recusa é obrigatório pela mesma razão que o motivo da devolução
 * é: quem recebe a negativa precisa saber o que fazer em seguida. E ele fica
 * guardado — apagar o pedido sem deixar rastro faria a pessoa achar que o
 * clique não pegou.
 */
export async function recusarDevolucao(
  demandaId: string,
  gerenteId: string,
  motivo: string
): Promise<ResultadoRecusa> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoRecusa;
    if (!demanda.returnRequestedAt || demanda.returnDecidedAt) {
      return { ok: false, motivo: "sem_pedido" } as ResultadoRecusa;
    }
    const recusou = await tx.demand.updateMany({
      where: { id: demandaId, returnDecidedAt: null, returnRequestedAt: { not: null } },
      data: { returnDecidedAt: new Date(), returnDecidedByUserId: gerenteId, returnRejectionReason: motivo },
    });
    if (recusou.count !== 1) return { ok: false, motivo: "sem_pedido" } as ResultadoRecusa;
    const atualizada = await tx.demand.findUnique({
      where: { id: demandaId },
      include: {
        documents: true,
        assignedUser: { select: { name: true } },
        // Sem estes dois, a resposta diz `assigned_by: null` e
        // `return_requested_by: null` sobre colunas que ESTÃO preenchidas — a
        // tela mostraria "direcionada" sem dizer por quem. Foi a prova da F5
        // que pegou, e é o mesmo defeito que o `mapProject` da F1 teve.
        assignedBy: { select: { name: true } },
        returnRequestedBy: { select: { name: true } },
      },
    });
    return { ok: true, demand: atualizada } as ResultadoRecusa;
  });
}

// ─── F5: o direcionamento e a reatribuição pelo gerente (D16) ───────────────

export type ResultadoReatribuir =
  | { ok: true; demand: any; anteriorUserId: string | null }
  | { ok: false; motivo: "not_found" }
  | { ok: false; motivo: "estado_invalido"; status: string }
  | { ok: false; motivo: "mesma_pessoa" };

/**
 * O gerente passa uma demanda JÁ ASSUMIDA para outra pessoa.
 *
 * O dono do PROJETO muda junto. Deixar o projeto com quem saiu faria a pessoa
 * nova receber uma demanda cujo trabalho ela não enxerga — a visibilidade de
 * projeto deste produto é por dono, gerente do dono e aprovador
 * (`src/prisma.ts`), e a demanda apontaria para um projeto invisível.
 *
 * Um pedido de devolução pendente é LIMPO: reatribuir já é a resposta ao
 * pedido, e deixá-lo pendurado faria o gerente ser cobrado outra vez por uma
 * decisão que ele acabou de tomar.
 */
export async function reatribuirDemanda(
  demandaId: string,
  novoUserId: string,
  gerenteId: string
): Promise<ResultadoReatribuir> {
  return prisma.$transaction(async (tx) => {
    const demanda = await tx.demand.findUnique({ where: { id: demandaId } });
    if (!demanda) return { ok: false, motivo: "not_found" } as ResultadoReatribuir;
    if (demanda.status !== "assigned" && demanda.status !== "in_analysis") {
      return { ok: false, motivo: "estado_invalido", status: demanda.status } as ResultadoReatribuir;
    }
    if (demanda.assignedUserId === novoUserId) {
      return { ok: false, motivo: "mesma_pessoa" } as ResultadoReatribuir;
    }

    await tx.demand.update({
      where: { id: demandaId },
      data: {
        assignedUserId: novoUserId,
        assignedByUserId: gerenteId,
        assignmentSource: "manager",
        returnRequestedAt: null,
        returnRequestedByUserId: null,
        returnRequestReason: null,
        returnDecidedAt: null,
        returnDecidedByUserId: null,
        returnRejectionReason: null,
      },
    });
    if (demanda.projectId) {
      await tx.project.update({ where: { id: demanda.projectId }, data: { ownerUserId: novoUserId } });
    }

    const atualizada = await tx.demand.findUnique({
      where: { id: demandaId },
      include: {
        documents: true,
        assignedUser: { select: { name: true } },
        // Sem estes dois, a resposta diz `assigned_by: null` e
        // `return_requested_by: null` sobre colunas que ESTÃO preenchidas — a
        // tela mostraria "direcionada" sem dizer por quem. Foi a prova da F5
        // que pegou, e é o mesmo defeito que o `mapProject` da F1 teve.
        assignedBy: { select: { name: true } },
        returnRequestedBy: { select: { name: true } },
      },
    });
    return { ok: true, demand: atualizada, anteriorUserId: demanda.assignedUserId } as ResultadoReatribuir;
  });
}
