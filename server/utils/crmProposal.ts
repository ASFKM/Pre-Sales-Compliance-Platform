import * as crypto from "node:crypto";
import { prisma } from "../../src/prisma";
import { logger } from "./logger";
import { createStorageAdapter } from "./storage";
import { dbStore } from "../../src/dbStore";

// CDC 16 — Fase 4. A proposta que volta COMPLETA (D22), no formato do
// `ProposalPush` da spec `cmcrm-inbound.v1.yaml`.
//
// Três decisões que este arquivo carrega, e o motivo de cada uma:
//
// 1. O CÓDIGO DO ITEM É O QUE FAZ ELE CASAR DO OUTRO LADO (D23). O CRM procura
//    o produto pelo `code`; sem ele o item entra solto, o que é legítimo mas
//    perde a ligação com o catálogo. Este produto tem o código em três lugares
//    diferentes, com qualidades diferentes: o `erpCode` do item de catálogo (o
//    código do ERP do cliente, que é justamente o vocabulário que os dois lados
//    compartilham), o `pn`/`itemCode` do catálogo interno, e o `part_number`/
//    `sku` do BOM extraído do edital. A ordem de preferência abaixo é essa, da
//    referência mais compartilhada para a menos.
//
// 2. O VALOR É O DA PROPOSTA, NÃO O DA FOLHA DE PRECIFICAÇÃO. A folha é o
//    trabalho; a proposta é o que vai ao cliente. Mandar o total da folha faria
//    o CRM sobrescrever o valor da oportunidade com um número que ninguém
//    ofereceu — e a D21 manda a proposta sobrescrever justamente porque ela É o
//    compromisso.
//
// 3. O DOCUMENTO VIAJA SEPARADO, E O HASH É CALCULADO DO ARQUIVO REAL. O
//    `sha256` que vai no `POST` é lido no ato de montar o envelope, e o `PUT` do
//    binário manda os mesmos bytes. Declarar um hash e mandar outro conteúdo é o
//    422 do contrato — e seria o que aconteceria se o hash viesse de um campo
//    guardado e o arquivo tivesse sido regerado depois.
//
//    O arquivo é lido pelo ADAPTADOR DE ARMAZENAMENTO, nunca por `fs`: os campos
//    `docx_file_path`/`pdf_file_path` são caminhos do esquema de armazenamento
//    (local, S3 ou GCS), e não caminhos de disco. Ler com `fs` funcionaria na
//    instalação que usa disco e falharia calada nas outras — o mesmo cuidado que
//    a rota de exportação já tomava.

/** Os oito estados do contrato. Este produto produz cinco deles. */
export type StatusDePropostaNoContrato =
  | "draft"
  | "in_approval"
  | "approved"
  | "sent"
  | "revised"
  | "accepted"
  | "rejected"
  | "expired";

/**
 * O mapa entre o enum deste produto e o do contrato.
 *
 * `released` vira `sent`: neste produto "liberada" é o estado em que a proposta
 * sai para o cliente. `rejected` continua `rejected`, e vale dizer o que ele
 * significa: é a APROVAÇÃO INTERNA recusada, não o cliente dizendo não — o
 * cliente ainda não foi consultado. O CRM sabe disso e não a mostra como
 * negócio perdido.
 */
export const STATUS_NO_CONTRATO: Record<string, StatusDePropostaNoContrato> = {
  draft: "draft",
  submitted: "in_approval",
  approved: "approved",
  rejected: "rejected",
  released: "sent",
};

export interface ItemDoEnvelope {
  code?: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percent?: number;
  line_total: number;
}

export interface DocumentoDaProposta {
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  /** Caminho no esquema de armazenamento, para o `PUT` do binário. Não viaja no `POST`. */
  caminho: string;
  /** Qual adaptador lê esse caminho — a proposta guarda o dela em `storage_provider`. */
  storageProvider: string;
}

export interface EnvelopeDaProposta {
  demandId: string;
  demandRef: string;
  tenantId: string;
  payload: Record<string, unknown>;
  documento: DocumentoDaProposta | null;
  version: number;
}

interface LinhaDaTabelaManual {
  item_id?: string;
  product_or_service?: string;
  specification?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  total_price?: number;
  discount?: number;
}

export interface ItemDoBom {
  item_id?: string;
  sku?: string;
  part_number?: string;
  equipment_name?: string;
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Duas casas, sempre: o contrato fala em dinheiro e o outro lado grava `numeric(14,2)`. */
function centavos(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * O documento a enviar, com o hash do arquivo REAL.
 *
 * PDF na frente do DOCX: é o formato que o cliente recebe e o que o vendedor
 * abre para conferir. O DOCX é o editável, e mandá-lo faria o CRM guardar um
 * rascunho no lugar do documento.
 */
async function escolherDocumento(
  pdfPath: string | null | undefined,
  docxPath: string | null | undefined,
  versao: number,
  storageProvider: string
): Promise<DocumentoDaProposta | null> {
  const candidatos: Array<{ caminho: string; mime: string; ext: string }> = [];
  if (pdfPath) candidatos.push({ caminho: pdfPath, mime: "application/pdf", ext: "pdf" });
  if (docxPath)
    candidatos.push({
      caminho: docxPath,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ext: "docx",
    });

  const settings = await dbStore.getSettings();
  const adapter = createStorageAdapter({ ...settings, storage_mode: storageProvider as any });

  for (const c of candidatos) {
    try {
      if (!(await adapter.exists(c.caminho))) continue;
      const conteudo = await adapter.readFile(c.caminho);
      if (conteudo.length === 0) continue;
      return {
        filename: `proposta-v${versao}.${c.ext}`,
        mime_type: c.mime,
        size_bytes: conteudo.length,
        sha256: crypto.createHash("sha256").update(conteudo).digest("hex"),
        caminho: c.caminho,
        storageProvider,
      };
    } catch {
      // Arquivo ausente não é erro: a proposta pode ter sido criada antes de o
      // documento ser gerado. O envelope simplesmente não declara documento, e
      // o CRM registra a proposta do mesmo jeito.
      continue;
    }
  }
  return null;
}

/**
 * Monta o envelope da proposta, ou devolve `null` quando não há o que mandar.
 *
 * `null` acontece em dois casos legítimos: a proposta não está ligada a nenhuma
 * demanda (o caminho secundário do §2.3 — o pré-vendas subiu o edital direto e
 * não há oportunidade do lado de lá), ou o projeto dela não veio de demanda
 * nenhuma. Nos dois, não há para onde contar, e inventar um destino seria pior
 * do que silêncio.
 */
export async function montarEnvelopeDaProposta(
  proposalId: string
): Promise<EnvelopeDaProposta | null> {
  try {
    const proposta = await prisma.proposal.findUnique({
      where: { id: proposalId },
      select: {
        id: true,
        tenantId: true,
        projectId: true,
        version: true,
        status: true,
        proposalType: true,
        docxFilePath: true,
        pdfFilePath: true,
        storageProvider: true,
        paymentTerms: true,
        deliveryTerms: true,
        proposalValidity: true,
        manualPricingTable: true,
        generatedBy: true,
        generatedAt: true,
      },
    });
    if (!proposta) return null;

    const demanda = await prisma.demand.findFirst({
      where: { tenantId: proposta.tenantId, projectId: proposta.projectId },
      select: { id: true, demandRef: true, currency: true, proposalValidityDate: true },
    });
    if (!demanda) return null;

    const itens = await montarItens(proposta.tenantId, proposta.projectId, proposta.manualPricingTable);
    const total = centavos(itens.reduce((soma, i) => soma + i.line_total, 0));

    const payload: Record<string, unknown> = {
      presales_proposal_id: proposta.id,
      version: proposta.version,
      status: STATUS_NO_CONTRATO[proposta.status] ?? "draft",
      total_value: total,
      currency: demanda.currency || "BRL",
      items: itens,
    };
    if (proposta.proposalType) payload.proposal_type = proposta.proposalType;
    if (proposta.paymentTerms) payload.payment_terms = proposta.paymentTerms;
    if (proposta.deliveryTerms) payload.delivery_terms = proposta.deliveryTerms;

    const validade = resolverValidade(proposta.proposalValidity, demanda.proposalValidityDate);
    if (validade) payload.valid_until = validade;

    const base = (process.env.APP_URL || "").replace(/\/+$/, "");
    if (base) payload.link = `${base}/projects/${proposta.projectId}`;

    const aprovacao = await montarAprovacao(proposta.id, proposta.status);
    if (aprovacao) payload.approval = aprovacao;

    const documento = await escolherDocumento(
      proposta.pdfFilePath,
      proposta.docxFilePath,
      proposta.version,
      proposta.storageProvider
    );
    if (documento) {
      payload.document = {
        filename: documento.filename,
        mime_type: documento.mime_type,
        size_bytes: documento.size_bytes,
        sha256: documento.sha256,
      };
    }

    return {
      demandId: demanda.id,
      demandRef: demanda.demandRef,
      tenantId: proposta.tenantId,
      payload,
      documento,
      version: proposta.version,
    };
  } catch (err) {
    logger.warn({ err, proposalId }, "cdc16 F4: falha ao montar o envelope da proposta para o CRM");
    return null;
  }
}

/**
 * O carimbo da aprovação já feita aqui (D24).
 *
 * Só sai quando a proposta REALMENTE passou pelo fluxo: a última decisão de
 * aprovação registrada. Mandar um carimbo em cima de um rascunho faria o CRM
 * registrar uma aprovação que ninguém deu — e é justamente esse carimbo que
 * impede a alçada de lá de reabrir o assunto.
 */
async function montarAprovacao(
  proposalId: string,
  status: string
): Promise<Record<string, unknown> | null> {
  if (status !== "approved" && status !== "released") return null;
  const decisao = await prisma.approvalDecision.findFirst({
    where: { proposalId, decision: "approved" },
    orderBy: { createdAt: "desc" },
    select: { approverUserId: true, createdAt: true },
  });
  if (!decisao) return null;
  const aprovador = await prisma.user.findUnique({
    where: { id: decisao.approverUserId },
    select: { id: true, name: true },
  });
  return {
    approved_by: {
      name: aprovador?.name ?? "aprovador do Pre-Sales",
      presales_user_id: decisao.approverUserId,
    },
    approved_at: decisao.createdAt.toISOString(),
  };
}

/** `proposalValidity` é texto livre no formulário; a data da demanda é data de verdade. */
function resolverValidade(
  texto: string | null | undefined,
  dataDaDemanda: Date | null | undefined
): string | null {
  if (texto && /^\d{4}-\d{2}-\d{2}$/.test(texto.trim())) return texto.trim();
  if (dataDaDemanda) return dataDaDemanda.toISOString().slice(0, 10);
  return null;
}

/**
 * Os itens, e de onde sai o código de cada um.
 *
 * A tabela de precificação manual é o que o cliente vê na proposta — é ela que
 * manda. O código NÃO está nela (o formulário nunca pediu um), então ele é
 * buscado por `item_id` em duas fontes, nesta ordem: a linha da folha de
 * precificação daquele item (que pode ter casado com o catálogo e ter `erpCode`)
 * e o item do BOM extraído do edital (`part_number`/`sku`).
 *
 * Sem tabela manual, os itens saem da própria folha de precificação — é o caso
 * da proposta técnica, que não tem tabela de preço no corpo mas tem um trabalho
 * de precificação por trás.
 */
export interface LinhaDaFolha {
  bomItemId: string | null;
  rawPartNumber: string | null;
  rawDescription: string | null;
  quantity: number;
  finalUnitPrice: number | null;
  discountPercent: number;
  matchedItem: {
    erpCode: string | null;
    itemCode: string | null;
    pn: string | null;
    description: string | null;
  } | null;
}

/**
 * O código de uma linha da folha, na ordem de preferência que importa (D23).
 *
 * `erpCode` primeiro porque é o código do ERP DO CLIENTE — o único vocabulário que os dois
 * produtos de fato compartilham, e o que tem chance real de existir no catálogo do CRM. `itemCode`
 * e `pn` são internos deste produto; `rawPartNumber` é o que veio escrito no edital, e é o último
 * porque é o menos curado de todos. Nenhum deles é descartado: um código ruim ainda é melhor do
 * que nenhum, porque do outro lado o item entra solto guardando o código e casa no dia em que o
 * produto for cadastrado.
 */
export function codigoDaLinha(linha: LinhaDaFolha): string | undefined {
  return (
    linha.matchedItem?.erpCode ||
    linha.matchedItem?.itemCode ||
    linha.matchedItem?.pn ||
    linha.rawPartNumber ||
    undefined
  );
}

/**
 * O núcleo do casamento de itens, separado do banco: é a regra da D23, e ela precisa ser provável
 * caso a caso sem subir Postgres.
 *
 * A tabela manual é o que o cliente VÊ na proposta — é ela que manda quando existe. O código não
 * está nela (o formulário nunca pediu um), então vem por `item_id`, das duas fontes que o têm.
 * Sem tabela manual, os itens saem da própria folha: é o caso da proposta técnica, que não tem
 * tabela de preço no corpo mas tem um trabalho de precificação por trás.
 */
export function montarItensDe(
  tabelaManual: unknown,
  linhas: readonly LinhaDaFolha[],
  bom: readonly ItemDoBom[]
): ItemDoEnvelope[] {
  const codigoPorItem = new Map<string, string>();
  for (const l of linhas) {
    const codigo = codigoDaLinha(l);
    if (l.bomItemId && codigo) codigoPorItem.set(l.bomItemId, codigo);
  }
  // O BOM só preenche o que a folha não sabia: a folha já passou por curadoria humana, o BOM saiu
  // da leitura do edital. Deixar o BOM sobrescrever seria trocar o revisado pelo extraído.
  for (const item of bom) {
    if (!item.item_id) continue;
    if (codigoPorItem.has(item.item_id)) continue;
    const codigo = item.part_number || item.sku;
    if (codigo) codigoPorItem.set(item.item_id, codigo);
  }

  if (Array.isArray(tabelaManual) && tabelaManual.length > 0) {
    return (tabelaManual as LinhaDaTabelaManual[]).map((linha) => {
      const quantidade = numero(linha.quantity);
      const unitario = centavos(numero(linha.unit_price));
      const totalDaLinha = centavos(
        linha.total_price !== undefined ? numero(linha.total_price) : quantidade * unitario
      );
      const codigo = linha.item_id ? codigoPorItem.get(linha.item_id) : undefined;
      const item: ItemDoEnvelope = {
        description: (linha.product_or_service || linha.specification || "item").slice(0, 2000),
        quantity: quantidade,
        unit_price: unitario,
        line_total: totalDaLinha,
      };
      if (codigo) item.code = codigo;
      const desconto = numero(linha.discount);
      if (desconto > 0) item.discount_percent = desconto;
      return item;
    });
  }

  return linhas
    .filter((l) => l.finalUnitPrice !== null && l.quantity > 0)
    .map((l) => {
      const unitario = centavos(numero(l.finalUnitPrice));
      const item: ItemDoEnvelope = {
        description: (
          l.rawDescription ||
          l.matchedItem?.description ||
          l.rawPartNumber ||
          "item"
        ).slice(0, 2000),
        quantity: l.quantity,
        unit_price: unitario,
        line_total: centavos(unitario * l.quantity),
      };
      const codigo = codigoDaLinha(l);
      if (codigo) item.code = codigo;
      if (l.discountPercent > 0) item.discount_percent = l.discountPercent;
      return item;
    });
}

async function montarItens(
  tenantId: string,
  projectId: string,
  tabelaManual: unknown
): Promise<ItemDoEnvelope[]> {
  const folha = await prisma.projectPricingSheet.findFirst({
    where: { tenantId, projectId },
    orderBy: { updatedAt: "desc" },
    select: {
      lines: {
        select: {
          bomItemId: true,
          rawPartNumber: true,
          rawDescription: true,
          quantity: true,
          finalUnitPrice: true,
          discountPercent: true,
          matchedItem: { select: { erpCode: true, itemCode: true, pn: true, description: true } },
        },
      },
    },
  });
  const linhas = (folha?.lines ?? []) as unknown as LinhaDaFolha[];

  const analise = await prisma.analysisResult.findUnique({
    where: { projectId },
    select: { bom: true },
  });
  const bom: ItemDoBom[] = Array.isArray(analise?.bom) ? (analise!.bom as ItemDoBom[]) : [];

  return montarItensDe(tabelaManual, linhas, bom);
}
