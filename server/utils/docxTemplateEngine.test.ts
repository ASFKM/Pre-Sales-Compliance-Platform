import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { buildDocxBuffer, DocxTemplateData } from "./docx";
import { renderDocxFromTemplate, extractTemplatePlaceholders } from "./docxTemplateEngine";

function makeTemplate(text: string): Buffer {
  return buildDocxBuffer(text);
}

const baseData: DocxTemplateData = {
  project: { name: "Rede Corporativa X", customer_name: "ACME Ltda", description: "Upgrade de rede", vertical: "Networking" },
  analysis: {
    bom: [
      { equipment_name: "Switch 24p", manufacturer: "Cisco", quantity: 2, unit: "un" },
      { equipment_name: "Roteador", manufacturer: "Juniper", quantity: 1, unit: "un" },
    ],
  } as any,
  proposal: {
    manual_pricing_table: [
      { product_or_service: "Switch 24p", quantity: 2, unit_price: 1000, total_price: 2000, currency: "USD" },
      { product_or_service: "Instalação", quantity: 1, unit_price: 500, total_price: 500, currency: "USD" },
    ],
    payment_terms: "45 dias",
  },
};

describe("extractTemplatePlaceholders", () => {
  it("finds every real tag in the template's own content", () => {
    const template = makeTemplate("Cliente: {{cliente}}\n{{#bom}}\n{{equipamento}}\n{{/bom}}\nTotal: {{preco_total}}");
    expect(extractTemplatePlaceholders(template)).toEqual(
      expect.arrayContaining(["cliente", "bom", "equipamento", "preco_total"])
    );
  });

  it("returns an empty list for a template with no placeholders", () => {
    const template = makeTemplate("Just a plain document with no tags.");
    expect(extractTemplatePlaceholders(template)).toEqual([]);
  });

  it("rejects a file that isn't a real docx/zip", () => {
    expect(() => extractTemplatePlaceholders(Buffer.from("not a docx"))).toThrow(/não é um \.docx válido/);
  });
});

describe("renderDocxFromTemplate", () => {
  it("substitutes flat placeholders and repeats a loop section per array item", () => {
    const template = makeTemplate(
      ["Cliente: {{cliente}}", "{{#bom}}", "- {{equipamento}} ({{fabricante}})", "{{/bom}}", "Total: {{preco_total}}"].join("\n")
    );
    const rendered = renderDocxFromTemplate(template, baseData);
    const xml = new PizZip(rendered).file("word/document.xml")!.asText();

    expect(xml).toContain("ACME Ltda");
    expect(xml).toContain("Cisco");
    expect(xml).toContain("Juniper");
    expect(xml).toContain("2500.00");
    expect(xml).not.toContain("{{cliente}}");
    expect(xml).not.toContain("{{#bom}}");
  });

  it("leaves unknown/missing fields blank instead of leaving the literal tag or throwing", () => {
    const template = makeTemplate("Escopo: {{escopo}}");
    const rendered = renderDocxFromTemplate(template, {
      project: { name: "x", customer_name: "x", description: "", vertical: "x" },
    });
    const xml = new PizZip(rendered).file("word/document.xml")!.asText();
    expect(xml).not.toContain("{{escopo}}");
  });

  it("throws a clear error for an unclosed loop tag instead of producing a corrupt file", () => {
    const template = makeTemplate("{{#bom}}\nsem fechamento");
    expect(() => renderDocxFromTemplate(template, baseData)).toThrow(/unclosed/i);
  });

  it("rejects a file that isn't a real docx/zip", () => {
    expect(() => renderDocxFromTemplate(Buffer.from("not a docx"), baseData)).toThrow(/não é um \.docx válido/);
  });
});
