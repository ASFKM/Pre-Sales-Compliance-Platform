/*
 * F8: a PRÉ-VISUALIZAÇÃO DO DOCUMENTO, extraída do Estúdio para ser usada também pelo dossiê do
 * aprovador.
 *
 * Ela já existia inteira em src/components/Proposals.tsx (PARTE A da F8 anterior): busca o binário
 * REAL pelas mesmas rotas de download (/export/docx, /export/pdf), converte DOCX com `mammoth` e
 * sanitiza com DOMPurify antes de injetar, e mostra PDF nativamente por object URL. Nada aqui é
 * novo - o que a F8 fez foi tirá-la de dentro de um componente de 2000 linhas para que o dossiê
 * NÃO precisasse de uma segunda implementação. Duas telas mostrando "o documento" por caminhos
 * diferentes acabariam mostrando coisas diferentes, e é a tela do aprovador que decide.
 *
 * O hook guarda o estado e o componente desenha o corpo; o shell (modal, aba, painel) fica com
 * quem chama, porque no Estúdio isso é um modal próprio e no dossiê é uma das quatro abas.
 *
 * ARMADILHA MEDIDA (F6, e ela continua valendo): o conteúdo carrega em STREAMING. Uma captura de
 * tela tirada cedo pega um preview truncado que parece prova de falha. Para PROVAR conteúdo, o
 * caminho é baixar o .docx pela rota e ler word/document.xml do zip - não olhar esta tela.
 */
import { useCallback, useState } from "react";
import * as mammoth from "mammoth";
import DOMPurify from "dompurify";

export type PreviewFormat = "docx" | "pdf";

export function useDocumentPreview(locale: "en" | "pt") {
  const [previewingProposalId, setPreviewingProposalId] = useState<string | null>(null);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("docx");
  const [previewDocxHtml, setPreviewDocxHtml] = useState<string | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const openPreview = useCallback(async (proposalId: string, format: PreviewFormat) => {
    setPreviewingProposalId(proposalId);
    setPreviewFormat(format);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}/export/${format}`);
      if (!res.ok) {
        throw new Error(locale === "pt" ? "Não foi possível carregar o documento." : "Could not load the document.");
      }
      if (format === "docx") {
        const arrayBuffer = await res.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        // mammoth repassa qualquer href/src que o XML do .docx declare - sanitizar antes de injetar
        // no DOM, do mesmo jeito que qualquer HTML montado a partir de dado que não é 100% à prova
        // de atacante. O template é controlado pelo admin, não pelo atacante, mas este é o
        // documento que aparece na tela e recebe o mesmo tratamento que HTML não confiável.
        setPreviewDocxHtml(DOMPurify.sanitize(result.value));
      } else {
        const blob = await res.blob();
        setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      }
    } catch (err) {
      console.error(err);
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [locale]);

  const closePreview = useCallback(() => {
    setPreviewingProposalId(null);
    setPreviewDocxHtml(null);
    setPreviewPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setPreviewError(null);
  }, []);

  return {
    previewingProposalId,
    previewFormat,
    previewDocxHtml,
    previewPdfUrl,
    previewLoading,
    previewError,
    openPreview,
    closePreview,
  };
}

interface DocumentFormatSwitchProps {
  locale: "en" | "pt";
  format: PreviewFormat;
  onChange: (format: PreviewFormat) => void;
}

export function DocumentFormatSwitch({ locale, format, onChange }: DocumentFormatSwitchProps) {
  return (
    // O rotulo era fixo em portugues num componente que nao recebia `locale` — o unico
    // do diff desta fase que ficou assim.
    <div role="group" aria-label={locale === "pt" ? "Formato do documento" : "Document format"} className="flex rounded border border-slate-200 overflow-hidden">
      {(["docx", "pdf"] as const).map((fmt) => (
        <button
          key={fmt}
          onClick={() => onChange(fmt)}
          aria-pressed={format === fmt}
          className={`px-2.5 py-1 text-[10px] font-bold uppercase font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-inset ${format === fmt ? "bg-brand-600 text-white focus:ring-white" : "bg-white text-slate-500 hover:bg-slate-50 focus:ring-brand-500"}`}
        >
          {fmt}
        </button>
      ))}
    </div>
  );
}

interface DocumentPreviewBodyProps {
  locale: "en" | "pt";
  format: PreviewFormat;
  docxHtml: string | null;
  pdfUrl: string | null;
  loading: boolean;
  error: string | null;
  emptyLabel?: string;
}

export function DocumentPreviewBody({ locale, format, docxHtml, pdfUrl, loading, error, emptyLabel }: DocumentPreviewBodyProps) {
  return (
    <div className="h-full w-full bg-slate-100">
      {loading && (
        <div role="status" aria-live="polite" className="h-full flex items-center justify-center text-xs text-slate-400 font-mono py-16">
          {locale === "pt" ? "Carregando documento..." : "Loading document..."}
        </div>
      )}
      {!loading && error && (
        <div role="alert" className="h-full flex items-center justify-center text-xs text-danger-600 font-mono p-4 text-center py-16">{error}</div>
      )}
      {!loading && !error && format === "docx" && docxHtml && (
        <div
          /* F10: `prose prose-sm` NAO EXISTIA. O plugin @tailwindcss/typography nao esta
             instalado e nada o importa - medido no CSS servido, `grep -c "\.prose"` deu 0.
             As duas classes eram silenciosamente nada, e o Preflight zera peso e margem de
             h1..h6/p/ul: o <h1> do documento vinha com font-size 14px, weight 400 e margin 0,
             identico ao <p> vizinho. `documento-renderizado` (src/index.css) faz o trabalho
             que se supunha feito, com a escala e os tokens deste produto. */
          className="bg-white max-w-3xl mx-auto my-6 p-10 shadow-sm text-sm leading-relaxed documento-renderizado"
          dangerouslySetInnerHTML={{ __html: docxHtml }}
        />
      )}
      {!loading && !error && format === "pdf" && pdfUrl && (
        <iframe title="pdf-preview" src={pdfUrl} className="w-full h-full min-h-[70vh] border-0" />
      )}
      {!loading && !error && ((format === "docx" && !docxHtml) || (format === "pdf" && !pdfUrl)) && (
        <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono py-16 px-4 text-center">
          {emptyLabel || (locale === "pt" ? "Nenhum documento carregado." : "No document loaded.")}
        </div>
      )}
    </div>
  );
}
