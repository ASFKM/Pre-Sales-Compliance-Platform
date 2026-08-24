import { useState } from "react";
import BugReportModal from "./BugReportModal";

// CloudMountain Diagnostics Agent (CDA) frontend - discreet, always-available entry point for
// "Reportar problema" (briefing Seção 17). Only rendered once a session exists - a report tied to
// no authenticated tenant/user has nowhere meaningful to attribute to on the CMSaaS side.
//
// Vive DENTRO do rodapé de diagnóstico (App.tsx), ao lado de "Manual do Usuário", e não mais como
// pastilha `position: fixed` no canto inferior direito: ali ela cobria o último trecho do próprio
// rodapé - visível em todas as 36 imagens do baseline visual, onde tapava "Audit Logs" e parte do
// "Debug Console". Reportado pelo dono durante a Fase 2 do programa de identidade visual.
export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const hasSession = !!localStorage.getItem("ca_session_token");

  if (!hasSession) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Reportar problema"
        className="text-slate-300 hover:text-brand-400 hover:underline cursor-pointer transition-colors"
      >
        Reportar problema
      </button>
      {open && <BugReportModal onClose={() => setOpen(false)} />}
    </>
  );
}
