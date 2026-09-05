import { describe, it, expect } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LOGIC_VERSIONS } from "./aiLogicVersions";
import { extractFunctionSource } from "./aiLogicVersionExtractor";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Golden-hash guard: if a versioned function's source changes, its LOGIC_VERSIONS entry AND this
// fixture must be updated together in the same commit (see aiLogicVersions.ts's own comment for
// why AnalysisResult.logic_versions exists at all). A bumped version with a stale fixture hash, or
// a changed function with a stale version, both fail loudly here instead of silently letting the
// staleness signal under-report - the exact class of gap that let ~5 real bom_enrichment bugs ship
// this session with no way for already-saved AnalysisResult rows to know they were outdated.
//
// "document_analysis" segue de fora: a logica principal dela vive inline num route handler grande
// do Express, nao isolada como funcao propria, entao nao serve para a tecnica de hash de fonte.
// Ela ainda tem entrada em LOGIC_VERSIONS e depende de disciplina de revisao por enquanto.
//
// F6 da rodada 09/2026: "proposal_opinion_panel" ENTROU aqui. Ele tinha entrada em LOGIC_VERSIONS
// desde que o painel de pareceres existe, mas nunca esteve no fixture nem neste teste - o guard
// declarava cobri-lo e nao cobria. `buildOpinionPrompt` e funcao nomeada e extraivel, igual a
// enrichBomWithWebSearch; era so lacuna, nao impedimento. Fechar isso importa mais nesta fase do
// que nas anteriores: o formato do parecer agora tem consequencia de dado (uma rodada v1 nao tem
// apontamentos, uma v2 tem), entao um prompt que mude sem bump deixaria rodadas indistinguiveis.
const FIXTURE_PATH = path.join(__dirname, "aiLogicVersions.fixture.json");

function hashOf(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex");
}

interface FixtureEntry {
  version: number;
  hash: string;
}

function checkLogicVersion(key: keyof typeof LOGIC_VERSIONS, filePath: string, functionSignature: string) {
  const fileContent = fs.readFileSync(filePath, "utf8");
  const source = extractFunctionSource(fileContent, functionSignature);
  const currentHash = hashOf(source);

  const fixture: Record<string, FixtureEntry> = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const entry = fixture[key];
  if (!entry) throw new Error(`No fixture entry for "${key}" in ${FIXTURE_PATH} - add one.`);

  if (currentHash !== entry.hash) {
    expect(
      LOGIC_VERSIONS[key],
      `"${key}"'s source changed but LOGIC_VERSIONS.${key} (${LOGIC_VERSIONS[key]}) still matches ` +
        `the fixture's recorded version (${entry.version}). Bump LOGIC_VERSIONS.${key} in ` +
        `src/aiLogicVersions.ts AND regenerate ${FIXTURE_PATH} (see ` +
        `scripts/generateLogicVersionFixture.ts) in this same commit.`
    ).not.toBe(entry.version);
  } else {
    expect(
      LOGIC_VERSIONS[key],
      `"${key}"'s source did NOT change, but LOGIC_VERSIONS.${key} (${LOGIC_VERSIONS[key]}) no ` +
        `longer matches the fixture's recorded version (${entry.version}) - either revert the ` +
        `unnecessary version bump, or regenerate the fixture if this was intentional.`
    ).toBe(entry.version);
  }
}

describe("AI logic version golden-hash guard", () => {
  it("bom_enrichment version matches the fixture hash of enrichBomWithWebSearch's source", () => {
    checkLogicVersion(
      "bom_enrichment",
      path.join(__dirname, "..", "server", "routes", "analysis.ts"),
      "async function enrichBomWithWebSearch("
    );
  });

  it("proposal_opinion_panel version matches the fixture hash of buildOpinionPrompt's source", () => {
    checkLogicVersion(
      "proposal_opinion_panel",
      path.join(__dirname, "..", "server", "routes", "proposals.ts"),
      "async function buildOpinionPrompt("
    );
  });
});
