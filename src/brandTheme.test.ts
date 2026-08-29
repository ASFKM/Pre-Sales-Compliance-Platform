import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  BRAND_DEFAULT_PRIMARY,
  BRAND_RAMP_STEPS,
  MIN_CONTRAST_ON_WHITE,
  REFERENCE_BRAND_RAMP,
  RETIRED_BRAND_HEXES,
  contrastOnWhite,
  contrastRatio,
  decideBrandTheme,
  deriveBrandRamp,
  hexToOklch,
  normalizeHex,
  applyBrandThemeToRoot,
} from "./brandTheme";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function maxChannelDelta(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
}

describe("normalizeHex", () => {
  it("aceita as duas formas que settings.ts já validava e normaliza para minúsculas", () => {
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
  // Âncoras medidas no navegador durante as Fases 2 a 7 (cor PINTADA num canvas, não
  // calculada de memória) e registradas em docs/roadmap/IDENTIDADE_VISUAL_2026-08.md. Se a
  // matemática deste módulo divergir delas, é este módulo que está errado.
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
    expect(contrastOnWhite(BRAND_DEFAULT_PRIMARY)).toBeGreaterThanOrEqual(MIN_CONTRAST_ON_WHITE);
  });
});

describe("deriveBrandRamp", () => {
  // A prova de que o molde e a derivação não divergiram: alimentar a derivação com o próprio
  // `brand-600` tem de devolver a rampa oficial inteira. Qualquer erro de sinal, de âncora ou
  // de conversão OKLab aparece aqui antes de aparecer numa tela.
  it("devolve a rampa oficial quando a cor do tenant É a cor da marca", () => {
    const ramp = deriveBrandRamp(BRAND_DEFAULT_PRIMARY);
    expect(ramp).toHaveLength(REFERENCE_BRAND_RAMP.length);
    ramp.forEach((hex, index) => {
      expect(maxChannelDelta(hex, REFERENCE_BRAND_RAMP[index])).toBeLessThanOrEqual(1);
    });
    expect(ramp[6]).toBe(BRAND_DEFAULT_PRIMARY);
  });

  it("mantém a cor do tenant EXATA no degrau 600", () => {
    for (const hex of ["#7c3aed", "#b91c1c", "#0f172b", "#4d4d4d"]) {
      expect(deriveBrandRamp(hex)[6]).toBe(hex);
    }
  });

  it("produz uma escala monotônica do claro ao escuro para qualquer matiz", () => {
    for (const hex of ["#7c3aed", "#b91c1c", "#166534", "#0f172b", "#236cc7", "#4d4d4d"]) {
      const luminances = deriveBrandRamp(hex).map((step) => hexToOklch(step).L);
      for (let i = 1; i < luminances.length; i++) {
        expect(luminances[i]).toBeLessThan(luminances[i - 1]);
      }
    }
  });

  it("carrega o matiz do tenant para os outros degraus, não o azul da marca", () => {
    const purple = deriveBrandRamp("#7c3aed");
    const tenantHue = hexToOklch("#7c3aed").h;
    const brandHue = hexToOklch(BRAND_DEFAULT_PRIMARY).h;
    for (const step of [purple[1], purple[4], purple[9]]) {
      // A rampa oficial deriva 19° do 50 ao 950, e a derivada herda esse desenho — então a
      // asserção que importa não é "matiz idêntico ao do tenant", é "muito mais perto do
      // matiz do tenant do que do azul da marca".
      const hue = hexToOklch(step).h;
      expect(Math.abs(hue - tenantHue)).toBeLessThan(Math.abs(hue - brandHue));
      expect(Math.abs(hue - tenantHue)).toBeLessThan(16);
    }
  });

  it("gera uma rampa cinza para uma marca sem croma, em vez de inventar cor", () => {
    for (const step of deriveBrandRamp("#4d4d4d")) {
      expect(hexToOklch(step).C).toBeLessThan(0.02);
    }
  });

  it("preserva a hierarquia de contraste que a interface usa (50 sobre 700, 100 sobre 700)", () => {
    for (const hex of ["#7c3aed", "#b91c1c", "#236cc7"]) {
      const ramp = deriveBrandRamp(hex);
      expect(contrastRatio(ramp[0], ramp[7])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ramp[1], ramp[7])).toBeGreaterThanOrEqual(4.5);
      expect(contrastOnWhite(ramp[7])).toBeGreaterThan(contrastOnWhite(ramp[6]));
    }
  });

  it("cai na rampa oficial quando o valor não é um hex", () => {
    expect(deriveBrandRamp("laranja")).toEqual([...REFERENCE_BRAND_RAMP]);
  });
});

describe("decideBrandTheme", () => {
  it("aceita uma cor de tenant que passa AA e devolve a rampa dela", () => {
    const decision = decideBrandTheme("#7c3aed");
    expect(decision.applied).toBe(true);
    expect(decision.primaryHex).toBe("#7c3aed");
    expect(decision.ramp[6]).toBe("#7c3aed");
  });

  it("REJEITA uma cor ilegível e devolve a marca, com mensagem que diz o número medido", () => {
    const decision = decideBrandTheme("#facc15"); // amarelo: ~1,7:1 sobre branco
    expect(decision.applied).toBe(false);
    expect(decision.primaryHex).toBe(BRAND_DEFAULT_PRIMARY);
    expect(decision.ramp).toEqual([...REFERENCE_BRAND_RAMP]);
    expect(decision.rejection?.reason).toBe("low_contrast");
    expect(decision.rejection?.pt).toContain("4,5:1");
    expect(decision.rejection?.pt).toContain("#facc15");
  });

  it("rejeita os dois hex da marca aposentada — eles reprovam AA", () => {
    for (const hex of RETIRED_BRAND_HEXES) {
      expect(decideBrandTheme(hex).applied).toBe(false);
    }
  });

  it("rejeita lixo sem quebrar, sempre com uma rampa utilizável", () => {
    const decision = decideBrandTheme("javascript:alert(1)");
    expect(decision.applied).toBe(false);
    expect(decision.rejection?.reason).toBe("invalid_hex");
    expect(decision.ramp).toHaveLength(11);
  });
});

describe("o molde e o CSS não podem divergir", () => {
  // `@theme static` é o que publica `--color-brand-*` em `:root`; este módulo copia os
  // mesmos 11 valores para poder derivar a rampa. Duas listas, uma verdade — então o teste
  // lê o CSS de verdade e compara.
  it("REFERENCE_BRAND_RAMP é igual ao bloco @theme static de src/index.css", () => {
    const css = fs.readFileSync(path.join(__dirname, "index.css"), "utf8");
    BRAND_RAMP_STEPS.forEach((step, index) => {
      const match = new RegExp(`--color-brand-${step}:\\s*(#[0-9a-fA-F]{6})`).exec(css); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `step` is BRAND_RAMP_STEPS, a hardcoded literal array in this same test file, never external input
      expect(match, `--color-brand-${step} não encontrado em src/index.css`).not.toBeNull();
      expect(match![1].toLowerCase()).toBe(REFERENCE_BRAND_RAMP[index]);
    });
  });
});

describe("applyBrandThemeToRoot", () => {
  function fakeRoot() {
    const set = new Map<string, string>();
    const removed: string[] = [];
    return {
      set,
      removed,
      style: {
        setProperty: (k: string, v: string) => { set.set(k, v); },
        removeProperty: (k: string) => { removed.push(k); set.delete(k); },
      },
    };
  }

  it("escreve os ONZE degraus, não só a ação primária", () => {
    const root = fakeRoot();
    const decision = applyBrandThemeToRoot(root, "#7c3aed", true);
    expect(decision.applied).toBe(true);
    expect(root.set.size).toBe(11);
    expect(root.set.get("--color-brand-600")).toBe("#7c3aed");
    for (const step of BRAND_RAMP_STEPS) {
      expect(root.set.get(`--color-brand-${step}`)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("desligado, REMOVE as variáveis em vez de reescrever a paleta padrão", () => {
    const root = fakeRoot();
    applyBrandThemeToRoot(root, "#7c3aed", false);
    expect(root.set.size).toBe(0);
    expect(root.removed).toHaveLength(11);
  });

  it("com cor ilegível, não pinta nada e devolve a rejeição", () => {
    const root = fakeRoot();
    const decision = applyBrandThemeToRoot(root, "#facc15", true);
    expect(decision.applied).toBe(false);
    expect(root.set.size).toBe(0);
    expect(root.removed).toHaveLength(11);
  });

  it("não quebra sem alvo (servidor, ou antes da montagem)", () => {
    expect(applyBrandThemeToRoot(null, "#7c3aed", true).applied).toBe(true);
  });
});
