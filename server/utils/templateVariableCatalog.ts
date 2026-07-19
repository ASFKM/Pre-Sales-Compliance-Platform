// Single source of truth for every variable a real uploaded .docx template can use - the ONLY
// place this list is defined. Both the variable glossary endpoint (GET /proposal-templates/
// variables) and the cross-check in POST /proposals/:id/validate read from this same array, so
// they can never drift apart from each other. buildTemplateVariables() (docxTemplateEngine.ts) is
// the actual implementation that computes these values from project/analysis data - kept in sync
// with this catalog by convention (each key here has a matching key there); if you add a variable
// to one, add it to the other.
//
// "kind: loop" variables are used as {{#nome}} ... {{/nome}} blocks in the template, repeating
// once per item; their `loopFields` are the inner {{...}} placeholders available inside the loop.

export interface TemplateVariableField {
  name: string;
  description: string;
}

export interface TemplateVariableEntry {
  name: string;
  description: string;
  category: string;
  kind: "value" | "loop";
  loopFields?: TemplateVariableField[];
  example?: string;
}

export const TEMPLATE_VARIABLE_CATALOG: TemplateVariableEntry[] = [
  // ---- Cliente e Projeto ----
  { name: "cliente", description: "Nome do cliente do projeto.", category: "Cliente e Projeto", kind: "value" },
  { name: "projeto", description: "Título/nome do projeto.", category: "Cliente e Projeto", kind: "value" },
  { name: "codigo_oportunidade", description: "Nome/código da oportunidade comercial associada ao projeto.", category: "Cliente e Projeto", kind: "value" },
  { name: "vertical", description: "Vertical de mercado do projeto (ex.: Segurança Pública, Varejo, Educação).", category: "Cliente e Projeto", kind: "value" },
  { name: "escopo", description: "Descrição/escopo do projeto conforme cadastrado.", category: "Cliente e Projeto", kind: "value" },
  { name: "status_projeto", description: "Status atual do projeto no sistema (ex.: em andamento, concluído).", category: "Cliente e Projeto", kind: "value" },
  { name: "prazo_projeto", description: "Prazo/deadline do projeto.", category: "Cliente e Projeto", kind: "value" },
  { name: "data_validade_projeto", description: "Data de validade da proposta definida no cadastro do projeto (distinta de validade_proposta, que é o texto comercial da proposta em si).", category: "Cliente e Projeto", kind: "value" },
  { name: "modalidade_contratacao", description: "Modalidade de contratação/licitação do projeto (ex.: pregão, dispensa), quando aplicável.", category: "Cliente e Projeto", kind: "value" },
  { name: "responsavel_projeto", description: "Nome do responsável (owner) pelo projeto no sistema.", category: "Cliente e Projeto", kind: "value" },

  // ---- Resumo Executivo ----
  { name: "resumo_executivo", description: "Visão geral do projeto gerada pela análise de IA.", category: "Resumo Executivo", kind: "value" },
  { name: "contexto_cliente", description: "Contexto do cliente identificado pela análise (situação atual, motivação da demanda).", category: "Resumo Executivo", kind: "value" },
  { name: "principais_requisitos", description: "Síntese dos requisitos mais importantes identificados pela análise.", category: "Resumo Executivo", kind: "value" },
  { name: "principais_riscos", description: "Síntese dos principais riscos identificados pela análise.", category: "Resumo Executivo", kind: "value" },
  { name: "principais_oportunidades", description: "Síntese das principais oportunidades comerciais identificadas pela análise.", category: "Resumo Executivo", kind: "value" },
  { name: "estrategia_recomendada", description: "Estratégia de venda/abordagem recomendada pela análise de IA.", category: "Resumo Executivo", kind: "value" },
  { name: "premissas_tecnicas", description: "Premissas técnicas assumidas pela análise ao interpretar o edital/documentos.", category: "Resumo Executivo", kind: "value" },
  { name: "proximos_passos", description: "Próximos passos recomendados pela análise.", category: "Resumo Executivo", kind: "value" },

  // ---- BOM ----
  {
    name: "bom", description: "Lista de materiais (Bill of Materials) do projeto.", category: "BOM", kind: "loop",
    example: "{{#bom}} {{equipamento}} - {{fabricante}} ({{quantidade}} {{unidade}}) {{/bom}}",
    loopFields: [
      { name: "equipamento", description: "Nome do equipamento/item." },
      { name: "fabricante", description: "Fabricante identificado (ou \"N/D\" se não encontrado)." },
      { name: "quantidade", description: "Quantidade do item." },
      { name: "unidade", description: "Unidade de medida do item." },
      { name: "categoria", description: "Categoria do item (ex.: Hardware, Software, Serviço)." },
      { name: "especificacao", description: "Especificação técnica completa do item." },
    ],
  },

  // ---- Requisitos Críticos ----
  {
    name: "requisitos_criticos", description: "Requisitos críticos extraídos dos documentos do projeto.", category: "Requisitos", kind: "loop",
    loopFields: [
      { name: "descricao", description: "Descrição do requisito." },
      { name: "status", description: "Status de conformidade (compliant, partially_compliant, non_compliant, not_enough_information)." },
      { name: "prioridade", description: "Prioridade do requisito (high, medium, low)." },
      { name: "obrigatorio", description: "Se o requisito é obrigatório ou opcional (mandatory/optional)." },
      { name: "confianca", description: "Nível de confiança da IA na extração deste requisito (0 a 1)." },
    ],
  },

  // ---- Riscos ----
  {
    name: "riscos", description: "Riscos identificados pela análise do projeto.", category: "Riscos e Oportunidades", kind: "loop",
    loopFields: [
      { name: "titulo", description: "Título do risco." },
      { name: "descricao", description: "Descrição detalhada do risco." },
      { name: "severidade", description: "Severidade do risco (low, medium, high, critical)." },
      { name: "probabilidade", description: "Probabilidade estimada do risco (low, medium, high)." },
      { name: "impacto", description: "Descrição do impacto caso o risco se concretize." },
      { name: "mitigacao", description: "Estratégia de mitigação recomendada (ou \"N/D\")." },
      { name: "area_responsavel", description: "Área interna responsável por tratar o risco." },
    ],
  },

  // ---- Oportunidades ----
  {
    name: "oportunidades", description: "Oportunidades comerciais identificadas pela análise do projeto.", category: "Riscos e Oportunidades", kind: "loop",
    loopFields: [
      { name: "titulo", description: "Título da oportunidade." },
      { name: "descricao", description: "Descrição detalhada da oportunidade." },
      { name: "valor_negocio", description: "Valor de negócio associado à oportunidade." },
      { name: "solucao_sugerida", description: "Solução sugerida para captura da oportunidade." },
      { name: "estrategia_venda", description: "Estratégia de venda recomendada para essa oportunidade." },
      { name: "prioridade", description: "Prioridade da oportunidade (high, medium, low)." },
    ],
  },

  // ---- Cronograma ----
  {
    name: "cronograma_preliminar", description: "Cronograma preliminar de execução do projeto, por fase.", category: "Cronograma", kind: "loop",
    loopFields: [
      { name: "fase", description: "Nome da fase do cronograma." },
      { name: "atividades", description: "Atividades da fase (lista unida por ponto-e-vírgula)." },
      { name: "duracao_estimada", description: "Duração estimada da fase." },
      { name: "dependencias", description: "Dependências da fase (lista unida por ponto-e-vírgula)." },
      { name: "area_responsavel", description: "Área responsável pela fase." },
      { name: "premissas", description: "Premissas assumidas para essa fase." },
      { name: "riscos_fase", description: "Riscos específicos dessa fase do cronograma." },
    ],
  },

  // ---- Matriz Técnica (point-to-point) ----
  {
    name: "matriz_requisitos", description: "Matriz técnica ponto-a-ponto, uma entrada por disciplina do projeto (ex.: CFTV, rede, elétrica) - como a matriz tem colunas diferentes por disciplina, cada entrada traz uma versão em texto simples pronta para uso (tabela_texto), já que templates DOCX não suportam colunas dinâmicas.",
    category: "Matriz Técnica", kind: "loop",
    loopFields: [
      { name: "disciplina", description: "Nome da disciplina técnica (ex.: CFTV, Rede, Elétrica)." },
      { name: "tabela_texto", description: "Renderização em texto simples da tabela dessa disciplina, uma linha por item, colunas separadas por \" | \"." },
    ],
  },

  // ---- Perguntas de Esclarecimento ----
  {
    name: "perguntas_esclarecimento", description: "Perguntas de esclarecimento que a análise recomenda enviar ao cliente.", category: "Perguntas de Esclarecimento", kind: "loop",
    loopFields: [
      { name: "pergunta", description: "Texto da pergunta." },
      { name: "motivo", description: "Motivo pelo qual a pergunta é necessária." },
      { name: "prioridade", description: "Prioridade da pergunta (high, medium, low)." },
      { name: "publico_alvo", description: "Público-alvo da pergunta (ex.: cliente, área técnica interna)." },
    ],
  },

  // ---- Comercial ----
  {
    name: "precificacao", description: "Tabela de precificação do projeto (Módulo de Precificação, quando o projeto tiver uma) ou a tabela manual informada na geração da proposta, como alternativa.", category: "Comercial", kind: "loop",
    loopFields: [
      { name: "item", description: "Nome do produto/serviço precificado." },
      { name: "quantidade", description: "Quantidade." },
      { name: "preco_unitario", description: "Preço unitário (2 casas decimais)." },
      { name: "preco_total_item", description: "Preço total do item (2 casas decimais)." },
      { name: "moeda", description: "Moeda utilizada." },
    ],
  },
  { name: "preco_total", description: "Soma total da tabela de precificação (2 casas decimais).", category: "Comercial", kind: "value" },
  { name: "termos_pagamento", description: "Termos de pagamento da proposta.", category: "Comercial", kind: "value" },
  { name: "termos_entrega", description: "Termos de entrega da proposta.", category: "Comercial", kind: "value" },
  { name: "validade_proposta", description: "Texto de validade comercial informado na geração desta proposta específica.", category: "Comercial", kind: "value" },
  { name: "premissas_comerciais", description: "Premissas comerciais informadas na geração da proposta.", category: "Comercial", kind: "value" },
  { name: "exclusoes", description: "Exclusões contratuais informadas na geração da proposta.", category: "Comercial", kind: "value" },
];

// Flattened set of every valid top-level and loop-inner variable name - used by the /validate
// cross-check to flag a placeholder found in an uploaded .docx that doesn't match anything here
// (it would always render empty).
export function getAllKnownVariableNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of TEMPLATE_VARIABLE_CATALOG) {
    names.add(entry.name);
    for (const field of entry.loopFields ?? []) {
      names.add(field.name);
    }
  }
  return names;
}
