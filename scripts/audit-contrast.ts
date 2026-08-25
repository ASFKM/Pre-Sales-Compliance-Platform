// Auditoria de contraste do produto inteiro - Fase 9 do programa de identidade visual
// (docs/roadmap/IDENTIDADE_VISUAL_2026-08.md).
//
// Três decisões que fazem esta ferramenta valer alguma coisa:
//
// 1. Mede a cor PINTADA, não a classe do JSX. Cada valor computado é pintado num canvas 1x1 pelo
//    próprio navegador e lido de volta em pixel - é assim que `oklch()` (como voltam os tokens
//    semânticos) e `rgb()` (como voltam os da marca) chegam ao mesmo lugar sem conversão à mão.
// 2. Compõe o alfa subindo pelos ancestrais até encontrar opacidade 1. Medir texto claro sobre um
//    `/10` renderizado contra branco foi o que produziu, na Fase 5, dois achados falsos de 2,46:1
//    e 1,61:1 que a Fase 7 teve de desmentir.
// 3. A conta de contraste é `contrastRatio` de src/brandTheme.ts - a MESMA função que o servidor
//    usa para aceitar ou recusar a cor de um tenant. Reimplementar a fórmula aqui criaria duas
//    verdades sobre o que é 4,5:1.
//
// Uso: `npm run audit:contrast` (servidor de dev no ar; reaproveita .auth/capture-state.json).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { contrastRatio } from "../src/brandTheme";
import {
  AUTH_STATE_PATH,
  DEFAULT_BASE_URL,
  SCREENS,
  VIEWPORTS,
  contextOptionsFor,
  openApp,
  saveAuthState,
  settle,
  stabilize,
} from "./uiScreens";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Piso da WCAG AA: 4,5:1 para texto normal, 3:1 para texto grande e para objeto gráfico. */
const PISO_TEXTO = 4.5;
const PISO_GRANDE = 3;
const PISO_UI = 3;

interface Amostra {
  tela: string;
  origem: "vivo" | "sintetico";
  tipo: "texto" | "texto-grande" | "ui";
  rotulo: string;
  fg: string;
  bg: string;
  fontePx: number;
  peso: number;
  classes: string;
}

/**
 * Roda dentro da página. Devolve as amostras já com as cores compostas em hexadecimal opaco -
 * a composição precisa acontecer aqui, onde os ancestrais e as opacidades existem.
 */
function coletar(): Omit<Amostra, "tela" | "origem">[] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  /** Deixa o NAVEGADOR pintar o valor e lê o pixel: resolve oklch, color-mix, currentColor, tudo. */
  const pintar = (valor: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000000";
    ctx.fillStyle = valor;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };

  const sobre = (frente: [number, number, number, number], fundo: [number, number, number]): [number, number, number] => [
    Math.round(frente[0] * frente[3] + fundo[0] * (1 - frente[3])),
    Math.round(frente[1] * frente[3] + fundo[1] * (1 - frente[3])),
    Math.round(frente[2] * frente[3] + fundo[2] * (1 - frente[3])),
  ];

  const hex = (c: [number, number, number]) =>
    "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

  /**
   * Fundo efetivo de um elemento: sobe pelos ancestrais acumulando os backgrounds e as opacidades
   * até chegar a uma cor opaca. Sem isso, `bg-brand-500/10` sobre a topbar escura é medido contra
   * branco e devolve um número que não existe na tela.
   */
  const fundoEfetivo = (el: Element): { cor: [number, number, number]; opacidade: number } => {
    const pilha: { cor: [number, number, number, number]; opacidade: number }[] = [];
    let no: Element | null = el;
    let opacidadeAcumulada = 1;
    while (no) {
      const cs = getComputedStyle(no);
      const op = parseFloat(cs.opacity || "1");
      opacidadeAcumulada *= Number.isFinite(op) ? op : 1;
      // Fundo pintado por gradiente/imagem NAO e uma cor chapada: medir so o `backgroundColor`
      // por baixo dele produz um numero que nao existe na tela (foi o que fez a previa de marca
      // do Admin aparecer como branco sobre branco).
      if (cs.backgroundImage && cs.backgroundImage !== "none") return { cor: [0, 0, 0], opacidade: -1 };
      const bg = pintar(cs.backgroundColor);
      if (bg[3] > 0) pilha.push({ cor: bg, opacidade: opacidadeAcumulada });
      if (bg[3] >= 1 && opacidadeAcumulada >= 1) break;
      no = no.parentElement;
    }
    // O branco do papel é o último fundo: nada mais atrás dele.
    let atual: [number, number, number] = [255, 255, 255];
    for (let i = pilha.length - 1; i >= 0; i--) {
      const camada = pilha[i];
      atual = sobre([camada.cor[0], camada.cor[1], camada.cor[2], camada.cor[3] * camada.opacidade], atual);
    }
    return { cor: atual, opacidade: opacidadeAcumulada };
  };

  const visivel = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };

  const classesDe = (el: Element) => (typeof el.className === "string" ? el.className : "").slice(0, 160);
  const out: Omit<Amostra, "tela" | "origem">[] = [];

  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (!visivel(el)) continue;
    const cs = getComputedStyle(el);
    const fundo = fundoEfetivo(el);
    if (fundo.opacidade < 0) continue; // sob gradiente: fora do alcance de uma medicao chapada

    // --- texto: só nós com texto PRÓPRIO, senão o mesmo texto seria contado por cada ancestral.
    const textoProprio = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent || "").trim())
      .join(" ")
      .trim();
    if (textoProprio) {
      const fgBruto = pintar(cs.color);
      const fg = sobre([fgBruto[0], fgBruto[1], fgBruto[2], fgBruto[3] * fundo.opacidade], fundo.cor);
      const fontePx = parseFloat(cs.fontSize) || 16;
      const peso = parseInt(cs.fontWeight, 10) || 400;
      const grande = fontePx >= 24 || (fontePx >= 18.66 && peso >= 700);
      out.push({
        tipo: grande ? "texto-grande" : "texto",
        rotulo: textoProprio.slice(0, 48),
        fg: hex(fg),
        bg: hex(fundo.cor),
        fontePx,
        peso,
        classes: classesDe(el),
      });
    }

    // --- objeto de interface: preenchimento sólido que carrega significado sozinho
    //     (barra de progresso, trilha, indicador) e borda de controle.
    const r = el.getBoundingClientRect();
    const bgProprio = pintar(cs.backgroundColor);
    const pai = el.parentElement;
    if (pai && bgProprio[3] > 0 && !textoProprio) {
      const fundoPai = fundoEfetivo(pai);
      const cor = sobre([bgProprio[0], bgProprio[1], bgProprio[2], bgProprio[3] * fundo.opacidade], fundoPai.cor);
      const ehBarra = r.height <= 16 && r.width >= 16 && el.children.length === 0;
      const ehPonto = r.width <= 16 && r.height <= 16 && el.children.length === 0;
      if ((ehBarra || ehPonto) && hex(cor) !== hex(fundoPai.cor)) {
        out.push({
          tipo: "ui",
          rotulo: (ehBarra ? "barra/indicador " : "ponto ") + Math.round(r.width) + "x" + Math.round(r.height),
          fg: hex(cor),
          bg: hex(fundoPai.cor),
          fontePx: 0,
          peso: 0,
          classes: classesDe(el),
        });
      }
    }
    if (el.matches("input, select, textarea")) {
      const bordaBruta = pintar(cs.borderTopColor);
      if (bordaBruta[3] > 0 && parseFloat(cs.borderTopWidth) > 0) {
        const borda = sobre([bordaBruta[0], bordaBruta[1], bordaBruta[2], bordaBruta[3] * fundo.opacidade], fundo.cor);
        const fundoPai = el.parentElement ? fundoEfetivo(el.parentElement).cor : ([255, 255, 255] as [number, number, number]);
        out.push({
          tipo: "ui",
          rotulo: "borda de " + el.tagName.toLowerCase(),
          fg: hex(borda),
          bg: hex(fundoPai),
          fontePx: 0,
          peso: 0,
          classes: classesDe(el),
        });
      }
    }
  }
  return out;
}

/**
 * Renderiza, DENTRO da aplicação viva, um bloco com cada combinação de classes de cor que o código
 * usa, e mede a cor pintada. É o que alcança o que o banco de dev não renderiza - status que nenhum
 * projeto tem, botão de um fluxo sem dado, badge de um tipo de arquivo que ninguém enviou.
 *
 * Cuidado herdado da Fase 3 e nomeado na Fase 7: classe que NÃO existe no CSS construído volta
 * PRETA e produz um contraste absurdo (20:1). O número alto é o sinal, e por isso ele é sinalizado
 * no relatório em vez de virar um "passou".
 */
function coletarSinteticas(combos: { classes: string; texto: string }[]): Omit<Amostra, "tela" | "origem">[] {
  const host = document.createElement("div");
  host.id = "auditoria-contraste";
  host.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;background:#ffffff;padding:4px";
  document.body.appendChild(host);
  const resultado: Omit<Amostra, "tela" | "origem">[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const pintar = (valor: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000000";
    ctx.fillStyle = valor;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const sobre = (f: [number, number, number, number], b: [number, number, number]): [number, number, number] => [
    Math.round(f[0] * f[3] + b[0] * (1 - f[3])),
    Math.round(f[1] * f[3] + b[1] * (1 - f[3])),
    Math.round(f[2] * f[3] + b[2] * (1 - f[3])),
  ];
  const hex = (c: [number, number, number]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

  for (const combo of combos) {
    const el = document.createElement("span");
    el.className = combo.classes;
    el.textContent = combo.texto;
    host.appendChild(el);
    const cs = getComputedStyle(el);
    const bgB = pintar(cs.backgroundColor);
    const bg = sobre(bgB, [255, 255, 255]);
    const fgB = pintar(cs.color);
    const fg = sobre(fgB, bg);
    const fontePx = parseFloat(cs.fontSize) || 16;
    const peso = parseInt(cs.fontWeight, 10) || 400;
    const grande = fontePx >= 24 || (fontePx >= 18.66 && peso >= 700);
    resultado.push({
      tipo: grande ? "texto-grande" : "texto",
      rotulo: combo.texto,
      fg: hex(fg),
      bg: hex(bg),
      fontePx,
      peso,
      classes: combo.classes,
    });
    host.removeChild(el);
  }
  host.remove();
  return resultado;
}

/** Extrai do código as combinações de classes de cor que precisam ser medidas mesmo sem dado. */
function combosDoCodigo(): { classes: string; texto: string }[] {
  const arquivos: string[] = [];
  const anda = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (e.name.endsWith(".tsx")) arquivos.push(p);
    }
  };
  anda(path.join(ROOT, "src"));

  const vistos = new Map<string, string>();
  const tokenCor = /\b(?:bg|text|border)-(?:brand|success|warning|danger|neutral|slate|white|black)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;
  for (const arquivo of arquivos) {
    const fonte = fs.readFileSync(arquivo, "utf8");
    // cada "string de classes" do código: entre aspas duplas ou dentro de um ramo de ternário
    for (const bruto of fonte.match(/"[^"\n]{3,240}"/g) || []) {
      const classes = (bruto.slice(1, -1).match(tokenCor) || []).filter((c) => !c.includes("/"));
      const temFundo = classes.some((c) => c.startsWith("bg-"));
      const temTexto = classes.some((c) => c.startsWith("text-"));
      if (!temFundo || !temTexto) continue;
      // Uma string com DOIS `text-*` (ou dois `bg-*`) e um ternario: os ramos sao alternativos e
      // nunca coexistem. Medi-los juntos inventa um par que a tela nunca mostra - foi o que
      // produziu "bg-brand-50 text-brand-600 text-slate-400" na primeira rodada.
      if (classes.filter((c) => c.startsWith("text-")).length !== 1) continue;
      if (classes.filter((c) => c.startsWith("bg-")).length !== 1) continue;
      const chave = classes.slice().sort().join(" ");
      if (!vistos.has(chave)) vistos.set(chave, classes.join(" ") + " px-2 py-0.5 text-xs font-bold");
    }
  }
  return [...vistos.entries()].map(([chave, classes]) => ({ classes, texto: chave.replace(/\s+/g, "·").slice(0, 40) }));
}

/**
 * O `tsx` compila com `keepNames`, e o esbuild injeta chamadas a `__name` DENTRO das funções que
 * este script serializa para dentro da página. Sem este atalho, toda `page.evaluate` morre com
 * "__name is not defined" - erro do compilador, não do produto.
 */
async function prepararPagina(page: Page): Promise<void> {
  await page.evaluate("globalThis.__name = globalThis.__name || ((f) => f)");
}

async function medirTela(page: Page, tela: string): Promise<Amostra[]> {
  await prepararPagina(page);
  const brutas = await page.evaluate(coletar);
  return brutas.map((b) => ({ ...b, tela, origem: "vivo" as const }));
}

async function main(): Promise<void> {
  dotenv.config({ path: path.join(ROOT, ".env.capture.local"), quiet: true });
  const baseUrl = process.env.CAPTURE_BASE_URL || DEFAULT_BASE_URL;
  const viewport = VIEWPORTS[0];
  const amostras: Amostra[] = [];

  const browser: Browser = await chromium.launch();
  try {
    let context = await browser.newContext({
      storageState: path.join(ROOT, AUTH_STATE_PATH),
      ...contextOptionsFor(viewport),
    });
    let page = await context.newPage();
    try {
      await openApp(page, baseUrl);
    } catch {
      // O estado salvo caduca (o token tem validade curta) e o sintoma é a tela de login no lugar
      // do shell. Renovar custa UM login dos 20 por janela; perder a rodada custa a rodada inteira.
      console.log("  estado de sessão expirado — renovando (1 login)");
      await context.close();
      const email = process.env.CAPTURE_EMAIL;
      const password = process.env.CAPTURE_PASSWORD;
      if (!email || !password) throw new Error("CAPTURE_EMAIL/CAPTURE_PASSWORD ausentes em .env.capture.local");
      await saveAuthState(browser, { baseUrl, email, password, path: path.join(ROOT, AUTH_STATE_PATH) });
      context = await browser.newContext({
        storageState: path.join(ROOT, AUTH_STATE_PATH),
        ...contextOptionsFor(viewport),
      });
      page = await context.newPage();
      await openApp(page, baseUrl);
    }
    await stabilize(page);

    for (const screen of SCREENS.filter((s) => s.authenticated)) {
      process.stdout.write(`  medindo ${screen.id}\n`);
      await screen.open(page);
      await stabilize(page);
      amostras.push(...(await medirTela(page, screen.id)));
    }

    // As sintéticas rodam uma vez, na última tela: as classes vêm do CSS construído, que é o mesmo
    // documento em todas elas.
    const combos = combosDoCodigo();
    process.stdout.write(`  ${combos.length} combinações de classes do código, medidas em amostra sintética\n`);
    await prepararPagina(page);
    const sinteticas = await page.evaluate(coletarSinteticas, combos);
    amostras.push(...sinteticas.map((s) => ({ ...s, tela: "amostra-sintetica", origem: "sintetico" as const })));

    // O login não é autenticado: contexto próprio, sem sessão.
    const ctxLogin = await browser.newContext(contextOptionsFor(viewport));
    const pageLogin = await ctxLogin.newPage();
    await pageLogin.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
    const login = SCREENS.find((s) => s.id === "login")!;
    await login.open(pageLogin);
    await settle(pageLogin);
    amostras.push(...(await medirTela(pageLogin, "login")));
    await ctxLogin.close();
    await context.close();
  } finally {
    await browser.close();
  }

  // ---- veredito, com a conta vindo de brandTheme -----------------------------------------
  interface Par {
    fg: string;
    bg: string;
    tipo: Amostra["tipo"];
    razao: number;
    piso: number;
    passa: boolean;
    ocorrencias: number;
    exemplos: string[];
    telas: Set<string>;
  }
  const pares = new Map<string, Par>();
  for (const a of amostras) {
    const piso = a.tipo === "texto" ? PISO_TEXTO : a.tipo === "texto-grande" ? PISO_GRANDE : PISO_UI;
    const chave = `${a.fg}|${a.bg}|${a.tipo}`;
    const atual = pares.get(chave);
    if (atual) {
      atual.ocorrencias++;
      atual.telas.add(a.tela);
      if (atual.exemplos.length < 4 && !atual.exemplos.includes(a.rotulo)) atual.exemplos.push(a.rotulo);
      continue;
    }
    const razao = contrastRatio(a.fg, a.bg);
    pares.set(chave, {
      fg: a.fg,
      bg: a.bg,
      tipo: a.tipo,
      razao,
      piso,
      passa: razao >= piso,
      ocorrencias: 1,
      exemplos: [a.rotulo],
      telas: new Set([a.tela]),
    });
  }

  const lista = [...pares.values()].sort((x, y) => x.razao - y.razao);
  const reprovados = lista.filter((p) => !p.passa);
  const relatorio = {
    geradoEm: new Date().toISOString(),
    amostras: amostras.length,
    paresUnicos: lista.length,
    reprovados: reprovados.length,
    pisos: { texto: PISO_TEXTO, textoGrande: PISO_GRANDE, ui: PISO_UI },
    pares: lista.map((p) => ({ ...p, razao: +p.razao.toFixed(2), telas: [...p.telas] })),
  };
  const saida = path.join(ROOT, "docs/roadmap/auditoria-contraste-fase9.json");
  fs.writeFileSync(saida, JSON.stringify(relatorio, null, 2));

  console.log(`\n${amostras.length} amostras · ${lista.length} pares únicos · ${reprovados.length} abaixo do piso`);
  for (const p of reprovados) {
    console.log(
      `  REPROVA ${p.razao.toFixed(2)}:1 (piso ${p.piso}) ${p.fg} sobre ${p.bg} [${p.tipo}] ` +
        `${p.ocorrencias}x em ${[...p.telas].join(",")} — ${p.exemplos.join(" | ")}`,
    );
  }
  const suspeitos = lista.filter((p) => p.razao >= 19 && p.fg === "#000000");
  if (suspeitos.length) {
    console.log(`\n  ${suspeitos.length} par(es) com texto PRETO e contraste absurdo — classe provavelmente ausente do CSS construído:`);
    for (const p of suspeitos) console.log(`   ${p.razao.toFixed(2)}:1  ${p.exemplos.join(" | ")}`);
  }
  console.log(`\nrelatório completo: ${saida}`);
  if (reprovados.length) process.exitCode = 1;
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
