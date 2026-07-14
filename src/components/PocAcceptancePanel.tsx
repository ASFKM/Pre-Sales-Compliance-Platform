import { useEffect, useState } from "react";
import { Check, X as XIcon, Upload, Download, Info } from "lucide-react";
import { PocAcceptance, PocAcceptanceDecision } from "../types";
import ApiClient from "../lib/api";

interface PocAcceptancePanelProps {
  pocId: string;
  canManage: boolean;
}

export default function PocAcceptancePanel({ pocId, canManage }: PocAcceptancePanelProps) {
  const [acceptance, setAcceptance] = useState<PocAcceptance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [signedBy, setSignedBy] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [notes, setNotes] = useState("");

  const fetchAcceptance = async () => {
    setLoading(true);
    try {
      const data = await ApiClient.get<PocAcceptance>(`/api/pocs/${pocId}/acceptance`);
      setAcceptance(data);
      setSignedBy(data.signed_by || "");
      setSignedAt(data.signed_at || "");
      setNotes(data.notes || "");
    } catch (e) {
      setAcceptance(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAcceptance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pocId]);

  const setDecision = async (decision: PocAcceptanceDecision) => {
    setSaving(true);
    try {
      const data = await ApiClient.put<PocAcceptance>(`/api/pocs/${pocId}/acceptance`, { decision });
      setAcceptance(data);
    } catch (e: any) {
      alert(e.message || "Não foi possível registrar a decisão.");
    } finally {
      setSaving(false);
    }
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      const data = await ApiClient.put<PocAcceptance>(`/api/pocs/${pocId}/acceptance`, {
        signed_by: signedBy || undefined,
        signed_at: signedAt || undefined,
        notes: notes || undefined,
      });
      setAcceptance(data);
    } catch (e: any) {
      alert(e.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const uploadDocument = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await ApiClient.post<PocAcceptance>(`/api/pocs/${pocId}/acceptance/signed-document`, formData);
      setAcceptance(data);
    } catch (e: any) {
      alert(e.message || "Não foi possível anexar o documento.");
    } finally {
      setUploading(false);
    }
  };

  const downloadDocument = () => {
    const token = localStorage.getItem("ca_session_token") || "";
    window.open(`/api/pocs/${pocId}/acceptance/signed-document?token=${encodeURIComponent(token)}`, "_blank");
  };

  if (loading || !acceptance) {
    return <p className="text-xs text-slate-400">Carregando...</p>;
  }

  const decision = acceptance.decision;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-2">Decisão final</div>
          <div className="flex gap-2">
            <button
              onClick={() => canManage && setDecision("won")}
              disabled={!canManage || saving}
              className={`flex-1 rounded-lg border-2 py-3 text-center transition-all ${decision === "won" ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-slate-300"}`}
            >
              <Check size={20} className={`mx-auto mb-1 ${decision === "won" ? "text-emerald-600" : "text-slate-300"}`} />
              <span className={`text-sm font-bold ${decision === "won" ? "text-emerald-700" : "text-slate-500"}`}>Ganha</span>
            </button>
            <button
              onClick={() => canManage && setDecision("lost")}
              disabled={!canManage || saving}
              className={`flex-1 rounded-lg border-2 py-3 text-center transition-all ${decision === "lost" ? "border-red-500 bg-red-50" : "border-slate-200 hover:border-slate-300"}`}
            >
              <XIcon size={20} className={`mx-auto mb-1 ${decision === "lost" ? "text-red-600" : "text-slate-300"}`} />
              <span className={`text-sm font-bold ${decision === "lost" ? "text-red-600" : "text-slate-500"}`}>Perdida</span>
            </button>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono mb-2">Documento de aceite assinado</div>
          {acceptance.signed_document_original_filename ? (
            <button
              onClick={downloadDocument}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg py-3 hover:bg-emerald-100"
            >
              <Download size={16} />
              {acceptance.signed_document_original_filename}
            </button>
          ) : (
            <p className="text-xs text-slate-400 italic border border-dashed border-slate-300 rounded-lg py-3 text-center">
              Nenhum documento anexado ainda
            </p>
          )}
          {canManage && (
            <label className="mt-2 flex items-center justify-center gap-2 px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500">
              <Upload size={13} />
              {uploading ? "Enviando..." : acceptance.signed_document_original_filename ? "Substituir documento" : "Anexar documento assinado"}
              <input
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadDocument(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="sm:col-span-1 lg:col-span-2">
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Assinado por</label>
          <input
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 font-sans text-sm text-slate-800"
            value={signedBy}
            disabled={!canManage}
            onChange={(e) => setSignedBy(e.target.value)}
            placeholder="Nome do responsável no cliente"
          />
        </div>
        <div className="sm:col-span-1 lg:col-span-2">
          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Data do aceite</label>
          <input
            type="date"
            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 font-sans text-sm text-slate-800"
            value={signedAt}
            disabled={!canManage}
            onChange={(e) => setSignedAt(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">Observações</label>
        <textarea
          className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400 font-sans text-sm text-slate-800"
          rows={3}
          value={notes}
          disabled={!canManage}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {canManage && (
        <button
          onClick={saveDetails}
          disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      )}

      <div className="flex items-start gap-2 text-[11px] text-slate-400 italic pt-2 border-t border-slate-100">
        <Info size={13} className="shrink-0 mt-0.5" />
        Mecanismo de assinatura eletrônica do aceite ainda em definição — por ora, registro manual
        com upload do documento assinado pelo cliente.
      </div>
    </div>
  );
}
