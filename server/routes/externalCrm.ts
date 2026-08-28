import express, { Response, NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import type { Request } from "../types/express";
import { prisma } from "../../src/prisma";
import { dbStore } from "../../src/dbStore";
import { requirePairKey, pairContext, runInPairTenant } from "../middleware/pairKeyAuth";
import { guardarChaveApresentada } from "../utils/crmPort";
import { getFleetLicenseStatus, checkLicenseEnforcement } from "../utils/fleetLicense";
import { createStorageAdapter, validateUploadedFile } from "../utils/storage";
import { withIdempotency, IdempotencyConflict } from "../utils/idempotency";
import { DemandCreateSchema, DemandPatchSchema, criarDemanda, toDemandState } from "../utils/demands";
import { registrarAtualizacao, aplicarCancelamento } from "../utils/demandLifecycleService";
import { executarExpurgo } from "../utils/crmPurge";
import { empurrarMarcoDaDemanda } from "../utils/crmOutbox";
import { calcularDueAt } from "../utils/demandSla";
import { lerSla } from "../utils/demandSlaConfig";
import { distribuirDemandaNova } from "../utils/demandAssignment";
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
// A F1 abriu quatro dos 6 caminhos da spec: /pair/verify, POST /demands,
// GET /demands/{ref} e o upload do binário. A F7 acrescenta os DOIS que
// faltavam - PATCH /demands/{ref} (D27) e POST /demands/{ref}/cancel (D18) -,
// mais /purge (D35), e com eles a superfície fecha em SEIS DE SEIS. O 404 que a
// prova da F1 conferia a cada fechamento, de propósito, deixa de valer aqui e
// vira conferência positiva: era a única forma verificável de dizer "ainda não
// existe" em vez de "existe pela metade".
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
    const { pair, rawKey } = pairContext(req);
    const entrada = DemandCreateSchema.parse(req.body);

    // F3: a chave que o CMCRM acabou de apresentar (e que `verifyPairKey` já
    // aprovou contra o CMSaaS) é guardada cifrada, junto do endereço de retorno
    // declarado no envelope. É o que dá a este lado como CHAMAR de volta - ver
    // a decisão 1 em server/utils/crmPort.ts. Não lança: uma falha aqui não
    // pode derrubar a criação da demanda, que é o que o CRM veio fazer.
    await guardarChaveApresentada(pair, rawKey, entrada.crm_callback_base_url ?? null);

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
          return { status: 200, body: toDemandState(jaExiste, await prazoDaEtapa(jaExiste)) };
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
          return { status: 200, body: toDemandState(agora, await prazoDaEtapa(agora)) };
        }
        logger.info(
          { demandId: criada.id, demandRef: criada.demandRef, documentos: criada.documents.length, crossEnvironment: pair.crossEnvironment },
          "cdc16: demanda recebida do CMCRM e enfileirada"
        );
        // F5 (D16, política `automatico`): a distribuição automática por menor
        // carga acontece AQUI, no ato da chegada, e não num varredor à parte —
        // uma demanda que fica minutos na fila esperando um distribuidor é uma
        // demanda que não foi distribuída. Nunca lança: uma falha em distribuir
        // deixa a demanda na fila, que é o comportamento de sempre, em vez de
        // recusar uma entrega que o CRM já considerou feita.
        const distribuida = await distribuirDemandaNova(criada.id, pair.tenantId);
        const estadoFinal = distribuida ?? criada;
        return { status: 201, body: toDemandState(estadoFinal, await prazoDaEtapa(estadoFinal)) };
      })
    );

    // A repetição responde 200, e não o 201 que ficou guardado da primeira vez.
    // A spec separa os dois de propósito - 201 é "criei agora", 200 é
    // "Idempotency-Key já usada, aqui está a demanda existente" -, e é por esse
    // status que o CMCRM distingue o envio que pegou do que já tinha pegado. Um
    // replay devolvendo 201 faria a retentativa parecer uma segunda criação, e
    // mentiria justamente para quem a idempotência existe para proteger.
    res.status(resultado.replayed ? 200 : resultado.status).json(resultado.body);
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
    res.json(toDemandState(demanda, await prazoDaEtapa(demanda)));
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /demands/{demand_ref} ────────────────────────────────────────────
//
// "Prazo alterado por impugnação, escopo revisto, valor renegociado. NÃO
// sobrescreve o que o pré-vendas já editou no projeto: chega como atualização
// pendente, que a pessoa vê com o antes e o depois e decide incorporar" (D27).
//
// A OPORTUNIDADE PERDIDA (D29) entra por aqui, e não por um caminho próprio: a
// spec não declara nenhum, e "avisa, e quem assumiu decide encerrar ou
// concluir" é exatamente o que uma atualização visível faz. O produto a
// reconhece pelo `opportunity.stage` e lhe dá destaque próprio na tela, sem que
// a perda vire um estado da demanda — ver `demandLifecycle.ts`.
router.patch("/demands/:demandRef", async (req: Request, res: Response, next: NextFunction) => {
  const chaveIdem = (req.headers["idempotency-key"] as string | undefined)?.trim();
  if (!chaveIdem || chaveIdem.length < 8) {
    return erro(res, 400, "idempotency_key_required", "Idempotency-Key é obrigatório e precisa ter ao menos 8 caracteres.");
  }

  try {
    const entrada = DemandPatchSchema.parse(req.body);

    const resultado = await runInPairTenant(req, () =>
      withIdempotency<Record<string, unknown>>(`demand:update`, chaveIdem, req.body, async () => {
        const demanda = await prisma.demand.findFirst({ where: { demandRef: req.params.demandRef } });
        if (!demanda) {
          return {
            status: 404,
            body: { error: "demand_not_found", message: "Não existe demanda com este demand_ref para este par." },
          };
        }
        const aplicada = await registrarAtualizacao(demanda.id, entrada);
        if (!aplicada.ok) {
          if (aplicada.motivo === "not_found") {
            return { status: 404, body: { error: "demand_not_found", message: "Não existe demanda com este demand_ref para este par." } };
          }
          // O 409 que a spec declara neste caminho, com o nome do estado: sem
          // ele, o CRM só saberia que houve conflito, e não que a demanda
          // acabou — que é a única informação que muda o que ele faz a seguir.
          return {
            status: 409,
            body: {
              error: "demand_closed",
              message: `Esta demanda está em '${aplicada.status}' e não aceita mais atualização.`,
            },
          };
        }
        return { status: 202, body: { pending_updates: aplicada.pendingUpdates } };
      })
    );

    res.status(resultado.status).json(resultado.body);
  } catch (err) {
    if (err instanceof IdempotencyConflict) {
      return erro(res, 409, `idempotency_${err.reason}`, err.message);
    }
    if (err instanceof z.ZodError) {
      return erro(res, 422, "validation_error", "Atualização inválida.", err.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`));
    }
    next(err);
  }
});

// ─── POST /demands/{demand_ref}/cancel ──────────────────────────────────────
//
// "O CRM só chama depois que o líder direto aprovou (D18). Enquanto a demanda
// está na fila sem dono, o cancelamento é efetivado na hora. Já assumida, vira
// pedido de encerramento que quem assumiu (ou o gerente) conclui - o corpo da
// resposta diz qual dos dois aconteceu."
//
// NÃO exige Idempotency-Key, e é leitura deliberada do contrato: a spec declara
// o cabeçalho em POST /demands e em PATCH, e não aqui - a mesma leitura que a
// F1 fez para o upload do binário. Exigir um cabeçalho que o contrato não
// declara recusaria um cliente conforme. A idempotência vem do próprio estado:
// cancelar o que já está cancelado devolve o mesmo 200 sem reescrever carimbo.
const CancelamentoSchema = z.object({
  justification: z.string().trim().min(10, "A justificativa precisa ter ao menos 10 caracteres."),
  approved_by: z.object({
    crm_user_id: z.string().min(1),
    name: z.string().min(1),
    email: z.string().optional(),
  }),
});

router.post("/demands/:demandRef/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entrada = CancelamentoSchema.parse(req.body);

    const resultado = await runInPairTenant(req, async () => {
      const demanda = await prisma.demand.findFirst({ where: { demandRef: req.params.demandRef } });
      if (!demanda) {
        return { status: 404, body: { error: "demand_not_found", message: "Não existe demanda com este demand_ref para este par." } };
      }

      const cancelamento = await aplicarCancelamento(demanda.id, {
        justificativa: entrada.justification,
        aprovadorCrmUserId: entrada.approved_by.crm_user_id,
        aprovadorNome: entrada.approved_by.name,
      });
      if (!cancelamento.ok) {
        if (cancelamento.motivo === "not_found") {
          return { status: 404, body: { error: "demand_not_found", message: "Não existe demanda com este demand_ref para este par." } };
        }
        // A spec declara só 200 e 404 aqui, e não previu a demanda que já
        // acabou por outro caminho. Responder 200 `cancelled` sobre uma demanda
        // CONCLUÍDA faria o CRM marcar como cancelada uma oportunidade cuja
        // proposta já foi entregue - mentir no corpo é pior do que devolver um
        // status que a spec não listou, e é o mesmo 409 que ela declara no
        // PATCH pelo mesmo motivo. Registrado no §10 e na spec, na F7.
        return { status: 409, body: { error: "demand_closed", message: cancelamento.mensagem } };
      }

      const atual = await prisma.demand.findFirst({
        where: { id: demanda.id },
        include: { assignedUser: { select: { name: true } } },
      });
      const estado = toDemandState(atual as any, await prazoDaEtapa(atual as any));

      // O `cancellation_ack` sai só quando a demanda DE FATO ficou cancelada, e
      // não quando o pedido foi registrado. "Ack" é confirmação de que acabou;
      // mandá-lo sobre um pedido pendente diria ao vendedor que o trabalho
      // parou enquanto alguém ainda o está fazendo. E ele sai SEM ator, porque
      // ninguém deste lado agiu: a fila não tinha dono, e pôr o aprovador do
      // CRM ali faria a timeline dizer que o líder trabalhou no pré-vendas.
      // (É a mesma decisão que a F5 tomou para o `sla_breached`, cujo ator é o
      // relógio.)
      if (cancelamento.desfecho === "cancelled" && !cancelamento.jaEstava) {
        await empurrarMarcoDaDemanda({
          tenantId: cancelamento.demanda.tenantId,
          demanda: cancelamento.demanda,
          event: "cancellation_ack",
          occurredAt: cancelamento.demanda.cancelledAt ?? new Date(),
          note: "Cancelada na fila, antes de alguém assumir.",
          projectId: cancelamento.demanda.projectId,
        });
      }

      return {
        status: 200,
        body: { outcome: cancelamento.desfecho, state: estado },
      };
    });

    res.status(resultado.status).json(resultado.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return erro(res, 422, "validation_error", "Pedido de cancelamento inválido.", err.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`));
    }
    next(err);
  }
});

// ─── POST /purge ────────────────────────────────────────────────────────────
//
// O expurgo em cascata (D35). Não é endereçado por `demand_ref` - é caminho de
// raiz na spec, e alcança tudo o que veio daquele documento ou daquela empresa,
// em qualquer estado do ciclo. Conformidade não espera o trabalho terminar.
//
// Também não exige Idempotency-Key, e aqui a razão é mais forte do que a
// leitura do contrato: o expurgo é idempotente por natureza. Apagar o que já
// não existe apaga zero, e cada chamada vira um REGISTRO próprio - porque o
// registro é de EXECUÇÃO, e não de efeito: saber que o CRM pediu duas vezes é
// parte do que uma auditoria vai querer ler.
const ExpurgoSchema = z.object({
  reason: z.enum(["retention", "data_subject_request"]),
  targets: z
    .array(z.object({ kind: z.enum(["document", "company"]), crm_id: z.string().min(1) }))
    .min(1, "É preciso declarar ao menos um alvo."),
});

router.post("/purge", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entrada = ExpurgoSchema.parse(req.body);
    const { pair } = pairContext(req);

    const resultado = await runInPairTenant(req, () =>
      executarExpurgo({
        tenantId: pair.tenantId,
        crmInstallationId: pair.sides.cmcrm.installation_id,
        reason: entrada.reason,
        targets: entrada.targets,
      })
    );

    res.json({ purged: resultado.purged, executed_at: resultado.executed_at });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return erro(res, 422, "validation_error", "Pedido de expurgo inválido.", err.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`));
    }
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

/**
 * O prazo da etapa devida, para a resposta do contrato (F5, D19).
 *
 * `undefined` quando não há SLA configurado — o estado de toda instalação que
 * existe hoje, e o que a F1 já respondia.
 */
async function prazoDaEtapa(demanda: {
  status: string;
  deadline: Date;
  queuedAt: Date;
  assignedAt: Date | null;
  analysisStartedAt: Date | null;
}): Promise<string | undefined> {
  const sla = await lerSla();
  const due = calcularDueAt({ id: "", ...demanda }, sla);
  return due ? due.toISOString() : undefined;
}

export default router;
