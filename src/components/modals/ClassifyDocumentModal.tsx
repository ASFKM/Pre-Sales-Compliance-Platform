import { X } from "lucide-react";
import { Document } from "../../types";

interface ClassifyDocumentModalProps {
  document: Document;
  tx: (en: string, pt: string) => string;
  onClose: () => void;
  onReclassify: (docId: string, manualType: string) => void;
}

export default function ClassifyDocumentModal({ document, tx, onClose, onReclassify }: ClassifyDocumentModalProps) {
  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-slate-200 w-[400px] overflow-hidden shadow-2xl">
        <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
          <h3 className="text-sm font-bold uppercase font-mono tracking-wider">{tx("Override Classification", "Sobrescrever Classificação")}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4 text-xs text-slate-700">
          <p className="font-semibold">{tx("Modify manual document category metadata for", "Modificar manualmente a categoria do documento para")} <span className="font-mono bg-slate-100 px-1 rounded">{document.original_filename}</span>:</p>

          <div className="space-y-2">
            <button
              onClick={() => onReclassify(document.id, "Public tender / edital")}
              className="w-full p-2.5 text-left bg-slate-50 border border-slate-200 hover:border-emerald-500 rounded font-bold hover:bg-slate-100 block cursor-pointer text-xs"
            >
              📜 Public tender / edital
            </button>
            <button
              onClick={() => onReclassify(document.id, "Technical specification")}
              className="w-full p-2.5 text-left bg-slate-50 border border-slate-200 hover:border-emerald-500 rounded font-bold hover:bg-slate-100 block cursor-pointer text-xs"
            >
              🔧 Technical specification
            </button>
            <button
              onClick={() => onReclassify(document.id, "Customer requirements")}
              className="w-full p-2.5 text-left bg-slate-50 border border-slate-200 hover:border-emerald-500 rounded font-bold hover:bg-slate-100 block cursor-pointer text-xs"
            >
              📝 Customer requirements
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
