import { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { verifyPairKey, VerifiedPair } from "../utils/pairKey";
import { runWithTenant } from "../../src/tenantContext";

// CDC 16 — Fase 1. Autentica uma chamada de MÁQUINA, feita com a chave do par.
//
// Contraste deliberado com `requireAuth` (server/routes/auth.ts), que autentica
// uma pessoa: aqui não há sessão, não há papel e não há permissão. O que existe
// é um par declarado no CMSaaS, e a autorização é ele estar ativo (D01/D04).
//
// O contexto de tenant NÃO é propagado por `next()`. O padrão que este código
// base já aprendeu à força (ver os comentários em server/routes/documents.ts e
// em src/tenantContext.ts) é que o AsyncLocalStorage não chega de forma
// confiável ao handler quando há middleware de corpo no meio - e aqui há, tanto
// express.json quanto express.raw. Por isso o handler recebe o par no `req` e
// abre o escopo ele mesmo, com `runInPairTenant`.

export interface PairRequestContext {
  pair: VerifiedPair;
  /** A chave crua, para invalidar o cache quando a própria porta descobrir que o par mudou. */
  rawKey: string;
}

export function requirePairKey(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["x-pair-key"];
  const rawKey = typeof header === "string" ? header.trim() : "";

  void (async () => {
    try {
      const veredito = await verifyPairKey(rawKey);
      if (!veredito.ok) {
        res.status(veredito.status).json({ error: veredito.error, message: veredito.message });
        return;
      }
      (req as any).pairContext = { pair: veredito.pair, rawKey } satisfies PairRequestContext;
      // Enriquecer o logger da requisição com quem está do outro lado - é o
      // equivalente ao que requireAuth faz com userId/tenantId para uma pessoa.
      if (req.log) {
        req.log = req.log.child({
          tenantId: veredito.pair.tenantId,
          pairId: veredito.pair.pairId,
          crmInstallationId: veredito.pair.sides.cmcrm.installation_id,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}

export function pairContext(req: Request): PairRequestContext {
  const ctx = (req as any).pairContext as PairRequestContext | undefined;
  if (!ctx) {
    // Erro de montagem de rota, não de requisição: só acontece se alguém
    // registrar um handler da porta de máquina sem requirePairKey antes.
    throw new Error("pairContext ausente - esta rota precisa rodar atrás de requirePairKey.");
  }
  return ctx;
}

/**
 * Roda `fn` no escopo do tenant que a chave do par resolveu.
 *
 * `canSeeAllProjects: true` porque não há usuário: a regra de visibilidade por
 * dono/gerente/aprovador (src/prisma.ts) existe para recortar o que UMA PESSOA
 * enxerga, e aplicá-la sem pessoa recortaria por `userId: undefined`, que não
 * casa com nada. O recorte que vale aqui é o de tenant, que continua valendo.
 */
export function runInPairTenant<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const { pair } = pairContext(req);
  return runWithTenant({ tenantId: pair.tenantId, canSeeAllProjects: true }, fn);
}
