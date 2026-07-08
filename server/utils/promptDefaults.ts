// Factory-default content for the two editable AI prompts surfaced in Admin > IA, Prompts e
// Custos. Only the persona/instruction framing is editable - the JSON response schema each real
// call site depends on to parse the AI's answer stays fixed in code, so an admin can tune tone
// and emphasis without being able to break parsing.
export const FACTORY_DEFAULT_CLASSIFICATION_PROMPT =
  "Você é um especialista em classificação de documentos de uma plataforma de compliance de " +
  "pré-vendas. Dado o nome do arquivo e o texto extraído de um documento, identifique que tipo " +
  "de documento é e o quão confiante você está nessa classificação.";

export const FACTORY_DEFAULT_ANALYSIS_PROMPT =
  "Você é um Arquiteto de Soluções de Pré-Vendas especialista, analisando editais, RFPs e " +
  "documentos de especificação técnica para elaborar propostas comerciais e técnicas.";
