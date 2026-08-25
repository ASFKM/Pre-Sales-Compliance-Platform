import { useState } from "react";
import { ApiClient } from "../lib/api";
import { captureScreenshot } from "./screenshot";
import { getOrCreateDiagnosticsSessionId } from "./transport";

interface Props {
  onClose: () => void;
}

type Step = "form" | "submitting" | "done" | "error";

// CloudMountain Diagnostics Agent (CDA) frontend - "Reportar problema" (briefing Seção 17). Only
// 3 questions from the user; everything else (route, session, screenshot) is automatic context.
// includeScreenshot starts unchecked - captureScreenshot() (which itself triggers the browser's
// native screen-picker consent dialog) is only ever called from handleSubmit, and only when this
// box is checked AND the user has clicked "Enviar" - never on mount, never implicitly.
export default function BugReportModal({ onClose }: Props) {
  const [whatHappened, setWhatHappened] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [stepsToReproduce, setStepsToReproduce] = useState("");
  const [includeScreenshot, setIncludeScreenshot] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep("submitting");
    setError("");

    try {
      let screenshotReference: string | undefined;

      if (includeScreenshot) {
        try {
          const blob = await captureScreenshot();
          const formData = new FormData();
          formData.append("file", blob, "screenshot.png");
          const uploadResult = await ApiClient.post<{ reference: string }>("/api/diagnostics-agent/attachments", formData);
          screenshotReference = uploadResult.reference;
        } catch {
          // User cancelled the native screen-picker, or capture failed for some other reason -
          // the report itself is still worth sending without a screenshot, never blocked on this.
        }
      }

      const result = await ApiClient.post<{ confirmation_code: string }>("/api/diagnostics-agent/bug-reports", {
        title: whatHappened.slice(0, 200),
        what_happened: whatHappened,
        expected_behavior: expectedBehavior || undefined,
        steps_to_reproduce: stepsToReproduce || undefined,
        route: window.location.pathname,
        session_id: getOrCreateDiagnosticsSessionId(),
        screenshot_reference: screenshotReference,
      });

      setConfirmationCode(result.confirmation_code);
      setStep("done");
    } catch (err: any) {
      setError(err.message || "Não foi possível enviar o report agora. Tente novamente em instantes.");
      setStep("error");
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div style={{ background: "white", borderRadius: 12, padding: 24, width: "100%", maxWidth: 440, fontFamily: "sans-serif" }}>
        {step === "done" ? (
          <div style={{ textAlign: "center" }}>
            <h3>Obrigado pelo report!</h3>
            <p style={{ fontSize: 13, color: "#555" }}>
              Código de confirmação: <b>{confirmationCode}</b>
            </p>
            <button onClick={onClose} style={{ marginTop: 12 }}>Fechar</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3 style={{ marginTop: 0 }}>Reportar problema</h3>
            {error && <p style={{ color: "var(--color-danger-700)", fontSize: 13 }}>{error}</p>}
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", marginTop: 8 }}>O que aconteceu?</label>
            <textarea required value={whatHappened} onChange={(e) => setWhatHappened(e.target.value)} rows={2} style={{ width: "100%" }} />
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", marginTop: 8 }}>O que deveria acontecer?</label>
            <textarea value={expectedBehavior} onChange={(e) => setExpectedBehavior(e.target.value)} rows={2} style={{ width: "100%" }} />
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", marginTop: 8 }}>Como podemos reproduzir?</label>
            <textarea value={stepsToReproduce} onChange={(e) => setStepsToReproduce(e.target.value)} rows={2} style={{ width: "100%" }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 10 }}>
              <input type="checkbox" checked={includeScreenshot} onChange={(e) => setIncludeScreenshot(e.target.checked)} />
              Incluir uma captura de tela (o navegador vai pedir para você escolher o que compartilhar)
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={onClose}>Cancelar</button>
              <button type="submit" disabled={step === "submitting"}>{step === "submitting" ? "Enviando..." : "Enviar"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
