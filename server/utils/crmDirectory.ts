import { randomUUID } from "node:crypto";
import { prisma } from "../../src/prisma";
import { logger } from "./logger";
import { lerChaveDoCrm, resolverDestino, chamarPortaDoCrm, type RespostaDoCrm } from "./crmPort";

// CDC 16 — Fase 6. O CAMINHO SECUNDÁRIO (D12): o pré-vendas sobe um edital direto, procura a
// empresa no CRM e, não a encontrando, cria empresa e oportunidade lá.
//
// Contrato: fleet-manager:docs/cdc/16-contratos/cmcrm-inbound.v1.yaml, caminhos
// `GET /companies/search`, `POST /companies` e `POST /opportunities`.
//
// ## Por que estas chamadas são SÍNCRONAS, e a fila de saída não serve aqui
//
// A fila (`crmOutbox.ts`) existe porque os eventos do retorno descrevem fatos que já
// aconteceram: quem assumiu a demanda assumiu, o CRM estando no ar ou não, e prender a
// transação do banco pelo tempo da rede do outro lado faria o trabalho DAQUI falhar por
// causa de um problema DE LÁ.
//
// Aqui é o contrário: há uma pessoa parada na tela esperando a resposta, e a resposta é o
// que ela vai usar para decidir. Uma busca de empresa enfileirada não é uma busca. E a
// criação da oportunidade devolve o `crm_opportunity_id` e o `demand_ref` que o projeto
// precisa guardar — enfileirá-la deixaria o projeto sem referência por tempo indeterminado,
// que é exatamente o que a D31 existe para evitar.
//
// A consequência aceita, e dita em voz alta: com o CRM fora do ar, o passo do CRM no intake
// não acontece. O projeto nasce mesmo assim, sem referência, e o vínculo pode ser feito
// depois — o modo standalone (D12) continua sendo o chão de tudo.

const TIMEOUT_MS = 10_000;

export interface OrganizacaoDoCrm {
  id: string;
  name: string;
}

export type EstadoDoCrm =
  | { ativo: false; motivo: string }
  | {
      ativo: true;
      /** Organização já escolhida, quando houver. */
      organizationId: string | null;
      /** As que ligaram a integração do outro lado. */
      organizations: OrganizacaoDoCrm[];
    };

/**
 * Uma leitura na porta do CRM. Espelha `chamarPortaDoCrm`, para GET.
 *
 * Função separada porque aqui não há `Idempotency-Key` — o contrato não a declara em leitura,
 * e mandá-la seria inventar um cabeçalho que o outro lado não pediu.
 */
async function lerDaPortaDoCrm(
  destino: { base: string; key: string },
  caminho: string,
  organizationId: string | null
): Promise<RespostaDoCrm | { erroDeRede: string }> {
  try {
    const resposta = await fetch(`${destino.base}${caminho}`, {
      method: "GET",
      headers: {
        "X-Pair-Key": destino.key,
        ...(organizationId ? { "X-Crm-Organization-Id": organizationId } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
    return { status: resposta.status, corpo: json };
  } catch (err) {
    return { erroDeRede: err instanceof Error ? err.message : String(err) };
  }
}

function erroDeRede(r: RespostaDoCrm | { erroDeRede: string }): r is { erroDeRede: string } {
  return "erroDeRede" in r;
}

/**
 * O que o intake precisa saber antes de oferecer o passo do CRM.
 *
 * A regra que sustenta o modo standalone: sem par, ou com o CRM inalcançável, isto responde
 * `ativo: false` e o intake não muda uma linha do que faz hoje. Nenhum caminho desta fase
 * inventa um passo quando não há com quem falar.
 */
export async function estadoDoCrm(tenantId: string): Promise<EstadoDoCrm> {
  const chave = await lerChaveDoCrm(tenantId);
  if (!chave) {
    return {
      ativo: false,
      motivo:
        "Esta instalação não está pareada com um CMCRM — o par é declarado no CMSaaS, e a chave chega pela licença.",
    };
  }

  const destino = await resolverDestino(tenantId);
  if (!destino.ok) return { ativo: false, motivo: destino.motivo };

  const resposta = await lerDaPortaDoCrm(destino, "/pair/verify", null);
  if (erroDeRede(resposta)) {
    return { ativo: false, motivo: `Não foi possível alcançar o CMCRM: ${resposta.erroDeRede}` };
  }
  if (resposta.status !== 200) {
    return { ativo: false, motivo: `O /pair/verify do CMCRM respondeu ${resposta.status}.` };
  }

  const corpo = (resposta.corpo ?? {}) as { organizations?: unknown };
  const organizations: OrganizacaoDoCrm[] = Array.isArray(corpo.organizations)
    ? (corpo.organizations as Array<Record<string, unknown>>)
        .filter((o) => typeof o?.id === "string" && typeof o?.name === "string")
        .map((o) => ({ id: o.id as string, name: o.name as string }))
    : [];

  // Uma só elegível é adotada sozinha e guardada: é o caso de toda instalação real, e pedir a
  // uma pessoa que escolha entre uma opção é cerimônia. Com mais de uma, quem escolhe é ela.
  let escolhida = chave.crmOrganizationId;
  if (!escolhida && organizations.length === 1) {
    escolhida = organizations[0].id;
    await guardarOrganizacao(tenantId, escolhida);
  }
  // A guardada deixou de ser elegível (o administrador de lá desligou a integração): o vínculo
  // some, e a escolha volta a ser pedida. Continuar mandando o id antigo daria 403 a cada
  // chamada, e a tela diria "erro" em vez de "escolha de novo".
  if (escolhida && !organizations.some((o) => o.id === escolhida)) {
    escolhida = null;
  }

  return { ativo: true, organizationId: escolhida, organizations };
}

export async function guardarOrganizacao(tenantId: string, organizationId: string): Promise<void> {
  // Select-then-write, nunca `upsert`: a extensão de tenant deste produto LANÇA em `.upsert()`
  // para modelo recortado por tenant, de propósito.
  const atual = await prisma.crmPairKey.findUnique({ where: { tenantId } });
  if (!atual) return;
  await prisma.crmPairKey.update({ where: { tenantId }, data: { crmOrganizationId: organizationId } });
}

export interface CandidataDoCrm {
  crm_company_id: string;
  name: string;
  legal_name?: string;
  tax_id?: string;
  owner?: { name: string; crm_user_id?: string };
  confidence: number;
  open_opportunities: Array<{
    crm_opportunity_id: string;
    name: string;
    stage: string;
    value: number;
  }>;
}

export type ResultadoDaBusca =
  | { ok: true; match_kind: string; candidates: CandidataDoCrm[] }
  | { ok: false; motivo: string; status?: number };

export async function buscarEmpresaNoCrm(
  tenantId: string,
  criterio: { taxId?: string; cnpjRoot?: string; name?: string }
): Promise<ResultadoDaBusca> {
  const preparado = await preparar(tenantId);
  if (!preparado.ok) return { ok: false, motivo: preparado.motivo };

  const params = new URLSearchParams();
  if (criterio.taxId) params.set("tax_id", criterio.taxId);
  if (criterio.cnpjRoot) params.set("cnpj_root", criterio.cnpjRoot);
  if (criterio.name) params.set("name", criterio.name);

  const resposta = await lerDaPortaDoCrm(
    preparado.destino,
    `/companies/search?${params.toString()}`,
    preparado.organizationId
  );
  if (erroDeRede(resposta)) return { ok: false, motivo: resposta.erroDeRede };
  if (resposta.status !== 200) {
    return { ok: false, status: resposta.status, motivo: mensagemDoErro(resposta) };
  }
  const corpo = (resposta.corpo ?? {}) as { match_kind?: string; candidates?: CandidataDoCrm[] };
  return { ok: true, match_kind: corpo.match_kind ?? "none", candidates: corpo.candidates ?? [] };
}

export type ResultadoDaCriacaoDeEmpresa =
  | { ok: true; crmCompanyId: string; deduplicada: boolean }
  | { ok: false; motivo: string; status?: number };

export async function criarEmpresaNoCrm(
  tenantId: string,
  empresa: {
    name: string;
    legalName?: string;
    taxId?: string;
    sector?: string;
    presalesProjectId?: string;
    documentRef?: string;
  },
  idempotencyKey?: string
): Promise<ResultadoDaCriacaoDeEmpresa> {
  const preparado = await preparar(tenantId);
  if (!preparado.ok) return { ok: false, motivo: preparado.motivo };

  const corpo = {
    name: empresa.name,
    ...(empresa.legalName ? { legal_name: empresa.legalName } : {}),
    ...(empresa.taxId ? { tax_id: empresa.taxId } : {}),
    ...(empresa.sector ? { sector: empresa.sector } : {}),
    ...(empresa.presalesProjectId || empresa.documentRef
      ? {
          created_from: {
            ...(empresa.presalesProjectId ? { presales_project_id: empresa.presalesProjectId } : {}),
            ...(empresa.documentRef ? { document_ref: empresa.documentRef } : {}),
          },
        }
      : {}),
  };

  const resposta = await chamarPortaDoCrmComOrg(
    preparado.destino,
    preparado.organizationId,
    "POST",
    "/companies",
    idempotencyKey ?? `company-${randomUUID()}`,
    corpo
  );
  if (erroDeRede(resposta)) return { ok: false, motivo: resposta.erroDeRede };
  if (resposta.status !== 201) {
    return { ok: false, status: resposta.status, motivo: mensagemDoErro(resposta) };
  }
  const c = (resposta.corpo ?? {}) as { crm_company_id?: string; deduplicated_into?: string };
  if (!c.crm_company_id) return { ok: false, motivo: "O CMCRM respondeu 201 sem crm_company_id." };
  return { ok: true, crmCompanyId: c.crm_company_id, deduplicada: Boolean(c.deduplicated_into) };
}

export type ResultadoDaCriacaoDeOportunidade =
  | {
      ok: true;
      crmOpportunityId: string;
      demandRef?: string;
      semDono: boolean;
      dono?: { name: string; crm_user_id?: string };
    }
  | { ok: false; motivo: string; status?: number };

export async function criarOportunidadeNoCrm(
  tenantId: string,
  pedido: {
    crmCompanyId: string;
    name: string;
    presalesProjectId: string;
    expectedCloseDate?: string;
    value?: number;
    currency?: string;
    createdBy?: { name: string; presales_user_id?: string };
  },
  idempotencyKey?: string
): Promise<ResultadoDaCriacaoDeOportunidade> {
  const preparado = await preparar(tenantId);
  if (!preparado.ok) return { ok: false, motivo: preparado.motivo };

  const corpo = {
    crm_company_id: pedido.crmCompanyId,
    name: pedido.name,
    presales_project_id: pedido.presalesProjectId,
    ...(pedido.expectedCloseDate ? { expected_close_date: pedido.expectedCloseDate } : {}),
    ...(pedido.value !== undefined ? { value: pedido.value } : {}),
    currency: pedido.currency ?? "BRL",
    origin: "presales",
    ...(pedido.createdBy ? { created_by: pedido.createdBy } : {}),
  };

  const resposta = await chamarPortaDoCrmComOrg(
    preparado.destino,
    preparado.organizationId,
    "POST",
    "/opportunities",
    // A chave de idempotência é DERIVADA DO PROJETO, e não sorteada: se a resposta se perder na
    // rede depois de o CRM ter criado, a retentativa devolve a MESMA oportunidade em vez de abrir
    // a segunda. Um UUID novo a cada tentativa transformaria uma falha de rede em duas
    // oportunidades no funil do vendedor.
    idempotencyKey ?? `opp-${pedido.presalesProjectId}`,
    corpo
  );
  if (erroDeRede(resposta)) return { ok: false, motivo: resposta.erroDeRede };
  if (resposta.status !== 201) {
    return { ok: false, status: resposta.status, motivo: mensagemDoErro(resposta) };
  }
  const c = (resposta.corpo ?? {}) as {
    crm_opportunity_id?: string;
    demand_ref?: string;
    unassigned?: boolean;
    owner?: { name: string; crm_user_id?: string };
  };
  if (!c.crm_opportunity_id) {
    return { ok: false, motivo: "O CMCRM respondeu 201 sem crm_opportunity_id." };
  }
  return {
    ok: true,
    crmOpportunityId: c.crm_opportunity_id,
    demandRef: c.demand_ref,
    semDono: Boolean(c.unassigned),
    dono: c.owner,
  };
}

async function chamarPortaDoCrmComOrg(
  destino: { base: string; key: string },
  organizationId: string,
  metodo: "POST",
  caminho: string,
  idempotencyKey: string,
  corpo: unknown
): Promise<RespostaDoCrm | { erroDeRede: string }> {
  try {
    const resposta = await fetch(`${destino.base}${caminho}`, {
      method: metodo,
      headers: {
        "X-Pair-Key": destino.key,
        "X-Crm-Organization-Id": organizationId,
        "Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
    return { status: resposta.status, corpo: json };
  } catch (err) {
    return { erroDeRede: err instanceof Error ? err.message : String(err) };
  }
}

type Preparado =
  | { ok: true; destino: { base: string; key: string }; organizationId: string }
  | { ok: false; motivo: string };

async function preparar(tenantId: string): Promise<Preparado> {
  const estado = await estadoDoCrm(tenantId);
  if (!estado.ativo) return { ok: false, motivo: estado.motivo };
  if (!estado.organizationId) {
    return {
      ok: false,
      motivo:
        estado.organizations.length === 0
          ? "Nenhuma organização do CMCRM trocou demanda por este par ainda — envie uma da tela do CRM primeiro."
          : "Escolha a qual organização do CMCRM esta instalação corresponde antes de criar cadastro lá.",
    };
  }
  const destino = await resolverDestino(tenantId);
  if (!destino.ok) return { ok: false, motivo: destino.motivo };
  return { ok: true, destino, organizationId: estado.organizationId };
}

/**
 * A mensagem que o CRM mandou, e não uma inventada aqui.
 *
 * O corpo de erro do contrato é `{error, message, details}`. Repassar `message` e `details` é o
 * que faz a tela dizer "informe ao menos três caracteres" em vez de "erro 422" — e é o único
 * jeito de a pessoa saber o que corrigir.
 */
function mensagemDoErro(resposta: RespostaDoCrm): string {
  const corpo = resposta.corpo as { message?: string; details?: string[] } | null;
  const base = corpo?.message ?? `O CMCRM respondeu ${resposta.status}.`;
  if (corpo?.details?.length) return `${base} ${corpo.details.join("; ")}`;
  return base;
}

export function registrarFalhaDoCrm(tenantId: string, contexto: string, motivo: string): void {
  logger.warn({ tenantId, contexto, motivo }, "cdc16 F6: chamada ao CMCRM não completou");
}
