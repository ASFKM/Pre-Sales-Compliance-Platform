import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// child_process is mocked BEFORE importing the module under test, so getAppVersion() (which
// caches its result at module scope on first call) picks up the mock - each test re-imports the
// module fresh via vi.resetModules() to get an unmemoized instance.
vi.mock("child_process", () => ({ execFileSync: vi.fn() }));

describe("getAppVersion", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.APP_VERSION_OVERRIDE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers APP_VERSION_OVERRIDE when set, without touching git at all", async () => {
    process.env.APP_VERSION_OVERRIDE = "2026.07.16-hotfix";
    const { execFileSync } = await import("child_process");
    const { getAppVersion } = await import("./appVersion");
    const info = getAppVersion();
    expect(info.version).toBe("2026.07.16-hotfix");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("uses `git describe` output when available (real checkout with tags)", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "rev-parse" && a[1] === "HEAD") return "abcdef1234567890\n" as any;
      if (a[0] === "rev-parse" && a[1] === "--short") return "abcdef1\n" as any;
      if (a[0] === "status") return "" as any; // clean tree
      if (a[0] === "describe") return "v1.4.2-0-gabcdef1\n" as any;
      throw new Error(`unexpected git args: ${a.join(" ")}`);
    });
    const { getAppVersion } = await import("./appVersion");
    const info = getAppVersion();
    expect(info.version).toBe("v1.4.2-0-gabcdef1");
    expect(info.gitSha).toBe("abcdef1234567890");
    expect(info.gitShaShort).toBe("abcdef1");
    expect(info.dirty).toBe(false);
  });

  it("marks dirty=true when `git status --porcelain` reports pending changes", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "rev-parse" && a[1] === "HEAD") return "abcdef1234567890\n" as any;
      if (a[0] === "rev-parse" && a[1] === "--short") return "abcdef1\n" as any;
      if (a[0] === "status") return " M server.ts\n" as any;
      if (a[0] === "describe") return "v1.4.2-0-gabcdef1-dirty\n" as any;
      throw new Error(`unexpected git args: ${a.join(" ")}`);
    });
    const { getAppVersion } = await import("./appVersion");
    expect(getAppVersion().dirty).toBe(true);
  });

  it("falls back to the short SHA when `git describe` fails (no tags reachable from HEAD)", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "rev-parse" && a[1] === "HEAD") return "abcdef1234567890\n" as any;
      if (a[0] === "rev-parse" && a[1] === "--short") return "abcdef1\n" as any;
      if (a[0] === "status") return "" as any;
      if (a[0] === "describe") throw new Error("fatal: No names found, cannot describe anything.");
      throw new Error(`unexpected git args: ${a.join(" ")}`);
    });
    const { getAppVersion } = await import("./appVersion");
    const info = getAppVersion();
    expect(info.version).toBe("abcdef1");
    expect(info.gitSha).toBe("abcdef1234567890");
  });

  it("falls back to package.json's version with an '-unknown' suffix when git is entirely unavailable", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("git: command not found");
    });
    const { getAppVersion } = await import("./appVersion");
    const info = getAppVersion();
    expect(info.version).toMatch(/-unknown$/);
    expect(info.gitSha).toBeNull();
    expect(info.gitShaShort).toBeNull();
  });

  it("caches the result across repeated calls within the same process (git is only invoked once)", async () => {
    const { execFileSync } = await import("child_process");
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === "rev-parse" && a[1] === "HEAD") return "abcdef1234567890\n" as any;
      if (a[0] === "rev-parse" && a[1] === "--short") return "abcdef1\n" as any;
      if (a[0] === "status") return "" as any;
      if (a[0] === "describe") return "v1.4.2-0-gabcdef1\n" as any;
      throw new Error(`unexpected git args: ${a.join(" ")}`);
    });
    const { getAppVersion } = await import("./appVersion");
    const first = getAppVersion();
    const callCountAfterFirst = vi.mocked(execFileSync).mock.calls.length;
    const second = getAppVersion();
    expect(second).toBe(first); // same cached object reference
    expect(vi.mocked(execFileSync).mock.calls.length).toBe(callCountAfterFirst);
  });
});
