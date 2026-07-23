import { Component, ErrorInfo, ReactNode } from "react";
import { sendFrontendCapture } from "./transport";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// CloudMountain Diagnostics Agent (CDA), frontend - global Error Boundary wrapping the whole app
// (see main.tsx). Catches render-tree errors React itself already isolates from the rest of the
// page; window.onerror/unhandledrejection (globalHandlers.ts) cover everything this can't
// (event handlers, timers, promise rejections).
export class DiagnosticsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void sendFrontendCapture({
      message: error.message,
      stackTrace: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
      severity: "critical",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: "center", fontFamily: "sans-serif" }}>
          <h1>Algo deu errado.</h1>
          <p>O problema já foi registrado. Tente recarregar a página.</p>
          <button onClick={() => window.location.reload()}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
