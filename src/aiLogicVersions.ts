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
  // v10 (F4 da rodada 09/2026): mesma natureza do bump anterior - a funcao passou a mandar ao
  // proxy do CMSaaS a tarefa real (`web_grounding`, no lugar do rotulo fixo "web_search"), o ator
  // e o gatilho. Nao muda o que ela pesquisa nem o que decide com o resultado; muda o que fica
  // registrado sobre a chamada. O bump existe porque o guard hasheia o CORPO da funcao, e a
  // alternativa - deixar o fixture defasado - foi exatamente o que aconteceu antes da v8.
  bom_enrichment: 10,
  // server/routes/proposals.ts - the 4 opinion-panel perspective prompt builders (technical/
  // commercial/legal/financial) and their shared cost-cap/sequential-execution worker. Stored on
  // ProposalOpinionRun.logicVersion directly (not AnalysisResult.logicVersions), same pattern.
  //
  // v2 (F6 da rodada 09/2026): os quatro prompts passaram a pedir APONTAMENTOS estruturados
  // (`findings[]`), cada um com titulo, detalhe, severidade e a secao que afeta. Diferente dos
  // bumps de `bom_enrichment` v9/v10, este NAO e so atribuicao de chamada: muda o que a IA e
  // solicitada a produzir e, portanto, o que fica gravado numa rodada. Uma rodada salva com
  // logicVersion 1 e legitimamente diferente de uma com 2 - a de antes nao tem apontamento nenhum,
  // e a tela precisa saber disso para nao apresentar "zero apontamentos" como se fosse um parecer
  // limpo. E exatamente para isso que este numero existe.
  // v3 (F7 da rodada 09/2026): os quatro prompts passaram a receber os apontamentos que ficaram
  // ABERTOS na rodada anterior e a pedir, para cada apontamento novo, qual deles ele CONTINUA
  // ("previous_finding_id"). Como o bump da v2, este nao e atribuicao de chamada: muda o que a IA
  // e solicitada a produzir e o que fica gravado - uma rodada v3 tem vinculo entre rodadas, uma v2
  // nao tem, e a comparacao "sanados / parciais / novos" so existe a partir da v3. A tela precisa
  // saber a diferenca para nao apresentar "100% novos" como se fosse a IA inventando pauta, quando
  // a verdade e que a rodada de tras nao tinha com que se comparar.
  proposal_opinion_panel: 3,
  // F7: a SANACAO por apontamento (server/routes/proposals.ts, buildRemediationPrompt). Le o par
  // texto anterior / texto novo de ProposalSectionEdit e devolve sanado | parcial | nao_sanado.
  // Entra no guard desde o nascimento - a licao da v2 do painel, que existiu por 8 rodadas sem
  // nunca ter sido hasheada, foi que a hora de por uma funcao de prompt sob guarda e quando ela e
  // escrita. O veredito e consultivo, mas fica GRAVADO na linha do apontamento: um prompt que mude
  // sem bump deixaria vereditos de formatos diferentes indistinguiveis no banco.
  proposal_finding_remediation: 1,
  // F7: a GRAMATICA por correcao pontual (buildGrammarPrompt). O contrato que este prompt sustenta
  // e byte a byte - o "trecho_original" tem de existir literalmente no texto, ou a correcao e
  // descartada por server/utils/proposalGrammar.ts. E exatamente o tipo de instrucao que se afrouxa
  // em silencio numa edicao futura, entao ela fica sob hash.
  proposal_grammar_check: 1,
  // F7: a COERENCIA DE TEXTO entre secoes (buildCoherencePrompt). O que este prompt guarda e uma
  // fronteira de projeto, nao so uma formatacao: a proibicao explicita de conferir numero, total,
  // prazo e item de material. A coerencia numerica e deterministica (server/utils/proposalQa.ts), e
  // relaxar essa frase levaria o produto de volta a mandar conta para modelo conferir.
  proposal_section_coherence: 1,
  // F9: o ASSISTENTE DO APROVADOR (buildApproverBriefingPrompt). O que este hash protege e a
  // PROIBICAO DE VEREDITO, e ela e o requisito da fase, nao o acabamento dela: um assistente
  // que recomende aprovar transforma o aprovador em carimbo e desfaz, no ultimo metro, a
  // governanca que as oito fases anteriores construiram. Junto com ela vai a proibicao de
  // conferir numero - a mesma fronteira que proposal_section_coherence defende - e o formato
  // dos pontos, que ficam GRAVADOS por versao do documento (ProposalApproverBriefing): um
  // prompt que mude sem bump deixaria resultados de formatos diferentes indistinguiveis no
  // banco, exatamente como o veredito de sanacao da F7.
  //
  // A proibicao tem uma segunda camada, em codigo, em server/utils/approverBriefing.ts - o
  // hash guarda a instrucao, o recorte guarda o resultado. Mudar uma sem a outra e o tipo de
  // afrouxamento silencioso que este guard existe para tornar barulhento.
  proposal_approver_briefing: 1,
} as const;

export type LogicVersionKey = keyof typeof LOGIC_VERSIONS;
