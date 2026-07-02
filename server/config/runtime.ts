export type AppRuntimeMode = "demo" | "production";

export function getAppRuntimeMode(): AppRuntimeMode {
  return process.env.APP_RUNTIME_MODE === "production" ? "production" : "demo";
}

export function isProductionRuntime(): boolean {
  return getAppRuntimeMode() === "production";
}

export function isDemoRuntime(): boolean {
  return getAppRuntimeMode() === "demo";
}
