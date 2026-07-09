import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module";
import { DocxTemplateData } from "./docx";

// Every placeholder a real uploaded template can use, documented here once instead of scattered
// across the Admin Console's upload hint and this engine. {{#loop}}...{{/loop}} sections repeat
// once per array item - when both tags sit inside the same table row, docxtemplater repeats the
// whole row (its own documented behavior, not something built here).
//   {{cliente}}, {{projeto}}, {{vertical}}, {{escopo}}, {{resumo_executivo}}
//   {{termos_pagamento}}, {{termos_entrega}}, {{validade_proposta}}, {{premissas_comerciais}}, {{exclusoes}}
//   {{preco_total}}
//   {{#bom}} {{equipamento}} {{fabricante}} {{quantidade}} {{unidade}} {{categoria}} {{especificacao}} {{/bom}}
//   {{#requisitos_criticos}} {{descricao}} {{status}} {{prioridade}} {{/requisitos_criticos}}
//   {{#riscos}} {{titulo}} {{severidade}} {{mitigacao}} {{/riscos}}
//   {{#precificacao}} {{item}} {{quantidade}} {{preco_unitario}} {{preco_total_item}} {{moeda}} {{/precificacao}}
const DELIMITERS = { start: "{{", end: "}}" };

function buildTemplateVariables(data: DocxTemplateData) {
  const bom = (data.analysis?.bom || []).map((item: any) => ({
    equipamento: item.equipment_name,
    fabricante: item.manufacturer || "N/D",
    quantidade: item.quantity,
    unidade: item.unit,
    categoria: item.category || "N/D",
    especificacao: item.specification || "",
  }));

  const requisitos_criticos = (data.analysis?.critical_requirements || []).map((req: any) => ({
    descricao: req.description,
    status: req.compliance_status || "not_enough_information",
    prioridade: req.priority || "",
  }));

  const riscos = (data.analysis?.risks || []).map((risk: any) => ({
    titulo: risk.title,
    severidade: risk.severity || "medium",
    mitigacao: risk.mitigation || "N/D",
  }));

  const precificacao = (data.proposal?.manual_pricing_table || []).map((p: any) => {
    const total = Number(p.total_price ?? Number(p.quantity || 0) * Number(p.unit_price || 0));
    return {
      item: p.product_or_service,
      quantidade: p.quantity,
      preco_unitario: Number(p.unit_price || 0).toFixed(2),
      preco_total_item: total.toFixed(2),
      moeda: p.currency || "USD",
    };
  });

  const precoTotal = (data.proposal?.manual_pricing_table || []).reduce((sum: number, p: any) => {
    return sum + Number(p.total_price ?? Number(p.quantity || 0) * Number(p.unit_price || 0));
  }, 0);

  return {
    cliente: data.project.customer_name,
    projeto: data.project.name,
    vertical: data.project.vertical,
    escopo: data.project.description,
    resumo_executivo: data.analysis?.executive_summary?.project_overview || "",
    bom,
    requisitos_criticos,
    riscos,
    precificacao,
    preco_total: precoTotal.toFixed(2),
    termos_pagamento: data.proposal?.payment_terms || "30 dias líquidos (padrão)",
    termos_entrega: data.proposal?.delivery_terms || "FOB Armazém",
    validade_proposta: data.proposal?.proposal_validity || "N/D",
    premissas_comerciais: data.proposal?.commercial_assumptions || "N/D",
    exclusoes: data.proposal?.exclusions || "Impostos e desembaraço aduaneiro",
  };
}

function openTemplateZip(templateBuffer: Buffer): PizZip {
  try {
    return new PizZip(templateBuffer);
  } catch {
    throw new Error("O arquivo do template não é um .docx válido (não foi possível abrir como ZIP).");
  }
}

function unwrapDocxtemplaterError(error: any): string {
  if (error?.properties?.errors instanceof Array) {
    return error.properties.errors
      .map((e: any) => e.properties?.explanation || e.message)
      .filter(Boolean)
      .join("; ");
  }
  return error?.message || String(error);
}

// Real template-merge engine for proposals that have a user-uploaded DOCX template with real
// placeholders - preserves the template's own formatting/letterhead, only used on the "has a real
// template file" path. buildDocxBuffer (docx.ts) remains the fallback when there is none.
export function renderDocxFromTemplate(templateBuffer: Buffer, data: DocxTemplateData): Buffer {
  const zip = openTemplateZip(templateBuffer);

  // Both the constructor (template compilation - catches things like an unclosed {{#loop}}) and
  // render() (data substitution) can throw a docxtemplater error - wrapping only render() was a
  // real bug caught during verification, since a malformed template throws from the constructor.
  try {
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: DELIMITERS,
      nullGetter: () => "",
      errorLogging: false,
    });
    doc.render(buildTemplateVariables(data));
    return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch (error: any) {
    throw new Error(`Falha ao preencher o template: ${unwrapDocxtemplaterError(error)}`);
  }
}

// getAllTags() returns a nested tree (loop tags carry their inner variable names as nested
// objects, e.g. { bom: { equipamento: {}, fabricante: {} } }) - flatten every level so a loop's
// inner variables are just as visible to the admin as its top-level tags.
function flattenTagNames(tags: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const [key, value] of Object.entries(tags)) {
    names.add(key);
    if (value && typeof value === "object") {
      for (const inner of flattenTagNames(value as Record<string, unknown>)) {
        names.add(inner);
      }
    }
  }
  return [...names];
}

// Real placeholders found in the template's own XML (via docxtemplater's parser), not just
// whatever the admin manually typed into the variables field when registering it - honest
// "here's what this template can actually receive" feedback for POST /templates/proposals/:id/validate.
export function extractTemplatePlaceholders(templateBuffer: Buffer): string[] {
  const zip = openTemplateZip(templateBuffer);
  const inspector = new InspectModule();

  try {
    new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: DELIMITERS,
      modules: [inspector],
      errorLogging: false,
    });
  } catch (error: any) {
    throw new Error(`Falha ao ler as variáveis do template: ${unwrapDocxtemplaterError(error)}`);
  }

  return flattenTagNames(inspector.getAllTags()).sort();
}
