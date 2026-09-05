// Regenerates src/aiLogicVersions.fixture.json against the CURRENT source on disk. Run this as
// part of the same commit that intentionally changes a versioned function AND bumps its entry in
// src/aiLogicVersions.ts - see aiLogicVersions.test.ts's own comment for what this guards against.
//
// Usage: npx tsx scripts/generateLogicVersionFixture.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { extractFunctionSource } from "../src/aiLogicVersionExtractor";
import { LOGIC_VERSIONS } from "../src/aiLogicVersions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hashOf(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex");
}

const analysisRoutesPath = path.join(__dirname, "..", "server", "routes", "analysis.ts");
const bomEnrichmentSource = extractFunctionSource(
  fs.readFileSync(analysisRoutesPath, "utf8"),
  "async function enrichBomWithWebSearch("
);

// F6 da rodada 09/2026: `proposal_opinion_panel` tinha entrada em LOGIC_VERSIONS desde que o
// painel existe, mas NAO estava no fixture nem no teste - ou seja, o guard nunca o guardou. Os 4
// prompts de perspectiva podiam mudar (e mudaram, nesta fase) sem que nada falhasse, que e
// literalmente a defasagem silenciosa descrita no comentario de aiLogicVersions.ts e que ja custou
// ~5 bugs reais em bom_enrichment. `buildOpinionPrompt` e uma funcao nomeada, extraivel do mesmo
// jeito - nao havia impedimento tecnico, so a lacuna.
const proposalRoutesPath = path.join(__dirname, "..", "server", "routes", "proposals.ts");
const opinionPromptSource = extractFunctionSource(
  fs.readFileSync(proposalRoutesPath, "utf8"),
  "async function buildOpinionPrompt("
);

// F7 da rodada 09/2026: as tres funcoes de prompt da revisao assistida entram no fixture junto com
// o codigo que as criou, e nao numa fase seguinte. Foi assim que `proposal_opinion_panel` ficou 8
// rodadas fora do guard que dizia cobri-lo.
const remediationPromptSource = extractFunctionSource(
  fs.readFileSync(proposalRoutesPath, "utf8"),
  "function buildRemediationPrompt("
);
const grammarPromptSource = extractFunctionSource(
  fs.readFileSync(proposalRoutesPath, "utf8"),
  "function buildGrammarPrompt("
);
const coherencePromptSource = extractFunctionSource(
  fs.readFileSync(proposalRoutesPath, "utf8"),
  "function buildCoherencePrompt("
);

const fixture = {
  bom_enrichment: { version: LOGIC_VERSIONS.bom_enrichment, hash: hashOf(bomEnrichmentSource) },
  proposal_opinion_panel: { version: LOGIC_VERSIONS.proposal_opinion_panel, hash: hashOf(opinionPromptSource) },
  proposal_finding_remediation: { version: LOGIC_VERSIONS.proposal_finding_remediation, hash: hashOf(remediationPromptSource) },
  proposal_grammar_check: { version: LOGIC_VERSIONS.proposal_grammar_check, hash: hashOf(grammarPromptSource) },
  proposal_section_coherence: { version: LOGIC_VERSIONS.proposal_section_coherence, hash: hashOf(coherencePromptSource) },
};

const fixturePath = path.join(__dirname, "..", "src", "aiLogicVersions.fixture.json");
fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${fixturePath}:`, fixture); // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring -- dev-only script; fixturePath is a local path this same script computed, never external input
