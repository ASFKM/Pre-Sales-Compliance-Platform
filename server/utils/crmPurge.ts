import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { dbStore } from "../../src/dbStore";
import { createStorageAdapter } from "./storage";
import { logger } from "./logger";

// CDC 16 — Fase 7. O EXPURGO EM CASCATA (D35).
//
// "O CRM apagando documento ou empresa, o PreSales apaga a cópia e devolve o
// que apagou, para o CRM registrar a execução. Sem esta chamada, apagar no CRM
// é conformidade de mentira: o mesmo arquivo continua vivo do outro lado."
//
// É a ÚNICA superfície da frente inteira que apaga, e ela roda sem gente
// olhando. Três decisões governam o que ela faz, e as três estão aqui em cima
// porque cada uma responde a uma pergunta que a fase teve de fazer antes de
// escrever a rota.
//
// ─────────────────────────────────────────────────────────────────────────────
// 1. O ARQUIVO SAI PRIMEIRO, e a linha só some depois
// ─────────────────────────────────────────────────────────────────────────────
//
// Apagar as linhas numa transação e o arquivo depois é a ordem intuitiva, e é a
// errada: se a remoção do arquivo falhar, o binário fica vivo no armazenamento e
// INALCANÇÁVEL — a linha que guardava o caminho dele já não existe, e nenhuma
// execução futura saberia o que apagar. O expurgo, portanto, apaga o arquivo
// primeiro; se não conseguir, a linha FICA, o alvo volta com `deleted: 0` e o
// erro entra no registro. Um expurgo que falhou e diz que falhou é recuperável;
// um que apagou o ponteiro não é.
//
// ─────────────────────────────────────────────────────────────────────────────
// 2. O TRABALHO DE QUEM ASSUMIU NÃO É APAGADO — a CÓPIA é
// ─────────────────────────────────────────────────────────────────────────────
//
// Quando o documento já foi materializado num Projeto, ele é o MESMO arquivo:
// `Document.storage_path` e `DemandDocument.storage_path` apontam para o mesmo
// binário desde o ato de assumir. As duas linhas somem e o arquivo some, porque
// as duas são a cópia que a D35 manda apagar.
//
// O que NÃO some é o que nasceu daqui: a análise técnica, a precificação, a
// proposta, a POC e o próprio Projeto. Isso não é cópia de nada do CRM — é
// trabalho de uma pessoa, e apagá-lo por um pedido de retenção do outro lado
// seria destruir o que a frente inteira existe para produzir. O registro diz o
// que sumiu, e é por ele que quem estava trabalhando entende o buraco.
//
// No expurgo de EMPRESA, o Projeto perde a REFERÊNCIA (`crm_company_id`,
// `crm_opportunity_id` e o nome do cliente): a empresa deixou de existir do
// outro lado, e um projeto apontando para um id que já não resolve é pior do
// que um projeto sem referência. Só são tocados os projetos cujo
// `crm_company_id` é o alvo — um projeto criado à mão, com o nome do cliente
// digitado por alguém, não é dado do CRM e não é tocado.
//
// ─────────────────────────────────────────────────────────────────────────────
// 3. O REGISTRO NÃO GUARDA O QUE FOI APAGADO
// ─────────────────────────────────────────────────────────────────────────────
//
// Ele guarda `crm_id`, `document_ref`, `sha256` e contagens — nunca nome de
// arquivo, nunca texto extraído. Quando o motivo é `data_subject_request`, o
// nome do arquivo pode ser exatamente o dado que se pediu para apagar, e um
// registro de expurgo que reproduz o dado apagado é o contrário de
// conformidade. O `sha256` identifica o arquivo sem reproduzi-lo, e é o mesmo
// identificador que o CRM já conhece.
//
// E o registro não é apagável por esta rota: `crm_purge_executions` não tem FK
// para `demands`, então nenhum cascade o alcança.

export type MotivoDeExpurgo = "retention" | "data_subject_request";

export interface AlvoDeExpurgo {
  kind: "document" | "company";
  crm_id: string;
}

interface ResultadoDoAlvo {
  kind: string;
  crm_id: string;
  deleted: number;
  documents: Array<{ document_ref: string; sha256: string; file_deleted: boolean; materialized: boolean }>;
  demands: string[];
  projects_unlinked: number;
  error?: string;
}

export interface ResultadoDoExpurgo {
  execucaoId: string;
  purged: Array<{ crm_id: string; deleted: number }>;
  executed_at: string;
  documentsDeleted: number;
  demandsDeleted: number;
  filesDeleted: number;
  projectsUnlinked: number;
}

/** O marcador que substitui o nome do cliente num projeto cuja empresa foi expurgada. */
export const CLIENTE_EXPURGADO = "(empresa expurgada a pedido do CRM)";

type Storage = ReturnType<typeof createStorageAdapter>;

/**
 * Apaga o binário e, só se conseguir, as duas linhas que apontavam para ele.
 *
 * Devolve quantas LINHAS sumiram e se o arquivo saiu. Um documento declarado e
 * nunca recebido não tem arquivo, e nesse caso `file_deleted` é falso sem que
 * nada tenha falhado — não havia o que apagar.
 */
async function apagarDocumento(
  resolverStorage: () => Promise<Storage>,
  dd: {
    id: string;
    documentRef: string;
    sha256: string;
    storagePath: string | null;
    documentId: string | null;
  }
): Promise<{ linhas: number; arquivoApagado: boolean; erro?: string }> {
  let arquivoApagado = false;
  if (dd.storagePath) {
    try {
      arquivoApagado = await (await resolverStorage()).deleteFile(dd.storagePath);
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      // A linha FICA. Ver a decisão 1 no cabeçalho.
      return { linhas: 0, arquivoApagado: false, erro };
    }
    if (!arquivoApagado) {
      return {
        linhas: 0,
        arquivoApagado: false,
        erro: "o armazenamento recusou a remoção do arquivo; a linha foi mantida para o expurgo poder ser repetido",
      };
    }
  }

  let linhas = 0;
  await prisma.$transaction(async (tx) => {
    if (dd.documentId) {
      // `DocumentContent` cai por cascade; `DemandDocument.document_id` é
      // SET NULL, então o Document sai primeiro sem deixar FK pendurada.
      await tx.document.deleteMany({ where: { id: dd.documentId } });
      linhas += 1;
    }
    await tx.demandDocument.deleteMany({ where: { id: dd.id } });
    linhas += 1;
  });
  return { linhas, arquivoApagado };
}

export async function executarExpurgo(entrada: {
  tenantId: string;
  crmInstallationId: string;
  reason: MotivoDeExpurgo;
  targets: readonly AlvoDeExpurgo[];
}): Promise<ResultadoDoExpurgo> {
  // O adaptador de armazenamento é resolvido SOB DEMANDA, no primeiro documento
  // que de fato tem arquivo. Um expurgo cujos alvos já não existem — a segunda
  // chamada da mesma retenção, que é o caso normal — não precisa da
  // configuração de storage para apagar nada, e exigi-la ali transformaria uma
  // instalação com a configuração incompleta num 500 sobre um pedido que não
  // tinha o que fazer.
  let storage: Storage | null = null;
  const storagePreguicoso = async (): Promise<Storage> => {
    if (!storage) storage = createStorageAdapter(await dbStore.getSettings());
    return storage;
  };

  const resultados: ResultadoDoAlvo[] = [];
  let documentsDeleted = 0;
  let demandsDeleted = 0;
  let filesDeleted = 0;
  let projectsUnlinked = 0;

  for (const alvo of entrada.targets) {
    const linha: ResultadoDoAlvo = {
      kind: alvo.kind,
      crm_id: alvo.crm_id,
      deleted: 0,
      documents: [],
      demands: [],
      projects_unlinked: 0,
    };

    if (alvo.kind === "document") {
      const declaracoes = await prisma.demandDocument.findMany({
        where: { crmDocumentId: alvo.crm_id },
      });
      for (const dd of declaracoes) {
        const r = await apagarDocumento(storagePreguicoso, dd);
        linha.documents.push({
          document_ref: dd.documentRef,
          sha256: dd.sha256,
          file_deleted: r.arquivoApagado,
          materialized: dd.documentId !== null,
        });
        if (r.erro) linha.error = r.erro;
        linha.deleted += r.linhas;
        documentsDeleted += r.linhas > 0 ? 1 : 0;
        if (r.arquivoApagado) filesDeleted += 1;
      }
    } else {
      const demandas = await prisma.demand.findMany({
        where: { crmCompanyId: alvo.crm_id },
        include: { documents: true },
      });
      for (const demanda of demandas) {
        let travou = false;
        for (const dd of demanda.documents) {
          const r = await apagarDocumento(storagePreguicoso, dd);
          linha.documents.push({
            document_ref: dd.documentRef,
            sha256: dd.sha256,
            file_deleted: r.arquivoApagado,
            materialized: dd.documentId !== null,
          });
          if (r.erro) {
            linha.error = r.erro;
            travou = true;
          }
          linha.deleted += r.linhas;
          documentsDeleted += r.linhas > 0 ? 1 : 0;
          if (r.arquivoApagado) filesDeleted += 1;
        }
        if (travou) {
          // Um arquivo que não saiu impede a demanda de sair: apagá-la levaria
          // junto, por cascade, a declaração que é o único ponteiro para ele.
          continue;
        }
        // Cascade leva `demand_documents`, `demand_outbound_events`,
        // `demand_sla_breaches` e `demand_updates`. O PROJETO não vai junto:
        // `Demand.project` é uma FK deste lado, e o projeto é o trabalho.
        await prisma.demand.deleteMany({ where: { id: demanda.id } });
        linha.demands.push(demanda.demandRef);
        linha.deleted += 1;
        demandsDeleted += 1;
      }

      const projetos = await prisma.project.updateMany({
        where: { crmCompanyId: alvo.crm_id },
        data: { crmCompanyId: null, crmOpportunityId: null, customerName: CLIENTE_EXPURGADO },
      });
      linha.projects_unlinked = projetos.count;
      linha.deleted += projetos.count;
      projectsUnlinked += projetos.count;
    }

    resultados.push(linha);
  }

  const execucaoId = randomId("purge");
  const executadoEm = new Date();
  await prisma.crmPurgeExecution.create({
    data: {
      id: execucaoId,
      tenantId: entrada.tenantId,
      reason: entrada.reason,
      crmInstallationId: entrada.crmInstallationId,
      targets: entrada.targets as any,
      results: resultados as any,
      documentsDeleted,
      demandsDeleted,
      filesDeleted,
      projectsUnlinked,
      executedAt: executadoEm,
    },
  });

  logger.warn(
    {
      execucaoId,
      reason: entrada.reason,
      alvos: entrada.targets.length,
      documentsDeleted,
      demandsDeleted,
      filesDeleted,
      projectsUnlinked,
    },
    "cdc16: expurgo em cascata executado a pedido do CMCRM"
  );

  return {
    execucaoId,
    purged: resultados.map((r) => ({ crm_id: r.crm_id, deleted: r.deleted })),
    executed_at: executadoEm.toISOString(),
    documentsDeleted,
    demandsDeleted,
    filesDeleted,
    projectsUnlinked,
  };
}
