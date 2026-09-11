import { describe, it, expect } from "vitest";
import { buildDocxBuffer } from "./docx";

// O DOCX é um zip; para conferir a cor basta procurar o XML do documento dentro dos bytes, que
// `createZip` grava sem compressão (ver a implementação em docx.ts). Nada de dependência nova.
function documentXml(buffer: Buffer): string {
  // Localiza os limites em latin1 (1 byte = 1 caractere, então os índices são de BYTES) e só
  // depois decodifica a fatia como UTF-8 - ler o zip inteiro como UTF-8 quebraria nos bytes
  // binários, e ler como latin1 corromperia todo acento do texto.
  const raw = buffer.toString("latin1");
  const start = raw.indexOf("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document");
  expect(start).toBeGreaterThan(-1);
  const end = raw.indexOf("</w:document>", start) + "</w:document>".length;
  return buffer.subarray(start, end).toString("utf8");
}

describe("buildDocxBuffer", () => {
  // F5: o cabeçalho de marca (nome da empresa, cor primária, logo, régua) saiu junto com a
  // identidade visual configurável por tenant. Ele só existia no gerador GENÉRICO — o caminho
  // sem template — e desde a F5 uma proposta só é gerada a partir de um template .docx com
  // arquivo físico, cujo timbre vem do próprio arquivo. O que resta desta função é o documento
  // de texto plano que server/routes/analysis.ts usa para exportar as perguntas de esclarecimento.
  it("gera o documento sem cabeçalho nenhum, só o corpo", () => {
    const xml = documentXml(buildDocxBuffer("Só o corpo."));
    expect(xml).not.toContain("<w:pBdr>");
    expect(xml).not.toContain("<w:color");
    expect(xml).not.toContain("<w:drawing>");
    expect(xml).toContain("Só o corpo.");
  });

  it("preserva acentuação e escapa XML no corpo", () => {
    const xml = documentXml(buildDocxBuffer("Alocação & manutenção <urgente>"));
    expect(xml).toContain("Alocação &amp; manutenção &lt;urgente&gt;");
  });
});
