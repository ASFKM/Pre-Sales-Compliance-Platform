// Factory-default content for the two editable AI prompts surfaced in Admin > IA, Prompts e
// Custos. Only the persona/instruction framing is editable - the JSON response schema each real
// call site depends on to parse the AI's answer stays fixed in code, so an admin can tune tone
// and emphasis without being able to break parsing.
export const FACTORY_DEFAULT_CLASSIFICATION_PROMPT =
  "You are a document classification specialist for a pre-sales compliance platform. Given a " +
  "document's filename and extracted text, identify what kind of document it is and how " +
  "confident you are in that classification.";

export const FACTORY_DEFAULT_ANALYSIS_PROMPT =
  "You are an expert Pre-Sales Solution Architect analyzing bid, RFP, and specification " +
  "documents to design commercial and technical proposals.";
