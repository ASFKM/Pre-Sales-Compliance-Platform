import { describe, it, expect } from "vitest";
import { normalizeHex, contrastRatio, contrastOnWhite, MIN_CONTRAST_ON_WHITE } from "./colorContrast";

// Sucessor de src/brandTheme.test.ts. A F5 removeu a identidade visual configurável por tenant,
// e com ela a derivação de rampa em OKLCH e a decisão "esta cor de tenant pode pintar a
// interface?" — não há mais cor de tenant. O que sobrevive aqui é a conta de contraste que
// scripts/audit-contrast.ts usa para auditar a paleta OFICIAL do produto, com as MESMAS âncoras
// medidas no navegador durante as Fases 2 a 7 do programa de identidade visual.

describe("normalizeHex", () => {
  it("aceita as duas formas de hex e normaliza para minúsculas", () => {
    expect(normalizeHex("#236CC7")).toBe("#236cc7");
    expect(normalizeHex("  #abc ")).toBe("#aabbcc");
  });

  it("recusa qualquer outra coisa", () => {
    for (const bad of ["236cc7", "#12345", "#gggggg", "rgb(0,0,0)", "", null, undefined, 42]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });
});

describe("contrastRatio", () => {
  // Âncoras medidas no navegador (cor PINTADA num canvas, não calculada de memória) e
  // registradas em docs/roadmap/IDENTIDADE_VISUAL_2026-08.md. Se a matemática deste módulo
  // divergir delas, é este módulo que está errado.
  it("reproduz os contrastes que o programa mediu no navegador", () => {
    expect(contrastOnWhite("#236cc7")).toBeCloseTo(5.2, 1);   // brand-600, ação primária
    expect(contrastOnWhite("#1a539e")).toBeCloseTo(7.57, 1);  // brand-700, hover
    expect(contrastRatio("#ebf6ff", "#1a539e")).toBeCloseTo(6.9, 1);  // brand-50 / brand-700
    expect(contrastRatio("#d2eafe", "#1a539e")).toBeCloseTo(6.1, 1);  // brand-100 / brand-700
  });

  it("é simétrico e vale 1 para cores iguais", () => {
    expect(contrastRatio("#236cc7", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#236cc7"), 10);
    expect(contrastRatio("#236cc7", "#236cc7")).toBeCloseTo(1, 10);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("confirma por que o verde aposentado precisou sair: ele reprova AA", () => {
    expect(contrastOnWhite("#059669")).toBeLessThan(MIN_CONTRAST_ON_WHITE);
    expect(contrastOnWhite("#10b981")).toBeLessThan(MIN_CONTRAST_ON_WHITE);
    // O primário oficial da marca, `--color-brand-600` em src/index.css, passa.
    expect(contrastOnWhite("#236cc7")).toBeGreaterThanOrEqual(MIN_CONTRAST_ON_WHITE);
  });
});
