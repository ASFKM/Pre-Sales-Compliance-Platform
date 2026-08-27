import { prisma } from "../../src/prisma";
import { encryptSecret, decryptSecret } from "./security";
import { assertPublicHttpsUrl } from "./ssrfGuard";
import { logger } from "./logger";
import type { VerifiedPair } from "./pairKey";

// CDC 16 — Fase 3. O cliente da porta de máquina do CMCRM: a primeira vez que
// este produto CHAMA o outro em vez de só ser chamado.
//
// Contrato: fleet-manager:docs/cdc/16-contratos/cmcrm-inbound.v1.yaml.
//
// Três decisões que valem estar escritas aqui:
//
// 1. A CHAVE É A QUE O CMCRM APRESENTOU. A D39 entrega a chave só ao lado que
//    chama, e até a F2 esse lado era só o CRM. Em vez de mudar a D39 e o
//    terceiro repositório, este lado guarda a mesma chave que já recebe em toda
//    chamada de entrada - depois de ela ter sido verificada contra o CMSaaS.
//    Efeito colateral desejável: só se chama de volta um par que já foi exercido
//    de verdade na direção original.
//
// 2. O ENDEREÇO DE VOLTA É CONFERIDO CONTRA O PAR, NUNCA ACEITO COMO VEIO. O
//    `crm_callback_base_url` chega no corpo da criação da demanda, e quem manda
//    o corpo é justamente quem quer ser chamado de volta. Antes do primeiro uso
//    (e a cada 10 minutos depois), o endereço é conferido: `GET {base}/pair/verify`
//    com a chave precisa responder `product: "cmcrm"` e o MESMO
//    `installation_id` que o par declarou. Um endereço que aponte para outro
//    lugar não passa nessa conferência, e é isso - e não a lista de IPs - que
//    torna o endereço confiável.
//
// 3. TLS SEM EXCEÇÃO. Nada aqui desliga verificação de certificado. Em
//    desenvolvimento, o CMCRM serve um certificado próprio, e a resposta certa é
//    a instalação confiar naquela CA (NODE_EXTRA_CA_CERTS aceita um arquivo com
//    vários PEMs) - não o código abrir uma exceção que sobreviveria à produção.

const TIMEOUT_MS = 10_000;
// O documento da proposta pode ter alguns megabytes, e 10s de teto derrubaria um
// envio que estava indo bem numa rede lenta — o custo de errar aqui é a fila
// retentando um upload que já quase tinha terminado.
const TIMEOUT_BINARIO_MS = 60_000;
const CONFERENCIA_VALE_MS = 10 * 60 * 1000;

export interface ChaveDoCrm {
  key: string;
  keyHint: string;
  crmInstallationId: string;
  callbackBaseUrl: string | null;
}

function limparBarras(url: string): string {
  let base = url.trim();
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

export function dicaDaChave(chave: string): string {
  const limpa = chave.trim();
  return limpa.length >= 4 ? limpa.slice(-4) : "????";
}

/**
 * Guarda (ou atualiza) a chave que o CMCRM acabou de apresentar.
 *
 * Chamado do caminho de entrada, depois de `verifyPairKey` ter aprovado - nunca
 * antes: guardar uma chave não verificada seria guardar o que qualquer um
 * mandasse no cabeçalho.
 *
 * Não lança: uma falha em guardar a chave não pode derrubar a criação da
 * demanda, que é o que o CRM veio fazer. O efeito de falhar é o retorno ficar
 * mudo até a próxima chamada de entrada, e isso é visível na fila de saída.
 */
export async function guardarChaveApresentada(
  par: VerifiedPair,
  rawKey: string,
  callbackBaseUrl?: string | null
): Promise<void> {
  try {
    const agora = new Date();
    const cifrada = encryptSecret(rawKey);
    const hint = dicaDaChave(rawKey);
    const base = callbackBaseUrl ? limparBarras(callbackBaseUrl) : null;

    const atual = await prisma.crmPairKey.findUnique({ where: { tenantId: par.tenantId } });
    // Chave nova (primeira entrega ou repareamento) invalida a conferência do
    // endereço: o retrato guardado é de outro par e não vale mais.
    const chaveMudou = !atual || decryptSecret(atual.keyEncrypted) !== rawKey;

    // Select-then-write explícito, e nunca `upsert`: a extensão de tenant deste produto LANÇA em
    // `.upsert()` para modelo recortado por tenant, de propósito — o `where` do upsert não passa
    // pelo filtro e a operação cairia em `create` sem escopo. É a mesma trava que já pegou esse
    // erro três vezes neste código, e ela pegou este também.
    if (atual) {
      await prisma.crmPairKey.update({
        where: { tenantId: par.tenantId },
        data: {
          keyEncrypted: cifrada,
          keyHint: hint,
          crmInstallationId: par.sides.cmcrm.installation_id,
          // Endereço ausente no envelope NÃO apaga o que já se sabia: uma versão
          // antiga do CRM que pare de mandar o campo deixaria o retorno mudo.
          ...(base ? { callbackBaseUrl: base } : {}),
          receivedAt: agora,
          ...(chaveMudou || (base && base !== atual.callbackBaseUrl)
            ? { verifiedAt: null, verifyError: null }
            : {}),
        },
      });
    } else {
      await prisma.crmPairKey.create({
        data: {
          tenantId: par.tenantId,
          keyEncrypted: cifrada,
          keyHint: hint,
          crmInstallationId: par.sides.cmcrm.installation_id,
          callbackBaseUrl: base,
          receivedAt: agora,
        },
      });
    }
  } catch (err) {
    logger.warn({ err, tenantId: par.tenantId }, "cdc16 F3: falha ao guardar a chave do par para o retorno");
  }
}

export async function lerChaveDoCrm(tenantId: string): Promise<ChaveDoCrm | null> {
  const linha = await prisma.crmPairKey.findUnique({ where: { tenantId } });
  if (!linha) return null;
  let key = "";
  try {
    key = decryptSecret(linha.keyEncrypted);
  } catch {
    return null;
  }
  if (!key) return null;
  return {
    key,
    keyHint: linha.keyHint,
    crmInstallationId: linha.crmInstallationId,
    callbackBaseUrl: linha.callbackBaseUrl,
  };
}

export type DestinoDoCrm =
  | { ok: true; base: string; key: string }
  | { ok: false; motivo: string; permanente: boolean };

/**
 * Onde chamar, já conferido contra o par.
 *
 * `permanente: true` para o que não adianta repetir (sem chave, sem endereço,
 * endereço que não é do par) e `false` para o que pode melhorar sozinho (CRM
 * fora do ar). É por esse campo que a fila decide entre desistir e reagendar.
 */
export async function resolverDestino(tenantId: string): Promise<DestinoDoCrm> {
  const chave = await lerChaveDoCrm(tenantId);
  if (!chave) {
    return {
      ok: false,
      permanente: true,
      motivo:
        "Nenhuma chave do par guardada deste lado — o CMCRM ainda não chamou esta instalação nenhuma vez.",
    };
  }
  if (!chave.callbackBaseUrl) {
    return {
      ok: false,
      permanente: true,
      motivo:
        "A demanda chegou sem `crm_callback_base_url`, então não há para onde devolver o evento.",
    };
  }

  const linha = await prisma.crmPairKey.findUnique({ where: { tenantId } });
  const conferidoRecentemente =
    linha?.verifiedAt && Date.now() - linha.verifiedAt.getTime() < CONFERENCIA_VALE_MS;
  if (conferidoRecentemente) {
    return { ok: true, base: chave.callbackBaseUrl, key: chave.key };
  }

  try {
    // Rede privada é permitida (o CMCRM real está na mesma LAN, como o CMSaaS),
    // e loopback/link-local seguem bloqueados pelo próprio guarda. O que impede
    // um endereço arbitrário de virar destino é a conferência logo abaixo.
    await assertPublicHttpsUrl(`${chave.callbackBaseUrl}/pair/verify`, {
      allowPrivateNetwork: true,
    });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : "endereço de retorno recusado";
    await prisma.crmPairKey.update({ where: { tenantId }, data: { verifyError: motivo } });
    return { ok: false, permanente: true, motivo };
  }

  let resposta: Response;
  try {
    resposta = await fetch(`${chave.callbackBaseUrl}/pair/verify`, {
      method: "GET",
      headers: { "X-Pair-Key": chave.key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const motivo = `Não foi possível alcançar o CMCRM em ${chave.callbackBaseUrl}: ${
      err instanceof Error ? err.message : String(err)
    }`;
    await prisma.crmPairKey.update({ where: { tenantId }, data: { verifyError: motivo } });
    return { ok: false, permanente: false, motivo };
  }

  if (resposta.status === 401 || resposta.status === 403) {
    const motivo = `O CMCRM recusou a chave do par (${resposta.status}) — o par pode ter sido revogado.`;
    await prisma.crmPairKey.update({ where: { tenantId }, data: { verifyError: motivo } });
    return { ok: false, permanente: true, motivo };
  }
  if (!resposta.ok) {
    const motivo = `O /pair/verify do CMCRM respondeu ${resposta.status}.`;
    await prisma.crmPairKey.update({ where: { tenantId }, data: { verifyError: motivo } });
    return { ok: false, permanente: false, motivo };
  }

  const corpo = (await resposta.json().catch(() => null)) as
    | { product?: string; installation_id?: string }
    | null;
  if (corpo?.product !== "cmcrm" || !corpo?.installation_id) {
    const motivo = "O endereço de retorno não respondeu como uma porta do CMCRM.";
    await prisma.crmPairKey.update({ where: { tenantId }, data: { verifyError: motivo } });
    return { ok: false, permanente: true, motivo };
  }
  if (corpo.installation_id !== chave.crmInstallationId) {
    // Este é o caso que a conferência existe para pegar: um endereço que
    // responde /pair/verify, mas de OUTRA instalação do CMCRM.
    const motivo = `O endereço de retorno é da instalação ${corpo.installation_id}, e o par é com ${chave.crmInstallationId}.`;
    await prisma.crmPairKey.update({ where: { tenantId }, data: { verifyError: motivo } });
    return { ok: false, permanente: true, motivo };
  }

  await prisma.crmPairKey.update({
    where: { tenantId },
    data: { verifiedAt: new Date(), verifyError: null },
  });
  return { ok: true, base: chave.callbackBaseUrl, key: chave.key };
}

export interface RespostaDoCrm {
  status: number;
  corpo: unknown;
}

/**
 * Uma chamada de escrita à porta do CMCRM.
 *
 * Nunca lança por status: quem chama precisa distinguir falha de NEGÓCIO (não
 * adianta repetir) de falha de TRANSPORTE (adianta), e uma exceção apagaria a
 * diferença. É a mesma separação que a F2 fez do lado do CRM.
 */
/**
 * A mesma porta, com um corpo BINÁRIO (`PUT .../proposals/{version}/document`).
 *
 * Função separada, e não um parâmetro de `chamarPortaDoCrm`: aqui não há
 * `Idempotency-Key`, e a ausência é do contrato, não esquecimento — a identidade
 * da mensagem é o `sha256` do próprio conteúdo, exatamente como no upload de
 * edital da F1. Passar uma chave de idempotência ao lado do hash daria duas
 * verdades sobre a mesma coisa, e a primeira divergência entre elas seria
 * invisível.
 */
export async function enviarBinarioAoCrm(
  destino: { base: string; key: string },
  caminho: string,
  conteudo: Buffer,
  mimeType: string
): Promise<RespostaDoCrm | { erroDeRede: string }> {
  try {
    const resposta = await fetch(`${destino.base}${caminho}`, {
      method: "PUT",
      headers: {
        "X-Pair-Key": destino.key,
        // `application/octet-stream` é o que a spec declara para este caminho, e é o
        // que o Fastify do outro lado tem parser: qualquer outro tipo volta 415 antes
        // de o handler de lá rodar.
        "Content-Type": "application/octet-stream",
        "X-Document-Mime-Type": mimeType,
      },
      body: new Uint8Array(conteudo),
      signal: AbortSignal.timeout(TIMEOUT_BINARIO_MS),
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

export async function chamarPortaDoCrm(
  destino: { base: string; key: string },
  metodo: "POST" | "PUT",
  caminho: string,
  idempotencyKey: string,
  corpo: unknown
): Promise<RespostaDoCrm | { erroDeRede: string }> {
  try {
    const resposta = await fetch(`${destino.base}${caminho}`, {
      method: metodo,
      headers: {
        "X-Pair-Key": destino.key,
        "Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
      },
      // Os MESMOS bytes a cada tentativa: o corpo vem congelado da fila, e o CRM
      // trata a mesma Idempotency-Key com corpo diferente como 409.
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
