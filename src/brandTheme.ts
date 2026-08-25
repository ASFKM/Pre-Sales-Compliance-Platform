// ═══════════════════════════════════════════════════════════════════════════════
// Cor de marca por tenant — validação, contraste e derivação da rampa.
// Fase 8 do programa de identidade visual (docs/roadmap/IDENTIDADE_VISUAL_2026-08.md).
//
// Até aqui `BrandingSettings.primary_color` só alimentava o cabeçalho do DOCX gerado
// (server/utils/docx.ts): a tela "Identidade Visual" prometia uma cor configurável que a
// interface ignorava — o defeito mais antigo registrado neste programa. Com os tokens da
// Fase 0 em `@theme static`, as 11 variáveis `--color-brand-*` existem em `:root` no CSS
// construído mesmo sem uso, e sobrescrevê-las em runtime passou a ser possível.
//
// Este módulo é COMPARTILHADO entre cliente e servidor de propósito: a mesma função que
// decide "esta cor pode entrar na interface?" precisa rodar no PUT que grava o dado e no
// código que pinta a tela. Duas implementações da mesma regra viram duas verdades.
//
// Não tem dependência de DOM nem de Prisma — só matemática de cor.
// ═══════════════════════════════════════════════════════════════════════════════

/** Ação primária da marca — `--color-brand-600` em src/index.css (5,20:1 sobre branco). */
export const BRAND_DEFAULT_PRIMARY = "#236cc7";
/** Acento vivo da marca — `--color-brand-500`, o azul do símbolo. Alimenta o gradiente
 *  de pré-visualização e o DOCX; a interface deriva a rampa inteira do PRIMÁRIO. */
export const BRAND_DEFAULT_ACCENT = "#288bf9";

/** Os dois hex da marca APOSENTADA (o verde que o programa substituiu). São os valores que
 *  a migration `20260825..._brand_color_official_palette` procura linha a linha: eram o
 *  default histórico do código, nunca uma escolha de administrador. */
export const RETIRED_BRAND_HEXES = ["#059669", "#10b981"];

/** Piso WCAG AA para texto: o primário carrega texto branco em botão sólido. */
export const MIN_CONTRAST_ON_WHITE = 4.5;

/** A rampa oficial, cópia literal do bloco `@theme static` de src/index.css.
 *  Serve de MOLDE: a cor do tenant entra no degrau 600 e os outros dez herdam o perfil de
 *  luminosidade e de croma daqui. Se a rampa do CSS mudar, esta lista muda junto —
 *  `brandTheme.test.ts` prova que derivar a rampa a partir do próprio `brand-600` devolve
 *  exatamente esta lista, então a divergência aparece como teste vermelho. */
export const BRAND_RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export const REFERENCE_BRAND_RAMP: readonly string[] = [
  "#ebf6ff", "#d2eafe", "#a7d3fb", "#77b8f8", "#52a1f4", "#288bf9",
  "#236cc7", "#1a539e", "#113774", "#061a3d", "#03102c",
];
/** Índice do degrau 600 dentro das listas acima — a âncora da derivação. */
const PRIMARY_INDEX = 6;

export interface Rgb { r: number; g: number; b: number }
export interface Oklch { L: number; C: number; h: number }

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normaliza `#ABC`/`#AABBCC` para `#aabbcc`. Devolve `null` para qualquer outra coisa —
 *  é a MESMA gramática que `settings.ts` já aplicava antes de a cor chegar ao DOCX. */
export function normalizeHex(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!HEX_PATTERN.test(raw)) return null;
  const body = raw.slice(1).toLowerCase();
  if (body.length === 3) return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  return `#${body}`;
}

export function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex) ?? BRAND_DEFAULT_PRIMARY;
  return {
    r: parseInt(normalized.slice(1, 3), 16) / 255,
    g: parseInt(normalized.slice(3, 5), 16) / 255,
    b: parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

function channelToHex(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

// sRGB ⇄ linear: a transferência gama. Tudo que é média, luminância ou mistura de luz
// precisa acontecer em linear; fazer conta direto no byte do hex erra o tom.
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

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

// ── OKLab / OKLCH ────────────────────────────────────────────────────────────────
// A derivação da rampa acontece em OKLCH e não em HSL: em HSL, dois tons com o mesmo `L`
// têm claridade percebida MUITO diferente conforme o matiz (um amarelo "50%" é quase
// branco, um azul "50%" é escuro), então uma rampa derivada em HSL sai com degraus que não
// se comportam como os da marca. Em OKLab o eixo `L` é perceptual, e é isso que faz a
// escala derivada preservar a hierarquia visual — o 700 continua "um passo mais escuro que
// o 600" para o olho, não só para a matemática.

export function hexToOklch(hex: string): Oklch {
  const { r, g, b } = hexToRgb(hex);
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.sqrt(a * a + bb * bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

function oklchToRgbUnclamped({ L, C, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);

  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

const inGamut = ({ r, g, b }: Rgb) =>
  r >= -0.0005 && r <= 1.0005 && g >= -0.0005 && g <= 1.0005 && b >= -0.0005 && b <= 1.0005;

/** OKLCH → hex, reduzindo o croma até a cor caber no sRGB em vez de deixar o clamp por
 *  canal torcer o matiz. Sem isso, um tenant com uma cor muito saturada ganharia degraus
 *  claros com matiz visivelmente diferente do seu — a rampa deixaria de parecer uma família. */
export function oklchToHex(color: Oklch): string {
  if (inGamut(oklchToRgbUnclamped(color))) return rgbToHex(oklchToRgbUnclamped(color));
  let low = 0;
  let high = color.C;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToRgbUnclamped({ ...color, C: mid }))) low = mid;
    else high = mid;
  }
  return rgbToHex(oklchToRgbUnclamped({ ...color, C: low }));
}

/**
 * Deriva os 11 degraus a partir de UMA cor de tenant.
 *
 * O tenant configura um valor só, mas a interface usa a rampa inteira: sobrescrever apenas
 * o 600 e deixar 50/100/700 na cor antiga produziria uma tela incoerente — um botão azul
 * do tenant sobre um chip azul da marca —, que é pior que não personalizar.
 *
 * A regra, e o porquê de cada metade:
 *
 * - **O degrau 600 é a cor do tenant, exata.** É o valor que ele escolheu, é o que o DOCX
 *   imprime, e é o único degrau cujo contraste o produto promete (texto branco sobre botão
 *   sólido). Se ele fosse "ajustado" para caber numa escala, a interface e o documento
 *   gerado passariam a mostrar cores diferentes — as duas verdades que a Fase 7 evitou.
 * - **Os outros dez herdam o PERFIL da rampa oficial**: mesma proporção de luminosidade
 *   entre degraus e mesmo desenho de croma, reancorados no 600 do tenant por um mapeamento
 *   afim em cada metade (50→600 e 600→950). Os extremos ficam presos nos da marca, então a
 *   escala continua indo de "quase branco" a "quase preto" e nunca inverte.
 * - **Matiz e saturação vêm do tenant**: o croma de cada degrau é o da marca reescalado
 *   pela razão entre o croma do tenant e o do `brand-600`. Uma marca cinza gera uma rampa
 *   cinza; uma marca saturada gera degraus vivos, sem estourar o gamut.
 * - **O matiz é transladado, não achatado.** A rampa oficial não tem um matiz só: ela deriva
 *   19° do degrau 50 ao 950 (242°→261° em OKLCH), com os claros mais frios. Copiar o matiz do tenant para os
 *   onze degraus apagaria esse desenho — e faria a derivação a partir do próprio `brand-600`
 *   devolver algo diferente da rampa oficial, que é justamente a prova de que o molde e a
 *   conta não divergiram. Cada degrau recebe o matiz do tenant MAIS o desvio que aquele
 *   degrau tem em relação ao 600 da marca.
 */
export function deriveBrandRamp(primaryHex: string): string[] {
  const normalized = normalizeHex(primaryHex);
  if (!normalized) return [...REFERENCE_BRAND_RAMP];

  const reference = REFERENCE_BRAND_RAMP.map(hexToOklch);
  const anchor = reference[PRIMARY_INDEX];
  const tenant = hexToOklch(normalized);

  const lightestL = reference[0].L;
  const darkestL = reference[reference.length - 1].L;
  // Mantém a âncora estritamente entre os extremos SÓ para o cálculo dos outros degraus —
  // o 600 continua sendo a cor do tenant. Uma cor mais escura que `brand-950` ou mais clara
  // que `brand-50` colapsaria uma das metades da escala.
  const anchorL = Math.min(lightestL - 0.02, Math.max(darkestL + 0.02, tenant.L));
  const chromaScale = anchor.C > 1e-6 ? tenant.C / anchor.C : 0;

  return reference.map((step, index) => {
    if (index === PRIMARY_INDEX) return normalized;

    const L = index < PRIMARY_INDEX
      ? lightestL + ((step.L - lightestL) * (anchorL - lightestL)) / (anchor.L - lightestL)
      : anchorL + ((step.L - anchor.L) * (darkestL - anchorL)) / (darkestL - anchor.L);

    const hue = (((tenant.h + (step.h - anchor.h)) % 360) + 360) % 360;
    return oklchToHex({ L, C: step.C * chromaScale, h: hue });
  });
}

export interface BrandThemeDecision {
  /** `true` quando a cor do tenant pode pintar a interface. */
  applied: boolean;
  /** A cor que efetivamente vale: a do tenant, ou o primário da marca quando ela é rejeitada. */
  primaryHex: string;
  ramp: string[];
  contrastOnWhite: number;
  /** Preenchido só quando `applied` é `false` — texto pronto para a tela, em pt e en. */
  rejection?: { reason: "invalid_hex" | "low_contrast"; pt: string; en: string };
}

/**
 * Decide se a cor de um tenant entra na interface — a guarda obrigatória da fase.
 *
 * Cor de tenant é dado arbitrário: um amarelo `#facc15` dá 1,7:1 contra branco e
 * transformaria todo botão primário do produto em texto branco ilegível. Rejeitar e cair no
 * primário da marca é a única saída aceitável; servir a interface ilegível não é.
 *
 * O piso é medido contra BRANCO porque é assim que o degrau 600 aparece: fundo sólido de
 * botão com rótulo branco, e texto de link sobre superfície clara.
 */
export function decideBrandTheme(primaryHex: unknown): BrandThemeDecision {
  const fallback = () => ({
    primaryHex: BRAND_DEFAULT_PRIMARY,
    ramp: [...REFERENCE_BRAND_RAMP],
    contrastOnWhite: contrastOnWhite(BRAND_DEFAULT_PRIMARY),
  });

  const normalized = normalizeHex(primaryHex);
  if (!normalized) {
    return {
      applied: false,
      ...fallback(),
      rejection: {
        reason: "invalid_hex",
        pt: "A cor informada não é um HEX válido (#RGB ou #RRGGBB). A interface segue na cor da marca.",
        en: "The color is not a valid HEX value (#RGB or #RRGGBB). The interface keeps the brand color.",
      },
    };
  }

  const ratio = contrastOnWhite(normalized);
  if (ratio < MIN_CONTRAST_ON_WHITE) {
    const measured = ratio.toFixed(2).replace(".", ",");
    return {
      applied: false,
      ...fallback(),
      rejection: {
        reason: "low_contrast",
        pt: `A cor ${normalized} tem contraste ${measured}:1 sobre branco e não atinge o mínimo de 4,5:1 exigido pela WCAG AA para texto. Ela continua valendo na proposta gerada, mas a interface segue na cor da marca — escolha um tom mais escuro para aplicá-la à interface.`,
        en: `Color ${normalized} has a ${ratio.toFixed(2)}:1 contrast ratio against white, below the 4.5:1 WCAG AA minimum for text. It still applies to the generated proposal, but the interface keeps the brand color — pick a darker shade to apply it to the interface.`,
      },
    };
  }

  return {
    applied: true,
    primaryHex: normalized,
    ramp: deriveBrandRamp(normalized),
    contrastOnWhite: ratio,
  };
}

/** Nome da variável CSS de cada degrau — as MESMAS que `@theme static` publica em `:root`. */
export function brandTokenName(step: (typeof BRAND_RAMP_STEPS)[number]): string {
  return `--color-brand-${step}`;
}

/** Alvo mínimo para aplicar a rampa: o que `document.documentElement` oferece, sem exigir DOM.
 *  Digitado estruturalmente de propósito — este módulo também roda no servidor, e um `import`
 *  de tipo do DOM aqui obrigaria o backend a carregar a biblioteca do navegador só para
 *  compilar. Também é o que torna a aplicação testável sem navegador. */
export interface BrandThemeTarget {
  style: {
    setProperty(property: string, value: string): void;
    removeProperty(property: string): void;
  };
}

/**
 * Escreve (ou remove) a rampa do tenant sobre os tokens `--color-brand-*` do `:root`.
 *
 * Sobrescreve os ONZE degraus, não só o 600: a interface usa `brand-50` em chip, `brand-100`
 * em badge, `brand-200` em borda, `brand-400` em fundo escuro, `brand-700` em hover e
 * `brand-900`/`950` na topbar e no login. Trocar só a ação primária deixaria um botão da cor
 * do tenant ao lado de um chip da cor da marca — uma tela incoerente, pior que uma tela não
 * personalizada.
 *
 * `enabled = false` REMOVE as propriedades em vez de reescrever a rampa oficial: sem elas o
 * valor volta a vir do próprio `@theme static`, que continua sendo a única fonte da paleta
 * padrão. Reescrever criaria uma segunda cópia dos mesmos 11 valores no atributo `style`.
 */
export function applyBrandThemeToRoot(
  target: BrandThemeTarget | null | undefined,
  primaryHex: unknown,
  enabled: boolean
): BrandThemeDecision {
  const decision = decideBrandTheme(primaryHex);
  if (!target) return decision;

  if (!enabled || !decision.applied) {
    for (const step of BRAND_RAMP_STEPS) target.style.removeProperty(brandTokenName(step));
    return decision;
  }

  BRAND_RAMP_STEPS.forEach((step, index) => {
    target.style.setProperty(brandTokenName(step), decision.ramp[index]);
  });
  return decision;
}
