import { prisma } from "../../src/prisma";
import { logger } from "./logger";

// CDC 16 — Fase 3. O retrato do projeto vinculado, no formato do `ProjectState`
// da spec `cmcrm-inbound.v1.yaml`.
//
// "Substitui o retrato anterior por completo" - por isso este arquivo monta o
// retrato INTEIRO a cada vez, lendo o estado atual, e nunca um delta. Um delta
// obrigaria os dois lados a concordar sobre o que "não mudou" significa, e a
// primeira divergência ficaria invisível.
//
// De onde sai cada campo, medido no schema deste produto:
//  - `status`: Project.status - os seis valores do enum são exatamente os seis
//    do contrato, o que não é coincidência: a spec foi escrita a partir daqui;
//  - `scope_summary` e `technical_risks`: AnalysisResult, que é o resultado da
//    análise técnica. Sem análise ainda, os dois ficam de fora - um resumo vazio
//    diria ao vendedor que o escopo é vazio, e não que ainda não foi analisado;
//  - `poc`: a POC mais recente do projeto e o aceite dela, quando existirem;
//  - `working_value`: a folha de precificação mais recente. É guardado do outro
//    lado e NÃO sobrescreve o valor da oportunidade - isso é a trilha de valor,
//    que é F4.

interface RiscoDaAnalise {
  title?: string;
  description?: string;
  severity?: string;
  mitigation?: string;
}

interface ResumoExecutivo {
  project_overview?: string;
  main_requirements?: string;
  recommended_strategy?: string;
}

/** A régua de severidade da análise é de quatro degraus; a do contrato, de três. */
const SEVERIDADE: Record<string, "baixa" | "media" | "alta"> = {
  low: "baixa",
  medium: "media",
  high: "alta",
  // `critical` vira `alta`, e não some: o contrato não tem um quarto degrau, e
  // silenciar o risco mais grave por falta de rótulo seria o pior desfecho.
  critical: "alta",
};

export async function montarRetratoDoProjeto(
  projectId: string
): Promise<Record<string, unknown> | null> {
  try {
    const projeto = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, ownerUserId: true, owner: { select: { name: true } } },
    });
    if (!projeto) return null;

    const retrato: Record<string, unknown> = {
      presales_project_id: projeto.id,
      status: projeto.status,
    };
    if (projeto.owner?.name) {
      retrato.owner = { name: projeto.owner.name, presales_user_id: projeto.ownerUserId };
    }

    const base = (process.env.APP_URL || "").replace(/\/+$/, "");
    if (base) retrato.link = `${base}/projects/${projeto.id}`;

    const analise = await prisma.analysisResult.findUnique({
      where: { projectId },
      select: { executiveSummary: true, risks: true },
    });
    if (analise) {
      const resumo = (analise.executiveSummary ?? {}) as ResumoExecutivo;
      const escopo = [resumo.project_overview, resumo.main_requirements]
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .join("\n\n")
        .trim();
      if (escopo) retrato.scope_summary = escopo.slice(0, 4000);

      const riscos = Array.isArray(analise.risks) ? (analise.risks as RiscoDaAnalise[]) : [];
      const mapeados = riscos
        .map((r) => {
          const descricao = [r.title, r.description]
            .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
            .join(" — ")
            .trim();
          if (!descricao) return null;
          const severidade = SEVERIDADE[(r.severity ?? "").toLowerCase()];
          return severidade
            ? { description: descricao.slice(0, 1000), severity: severidade }
            : { description: descricao.slice(0, 1000) };
        })
        .filter((r): r is { description: string; severity?: "baixa" | "media" | "alta" } => r !== null);
      if (mapeados.length > 0) retrato.technical_risks = mapeados;
    }

    const poc = await prisma.poc.findFirst({
      where: { projectId, archived: false },
      orderBy: { createdAt: "desc" },
      select: { status: true, acceptance: { select: { decision: true, signedAt: true, approvedAt: true } } },
    });
    if (poc) {
      const bloco: Record<string, unknown> = { exists: true, status: poc.status };
      if (poc.acceptance?.decision) bloco.acceptance_decision = poc.acceptance.decision;
      const aceitoEm = poc.acceptance?.signedAt ?? poc.acceptance?.approvedAt;
      if (aceitoEm) bloco.accepted_at = aceitoEm.toISOString();
      retrato.poc = bloco;
    }

    const folha = await prisma.projectPricingSheet.findFirst({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        updatedAt: true,
        // Não há coluna de total por linha: o valor da linha é quantidade × preço
        // unitário final, e é assim que a própria tela de precificação o calcula.
        lines: { select: { quantity: true, finalUnitPrice: true } },
      },
    });
    if (folha && folha.lines.length > 0) {
      const total = folha.lines.reduce(
        (soma, l) => soma + (l.finalUnitPrice ?? 0) * (l.quantity ?? 0),
        0,
      );
      if (total > 0) {
        retrato.working_value = {
          amount: Number(total.toFixed(2)),
          currency: "BRL",
          computed_at: folha.updatedAt.toISOString(),
        };
      }
    }

    return retrato;
  } catch (err) {
    logger.warn({ err, projectId }, "cdc16 F3: falha ao montar o retrato do projeto para o CRM");
    return null;
  }
}
