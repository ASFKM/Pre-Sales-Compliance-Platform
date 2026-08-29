import { describe, expect, it } from "vitest";
import { ConversaoDeDocumentoError, converterDocParaDocx } from "./docConversion";

/*
 * Estes testes cobrem o comportamento que precisa valer em QUALQUER ambiente, com ou sem
 * LibreOffice instalado - inclusive no runner de CI, que não tem o binário. A conversão feliz é
 * provada contra a imagem real (com o LibreOffice dentro), não aqui.
 *
 * O que importa provar sem o binário é o contrato de falha: quando a conversão não acontece, esta
 * função LANÇA. Ela nunca pode devolver o buffer de entrada como se tivesse convertido - isso
 * gravaria um .doc renomeado para .docx, que o docxtemplater não abre, reintroduzindo pela porta
 * dos fundos a falha silenciosa que a F6 existe para eliminar.
 */
describe("converterDocParaDocx", () => {
  const docFalso = Buffer.from("conteudo qualquer, nao e um .doc real");

  it("erra com instrução acionável quando o conversor não está instalado", async () => {
    const pathOriginal = process.env.PATH;
    // PATH vazio garante ENOENT no execFile mesmo numa máquina que TEM o LibreOffice, então o
    // teste mede o mesmo caminho de código nos dois ambientes em vez de depender do host.
    process.env.PATH = "";
    try {
      await expect(converterDocParaDocx(docFalso)).rejects.toThrow(ConversaoDeDocumentoError);
      await expect(converterDocParaDocx(docFalso)).rejects.toThrow(/salve o arquivo como \.docx/i);
    } finally {
      process.env.PATH = pathOriginal;
    }
  });

  it("nunca devolve o buffer de entrada quando falha", async () => {
    const pathOriginal = process.env.PATH;
    process.env.PATH = "";
    try {
      const resultado = await converterDocParaDocx(docFalso).catch((err) => err);
      expect(resultado).toBeInstanceOf(ConversaoDeDocumentoError);
      expect(Buffer.isBuffer(resultado)).toBe(false);
    } finally {
      process.env.PATH = pathOriginal;
    }
  });
});
