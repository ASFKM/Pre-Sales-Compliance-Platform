// Módulo de Precificação (add-on) - "Enviar Arquivos": extrai linhas de preço de uma cotação de
// fornecedor (PDF/imagem/planilha ou docx fora do template) usando IA. Paralelo a
// pricingImport.ts (que é o parser DETERMINÍSTICO da planilha modelo, sem IA nenhuma) - este
// arquivo só entra quando o arquivo enviado NÃO bate com o template estrito.
//
// Reaproveita o mesmo caminho de visão já usado por document_analysis (server/routes/analysis.ts):
// PDF/imagem vai como bytes reais pro modelo, sem OCR próprio. Arquivos de texto/planilha fora do
// template passam primeiro por extractTextFromDocument (server/utils/extraction.ts), e o texto
// resultante alimenta uma chamada só-texto.
import { z } from "zod";
import { ConnectedProvider, ProviderFileInput, generateJsonWithProvider } from "./aiProviders";
import { extractTextFromDocument } from "./extraction";
import { parseAiJson } from "../routes/analysis";

export interface DraftPricingRow {
  itemCode: string | null;
  category: string | null;
  pn: string;
  erpCode: string | null;
  description: string;
  listPriceBrl: number | null;
  listPriceUsd: number | null;
  sourceCurrency: "BRL" | "USD";
  markupMin: number | null;
  markupMax: number | null;
  confidenceNote: string | null;
}

export interface AiExtractionResult {
  rows: DraftPricingRow[];
  // Sugestão da IA a partir do cabeçalho/rodapé/assinatura do documento - só uma sugestão inicial,
  // sempre confirmável/editável pelo usuário na tela de revisão antes de qualquer linha virar
  // PriceCatalogItem de verdade.
  supplierName: string | null;
  inputTokens: number;
  outputTokens: number;
  billedCostUsd: number | null;
}

// Mesmo conjunto usado em server/routes/analysis.ts pro caminho de document_analysis - PDF/imagem
// vai direto como bytes pro modelo com capacidade de visão, sem extração de texto própria.
const VISION_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

const DraftRowResponseSchema = z.object({
  item_code: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  pn: z.string(),
  erp_code: z.string().nullable().optional(),
  description: z.string(),
  list_price_brl: z.number().nullable().optional(),
  list_price_usd: z.number().nullable().optional(),
  markup_min: z.number().nullable().optional(),
  markup_max: z.number().nullable().optional(),
  confidence_note: z.string().nullable().optional(),
});

const ExtractionResponseSchema = z.object({
  supplier_name: z.string().nullable().optional(),
  items: z.array(DraftRowResponseSchema),
});

const EXTRACTION_PROMPT = `Você é um assistente de pré-vendas extraindo uma tabela de preços a partir de uma cotação de fornecedor (pode ser um PDF, foto de uma tabela impressa, ou planilha/documento num layout livre - não segue nenhum template fixo).

Extraia cada item de preço mencionado no documento. Responda com um único objeto JSON, sem markdown e sem texto fora do JSON, no formato exato:
{
  "supplier_name": "nome da empresa fornecedora/remetente, se identificável no cabeçalho/rodapé/assinatura do documento - null se não houver indicação clara",
  "items": [
    {
      "item_code": "código interno do item, se houver algum identificador claro - null caso contrário",
      "category": "categoria do item (ex: hardware, software, serviço) se inferível - null caso contrário",
      "pn": "part number ou identificador mais específico disponível - NUNCA invente um código; se não houver PN explícito, use o nome/modelo do produto como texto aqui",
      "erp_code": null,
      "description": "descrição do item exatamente como aparece no documento",
      "list_price_brl": "preço em reais, como número, SOMENTE se o documento informar o valor em R$/BRL - null caso contrário",
      "list_price_usd": "preço em dólares, como número, SOMENTE se o documento informar o valor em US$/USD - null caso contrário",
      "markup_min": null,
      "markup_max": null,
      "confidence_note": "frase curta em português só quando algo ficou ambíguo nesta linha - null caso contrário"
    }
  ]
}

Regras importantes:
- "pn" e "description" são sempre obrigatórios em cada item.
- Preencha list_price_brl OU list_price_usd com o valor exatamente como está escrito no documento, na moeda em que está escrito. NÃO converta entre R$ e US$ você mesmo - isso é feito depois, de forma determinística, com a cotação oficial do dia.
- markup_min/markup_max quase nunca aparecem numa cotação de fornecedor (isso é uma decisão comercial do vendedor, não do fornecedor) - deixe null se não estiverem EXPLICITAMENTE informados no documento. Nunca invente um valor de markup.
- Nunca invente preços, códigos ou nomes que não estejam no documento. Se um campo não puder ser determinado com confiança razoável, use null.`;

function stripToJsonObject(text: string): any {
  const parsed = parseAiJson(text);
  return parsed;
}

export async function extractPricingRowsWithAi(
  file: { buffer: Buffer; filename: string; mimeType: string },
  exchangeRate: number,
  provider: ConnectedProvider,
  model: string
): Promise<AiExtractionResult> {
  let files: ProviderFileInput[] | undefined;
  let prompt = EXTRACTION_PROMPT;

  if (VISION_MIME_TYPES.has(file.mimeType)) {
    files = [{ mimeType: file.mimeType, base64Data: file.buffer.toString("base64") }];
  } else {
    const extracted = await extractTextFromDocument(file.buffer, file.filename, file.mimeType);
    // Falha rápido e com mensagem clara em vez de mandar pra IA um "prompt" que só descreve a
    // própria falha de leitura - isso gerava respostas de IA sem sentido, que por sua vez
    // quebravam o parser de JSON mais adiante com um erro confuso pro usuário (achado real: xlsx
    // "tabela-de-precos-hikvision-preenchida.xlsx" não conseguia ser lido pelo ExcelJS, mas a
    // extração seguia adiante mesmo assim).
    if (extracted.metadata.extractionStatus === "failed") {
      throw new Error(`Não foi possível ler o conteúdo de "${file.filename}" - o arquivo pode estar corrompido, protegido por senha, ou num formato não suportado.`);
    }
    prompt += `\n\n--- CONTEÚDO DO DOCUMENTO (${file.filename}) ---\n${extracted.text.substring(0, 20000)}`;
  }

  const { text, inputTokens, outputTokens, billedCostUsd } = await generateJsonWithProvider(provider, model, prompt, files);
  const parsed = ExtractionResponseSchema.parse(stripToJsonObject(text));

  const rows: DraftPricingRow[] = parsed.items.map((item) => {
    let listPriceBrl = item.list_price_brl ?? null;
    let listPriceUsd = item.list_price_usd ?? null;
    let sourceCurrency: "BRL" | "USD" = "BRL";

    if (listPriceBrl != null && listPriceUsd == null) {
      listPriceUsd = listPriceBrl / exchangeRate;
      sourceCurrency = "BRL";
    } else if (listPriceUsd != null && listPriceBrl == null) {
      listPriceBrl = listPriceUsd * exchangeRate;
      sourceCurrency = "USD";
    } else if (listPriceBrl != null && listPriceUsd != null) {
      sourceCurrency = "BRL";
    }

    return {
      itemCode: item.item_code ?? null,
      category: item.category ?? null,
      pn: item.pn,
      erpCode: item.erp_code ?? null,
      description: item.description,
      listPriceBrl,
      listPriceUsd,
      sourceCurrency,
      markupMin: item.markup_min ?? null,
      markupMax: item.markup_max ?? null,
      confidenceNote: item.confidence_note ?? null,
    };
  });

  return {
    rows,
    supplierName: parsed.supplier_name ?? null,
    inputTokens,
    outputTokens,
    billedCostUsd: billedCostUsd ?? null,
  };
}
