import { X, Cpu } from "lucide-react";
import { DebugLog } from "../../types";

interface DebugConsoleModalProps {
  debugLogs: DebugLog[];
  locale: string;
  tx: (en: string, pt: string) => string;
  hasPermission: (permission: string) => boolean;
  onClose: () => void;
  onExportDiagnostics: () => void;
}

export default function DebugConsoleModal({ debugLogs, locale, tx, hasPermission, onClose, onExportDiagnostics }: DebugConsoleModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-slate-200 w-[850px] h-[650px] overflow-hidden shadow-2xl flex flex-col">
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-brand-400" />
            <h3 className="text-sm font-bold uppercase font-mono tracking-wider">
              {locale === "pt" ? "Logs de Rastreamento da Orquestração de IA" : "Pre-Sales AI Orchestration Trace logs"}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
        </div>

        <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center shrink-0">
          <div className="flex gap-4 text-xs font-mono text-slate-400">
            <span>{tx("Debug Records", "Registros de Debug")}: <span className="text-brand-400 font-bold">{debugLogs.length}</span></span>
            <span>{tx("Diagnostics", "Diagnóstico")}: <span className="text-brand-400 font-bold">{tx("Sanitized", "Sanitizado")}</span></span>
          </div>
          <button
            onClick={() => {
              if (!hasPermission("admin:diagnostics")) {
                alert(locale === "pt" ? "Acesso negado pela API administrativa. Verifique as permissões do usuário." : "Access denied by the administrative API. Check the current user's permissions.");
                return;
              }
              onExportDiagnostics();
            }}
            className="bg-brand-600 hover:bg-brand-500 text-white font-mono text-xs font-bold py-1.5 px-3 rounded shadow-sm transition-all cursor-pointer"
          >
            {locale === "pt" ? "Baixar Pacote de Diagnóstico" : "Download Diagnostic Package"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px] leading-relaxed bg-slate-950 text-slate-400">
          {debugLogs.map(dbg => (
            <div key={dbg.id} className="p-2.5 bg-slate-900/50 rounded border border-slate-850 hover:bg-slate-900 transition-colors">
              <div className="flex justify-between items-start mb-1">
                <span className={`font-bold uppercase tracking-wider text-[10px] px-1.5 rounded ${
                  dbg.log_level === "ERROR" ? "bg-danger-500/20 text-danger-400" : (dbg.log_level === "WARN" ? "bg-warning-500/20 text-warning-400" : "bg-brand-500/20 text-brand-400")
                }`}>{dbg.log_level}</span>
                <span className="text-slate-500 text-[10px]">{dbg.timestamp}</span>
              </div>
              <p className="text-slate-200 font-semibold">{dbg.operation} - {dbg.message}</p>
              <div className="grid grid-cols-4 gap-2 text-[10px] text-slate-500 mt-1">
                <span><strong>{tx("Module", "Módulo")}:</strong> {dbg.module_name}</span>
                <span><strong>{tx("Service", "Serviço")}:</strong> {dbg.service_name}</span>
                <span><strong>{tx("Latency", "Latência")}:</strong> {dbg.duration_ms}ms</span>
                <span><strong>{tx("Status", "Status")}:</strong> {dbg.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
