import { describe, it, expect } from "vitest";
import { acharCnpjNoTexto, cnpjValido, formatarCnpj, normalizarCnpj } from "./cnpj";

// CDC 16 — Fase 6. O CNPJ do edital (ADR 0001 §2.9).
//
// A prova por execução real exercita a busca contra o CRM vivo. O que ela não faz barato é
// varrer os casos em que um número de 14 dígitos NÃO é um CNPJ — e é justamente isso que separa
// "achei o cliente" de "casei com a empresa errada, em silêncio".

describe("F6 — o dígito verificador é o que separa CNPJ de número qualquer", () => {
  it("aceita CNPJs reais, formatados ou crus", () => {
    // Petrobras e Banco do Brasil — CNPJs públicos, com dígito verificador de verdade.
    expect(cnpjValido("33.000.167/0001-01")).toBe(true);
    expect(cnpjValido("33000167000101")).toBe(true);
    expect(cnpjValido("00.000.000/0001-91")).toBe(true);
  });

  it("recusa o mesmo número com um dígito trocado", () => {
    expect(cnpjValido("33.000.167/0001-02")).toBe(false);
  });

  it("recusa comprimento errado", () => {
    expect(cnpjValido("3300016700010")).toBe(false);
    expect(cnpjValido("330001670001010")).toBe(false);
    expect(cnpjValido("")).toBe(false);
    expect(cnpjValido(null)).toBe(false);
  });

  it("recusa dígitos todos iguais, que passam no módulo 11 e não são de ninguém", () => {
    expect(cnpjValido("11111111111111")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });
});

describe("F6 — achar o CNPJ no texto do edital", () => {
  it("acha formatado", () => {
    expect(acharCnpjNoTexto("Órgão: PETROBRAS, CNPJ 33.000.167/0001-01, Rio de Janeiro")).toBe(
      "33000167000101",
    );
  });

  it("acha sem formatação", () => {
    expect(acharCnpjNoTexto("inscrito no CNPJ 33000167000101 doravante")).toBe("33000167000101");
  });

  it("NÃO confunde número de processo com CNPJ", () => {
    // É o caso que motiva o dígito verificador: editais estão cheios de números de 14 dígitos
    // (processo, empenho, protocolo) e sem a conta metade das buscas sairia com o número errado.
    expect(acharCnpjNoTexto("Processo administrativo nº 12.345.678/9012-34")).toBeNull();
  });

  it("devolve o PRIMEIRO válido, que é o do cabeçalho", () => {
    // O do órgão que publica vem no cabeçalho; o mais frequente costuma ser o CNPJ de exemplo de
    // um anexo de modelo de declaração, repetido em cada folha.
    const texto = `
      PREFEITURA — CNPJ 00.000.000/0001-91
      ...
      ANEXO III — modelo: CNPJ 33.000.167/0001-01
      ANEXO III — modelo: CNPJ 33.000.167/0001-01
      ANEXO III — modelo: CNPJ 33.000.167/0001-01
    `;
    expect(acharCnpjNoTexto(texto)).toBe("00000000000191");
  });

  it("pula o inválido e segue procurando", () => {
    expect(acharCnpjNoTexto("nº 12.345.678/9012-34 e CNPJ 33.000.167/0001-01")).toBe(
      "33000167000101",
    );
  });

  it("responde nulo quando o edital não traz CNPJ — e aí a busca cai para o nome", () => {
    expect(acharCnpjNoTexto("Pregão eletrônico para aquisição de câmeras")).toBeNull();
    expect(acharCnpjNoTexto("")).toBeNull();
    expect(acharCnpjNoTexto(null)).toBeNull();
  });

  it("não guarda estado entre chamadas", () => {
    // A regex é global e vive no módulo: sem zerar `lastIndex`, a segunda chamada começaria de
    // onde a primeira parou e devolveria nulo sobre um texto que tem CNPJ.
    const texto = "CNPJ 33.000.167/0001-01";
    expect(acharCnpjNoTexto(texto)).toBe("33000167000101");
    expect(acharCnpjNoTexto(texto)).toBe("33000167000101");
  });
});

describe("F6 — normalizar e formatar", () => {
  it("normaliza as duas escritas para o mesmo número", () => {
    expect(normalizarCnpj("33.000.167/0001-01")).toBe("33000167000101");
    expect(normalizarCnpj("33000167000101")).toBe("33000167000101");
  });

  it("formata para leitura humana", () => {
    expect(formatarCnpj("33000167000101")).toBe("33.000.167/0001-01");
  });

  it("devolve o que veio quando não é CNPJ", () => {
    expect(formatarCnpj("123")).toBe("123");
  });
});
