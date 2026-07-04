import { X, ShieldAlert, Download } from "lucide-react";
import { AuditLog } from "../../types";

interface AuditLogsModalProps {
  auditLogs: AuditLog[];
  tx: (en: string, pt: string) => string;
  onClose: () => void;
  onExportCSV: () => void;
}

export default function AuditLogsModal({ auditLogs, tx, onClose, onExportCSV }: AuditLogsModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-slate-200 w-[800px] h-[600px] overflow-hidden shadow-2xl flex flex-col">
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-emerald-500" />
            <h3 className="text-sm font-bold uppercase font-mono tracking-wider">{tx("Enterprise Compliance Audit Log Ledger", "Livro de Auditoria de Compliance Empresarial")}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
        </div>

        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
          <span className="text-xs text-slate-500 font-mono">{tx("Filter: All Pre-Sales Operations Logs", "Filtro: Todos os Logs de Operações de Pré-Vendas")}</span>
          <button
            onClick={onExportCSV}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
          >
            <Download size={13} /> Export Ledger (CSV)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px] leading-relaxed bg-slate-950 text-slate-300">
          {auditLogs.map(log => (
            <div key={log.id} className="p-2 border-b border-slate-800 flex justify-between items-start">
              <div>
                <span className="text-emerald-400 font-bold block">[{new Date(log.created_at).toISOString()}] {log.action}</span>
                <p className="text-slate-400 mt-0.5">Executor: {log.user_id} | Entity: {log.entity_type} ({log.entity_id})</p>
                {log.metadata && (
                  <span className="text-slate-500 text-[10px] block">Metadata: {log.metadata}</span>
                )}
              </div>
              <span className="text-slate-500 text-[10px]">IP: {log.ip_address}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
