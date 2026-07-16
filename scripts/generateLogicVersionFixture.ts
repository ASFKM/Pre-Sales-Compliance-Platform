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

const fixture = {
  bom_enrichment: { version: LOGIC_VERSIONS.bom_enrichment, hash: hashOf(bomEnrichmentSource) },
};

const fixturePath = path.join(__dirname, "..", "src", "aiLogicVersions.fixture.json");
fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
console.log(`Wrote ${fixturePath}:`, fixture);
