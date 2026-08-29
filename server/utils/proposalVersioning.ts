// PreSales F8 (PARTE B) - versionamento por reabertura pós-rejeição.
//
// As regras que decidem O QUE a versão nova é ficam aqui, puras e sem banco, pelo mesmo motivo que
// getRejectedEditableFields (server/utils/proposalTypes.ts) e validateApprovalDecisionComments
// (server/utils/approvalDecision.ts): dá para provar por teste unitário, sem Postgres, exatamente a
// parte em que um erro passaria despercebido (copiar um campo a menos, esquecer de incrementar a
// versão, carregar o parecer de IA da versão rejeitada para a nova). O resto - RBAC, escrita real
// dos arquivos, o `@unique` do elo - é provado por execução real contra o servidor.
//
// A decisão de arquitetura que isto materializa: reabrir NÃO muta a proposta rejeitada. Ela fica
// `rejected` para sempre, congelada, com os arquivos DOCX/PDF e os pareceres que tinha. A versão
// nova é uma LINHA nova, ligada à anterior por `previous_version_id` e ao histórico inteiro por
// `proposal_group_id`.

import { Proposal } from "../../src/types";

export type ReopenGuard = { allowed: true } | { allowed: false; message: string };

// Só uma proposta REJEITADA reabre. `draft` já é editável (o PUT resolve), `submitted` está em
// julgamento, `approved`/`released` viraram compromisso - abrir uma "v2" a partir de qualquer um
// desses estados criaria duas versões vivas da mesma proposta ao mesmo tempo.
export function canReopenProposal(status: Proposal["status"]): ReopenGuard {
  if (status !== "rejected") {
    return {
      allowed: false,
      message: `Only rejected proposals can be reopened as a new version. Current status is '${status}'.`,
    };
  }
  return { allowed: true };
}

export interface ReopenedDocuments {
  docx_file_path: string;
  pdf_file_path: string;
  storage_provider: Proposal["storage_provider"];
  editable_content: string;
}

// O conjunto exato de campos com que a versão nova nasce.
//
// `latest_opinion_run_id` NÃO aparece aqui de propósito, e essa ausência é a decisão: a v2 nasce
// sem parecer de IA, igual a qualquer proposta recém-gerada. O gatilho de parecer neste produto
// nunca foi automático - é o usuário que dispara POST /proposals/:id/opinion-panel pela tela, e só
// em `draft`. Herdar o `latest_opinion_run_id` da v1 mostraria na v2 um parecer escrito sobre um
// documento que não é mais o dela.
//
// Os caminhos de arquivo também não são copiados: eles vêm de `documents`, que é o resultado de uma
// geração NOVA. Copiar os da v1 faria as duas versões apontarem para o mesmo arquivo, e a primeira
// edição da v2 (PUT, que apaga o arquivo antigo) destruiria o documento da proposta rejeitada.
export function buildReopenedProposalFields(
  rejected: Proposal,
  documents: ReopenedDocuments,
  generatedBy: string
): Omit<Proposal, "id" | "generated_at" | "latest_opinion_run_id"> {
  return {
    project_id: rejected.project_id,
    proposal_type: rejected.proposal_type,
    template_id: rejected.template_id,
    template_version: rejected.template_version,
    status: "draft",
    language: rejected.language,
    docx_file_path: documents.docx_file_path,
    pdf_file_path: documents.pdf_file_path,
    storage_provider: documents.storage_provider,
    generated_by: generatedBy,
    version: rejected.version + 1,
    proposal_group_id: rejected.proposal_group_id,
    previous_version_id: rejected.id,
    approval_workflow_id: rejected.approval_workflow_id,
    manual_pricing_table: rejected.manual_pricing_table,
    payment_terms: rejected.payment_terms,
    delivery_terms: rejected.delivery_terms,
    proposal_validity: rejected.proposal_validity,
    commercial_assumptions: rejected.commercial_assumptions,
    exclusions: rejected.exclusions,
    editable_content: documents.editable_content,
  };
}
