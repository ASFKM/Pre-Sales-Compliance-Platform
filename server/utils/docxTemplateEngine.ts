import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import InspectModule from "docxtemplater/js/inspect-module";
import { DocxTemplateData } from "./docx";
import { podeSerSubstituidaPorTextoAprovado } from "./proposalAiAssist";

// Every placeholder a real uploaded template can use is documented in ./templateVariableCatalog
// (name + human-readable description, in Portuguese, shown in the Admin Console's variable
// glossary panel) - this function is the implementation that actually computes each of those
// variables from project/analysis data. Keep the two in sync: every key returned below should
// have a matching entry in TEMPLATE_VARIABLE_CATALOG, and vice-versa.
const DELIMITERS = { start: "{{", end: "}}" };

// Point-to-point matrices have per-discipline dynamic columns (see DynamicMatrixSchema in
// analysis.ts) - a real DOCX table needs fixed columns, so there's no clean way to loop over
// arbitrary columns in docxtemplater. Flatten each discipline's rows into a plain-text table
// instead (one line per row, "label: value" pairs joined by " | "), so a template author can still
// drop the whole matrix into a document without needing to know its columns in advance.
function renderMatrixAsText(matrix: { columns?: Array<{ key: string; label: string }>; rows?: Array<Record<string, unknown>> }): string {
  const columns = matrix.columns || [];
  const rows = matrix.rows || [];
  return rows
    .map((row) =>
      columns
        .map((col) => `${col.label}: ${row[col.key] ?? "N/D"}`)
        .join(" | ")
    )
    .join("\n");
}

// Exportada desde a F6: o QA do documento gerado (proposalQa.ts) e o apoio de IA
// (proposalAiAssist.ts) precisam enxergar EXATAMENTE os valores que o merge usou. Reimplementar
// essa resolucao em outro lugar deixaria as duas copias divergirem sem ninguem perceber.
export function buildTemplateVariables(data: DocxTemplateData) {
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
    obrigatorio: req.mandatory_or_optional || "",
    confianca: req.confidence != null ? Number(req.confidence).toFixed(2) : "",
  }));

  const riscos = (data.analysis?.risks || []).map((risk: any) => ({
    titulo: risk.title,
    descricao: risk.description || "",
    severidade: risk.severity || "medium",
    probabilidade: risk.probability || "",
    impacto: risk.impact || "",
    mitigacao: risk.mitigation || "N/D",
    area_responsavel: risk.owner_area || "",
  }));

  const oportunidades = (data.analysis?.opportunities || []).map((opp: any) => ({
    titulo: opp.title,
    descricao: opp.description || "",
    valor_negocio: opp.business_value || "",
    solucao_sugerida: opp.suggested_solution || "",
    estrategia_venda: opp.sales_strategy || "",
    prioridade: opp.priority || "",
  }));

  const cronograma_preliminar = (data.analysis?.preliminary_schedule || []).map((phase: any) => ({
    fase: phase.phase_name,
    atividades: (phase.activities || []).join("; "),
    duracao_estimada: phase.estimated_duration || "",
    dependencias: (phase.dependencies || []).join("; "),
    area_responsavel: phase.responsible_area || "",
    premissas: phase.assumptions || "",
    riscos_fase: phase.risks || "",
  }));

  const matriz_requisitos = (data.analysis?.point_to_point_table || []).map((matrix: any) => ({
    disciplina: matrix.discipline,
    tabela_texto: renderMatrixAsText(matrix),
  }));

  const perguntas_esclarecimento = (data.analysis?.clarification_questions || []).map((q: any) => ({
    pergunta: q.question,
    motivo: q.reason || "",
    prioridade: q.priority || "",
    publico_alvo: q.target_audience || "",
  }));

  // Módulo de Precificação (add-on): se o projeto tem uma sessão de precificação real com linhas
  // já precificadas, ela tem prioridade sobre a tabela manual (mantém compatibilidade total com
  // propostas/templates que nunca usaram o módulo - sem sessão, comportamento idêntico ao de
  // sempre). NUNCA adicionar listPriceSnapshot/discountPercent/markupMin/markupMax aqui, mesmo
  // que pareça útil - isso exporia a margem ao cliente na proposta. Os únicos campos disponíveis
  // em data.pricing.lines já vêm filtrados desde server/routes/proposals.ts, de propósito - não
  // tem como este resolvedor alcançar os campos sensíveis mesmo por engano.
  const pricingLines = data.pricing?.lines ?? [];
  const pricingUnitPrice = (l: { finalUnitPrice: number | null; finalPriceWithTax: number | null }) => l.finalPriceWithTax ?? l.finalUnitPrice ?? 0;

  const precificacao = pricingLines.length > 0
    ? pricingLines.map((l) => ({
        item: l.description,
        quantidade: l.quantity,
        preco_unitario: pricingUnitPrice(l).toFixed(2),
        preco_total_item: (pricingUnitPrice(l) * l.quantity).toFixed(2),
        moeda: "BRL",
      }))
    : (data.proposal?.manual_pricing_table || []).map((p: any) => {
        const total = Number(p.total_price ?? Number(p.quantity || 0) * Number(p.unit_price || 0));
        return {
          item: p.product_or_service,
          quantidade: p.quantity,
          preco_unitario: Number(p.unit_price || 0).toFixed(2),
          preco_total_item: total.toFixed(2),
          moeda: p.currency || "USD",
        };
      });

  const precoTotal = pricingLines.length > 0
    ? pricingLines.reduce((sum, l) => sum + pricingUnitPrice(l) * l.quantity, 0)
    : (data.proposal?.manual_pricing_table || []).reduce((sum: number, p: any) => {
        return sum + Number(p.total_price ?? Number(p.quantity || 0) * Number(p.unit_price || 0));
      }, 0);

  const executiveSummary = data.analysis?.executive_summary || {};

  const resolvidas: Record<string, unknown> = {
    cliente: data.project.customer_name,
    projeto: data.project.name,
    codigo_oportunidade: data.project.opportunity_name || "",
    vertical: data.project.vertical,
    escopo: data.project.description,
    status_projeto: data.project.status || "",
    prazo_projeto: data.project.deadline || "",
    data_validade_projeto: data.project.proposal_validity_date || "",
    modalidade_contratacao: [data.project.procurement_modality, data.project.procurement_subtype].filter(Boolean).join(" - "),
    responsavel_projeto: data.project.owner_name || "",
    resumo_executivo: executiveSummary.project_overview || "",
    contexto_cliente: executiveSummary.customer_context || "",
    principais_requisitos: executiveSummary.main_requirements || "",
    principais_riscos: executiveSummary.main_risks || "",
    principais_oportunidades: executiveSummary.main_opportunities || "",
    estrategia_recomendada: executiveSummary.recommended_strategy || "",
    premissas_tecnicas: executiveSummary.assumptions || "",
    proximos_passos: executiveSummary.next_steps || "",
    bom,
    requisitos_criticos,
    riscos,
    oportunidades,
    cronograma_preliminar,
    matriz_requisitos,
    perguntas_esclarecimento,
    precificacao,
    preco_total: precoTotal.toFixed(2),
    termos_pagamento: data.proposal?.payment_terms || "30 dias líquidos (padrão)",
    termos_entrega: data.proposal?.delivery_terms || "FOB Armazém",
    validade_proposta: data.proposal?.proposal_validity || "N/D",
    premissas_comerciais: data.proposal?.commercial_assumptions || "N/D",
    exclusoes: data.proposal?.exclusions || "Impostos e desembaraço aduaneiro",
  };

  /*
   * F6 (rodada 09/2026): SUBSTITUICAO EXPLICITA no lugar de "preencher o vazio".
   *
   * A regra anterior era "preenche o vazio, nunca substitui o conhecido": um texto aprovado so
   * ocupava variavel em branco. Ela protegia `cliente` de graca - `cliente` nunca esta vazio - mas
   * ao preco de tornar impossivel corrigir uma secao que a analise redigiu mal. Como o parecer
   * agora produz apontamentos ligados a uma secao, e o ciclo do apontamento so fecha quando a
   * secao muda, a regra do vazio inviabilizaria a propria fase: o apontamento apontaria um texto
   * que ninguem consegue trocar.
   *
   * Entao a regra passa a ser: um valor aprovado por uma pessoa SUBSTITUI o que estava ali, desde
   * que a variavel possa ser substituida (podeSerSubstituidaPorTextoAprovado). E a mesma allowlist
   * que a rota PUT /proposals/:id/campos-do-template aplica na entrada - aqui ela e a ULTIMA
   * barreira, para o caso de um valor ter sido gravado por outro caminho. `cliente`, `projeto`,
   * `vertical`, `escopo` e os demais fatos de cadastro seguem intocaveis; o que mudou e por onde:
   * antes pela regra do vazio, agora pela lista explicita (ver o comentario grande em
   * server/utils/proposalAiAssist.ts, que registra essa troca de mecanismo).
   *
   * O filtro `typeof valor === "string"` continua barrando laco (bom, precificacao) antes de
   * qualquer coisa, e a allowlist os barra de novo pelo nome - as duas travas seguem de pe.
   *
   * O que ficou de FORA daqui, de proposito: guardar o valor anterior. Historico e responsabilidade
   * de quem GRAVA (ProposalSectionEdit, escrito pela rota), nao de quem renderiza - este ponto e
   * chamado tambem em pre-visualizacao e em regeracao, e registrar historico aqui inventaria
   * "edicoes" que ninguem fez.
   */
  for (const [nome, valor] of Object.entries(data.templateFieldValues || {})) {
    if (typeof valor !== "string" || valor.trim().length === 0) continue;
    if (!podeSerSubstituidaPorTextoAprovado(nome)) continue;
    resolvidas[nome] = valor;
  }

  return resolvidas;
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
