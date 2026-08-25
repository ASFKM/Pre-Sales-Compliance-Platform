import { describe, it, expect } from "vitest";
import { buildDocxBuffer } from "./docx";
import { BRAND_DEFAULT_PRIMARY } from "../../src/brandTheme";

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

describe("buildDocxBuffer — cabeçalho de marca", () => {
  it("imprime a cor da marca no nome da empresa e na régua abaixo dele", () => {
    const xml = documentXml(buildDocxBuffer("Corpo da proposta.", {
      companyName: "Empresa Exemplo",
      primaryColorHex: BRAND_DEFAULT_PRIMARY,
    }));
    // O OOXML quer o hex sem "#".
    expect(xml).toContain('<w:color w:val="236cc7"/>');
    expect(xml).toContain('w:color="236cc7"');
    expect(xml).toContain("Empresa Exemplo");
  });

  it("respeita a cor customizada de um tenant, mesmo uma que a INTERFACE recusaria", () => {
    // A guarda de contraste da Fase 8 vale para a interface, onde a cor vira fundo de rótulo
    // branco. No documento ela pinta texto e uma régua sobre papel branco, então continua
    // valendo como sempre valeu - e este teste existe para que ninguém "unifique" as duas
    // regras mais tarde e apague a cor que o cliente escolheu para as propostas dele.
    const xml = documentXml(buildDocxBuffer("Corpo.", {
      companyName: "Cliente com cor própria",
      primaryColorHex: "#0f172b",
    }));
    expect(xml).toContain('<w:color w:val="0f172b"/>');
  });

  it("não inventa cor quando o valor não presta — cai na régua cinza neutra", () => {
    const xml = documentXml(buildDocxBuffer("Corpo.", {
      companyName: "Sem cor",
      primaryColorHex: "not-a-color",
    }));
    expect(xml).not.toContain("<w:color");
    expect(xml).toContain('w:color="999999"');
  });

  it("sem branding nenhum, gera o documento sem cabeçalho", () => {
    const xml = documentXml(buildDocxBuffer("Só o corpo."));
    expect(xml).not.toContain("<w:pBdr>");
    expect(xml).toContain("Só o corpo.");
  });
});
