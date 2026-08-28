// Staleness signal for HARDCODED prompt/parsing/matching logic in this codebase - distinct from
// AIAnalysisJob.promptTemplateVersion, which only versions the admin-editable prompt TEXT stored
// in the PromptTemplate table. Bump the relevant key here whenever you change matching/parsing/
// business-rule logic that affects what an AnalysisResult contains - NOT when a tenant admin edits
// their own PromptTemplate content in the Admin Console (that's already versioned separately).
//
// A CI test (src/aiLogicVersions.test.ts) hashes the source of each function listed below and
// fails if the hash changed without a matching version bump here - update BOTH in the same commit.
export const LOGIC_VERSIONS = {
  // server/routes/analysis.ts - the hardcoded document-extraction prompt/parsing for the initial
  // 8-section analysis (POST /projects/:projectId/analyze).
  document_analysis: 1,
  // server/routes/analysis.ts - enrichBomWithWebSearch. v6 bumped this session after ~5 real
  // fixes: JSON-extraction robustness against trailing citations, equipment-category mismatch
  // guard, manufacturer-precedence fix, project-wide mandatory brand policy threading, and JSON
  // parse retry + quote-escaping guidance. v7: structured brand_policy_applicable/compliant/note
  // self-report per item + computeBrandPolicyCrossCheck deterministic pass. v8 (2026-07-22):
  // catches up drift the golden-hash guard should have caught between 726129e (last time the
  // fixture was regenerated) and now - several commits since then (Tier 3 matching, rate-limit
  // backoff, identity-match dedup, confidence unification) touched this function without bumping
  // the version, so the fixture had gone silently stale; this bump also covers the current
  // session's own minLength/limit fix to the document-wide extractKnowledgeBaseKeywords calls
  // (the item-level call inside this function keeps minLength=3, already correct, unchanged).
  // v9 (F11, docs/cdc/16-integracao-cmcrm-presales.md, item 31): enrichBomWithWebSearch ganhou
  // um parâmetro `userId`, passado a recordAiUsage para atribuir a chamada a um dono - não muda
  // o que a função pesquisa/decide, só quem fica registrado como autor da chamada de IA.
  bom_enrichment: 9,
  // server/routes/proposals.ts - the 4 opinion-panel perspective prompt builders (technical/
  // commercial/legal/financial) and their shared cost-cap/sequential-execution worker. Stored on
  // ProposalOpinionRun.logicVersion directly (not AnalysisResult.logicVersions), same pattern.
  proposal_opinion_panel: 1,
} as const;

export type LogicVersionKey = keyof typeof LOGIC_VERSIONS;
