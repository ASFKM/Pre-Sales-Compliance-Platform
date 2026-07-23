import { useState } from "react";
import BugReportModal from "./BugReportModal";

// CloudMountain Diagnostics Agent (CDA) frontend - discreet, always-available entry point for
// "Reportar problema" (briefing Seção 17). Only rendered once a session exists - a report tied to
// no authenticated tenant/user has nowhere meaningful to attribute to on the CMSaaS side.
export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const hasSession = !!localStorage.getItem("ca_session_token");

  if (!hasSession) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Reportar problema"
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9998,
          fontSize: 12,
          padding: "6px 12px",
          borderRadius: 999,
          border: "1px solid #ddd",
          background: "white",
          color: "#555",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          cursor: "pointer",
        }}
      >
        Reportar problema
      </button>
      {open && <BugReportModal onClose={() => setOpen(false)} />}
    </>
  );
}
