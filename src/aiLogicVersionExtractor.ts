// Shared brace/string/regex-aware function-source extractor, used by both
// aiLogicVersions.test.ts (the CI guard) and scripts/generateLogicVersionFixture.ts (regenerates
// the fixture when a version is intentionally bumped) - kept as one implementation so the two
// never drift apart.
//
// TypeScript 7's "typescript" npm package in this project doesn't expose the classic compiler API
// (require("typescript") only has {version, versionMajorMinor}) - a real AST parse wasn't
// available, so this is a careful character scanner instead. It must recognize string/template
// literals AND regex literals - enrichBomWithWebSearch (server/routes/analysis.ts) uses regex like
// /\[\s*\{/ containing a literal "{" that a naive brace counter would miscount as code.
export function extractFunctionSource(fileContent: string, functionSignature: string): string {
  const startIdx = fileContent.indexOf(functionSignature);
  if (startIdx === -1) throw new Error(`Could not find function: ${functionSignature}`);

  let depth = 0;
  let started = false;
  let inString: false | string = false;
  let escape = false;
  let lastSignificantChar = "";

  for (let i = startIdx; i < fileContent.length; i++) {
    const ch = fileContent[i];

    if (inString) {
      if (escape) { escape = false; }
      else if (ch === "\\") { escape = true; }
      else if (ch === inString) { inString = false; lastSignificantChar = ch; }
      continue;
    }

    if (ch === "/" && fileContent[i + 1] === "/") {
      const nl = fileContent.indexOf("\n", i);
      i = nl === -1 ? fileContent.length : nl;
      continue;
    }
    if (ch === "/" && fileContent[i + 1] === "*") {
      const end = fileContent.indexOf("*/", i + 2);
      i = end === -1 ? fileContent.length : end + 1;
      continue;
    }
    // Regex literal - only where syntactically valid (previous significant token precedes an
    // expression). Sufficient for this codebase's actual usage (always ".match(/.../)",
    // ".search(/.../)" etc - "/" right after "(").
    if (ch === "/" && "(,=:;![{&|?\n".includes(lastSignificantChar || "\n")) {
      let j = i + 1;
      let inClass = false;
      while (j < fileContent.length) {
        const cj = fileContent[j];
        if (cj === "\\") { j += 2; continue; }
        if (cj === "[") { inClass = true; j++; continue; }
        if (cj === "]") { inClass = false; j++; continue; }
        if (cj === "/" && !inClass) { j++; break; }
        if (cj === "\n") break;
        j++;
      }
      while (j < fileContent.length && /[a-z]/i.test(fileContent[j])) j++;
      if (fileContent[j - 1] === "/" || /[a-z]/i.test(fileContent[j - 1])) {
        i = j - 1;
        lastSignificantChar = "/";
        continue;
      }
    }

    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }

    if (ch === "{") { depth++; started = true; lastSignificantChar = ch; }
    else if (ch === "}") {
      depth--;
      if (started && depth === 0) return fileContent.slice(startIdx, i + 1);
      lastSignificantChar = ch;
    } else if (!/\s/.test(ch)) {
      lastSignificantChar = ch;
    }
  }
  throw new Error(`Could not find end of function: ${functionSignature}`);
}
