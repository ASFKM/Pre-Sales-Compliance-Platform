import crypto from "crypto";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { canonicalJsonDeep } from "./fleetLicense";
import { getCurrentTenantId } from "../../src/tenantContext";

// CDC 16 — Fase 1. Idempotência de toda escrita da porta de máquina.
//
// É a regra 1 do §4 do plano, e a razão de ela existir é a D10: o CMCRM entrega
// em SEGUNDO PLANO, COM RETENTATIVA. Sem isto, uma resposta perdida no meio do
// caminho faria a retentativa abrir uma segunda demanda para a mesma
// oportunidade - e nada, de nenhum dos dois lados, perceberia.
//
// O registro guarda a RESPOSTA, e não só a chave: a retentativa precisa receber
// o mesmo corpo de antes. Devolver 200 vazio obrigaria o outro lado a ir
// perguntar o que aconteceu, que é exatamente o passo que a retentativa existe
// para evitar.

/** Erro que o handler lança quando a chave foi reaproveitada para outro conteúdo. */
export class IdempotencyConflict extends Error {
  constructor(public readonly reason: "different_payload" | "in_flight", message: string) {
    super(message);
    this.name = "IdempotencyConflict";
  }
}

export interface IdempotentOutcome<T> {
  status: number;
  body: T;
  /** true quando a resposta veio do registro, e nada novo foi executado. */
  replayed: boolean;
}

// Reserva feita, execução ainda em curso.
const EM_VOO = 0;

// Depois disto, uma reserva em voo é tratada como ABANDONADA e a execução é
// refeita. Existe porque a reserva é gravada numa transação e a execução roda
// noutra: um processo que morre entre as duas (deploy, OOM, restart) deixaria a
// chave enterrada, e toda retentativa do CMCRM receberia 409 "em execução" para
// sempre - o oposto do que a idempotência existe para fazer. Refazer é seguro
// porque a própria escrita é idempotente pelo seu identificador natural (o
// demand_ref, que tem índice único).
const EM_VOO_ABANDONADO_APOS_MS = 90_000;

function exigirTenant(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("withIdempotency precisa rodar dentro de runWithTenant().");
  }
  return tenantId;
}

function hashDoPedido(payload: unknown): string {
  return crypto.createHash("sha256").update(canonicalJsonDeep(payload)).digest("hex");
}

/**
 * Executa `run` no máximo uma vez por (tenant, escopo, chave).
 *
 * Precisa rodar DENTRO de um escopo de tenant - o tenantId é injetado pela
 * extensão do Prisma (src/prisma.ts), como em qualquer outra escrita.
 *
 * A reserva é feita ANTES da execução, e não depois: duas requisições
 * simultâneas com a mesma chave são separadas pelo índice único
 * (tenant, escopo, chave), que é a única coisa que uma leitura-antes-de-escrever
 * não consegue garantir. A frente 14 já registrou um upsert concorrente que não
 * falhou e deixou o último a escrever ganhar; aqui a segunda requisição perde a
 * corrida no banco e é tratada como o que é: uma repetição.
 */
export async function withIdempotency<T>(
  scope: string,
  key: string,
  requestPayload: unknown,
  run: () => Promise<{ status: number; body: T }>
): Promise<IdempotentOutcome<T>> {
  const requestHash = hashDoPedido(requestPayload);

  const existente = await prisma.idempotencyRecord.findFirst({ where: { scope, key } });
  if (existente) {
    if (!emVooAbandonado(existente)) {
      return interpretarExistente<T>(existente, requestHash);
    }
    // Assume a reserva abandonada em vez de criar outra: o índice único não
    // deixaria criar, e sobrescrever o hash é o que permite a retentativa
    // legítima seguir com o mesmo corpo.
    await prisma.idempotencyRecord.updateMany({
      where: { id: existente.id, responseStatus: EM_VOO },
      data: { requestHash, createdAt: new Date() },
    });
    return await executarEGravar<T>(existente.id, run);
  }

  let reservaId: string;
  try {
    const reserva = await prisma.idempotencyRecord.create({
      data: {
        id: randomId("idem"),
        // Explícito, embora a extensão do Prisma também injete: sem ele o tipo
        // gerado exige a relação "tenant", e passar o id é o que todo o resto do
        // código base já faz (ver requireTenantId em src/dbStore.ts).
        tenantId: exigirTenant(),
        scope,
        key,
        requestHash,
        responseStatus: EM_VOO,
        responseBody: "",
      },
    });
    reservaId = reserva.id;
  } catch (err: any) {
    // P2002 = violação do índice único: alguém reservou a mesma chave entre a
    // leitura acima e esta escrita.
    if (err?.code !== "P2002") throw err;
    const agora = await prisma.idempotencyRecord.findFirst({ where: { scope, key } });
    if (!agora) throw err;
    return interpretarExistente<T>(agora, requestHash);
  }

  return executarEGravar<T>(reservaId, run);
}

function emVooAbandonado(registro: { responseStatus: number; createdAt: Date }): boolean {
  return registro.responseStatus === EM_VOO && Date.now() - registro.createdAt.getTime() > EM_VOO_ABANDONADO_APOS_MS;
}

async function executarEGravar<T>(
  reservaId: string,
  run: () => Promise<{ status: number; body: T }>
): Promise<IdempotentOutcome<T>> {
  try {
    const resultado = await run();
    await prisma.idempotencyRecord.update({
      where: { id: reservaId },
      data: { responseStatus: resultado.status, responseBody: JSON.stringify(resultado.body) },
    });
    return { status: resultado.status, body: resultado.body, replayed: false };
  } catch (err) {
    // A reserva some se a execução falhou: uma falha de validação ou de banco
    // não pode transformar a chave num túmulo que recusa a retentativa correta.
    await prisma.idempotencyRecord.deleteMany({ where: { id: reservaId } }).catch(() => undefined);
    throw err;
  }
}

function interpretarExistente<T>(
  registro: { requestHash: string; responseStatus: number; responseBody: string },
  requestHash: string
): IdempotentOutcome<T> {
  if (registro.requestHash !== requestHash) {
    throw new IdempotencyConflict(
      "different_payload",
      "Esta Idempotency-Key já foi usada com outro conteúdo. Use uma chave nova para um pedido novo."
    );
  }
  if (registro.responseStatus === EM_VOO) {
    throw new IdempotencyConflict(
      "in_flight",
      "Uma requisição com esta Idempotency-Key ainda está em execução. Repita em instantes."
    );
  }
  return { status: registro.responseStatus, body: JSON.parse(registro.responseBody) as T, replayed: true };
}
