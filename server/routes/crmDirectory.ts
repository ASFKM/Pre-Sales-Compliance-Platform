import express, { Response, NextFunction } from "express";
import type { Request } from "../types/express";
import { z } from "zod";
import { prisma } from "../../src/prisma";
import { randomId } from "../../src/idGenerator";
import { dbStore } from "../../src/dbStore";
import { requireAuth, requirePermission } from "./auth";
import { requireUserId } from "../middleware/security";
import {
  buscarEmpresaNoCrm,
  criarEmpresaNoCrm,
  criarOportunidadeNoCrm,
  estadoDoCrm,
  guardarOrganizacao,
} from "../utils/crmDirectory";

// CDC 16 — Fase 6. O passo do CRM no caminho secundário (D12/D31/D34).
//
// O pré-vendas sobe um edital direto, como sempre pôde. O que muda é que, HAVENDO PAR, ele
// pode agora procurar a empresa no CRM antes de criar outra, e criar lá a empresa e a
// oportunidade que faltavam — preenchendo as duas colunas de referência do projeto (D31).
//
// ## O modo standalone não muda uma linha
//
// `GET /api/crm/status` responde `ativo: false` quando não há par, quando o CRM está
// inalcançável ou quando nenhuma organização de lá habilitou a integração. A tela não oferece
// passo nenhum nesses casos, e o intake continua sendo exatamente o que era.
//
// ## Quem pode
//
// `project:create`. Quem pode criar o projeto pode vinculá-lo — e é a mesma pessoa, no mesmo
// ato. Exigir permissão nova faria o passo aparecer para quem não pode concluí-lo, e D34 já
// diz que ela não precisa de conta no CRM para nada disto.

const router = express.Router();

router.get("/status", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const estado = await estadoDoCrm(tenantId);
    res.json(estado);
  } catch (err) {
    next(err);
  }
});

const OrganizacaoSchema = z.object({ organization_id: z.string().min(1) });

router.put("/organization", requirePermission("project:create"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const userId = requireUserId(req);
    const { organization_id } = OrganizacaoSchema.parse(req.body);

    // Conferida contra a lista que o CRM devolve, e nunca aceita como veio: quem manda o id é a
    // mesma requisição que quer escrever naquela organização. A porta do outro lado recusaria de
    // qualquer jeito (403), e conferir aqui é o que transforma esse 403 numa mensagem útil.
    const estado = await estadoDoCrm(tenantId);
    if (!estado.ativo) return res.status(409).json({ success: false, message: estado.motivo });
    if (!estado.organizations.some((o) => o.id === organization_id)) {
      return res.status(400).json({
        success: false,
        message:
          "Esta organização não está entre as que já trocaram demandas por este par no CMCRM.",
      });
    }

    await guardarOrganizacao(tenantId, organization_id);
    await dbStore.addAuditLog({
      user_id: userId,
      action: "Set CRM organization for pair",
      entity_type: "CrmPairKey",
      entity_id: tenantId,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ organization_id }),
    });
    res.json({ success: true, organization_id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

router.get("/companies/search", requirePermission("project:create"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const taxId = typeof req.query.tax_id === "string" ? req.query.tax_id : undefined;
    const name = typeof req.query.name === "string" ? req.query.name : undefined;
    if (!taxId && !name) {
      return res.status(400).json({ success: false, message: "Informe CNPJ ou nome." });
    }
    const r = await buscarEmpresaNoCrm(tenantId, { taxId, name });
    if (!r.ok) return res.status(r.status && r.status < 500 ? 400 : 502).json({ success: false, message: r.motivo });
    res.json({ match_kind: r.match_kind, candidates: r.candidates });
  } catch (err) {
    next(err);
  }
});

const VinculoSchema = z
  .object({
    // Vincular a uma empresa que já existe lá.
    crm_company_id: z.string().min(1).optional(),
    // Ou criar a que não existia.
    company: z
      .object({
        name: z.string().min(1),
        legal_name: z.string().optional(),
        tax_id: z.string().optional(),
        sector: z.string().optional(),
      })
      .optional(),
    // Vincular a uma oportunidade ABERTA que já existe, em vez de abrir a segunda.
    crm_opportunity_id: z.string().min(1).optional(),
    opportunity_name: z.string().min(1).optional(),
    value: z.number().nonnegative().optional(),
    expected_close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine((v) => Boolean(v.crm_company_id) !== Boolean(v.company), {
    message: "Informe crm_company_id OU company, nunca os dois.",
  });

/**
 * O vínculo do projeto com o CRM.
 *
 * ## Por que depois do projeto, e não antes
 *
 * `POST /opportunities` do contrato exige `presales_project_id`: a oportunidade nasce sabendo a
 * qual projeto ela corresponde. O projeto, portanto, precisa existir antes — e é por isso que
 * este é um passo APÓS o `confirm` do intake, e não um campo dentro dele. O efeito colateral é
 * bom: o projeto nasce mesmo que o CRM esteja fora do ar, e o vínculo pode ser feito depois.
 *
 * ## A demanda espelho
 *
 * Criada dos dois lados, com o `demand_ref` que o CRM devolve. Sem ela, um projeto nascido aqui
 * nunca mandaria marco, retrato, proposta nem prazo — toda a fila de saída endereça
 * `/demands/{ref}/...`. Ela nasce `assigned`, com o dono do projeto, porque é a verdade: o
 * trabalho já começou e ninguém precisa assumi-lo. Nasce sem `sentBy*` porque não houve envio.
 */
router.post("/projects/:id/link", requirePermission("project:create"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.headers["x-tenant-id"] as string;
    const userId = requireUserId(req);
    const corpo = VinculoSchema.parse(req.body);

    const projeto = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { demand: true },
    });
    if (!projeto) return res.status(404).json({ success: false, message: "Projeto não encontrado." });
    if (projeto.crmOpportunityId) {
      return res
        .status(409)
        .json({ success: false, message: "Este projeto já está vinculado a uma oportunidade do CRM." });
    }

    // ── 1. A empresa ────────────────────────────────────────────────────────
    let crmCompanyId = corpo.crm_company_id ?? null;
    let empresaDeduplicada = false;
    if (!crmCompanyId && corpo.company) {
      const criada = await criarEmpresaNoCrm(
        tenantId,
        {
          name: corpo.company.name,
          legalName: corpo.company.legal_name,
          taxId: corpo.company.tax_id,
          sector: corpo.company.sector,
          presalesProjectId: projeto.id,
        },
        // Derivada do projeto: uma retentativa depois de o CRM ter criado devolve a MESMA
        // empresa, em vez de abrir a segunda com o mesmo nome.
        `company-${projeto.id}`
      );
      if (!criada.ok) {
        return res.status(criada.status && criada.status < 500 ? 400 : 502).json({ success: false, message: criada.motivo });
      }
      crmCompanyId = criada.crmCompanyId;
      empresaDeduplicada = criada.deduplicada;
    }
    if (!crmCompanyId) {
      return res.status(400).json({ success: false, message: "Nenhuma empresa informada." });
    }

    // ── 2. A oportunidade ───────────────────────────────────────────────────
    //
    // Vincular a uma ABERTA que já existe é o caminho preferido, e é para isso que a busca
    // devolve `open_opportunities`: quem sobe um edital de um cliente que já tem oportunidade
    // aberta quase sempre quer aquela, e abrir a segunda duplicaria o funil do vendedor.
    let crmOpportunityId = corpo.crm_opportunity_id ?? null;
    let demandRef: string | undefined;
    let semDono = false;
    if (!crmOpportunityId) {
      const usuario = await prisma.user.findUnique({ where: { id: userId } });
      const criada = await criarOportunidadeNoCrm(
        tenantId,
        {
          crmCompanyId,
          name: corpo.opportunity_name || projeto.opportunityName || projeto.name,
          presalesProjectId: projeto.id,
          expectedCloseDate: corpo.expected_close_date,
          value: corpo.value,
          // Referência externa, sem exigir conta no CRM (D34). O e-mail NÃO viaja: é dado
          // pessoal sem uso do outro lado, e a D32 já governa a direção oposta pelo mesmo
          // princípio.
          createdBy: { name: usuario?.name || "Pré-vendas", presales_user_id: userId },
        },
        `opp-${projeto.id}`
      );
      if (!criada.ok) {
        return res.status(criada.status && criada.status < 500 ? 400 : 502).json({ success: false, message: criada.motivo });
      }
      crmOpportunityId = criada.crmOpportunityId;
      demandRef = criada.demandRef;
      semDono = criada.semDono;
    }

    // ── 3. As referências no projeto (D31), e a demanda espelho ─────────────
    await prisma.project.update({
      where: { id: projeto.id },
      data: { crmCompanyId, crmOpportunityId },
    });

    if (demandRef && !projeto.demand) {
      const par = await prisma.crmPairKey.findUnique({ where: { tenantId } });
      const agora = new Date();
      await prisma.demand.create({
        data: {
          id: randomId("dem"),
          tenantId,
          demandRef,
          sequence: 1,
          source: "presales",
          // `assigned` e não `queued`: o projeto já existe e já tem dono. Um `queued` faria a
          // fila oferecer para alguém assumir um trabalho que já começou, e o SLA passaria a
          // cobrar um prazo de assumir que ninguém deve.
          status: "assigned",
          assignedUserId: projeto.ownerUserId,
          assignedAt: agora,
          queuedAt: agora,
          projectId: projeto.id,

          crmCompanyId,
          companyName: corpo.company?.name ?? projeto.customerName,
          companyLegalName: corpo.company?.legal_name ?? null,
          companyTaxId: corpo.company?.tax_id ?? null,

          crmOpportunityId,
          opportunityName: corpo.opportunity_name || projeto.opportunityName || projeto.name,
          value: corpo.value ?? null,
          currency: "BRL",
          origin: "presales",

          title: projeto.name,
          vertical: projeto.vertical,
          description: projeto.description,
          deadline: projeto.deadline,
          proposalValidityDate: projeto.proposalValidityDate,
          outputLanguage: projeto.outputLanguage,
          proposalLanguage: projeto.proposalLanguage,
          aiOrientationMode: projeto.aiOrientationMode,
          aiOrientationText: projeto.aiOrientationText,
          procurementModality: projeto.procurementModality,
          procurementSubtype: projeto.procurementSubtype,

          // Sem remetente: não houve envio do lado do CRM.
          sentByCrmUserId: null,
          sentByName: null,
          sentAt: agora,
          crmCallbackBaseUrl: par?.callbackBaseUrl ?? null,
          pairCrmInstallationId: par?.crmInstallationId ?? "desconhecida",
        },
      });
    }

    await dbStore.addAuditLog({
      user_id: userId,
      action: "Link project to CRM (secondary path)",
      entity_type: "Project",
      entity_id: projeto.id,
      project_id: projeto.id,
      ip_address: req.ip || "127.0.0.1",
      user_agent: req.headers["user-agent"] || "unknown",
      metadata: JSON.stringify({ crmCompanyId, crmOpportunityId, demandRef, semDono, empresaDeduplicada }),
    });

    res.status(201).json({
      success: true,
      crm_company_id: crmCompanyId,
      crm_opportunity_id: crmOpportunityId,
      demand_ref: demandRef ?? null,
      // Dito em voz alta para a tela poder dizê-lo: uma oportunidade sem dono não é um erro, é um
      // estado — e ela está na fila de sem dono do CRM esperando alguém do comercial adotá-la.
      unassigned: semDono,
      company_deduplicated: empresaDeduplicada,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: err.issues[0].message });
    }
    next(err);
  }
});

export default router;
