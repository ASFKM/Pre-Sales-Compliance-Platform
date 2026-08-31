import { prisma } from "../../src/prisma";
import { runWithTenant } from "../../src/tenantContext";
import { randomId } from "../../src/idGenerator";
import {
  PoliticaDeSenha,
  POLITICA_PADRAO,
  normalizarPolitica,
  senhaExpirada,
} from "./politicaDeSenha";
import { comparePasswords } from "./security";

/**
 * F3 (01/09/2026) - quem le e grava a politica de senha, e quem guarda o historico de reuso.
 *
 * A politica e UMA LINHA POR TENANT (`password_policies`). Este produto e multi-tenant e cada
 * instalacao tem o proprio administrador, entao quem manda na politica e o tenant. No CMSaaS, que
 * nao tem conceito de tenant, a mesma politica e uma linha unica - os CAMPOS, porem, sao os
 * mesmos nos tres produtos (`server/utils/politicaDeSenha.ts`).
 *
 * TODA FUNCAO AQUI RECEBE `tenantId` EXPLICITO, e nao o pega do contexto. Duas razoes:
 *
 *   1. O gate de senha roda ANTES do `runWithTenant` do `requireAuth` - naquele ponto ainda nao
 *      ha contexto, e uma consulta sem contexto nao e recortada.
 *   2. O footgun documentado em `src/tenantContext.ts`: `runWithTenant(ctx, () => prisma.x.find())`
 *      sem `await` DENTRO da funcao executa a consulta fora da janela do contexto, sem recorte e
 *      sem erro. Por isso cada `runWithTenant` daqui tem um `async` com `await` na primeira linha.
 *
 * LINHA AUSENTE = PADRAO DE FABRICA. Nunca e erro: um tenant que nunca abriu a tela roda com
 * `POLITICA_PADRAO`, e a primeira gravacao cria a linha.
 */

/**
 * Cache curto porque `lerPolitica()` entra no caminho de TODA requisicao autenticada (o gate de
 * validade em `requireAuth`), e uma consulta a mais por request para ler sete valores e custo sem
 * contrapartida. 30 segundos e o atraso maximo entre salvar na tela e a regra valer noutro
 * processo; a gravacao zera a entrada do tenant que gravou, entao quem salvou ve o efeito na hora.
 */
const TTL_DO_CACHE_MS = 30_000;
const cache = new Map<string, { politica: PoliticaDeSenha; lidaEm: number }>();

function daLinha(linha: any): PoliticaDeSenha {
  return {
    comprimento_minimo: linha.comprimentoMinimo,
    exigir_maiuscula: linha.exigirMaiuscula,
    exigir_minuscula: linha.exigirMinuscula,
    exigir_numero: linha.exigirNumero,
    exigir_especial: linha.exigirEspecial,
    historico_de_reuso: linha.historicoDeReuso,
    validade_em_dias: linha.validadeEmDias,
  };
}

export function limparCacheDaPolitica(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function lerPolitica(tenantId: string): Promise<PoliticaDeSenha> {
  const emCache = cache.get(tenantId);
  if (emCache && Date.now() - emCache.lidaEm < TTL_DO_CACHE_MS) return emCache.politica;

  const linha = await runWithTenant({ tenantId }, async () => {
    return await prisma.passwordPolicy.findFirst({ where: { tenantId } });
  });
  const politica = linha ? daLinha(linha) : POLITICA_PADRAO;
  cache.set(tenantId, { politica, lidaEm: Date.now() });
  return politica;
}

export async function gravarPolitica(
  tenantId: string,
  entrada: Partial<PoliticaDeSenha>,
  atorUserId: string | null
): Promise<PoliticaDeSenha> {
  const atual = await lerPolitica(tenantId);
  const nova = normalizarPolitica(entrada, atual);
  const dados = {
    comprimentoMinimo: nova.comprimento_minimo,
    exigirMaiuscula: nova.exigir_maiuscula,
    exigirMinuscula: nova.exigir_minuscula,
    exigirNumero: nova.exigir_numero,
    exigirEspecial: nova.exigir_especial,
    historicoDeReuso: nova.historico_de_reuso,
    validadeEmDias: nova.validade_em_dias,
    updatedByUserId: atorUserId,
  };

  await runWithTenant({ tenantId }, async () => {
    const existente = await prisma.passwordPolicy.findFirst({ where: { tenantId } });
    if (existente) {
      await prisma.passwordPolicy.update({ where: { id: existente.id }, data: dados });
    } else {
      await prisma.passwordPolicy.create({ data: { id: randomId("pol"), tenantId, ...dados } });
    }
  });

  limparCacheDaPolitica(tenantId);
  return nova;
}

/**
 * HISTORICO DE REUSO - os dois cuidados que o modelo sozinho nao garante:
 *
 * 1. A tabela e PODADA a cada gravacao, para exatamente `historico_de_reuso` entradas. Nao
 *    guardamos "um pouco mais, vai que a politica sobe": um hash antigo continua sendo material
 *    de senha, e material que nao sera consultado e risco sem uso. Baixar o historico de 10 para
 *    3 apaga as 7 mais antigas na proxima troca - que e o comportamento correto, nao perda.
 * 2. NENHUMA rota devolve estes hashes. Eles so sao lidos aqui dentro, por `senhaJaFoiUsada`.
 */
export async function registrarSenhaNoHistorico(tenantId: string, userId: string, passwordHash: string): Promise<void> {
  const politica = await lerPolitica(tenantId);

  await runWithTenant({ tenantId }, async () => {
    if (politica.historico_de_reuso <= 0) {
      // Historico desligado: nada a guardar, e o que ja existia sai junto - mesma decisao do item
      // 1 acima, aplicada ao caso de o administrador desligar a verificacao.
      await prisma.passwordHistory.deleteMany({ where: { userId } });
      return;
    }

    await prisma.passwordHistory.create({ data: { id: randomId("pwh"), tenantId, userId, passwordHash } });

    const excedentes = await prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: politica.historico_de_reuso,
      select: { id: true },
    });
    if (excedentes.length > 0) {
      await prisma.passwordHistory.deleteMany({ where: { id: { in: excedentes.map((e) => e.id) } } });
    }
  });
}

/**
 * A senha nova e uma das ultimas `historico_de_reuso`?
 *
 * Cada comparacao e um scrypt inteiro (~100ms), entao isto custa proporcionalmente ao tamanho do
 * historico - e o preco de guardar hash com salt por senha, e e por isso que o teto do historico
 * e 24 e nao 500. Roda uma vez por troca de senha, nunca por login.
 */
export async function senhaJaFoiUsada(tenantId: string, userId: string, senhaNova: string): Promise<boolean> {
  const politica = await lerPolitica(tenantId);
  if (politica.historico_de_reuso <= 0) return false;

  const anteriores = await runWithTenant({ tenantId }, async () => {
    return await prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: politica.historico_de_reuso,
      select: { passwordHash: true },
    });
  });
  return anteriores.some((a) => comparePasswords(senhaNova, a.passwordHash));
}

/**
 * O GATE UNICO. `must_change_password` (definido pelo administrador) e a senha vencida pela
 * validade da politica barram a MESMA pessoa, entao precisam ser a MESMA pergunta - dois caminhos
 * que barram por motivos diferentes e como um deles ser esquecido numa rota. No PreSales ha tres
 * lugares que perguntam (`requireAuth`, `GET /me` e a resposta do login/MFA), e os tres chamam
 * esta funcao. Foi exatamente `GET /me` que ficou sem o gate ate a F1.
 */
export async function precisaTrocarSenha(user: {
  tenant_id: string;
  must_change_password: boolean;
  password_changed_at?: string | null;
}): Promise<boolean> {
  if (user.must_change_password) return true;
  const politica = await lerPolitica(user.tenant_id);
  return senhaExpirada(politica, user.password_changed_at ?? null);
}
