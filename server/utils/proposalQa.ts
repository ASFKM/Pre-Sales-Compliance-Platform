import PizZip from "pizzip";

/*
 * F6, frente (c): revisão/QA sobre o DOCUMENTO FINAL gerado.
 *
 * Deliberadamente SEM IA. O pedido era "checa se sobrou placeholder de variável não substituído e
 * se os números batem com BOM/precificação (validação, não geração criativa às cegas)" - e as duas
 * perguntas têm resposta exata, computável a partir do documento e dos dados de origem. Um modelo
 * de linguagem responderia às mesmas perguntas com menos confiabilidade, custo por proposta e
 * risco de alucinar uma divergência que não existe; aqui um achado é sempre verificável e um
 * documento limpo é PROVADAMENTE limpo, não "aparentemente" limpo.
 *
 * As frentes (a) e (b) da mesma fase, essas sim, são de IA - elas escrevem texto, que é trabalho de
 * modelo. Ver server/utils/proposalAiAssist.ts.
 */

export type SeveridadeDeAchado = "alta" | "media" | "baixa";

export interface AchadoDeRevisao {
  tipo:
    | "placeholder_nao_substituido"
    | "variavel_vazia"
    | "divergencia_de_total"
    | "item_do_bom_ausente";
  severidade: SeveridadeDeAchado;
  descricao: string;
}

// Tolerância de centavo: os valores viajam como string já arredondada (toFixed(2)) até o template,
// então somar as linhas e comparar com o total pode divergir por arredondamento legítimo. Acima
// disso é divergência de verdade, não formatação.
const TOLERANCIA_DE_TOTAL = 0.02;

/**
 * Texto corrido de um .docx, para conferir se um valor esperado realmente saiu no documento.
 * Remove as tags do OOXML em vez de interpretá-las - o objetivo é procurar ocorrência de texto,
 * não reconstruir o layout.
 */
export function extrairTextoDoDocx(docxBuffer: Buffer): string {
  const zip = new PizZip(docxBuffer);
  const partes: string[] = [];
  for (const nome of Object.keys(zip.files)) {
    // Corpo, cabeçalhos e rodapés: um placeholder esquecido no papel timbrado conta tanto quanto
    // um no meio do texto.
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(nome)) continue;
    const xml = zip.files[nome].asText();
    partes.push(
      xml
        // <w:p> vira quebra para duas palavras de parágrafos diferentes não colarem numa só.
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
    );
  }
  return partes.join("\n");
}

function decodificarEntidadesXml(texto: string): string {
  return texto
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Placeholders `{{...}}` que sobraram no documento final.
 *
 * Depois de um merge bem-sucedido não deveria existir nenhum: ou a variável foi substituída por um
 * valor, ou pelo vazio. Um `{{...}}` remanescente significa que o cliente receberia o código-fonte
 * do template no meio da proposta - o pior desfecho possível deste fluxo.
 */
export function encontrarPlaceholdersRemanescentes(docxBuffer: Buffer): string[] {
  const texto = decodificarEntidadesXml(extrairTextoDoDocx(docxBuffer));
  const encontrados = texto.match(/\{\{[^}\n]{1,80}\}\}/g) || [];
  return Array.from(new Set(encontrados));
}

interface LinhaDePrecificacao {
  item: string;
  quantidade: number | string;
  preco_unitario: string;
  preco_total_item: string;
  moeda: string;
}

/**
 * A soma das linhas de precificação bate com o total que o documento apresenta?
 *
 * As duas grandezas são calculadas em pontos diferentes de buildTemplateVariables (a lista item a
 * item e o `preco_total`), a partir de fontes que podem divergir - sessão de precificação do
 * add-on ou tabela manual. Uma proposta que mostra itens somando um valor e um total diferente
 * dele é o tipo de erro que só aparece quando o cliente confere a conta.
 */
export function conferirTotalDePrecificacao(
  linhas: LinhaDePrecificacao[],
  precoTotalApresentado: string
): AchadoDeRevisao[] {
  if (linhas.length === 0) return [];

  const somaDasLinhas = linhas.reduce((soma, linha) => soma + Number(linha.preco_total_item || 0), 0);
  const total = Number(precoTotalApresentado || 0);
  if (Math.abs(somaDasLinhas - total) <= TOLERANCIA_DE_TOTAL) return [];

  return [{
    tipo: "divergencia_de_total",
    severidade: "alta",
    descricao: `A soma dos itens de precificação (${somaDasLinhas.toFixed(2)}) não bate com o total apresentado na proposta (${total.toFixed(2)}).`,
  }];
}

/**
 * Todo item do BOM que o template pediu chegou ao documento?
 *
 * Só roda quando o template usa o laço {{#bom}} - um template que não lista o BOM não tem nada a
 * conferir aqui. Um item ausente costuma indicar laço mal fechado no modelo, que o docxtemplater
 * aceita sem reclamar.
 */
export function conferirItensDoBomNoTexto(
  textoDoDocumento: string,
  bom: Array<{ equipamento?: string }>,
  templateUsaLacoDeBom: boolean
): AchadoDeRevisao[] {
  if (!templateUsaLacoDeBom || bom.length === 0) return [];

  const texto = textoDoDocumento.toLowerCase();
  const ausentes = bom
    .map((item) => (item.equipamento || "").trim())
    .filter((nome) => nome.length > 0 && !texto.includes(nome.toLowerCase()));

  if (ausentes.length === 0) return [];

  return [{
    tipo: "item_do_bom_ausente",
    severidade: "alta",
    descricao: `${ausentes.length} item(ns) do BOM não aparecem no documento gerado, embora o template use o bloco {{#bom}}: ${ausentes.slice(0, 5).join(", ")}${ausentes.length > 5 ? "..." : ""}.`,
  }];
}

/**
 * Variáveis que o template pede mas que saíram em branco.
 *
 * Não é erro por si só - um campo comercial legitimamente vazio existe - por isso a severidade é
 * média: é um aviso para quem revisa antes de enviar, não um bloqueio.
 */
export function conferirVariaveisVazias(
  placeholdersDoTemplate: string[],
  variaveisResolvidas: Record<string, unknown>
): AchadoDeRevisao[] {
  const vazias = placeholdersDoTemplate.filter((nome) => {
    if (!(nome in variaveisResolvidas)) return false;
    const valor = variaveisResolvidas[nome];
    if (Array.isArray(valor)) return valor.length === 0;
    return typeof valor === "string" && valor.trim().length === 0;
  });

  if (vazias.length === 0) return [];

  return [{
    tipo: "variavel_vazia",
    severidade: "media",
    descricao: `${vazias.length} variável(is) do template saíram em branco no documento: ${vazias.slice(0, 8).join(", ")}${vazias.length > 8 ? "..." : ""}.`,
  }];
}

export interface EntradaDeRevisao {
  docxBuffer: Buffer;
  placeholdersDoTemplate: string[];
  variaveisResolvidas: Record<string, unknown>;
}

/**
 * Revisão completa do documento final. Devolve os achados ordenados por severidade - lista vazia
 * significa documento conferido, não "não checado".
 */
export function revisarDocumentoGerado(entrada: EntradaDeRevisao): AchadoDeRevisao[] {
  const { docxBuffer, placeholdersDoTemplate, variaveisResolvidas } = entrada;
  const achados: AchadoDeRevisao[] = [];

  const remanescentes = encontrarPlaceholdersRemanescentes(docxBuffer);
  if (remanescentes.length > 0) {
    achados.push({
      tipo: "placeholder_nao_substituido",
      severidade: "alta",
      descricao: `O documento gerado ainda contém ${remanescentes.length} marcador(es) de variável não substituído(s): ${remanescentes.slice(0, 5).join(", ")}${remanescentes.length > 5 ? "..." : ""}. Eles apareceriam literalmente para o cliente.`,
    });
  }

  const linhas = (variaveisResolvidas.precificacao as LinhaDePrecificacao[]) || [];
  achados.push(...conferirTotalDePrecificacao(linhas, String(variaveisResolvidas.preco_total ?? "0")));

  const bom = (variaveisResolvidas.bom as Array<{ equipamento?: string }>) || [];
  achados.push(
    ...conferirItensDoBomNoTexto(extrairTextoDoDocx(docxBuffer), bom, placeholdersDoTemplate.includes("bom"))
  );

  achados.push(...conferirVariaveisVazias(placeholdersDoTemplate, variaveisResolvidas));

  const ordem: Record<SeveridadeDeAchado, number> = { alta: 0, media: 1, baixa: 2 };
  return achados.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);
}
