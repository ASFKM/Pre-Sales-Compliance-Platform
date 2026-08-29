/*
 * Decisões do upload de template de proposta que não dependem de banco, storage nem do binário do
 * LibreOffice - separadas aqui para serem testáveis sozinhas (mesmo motivo de proposalTypes.ts).
 * A rota (server/routes/templates.ts) é quem aplica estas decisões contra uma requisição real.
 */

import path from "node:path";

/*
 * O que este cadastro aceita como template de ENTRADA (F6).
 *
 * Só formatos que o docxtemplater consegue mesclar de verdade. O .docx entra direto; o .doc entra
 * por conversão e vira .docx antes de ser gravado, de modo que o banco nunca mais registra
 * file_type "doc". O PDF SAIU: continua sendo formato de SAÍDA da proposta gerada (isso não muda),
 * mas como entrada ele era aceito e depois ignorado em silêncio na geração, entregando o layout
 * genérico no lugar do papel timbrado do cliente.
 */
export function fileTypeFromExtension(originalFilename: string): "docx" | "doc" | null {
  const ext = path.extname(originalFilename).toLowerCase();
  if (ext === ".docx") return "docx";
  if (ext === ".doc") return "doc";
  return null;
}

export function ehExtensaoPdf(originalFilename: string): boolean {
  return path.extname(originalFilename).toLowerCase() === ".pdf";
}

// Mensagem própria para o PDF, que é o caso que o admin mais tenta: ele não é um formato "inválido"
// no produto (a proposta gerada sai em PDF), só não serve como molde de entrada.
export const MOTIVO_PDF_RECUSADO =
  "PDF não pode ser usado como template de proposta: as variáveis {{...}} não podem ser mescladas nesse formato. Envie o modelo em .docx (ou .doc, que é convertido automaticamente). O PDF continua disponível como formato de saída da proposta gerada.";

export const MOTIVO_EXTENSAO_RECUSADA =
  "Apenas .docx e .doc são aceitos como template de proposta.";

export const MOTIVO_CONVERSAO_PERDEU_VARIAVEIS =
  "O arquivo .doc tem variáveis {{...}}, mas nenhuma sobreviveu à conversão para .docx — mescladas assim, elas sairiam em branco no documento gerado. Abra o arquivo no Word, salve como .docx e envie novamente.";

/*
 * Quantas aberturas de placeholder o .doc ORIGINAL parece ter.
 *
 * Serve a uma única decisão: se a conversão terminou com zero placeholders, isso destruiu algo ou
 * apenas refletiu um arquivo que nunca teve nenhum? É uma heurística deliberada - um .doc é um
 * binário OLE2 e não existe, neste servidor, parser de verdade para ele (é justamente por isso que
 * a conversão existe). O texto do documento aparece no binário ora com 1 byte por caractere, ora
 * em UTF-16LE, então a contagem procura "{{" nas duas codificações e fica com a maior.
 *
 * Um falso positivo faz o upload ser recusado com uma instrução que o admin consegue seguir
 * ("salve como .docx"); um falso negativo apenas deixa passar um template sem variáveis, que é
 * legítimo. Nenhum dos dois grava um template mudo em silêncio, que é o que importa.
 */
export function contarPlaceholdersDoDocOriginal(bufferDoDoc: Buffer): number {
  const contarEm = (codificacao: BufferEncoding) => {
    const texto = bufferDoDoc.toString(codificacao);
    return (texto.match(/\{\{/g) || []).length;
  };
  return Math.max(contarEm("latin1"), contarEm("utf16le"));
}

/*
 * A conversão preservou o que precisava preservar?
 *
 * Converter não basta: o docxtemplater casa `{{variavel}}` dentro de um único run do XML, e uma
 * conversão pode fragmentar o texto em runs ({{cli + ente}}), fazendo o placeholder deixar de ser
 * reconhecido - o template seria aceito e mesclaria em branco, a mesma falha silenciosa só que
 * mais adiante.
 *
 * Um .doc que nunca teve variável nenhuma é aceito: template fixo (uma carta de apresentação, por
 * exemplo) sempre foi legítimo neste cadastro.
 */
export function conversaoPreservouAsVariaveis(
  placeholdersNaOrigem: number,
  placeholdersNoConvertido: number
): boolean {
  if (placeholdersNaOrigem === 0) return true;
  return placeholdersNoConvertido > 0;
}
