import { describe, it, expect } from "vitest";
import { extractFunctionSource } from "./aiLogicVersionExtractor";

/*
 * F7 (rodada 09/2026): este arquivo existe por causa de um defeito real e medido.
 *
 * O extrator contava chaves a partir do primeiro `{` depois da assinatura. Um parâmetro com tipo
 * objeto inline - `secoesDeTexto: readonly { nome: string }[]`, a assinatura que a F6 deu a
 * buildOpinionPrompt - fechava a contagem na própria assinatura, e o "corpo hasheado" eram 327
 * caracteres sem uma linha de prompt. O golden-hash guard passava a verde para qualquer mudança.
 *
 * O guard guarda os prompts; ninguém guardava o guard. Agora guarda.
 */
describe("extractFunctionSource", () => {
  it("extrai a função inteira quando um PARÂMETRO tem tipo objeto inline - o defeito medido na F7", () => {
    const arquivo = `
async function alvo(
  a: string,
  secoes: readonly { nome: string; descricao: string }[],
  b: number = 0
): Promise<string> {
  const x = { dentro: true };
  return \`resultado \${a}\`;
}
function depois() { return 1; }
`;
    const fonte = extractFunctionSource(arquivo, "async function alvo(");
    expect(fonte).toContain("const x = { dentro: true };");
    expect(fonte).toContain("return");
    expect(fonte).not.toContain("function depois");
    expect(fonte.trimEnd().endsWith("}")).toBe(true);
  });

  it("não confunde chave dentro de string nem de template literal", () => {
    const arquivo = `
function alvo(p: { k: string }): string {
  const s = "um { aberto";
  const t = \`outro } fechado\`;
  return s + t;
}
function vizinha() { return 2; }
`;
    const fonte = extractFunctionSource(arquivo, "function alvo(");
    expect(fonte).toContain('const s = "um { aberto";');
    expect(fonte).toContain("return s + t;");
    expect(fonte).not.toContain("function vizinha");
  });

  it("respeita parênteses aninhados na lista de parâmetros", () => {
    const arquivo = `
function alvo(cb: (x: number) => void, o: { a: string }): void {
  cb(1);
}
function outra() {}
`;
    const fonte = extractFunctionSource(arquivo, "function alvo(");
    expect(fonte).toContain("cb(1);");
    expect(fonte).not.toContain("function outra");
  });

  it("reclama alto quando a função não existe, em vez de devolver trecho errado", () => {
    expect(() => extractFunctionSource("const a = 1;", "function inexistente(")).toThrow(/Could not find function/);
  });
});
