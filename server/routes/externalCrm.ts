import express, { Response, NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import type { Request } from "../types/express";
import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { requirePairKey, pairContext, runInPairTenant } from "../middleware/pairKeyAuth";
import { getFleetLicenseStatus, checkLicenseEnforcement } from "../utils/fleetLicense";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { withIdempotency, IdempotencyConflict } from "../utils/idempotency";
import { DemandCreateSchema, criarDemanda, toDemandState } from "../utils/demands";
import { logger } from "../utils/logger";

// CDC 16 — Fase 1. A PORTA DE MÁQUINA do PreSales: o que o CMCRM chama.
//
// Contrato: fleet-manager:docs/cdc/16-contratos/presales-inbound.v1.yaml.
// Montada em /api/external/crm/v1 (ver server.ts), que é o `servers.url` da spec.
//
// Nenhuma rota daqui tem sessão, papel ou permissão: a autenticação é a chave do
// par (server/middleware/pairKeyAuth.ts), e a autorização é o par estar ativo no
// CMSaaS. É a primeira superfície do produto assim - todas as outras
// (server/routes/*.ts) continuam exigindo sessão humana, e esta não afrouxa
// nenhuma delas: é superfície nova e separada (ADR 0001, §5).
//
// O que a F1 expõe, dos 6 caminhos da spec: /pair/verify, POST /demands,
// GET /demands/{ref} e o upload do binário. PATCH /demands/{ref}, /cancel e
// /purge são F7 e deliberadamente NÃO existem aqui - a API 404 do servidor
// responde por eles, que é a resposta honesta para o que ainda não nasceu.
//
// O identificador do módulo da integração no envelope de licença, derivado do
// par pelo CMSaaS (F0). Não é um módulo vendido: é o que o CMSaaS acrescenta
// quando o par existe, e retira quando ele é revogado (D05).
export const MODULO_INTEGRACAO = "integracao_crm_presales";

const router = express.Router();

/** Erro no formato que a spec define (`Error`), e não no `{success,message}` do resto do produto. */
function erro(res: Response, status: number, error: string, message: string, details?: string[]) {
  const corpo: Record<string, unknown> = { error, message };
  if (details?.length) corpo.details = details;
  return res.status(status).json(corpo);
}

router.use(requirePairKey);

// ─── GET /pair/verify ───────────────────────────────────────────────────────
//
// "Devolve a identificação deste lado e queue_enabled" - a spec.
//
// Note que a resposta descreve ESTE lado (product: presales), e não o par
// inteiro: quem quer o par inteiro pergunta ao CMSaaS, que é dono dele. O que só
// este lado sabe responder é se a fila está de pé aqui.
router.get("/pair/verify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pair } = pairContext(req);
    const licenca = await getFleetLicenseStatus(pair.tenantId);
    const enforcement = await runInPairTenant(req, () => checkLicenseEnforcement(pair.tenantId));

    // `queue_enabled` responde uma pergunta prática: vale a pena o CRM mandar
    // trabalho para cá agora? É falso quando o modo integrado ainda não chegou
    // na licença assinada desta instalação (o par acabou de nascer e o próximo
    // heartbeat ainda não veio) e quando a instalação está bloqueada por
    // licença - nos dois casos a demanda entraria numa fila que ninguém
    // consegue abrir.
    const queueEnabled = licenca.modules.includes(MODULO_INTEGRACAO) && !enforcement.blocked;

    res.json({
      installation_id: pair.sides.presales.installation_id,
      customer_id: pair.customerId,
      environment: pair.sides.presales.environment,
      product: "presales",
      queue_enabled: queueEnabled,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /demands ──────────────────────────────────────────────────────────
router.post("/demands", async (req: Request, res: Response, next: NextFunction) => {
  const chaveIdem = (req.headers["idempotency-key"] as string | undefined)?.trim();
  if (!chaveIdem || chaveIdem.length < 8) {
    return erro(
      res,
      400,
      "idempotency_key_required",
      "Idempotency-Key é obrigatório e precisa ter ao menos 8 caracteres."
    );
  }

  try {
    const { pair } = pairContext(req);
    const entrada = DemandCreateSchema.parse(req.body);

    const resultado = await runInPairTenant(req, () =>
      withIdempotency(`demand:create`, chaveIdem, req.body, async () => {
        // Reenvio da MESMA demanda com outra Idempotency-Key: o demand_ref é
        // único por tenant, então o segundo envio não duplica. Devolver 200 com
        // o estado atual é mais útil do que 409: o CRM queria garantir que a
        // demanda existe, e ela existe.
        const jaExiste = await prisma.demand.findFirst({
          where: { demandRef: entrada.demand_ref },
          include: { assignedUser: { select: { name: true } } },
        });
        if (jaExiste) {
          return { status: 200, body: toDemandState(jaExiste) };
        }

        let criada;
        try {
          criada = await criarDemanda(entrada, pair);
        } catch (err: any) {
          // P2002 no índice (tenant, demand_ref): duas chaves de idempotência
          // DIFERENTES para a mesma demanda, enviadas ao mesmo tempo. A leitura
          // acima não separa isso - o índice único separa. Quem perde a corrida
          // recebe o mesmo 200 que receberia se tivesse chegado um instante
          // depois, porque o que ele queria (a demanda existir) aconteceu.
          if (err?.code !== "P2002") throw err;
          const agora = await prisma.demand.findFirst({
            where: { demandRef: entrada.demand_ref },
            include: { assignedUser: { select: { name: true } } },
          });
          if (!agora) throw err;
          return { status: 200, body: toDemandState(agora) };
        }
        logger.info(
          { demandId: criada.id, demandRef: criada.demandRef, documentos: criada.documents.length, crossEnvironment: pair.crossEnvironment },
          "cdc16: demanda recebida do CMCRM e enfileirada"
        );
        return { status: 201, body: toDemandState(criada) };
      })
    );

    res.status(resultado.status).json(resultado.body);
  } catch (err) {
    if (err instanceof IdempotencyConflict) {
      return erro(res, 409, `idempotency_${err.reason}`, err.message);
    }
    if (err instanceof z.ZodError) {
      return erro(
        res,
        422,
        "validation_error",
        "Envelope inválido ou ficha incompleta.",
        err.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      );
    }
    next(err);
  }
});

// ─── GET /demands/{demand_ref} ──────────────────────────────────────────────
router.get("/demands/:demandRef", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const demanda = await runInPairTenant(req, () =>
      prisma.demand.findFirst({
        where: { demandRef: req.params.demandRef },
        include: { assignedUser: { select: { name: true } } },
      })
    );
    if (!demanda) {
      return erro(res, 404, "demand_not_found", "Não existe demanda com este demand_ref para este par.");
    }
    res.json(toDemandState(demanda));
  } catch (err) {
    next(err);
  }
});

// ─── PUT /demands/{demand_ref}/documents/{document_ref}/content ─────────────
//
// O binário sobe SEPARADO do registro (regra 2 do §4 do plano): a demanda é
// criada com os metadados e o hash de cada documento, e o conteúdo vem depois,
// um a um. Uma falha aqui não derruba o envio inteiro.
//
// Não exige Idempotency-Key, e isto é leitura deliberada do contrato: a spec
// declara o cabeçalho como obrigatório em POST /demands e em PATCH, e não neste
// caminho. Aqui a idempotência é o próprio sha256 (D11) - "hash já conhecido
// devolve 200 sem regravar" -, que é mais forte do que uma chave de mensagem:
// vale mesmo entre chamadas que o CRM nunca soube que eram a mesma.
router.put(
  "/demands/:demandRef/documents/:documentRef/content",
  express.raw({ type: () => true, limit: "25mb" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const corpo = req.body;
      if (!Buffer.isBuffer(corpo) || corpo.length === 0) {
        return erro(res, 400, "empty_body", "O corpo da requisição precisa ser o binário do documento.");
      }

      const resultado = await runInPairTenant(req, async () => {
        const demanda = await prisma.demand.findFirst({ where: { demandRef: req.params.demandRef } });
        if (!demanda) return { status: 404, body: { error: "demand_not_found", message: "Não existe demanda com este demand_ref para este par." } };

        const declaracao = await prisma.demandDocument.findFirst({
          where: { demandId: demanda.id, documentRef: req.params.documentRef },
        });
        if (!declaracao) {
          return {
            status: 404,
            body: { error: "document_not_declared", message: "Este document_ref não foi declarado no envelope desta demanda." },
          };
        }

        const sha = crypto.createHash("sha256").update(corpo).digest("hex");
        if (sha !== declaracao.sha256) {
          return {
            status: 422,
            body: {
              error: "sha256_mismatch",
              message: "O conteúdo enviado não corresponde ao sha256 declarado em /demands.",
              details: [`declarado: ${declaracao.sha256}`, `recebido: ${sha}`],
            },
          };
        }

        // Hash já conhecido não regrava (D11). Vale para a retentativa do mesmo
        // upload e para o adendo que repete um anexo já enviado.
        if (declaracao.storagePath && declaracao.contentReceivedAt) {
          return { status: 200, body: { stored: false, sha256: sha, message: "Conteúdo já existente com o mesmo hash - nada foi regravado." } };
        }

        const validacao = validateUploadedFile(declaracao.filename, declaracao.mimeType, corpo.length);
        if (!validacao.valid) {
          return { status: 422, body: { error: "file_rejected", message: validacao.error as string } };
        }

        const settings = await dbStore.getSettings();
        const storage = createStorageAdapter(settings);
        // O caminho usa o id LOCAL da demanda, nunca o demand_ref: o ref é texto
        // que o outro lado escolhe, e vira segmento de diretório aqui. Um
        // "../.." num ref sairia do diretório de uploads.
        const storagePath = await storage.uploadFile(demanda.id, corpo, declaracao.filename, declaracao.mimeType);

        await prisma.demandDocument.update({
          where: { id: declaracao.id },
          data: {
            storageProvider: settings.storage_mode,
            storagePath,
            contentReceivedAt: new Date(),
            // O tamanho declarado pode ter sido estimado do outro lado; o que
            // vale para cota e para a tela é o que realmente chegou.
            sizeBytes: corpo.length,
          },
        });

        return { status: 201, body: { stored: true, sha256: sha, size_bytes: corpo.length } };
      });

      res.status(resultado.status).json(resultado.body);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
