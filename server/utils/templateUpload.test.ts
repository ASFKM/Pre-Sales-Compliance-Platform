import { describe, expect, it } from "vitest";
import {
  conversaoPreservouAsVariaveis,
  contarPlaceholdersDoDocOriginal,
  ehExtensaoPdf,
  fileTypeFromExtension,
} from "./templateUpload";

describe("fileTypeFromExtension", () => {
  it("aceita .docx e .doc, os dois formatos que o motor consegue mesclar", () => {
    expect(fileTypeFromExtension("modelo.docx")).toBe("docx");
    expect(fileTypeFromExtension("modelo.doc")).toBe("doc");
  });

  it("é indiferente a maiúsculas na extensão", () => {
    expect(fileTypeFromExtension("MODELO.DOCX")).toBe("docx");
    expect(fileTypeFromExtension("Modelo.Doc")).toBe("doc");
  });

  // O caso do bug: antes da F6 isto devolvia "pdf", o template era gravado, e a geração pulava o
  // merge em silêncio entregando o layout genérico.
  it("recusa PDF como template de entrada", () => {
    expect(fileTypeFromExtension("modelo.pdf")).toBeNull();
    expect(ehExtensaoPdf("modelo.pdf")).toBe(true);
  });

  it("recusa qualquer outra extensão", () => {
    expect(fileTypeFromExtension("modelo.odt")).toBeNull();
    expect(fileTypeFromExtension("modelo.txt")).toBeNull();
    expect(fileTypeFromExtension("modelo")).toBeNull();
  });

  // ".docx.pdf" tem extensão real .pdf - o que importa é a última, não a que aparece antes.
  it("olha a última extensão, não uma anterior no nome", () => {
    expect(fileTypeFromExtension("modelo.docx.pdf")).toBeNull();
    expect(ehExtensaoPdf("modelo.docx.pdf")).toBe(true);
  });
});

describe("contarPlaceholdersDoDocOriginal", () => {
  it("acha placeholders escritos com 1 byte por caractere", () => {
    expect(contarPlaceholdersDoDocOriginal(Buffer.from("olá {{cliente}} e {{projeto}}", "latin1"))).toBe(2);
  });

  it("acha placeholders escritos em UTF-16LE, como o .doc costuma guardar texto", () => {
    expect(contarPlaceholdersDoDocOriginal(Buffer.from("{{cliente}} {{projeto}} {{vertical}}", "utf16le"))).toBe(3);
  });

  it("devolve zero para um arquivo sem nenhuma variável", () => {
    expect(contarPlaceholdersDoDocOriginal(Buffer.from("carta fixa, sem variáveis", "latin1"))).toBe(0);
  });
});

describe("conversaoPreservouAsVariaveis", () => {
  it("aprova quando as variáveis da origem sobreviveram", () => {
    expect(conversaoPreservouAsVariaveis(5, 5)).toBe(true);
  });

  // Sobreviver PARCIALMENTE é aceito de propósito: a contagem da origem é heurística sobre um
  // binário, então exigir igualdade exata reprovaria conversões boas. O que se detecta aqui é o
  // caso categórico - tinha variável, não sobrou nenhuma.
  it("aprova quando parte das variáveis sobreviveu", () => {
    expect(conversaoPreservouAsVariaveis(5, 3)).toBe(true);
  });

  it("reprova quando a origem tinha variáveis e nenhuma sobreviveu", () => {
    expect(conversaoPreservouAsVariaveis(5, 0)).toBe(false);
  });

  it("aprova um template fixo, que nunca teve variável nenhuma", () => {
    expect(conversaoPreservouAsVariaveis(0, 0)).toBe(true);
  });
});
