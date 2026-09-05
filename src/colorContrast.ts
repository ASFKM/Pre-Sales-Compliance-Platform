// ═══════════════════════════════════════════════════════════════════════════════
// Conta de contraste WCAG — o que sobrou de src/brandTheme.ts depois da F5.
//
// A F5 removeu a identidade visual configurável por tenant (a tela "Identidade Visual",
// BrandingSettings, BrandStyle e a sobrescrita em runtime dos tokens `--color-brand-*`).
// Junto foi a derivação de rampa em OKLCH, que só existia para pintar a interface com a cor
// de um tenant — não há mais cor de tenant.
//
// A conta de CONTRASTE, porém, não era identidade visual configurável: ela audita a paleta
// OFICIAL do produto, publicada em `@theme static` (src/index.css). Quem a usa é
// scripts/audit-contrast.ts, que prova que os pares de cor da interface passam no piso da
// WCAG AA. Apagá-la junto com a rampa quebraria essa auditoria, então ela mora aqui.
//
// Sem dependência de DOM nem de Prisma — só matemática de cor.
// ═══════════════════════════════════════════════════════════════════════════════

/** Piso WCAG AA para texto. */
export const MIN_CONTRAST_ON_WHITE = 4.5;

export interface Rgb { r: number; g: number; b: number }

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FALLBACK_HEX = "#000000";

/** Normaliza `#ABC`/`#AABBCC` para `#aabbcc`. Devolve `null` para qualquer outra coisa. */
export function normalizeHex(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!HEX_PATTERN.test(raw)) return null;
  const body = raw.slice(1).toLowerCase();
  if (body.length === 3) return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  return `#${body}`;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex) ?? FALLBACK_HEX;
  return {
    r: parseInt(normalized.slice(1, 3), 16) / 255,
    g: parseInt(normalized.slice(3, 5), 16) / 255,
    b: parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

// sRGB → linear: a transferência gama. Luminância precisa acontecer em linear; fazer a conta
// direto no byte do hex erra o tom.
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Luminância relativa da WCAG 2.x — os coeficientes são os da própria norma. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Razão de contraste WCAG entre dois hex, sempre ≥ 1. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastOnWhite(hex: string): number {
  return contrastRatio(hex, "#ffffff");
}
