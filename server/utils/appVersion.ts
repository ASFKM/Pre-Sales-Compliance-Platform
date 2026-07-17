import { execFileSync } from "child_process";
import { logger } from "./logger";

export interface AppVersionInfo {
  version: string;
  gitSha: string | null;
  gitShaShort: string | null;
  dirty: boolean;
  computedAt: string;
}

// execFileSync (argument array, no shell) rather than execSync/exec - none of the arguments below
// are ever dynamic/user-influenced, but there's no reason to go through a shell at all for a fixed
// git invocation.
function runGit(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// Roadmap item (customer_request): "Sistema de Atualização de Produção" - package.json's own
// "version" field has sat at a hardcoded "0.0.0" placeholder, never bumped, so it can't be trusted
// as the source of truth for what's actually running on a given installation. Derived instead from
// the real git state of the checkout, which is also what CMSaaS's Release.codeRef references (a
// real git tag/SHA) - so this value can be meaningfully compared against a release's codeRef to
// know if an installation is up to date.
//
// Computed once per process boot (module-level cache below), not per request - git subprocess
// calls aren't free, and the answer can't change without a restart anyway (an update always
// restarts the process, see scripts/update.sh).
function computeAppVersion(): AppVersionInfo {
  const computedAt = new Date().toISOString();

  const override = process.env.APP_VERSION_OVERRIDE?.trim();
  if (override) {
    return { version: override, gitSha: null, gitShaShort: null, dirty: false, computedAt };
  }

  let gitSha: string | null = null;
  let gitShaShort: string | null = null;
  let dirty = false;
  try {
    gitSha = runGit(["rev-parse", "HEAD"]);
    gitShaShort = runGit(["rev-parse", "--short", "HEAD"]);
    dirty = runGit(["status", "--porcelain"]).length > 0;
  } catch (err) {
    logger.warn({ err }, "getAppVersion: could not read git HEAD (not a git checkout, or git unavailable) - falling back to short SHA/tag detection");
  }

  // git describe fails outright if there are no tags reachable from HEAD at all (a fresh clone
  // with no tags yet) - that's expected on some installations, not an error worth logging loudly.
  try {
    const described = runGit(["describe", "--tags", "--always", "--long", "--dirty"]);
    if (described) {
      return { version: described, gitSha, gitShaShort, dirty, computedAt };
    }
  } catch {
    // fall through to the SHA-only / package.json fallbacks below
  }

  if (gitShaShort) {
    return { version: gitShaShort, gitSha, gitShaShort, dirty, computedAt };
  }

  // Last resort - package.json's own field is known-stale ("0.0.0"), but returning something
  // is better than throwing, and the "-unknown" suffix makes it obvious this wasn't derived from
  // real git state rather than silently looking like a real version.
  logger.warn("getAppVersion: no usable git state found - falling back to package.json version (unreliable, likely stale)");
  let packageVersion = "0.0.0";
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    packageVersion = require("../package.json").version || packageVersion;
  } catch {
    // ignore - keep default
  }
  return { version: `${packageVersion}-unknown`, gitSha, gitShaShort, dirty, computedAt };
}

let cached: AppVersionInfo | null = null;

export function getAppVersion(): AppVersionInfo {
  if (!cached) cached = computeAppVersion();
  return cached;
}
