import { sendFrontendCapture } from "./transport";

// CloudMountain Diagnostics Agent (CDA), frontend - catches what React's Error Boundary
// structurally cannot: errors outside the render tree (event handlers, timers, non-React DOM
// code) and unhandled promise rejections (a failed fetch nobody awaited/caught). Installed once,
// from main.tsx, before the app renders.
let installed = false;

export function installGlobalDiagnosticsHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    void sendFrontendCapture({
      message: event.message || "Uncaught error",
      stackTrace: event.error?.stack,
      severity: "high",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stackTrace = reason instanceof Error ? reason.stack : undefined;
    void sendFrontendCapture({
      message: `Unhandled promise rejection: ${message}`,
      stackTrace,
      severity: "high",
    });
  });
}
