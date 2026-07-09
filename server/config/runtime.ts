export type AppRuntimeMode = "demo" | "production";

// Defaults to production (the safe side) rather than demo: demo mode reactivates hardcoded MFA
// bypass codes and relaxes the secret-encryption-key requirement, so a missing/mistyped env var
// must fail closed, not open. Set APP_RUNTIME_MODE=demo explicitly to opt into demo behavior.
export function getAppRuntimeMode(): AppRuntimeMode {
  return process.env.APP_RUNTIME_MODE === "demo" ? "demo" : "production";
}

export function isProductionRuntime(): boolean {
  return getAppRuntimeMode() === "production";
}

export function isDemoRuntime(): boolean {
  return getAppRuntimeMode() === "demo";
}
