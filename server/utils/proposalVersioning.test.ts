import { describe, expect, it } from "vitest";
import { canReopenProposal, buildReopenedProposalFields, ReopenedDocuments } from "./proposalVersioning";
import { Proposal } from "../../src/types";

const DOCUMENTS: ReopenedDocuments = {
  docx_file_path: "/uploads/proposals/p1/commercial_v2.docx",
  pdf_file_path: "/uploads/proposals/p1/commercial_v2.pdf",
  storage_provider: "local",
  editable_content: "texto da v2",
};

function propostaRejeitada(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop_v1",
    project_id: "p1",
    proposal_type: "commercial",
    template_id: "t2",
    template_version: "v2.0",
    status: "rejected",
    language: "Portuguese",
    docx_file_path: "/uploads/proposals/p1/commercial_v1.docx",
    pdf_file_path: "/uploads/proposals/p1/commercial_v1.pdf",
    storage_provider: "local",
    generated_by: "Elena Rostova",
    generated_at: "2026-08-01T10:00:00.000Z",
    version: 1,
    proposal_group_id: "prop_v1",
    previous_version_id: null,
    approval_workflow_id: "w1",
    manual_pricing_table: [],
    payment_terms: "30/60/90 dias",
    delivery_terms: "45 dias após o pedido",
    proposal_validity: "2026-12-31",
    commercial_assumptions: "Instalação em horário comercial",
    exclusions: "Obra civil",
    editable_content: "texto da v1",
    latest_opinion_run_id: "por_da_v1",
    ...overrides,
  };
}

describe("PreSales F8 — canReopenProposal", () => {
  it("só uma proposta rejeitada reabre", () => {
    expect(canReopenProposal("rejected")).toEqual({ allowed: true });
  });

  it("recusa qualquer outro status, dizendo qual é o status atual", () => {
    for (const status of ["draft", "submitted", "approved", "released"] as const) {
      const guard = canReopenProposal(status);
      expect(guard.allowed).toBe(false);
      expect(guard.allowed === false && guard.message).toContain(`'${status}'`);
    }
  });
});

describe("PreSales F8 — buildReopenedProposalFields", () => {
  it("incrementa a versão a partir da rejeitada (o campo `version` era morto antes desta fase)", () => {
    expect(buildReopenedProposalFields(propostaRejeitada(), DOCUMENTS, "Marcus Vance").version).toBe(2);
    expect(buildReopenedProposalFields(propostaRejeitada({ version: 4 }), DOCUMENTS, "Marcus Vance").version).toBe(5);
  });

  it("mantém o mesmo proposal_group_id — a v3 continua no grupo aberto pela v1", () => {
    const v3 = buildReopenedProposalFields(
      propostaRejeitada({ id: "prop_v2", version: 2, proposal_group_id: "prop_v1", previous_version_id: "prop_v1" }),
      DOCUMENTS,
      "Marcus Vance"
    );
    expect(v3.proposal_group_id).toBe("prop_v1");
    expect(v3.version).toBe(3);
    expect(v3.previous_version_id).toBe("prop_v2");
  });

  it("liga a versão nova à rejeitada por previous_version_id", () => {
    expect(buildReopenedProposalFields(propostaRejeitada(), DOCUMENTS, "Marcus Vance").previous_version_id).toBe("prop_v1");
  });

  it("a versão nova nasce em draft — é isso que faz o PUT já existente funcionar nela sem mudança", () => {
    expect(buildReopenedProposalFields(propostaRejeitada(), DOCUMENTS, "Marcus Vance").status).toBe("draft");
  });

  it("NÃO carrega o parecer de IA da versão rejeitada (o parecer descreve um documento que não é o da v2)", () => {
    const v2 = buildReopenedProposalFields(propostaRejeitada(), DOCUMENTS, "Marcus Vance");
    expect("latest_opinion_run_id" in v2).toBe(false);
  });

  it("NÃO reaproveita os caminhos de arquivo da v1 — se reaproveitasse, o primeiro PUT na v2 apagaria o documento da proposta rejeitada", () => {
    const rejeitada = propostaRejeitada();
    const v2 = buildReopenedProposalFields(rejeitada, DOCUMENTS, "Marcus Vance");
    expect(v2.docx_file_path).toBe(DOCUMENTS.docx_file_path);
    expect(v2.pdf_file_path).toBe(DOCUMENTS.pdf_file_path);
    expect(v2.docx_file_path).not.toBe(rejeitada.docx_file_path);
    expect(v2.pdf_file_path).not.toBe(rejeitada.pdf_file_path);
  });

  it("copia todo o conteúdo comercial e os metadados de origem da rejeitada", () => {
    const rejeitada = propostaRejeitada();
    const v2 = buildReopenedProposalFields(rejeitada, DOCUMENTS, "Marcus Vance");
    expect(v2).toMatchObject({
      project_id: rejeitada.project_id,
      proposal_type: rejeitada.proposal_type,
      template_id: rejeitada.template_id,
      template_version: rejeitada.template_version,
      language: rejeitada.language,
      approval_workflow_id: rejeitada.approval_workflow_id,
      payment_terms: rejeitada.payment_terms,
      delivery_terms: rejeitada.delivery_terms,
      proposal_validity: rejeitada.proposal_validity,
      commercial_assumptions: rejeitada.commercial_assumptions,
      exclusions: rejeitada.exclusions,
    });
  });

  it("registra quem reabriu, não quem gerou a versão anterior", () => {
    const v2 = buildReopenedProposalFields(propostaRejeitada(), DOCUMENTS, "Marcus Vance");
    expect(v2.generated_by).toBe("Marcus Vance");
  });

  it("também vale para os 4 tipos de relatório sem campo comercial editável — a v2 é criada do mesmo jeito (consistência de auditoria)", () => {
    for (const tipo of ["executive_summary", "risk_report", "bom_report", "questions_report"] as const) {
      const v2 = buildReopenedProposalFields(propostaRejeitada({ proposal_type: tipo }), DOCUMENTS, "Marcus Vance");
      expect(v2.proposal_type).toBe(tipo);
      expect(v2.version).toBe(2);
      expect(v2.status).toBe("draft");
    }
  });
});
