/**
 * CDC 16 — Fase 10. Prova visual: a Início virou painel.
 *
 * Duas pessoas, de propósito, pelo mesmo motivo da F9: o que esta fase muda depende de QUEM olha.
 * O administrador alcança a Administração; o pré-vendas, que tem `demand:read` e NÃO tem
 * `admin:settings`, não — e é ele quem vive na fila. Uma captura só com o administrador provaria
 * metade da regra.
 *
 * As imagens saem FORA de `docs/visual-baseline/`: regravar parte do baseline muda o trajeto de
 * `npm run test:visual` sem ninguém pedir, e o baseline só se regrava INTEIRO e depois de publicar.
 *
 *   BASE_URL=http://127.0.0.1:3019 PROVA_PASSWORD=… SAIDA=/tmp/cdc16-f10 \
 *     npx tsx scripts/cdc16-f10-capturar.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { VIEWPORTS, contextOptionsFor, login, settle, stabilize } from "./uiScreens";
import { PAPEIS_DA_PROVA, entrarComo, papelDaProva } from "./cdc16-f5-comum";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3019";
const SAIDA = process.env.SAIDA || "/tmp/cdc16-f10";
const TENANT = process.env.PROVA_TENANT || "tenant_default";
const PREFIXO = "captura-cdc16-f10-";
const SENHA = process.env.PROVA_PASSWORD || "";

const EMAIL_ADMIN = `${PREFIXO}alberto@teste.invalid`;
const EMAIL_EQUIPE = `${PREFIXO}ana@teste.invalid`;
const EMAIL_COLEGA = `${PREFIXO}bruno@teste.invalid`;

// Neste shell quem rola é um container interno, então `fullPage` captura a viewport e nada mais.
// A altura vai grande na mão, e o tamanho de cada PNG é CONFERIDO no fim: uma imagem de 720px de
// altura é o sintoma exato desta armadilha, e ela passa sem erro nenhum.
const ALTOS = VIEWPORTS.map((v) => ({ ...v, height: v.isMobile ? 2600 : 2000 }));

const medidas: Record<string, any> = {};

/** Os rótulos das colunas de um card, lidos do DOM. */
const colunasDe = (testid: string) => `(() => {
  const card = document.querySelector("[data-testid='${testid}']");
  if (!card) return null;
  return [...card.querySelectorAll("thead th")].map((th) => (th.innerText || "").replace(/\\s+/g, " ").trim());
})()`;

/**
 * As linhas de um card: a REFERÊNCIA e o título, na ordem desenhada.
 *
 * A referência entra porque o título não serve de identidade — a instalação de
 * prova tem demandas com títulos repetidos, e "a página 2 não repete a 1"
 * medido por título passaria mesmo com uma linha repetida de verdade. Foi
 * exatamente esse empate que a F9 achou na ordenação.
 */
const linhasDe = (testid: string) => `(() => {
  const card = document.querySelector("[data-testid='${testid}']");
  if (!card) return null;
  return [...card.querySelectorAll("tbody tr")]
    .map((tr) => {
      const td = tr.querySelector("td");
      if (!td) return null;
      const partes = (td.innerText || "").split("\\n").map((x) => x.replace(/\\s+/g, " ").trim());
      return { titulo: partes[0] || "", ref: partes[1] || "" };
    })
    .filter((x) => x && x.titulo);
})()`;

/** Os VALORES da coluna "Valor" de um card, na ordem desenhada. `null` para a demanda sem valor. */
const valoresDe = (testid: string) => `(() => {
  const card = document.querySelector("[data-testid='${testid}']");
  if (!card) return null;
  return [...card.querySelectorAll("tbody tr")].map((tr) => {
    const td = tr.querySelectorAll("td")[1];
    if (!td) return null;
    const t = (td.innerText || "").split("\\n")[0].replace(/\\s+/g, "").trim();
    if (!t || t === "—") return null;
    const n = Number(t.replace(/[^0-9,.-]/g, "").replace(/\\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  });
})()`;

async function preparar() {
  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    const papelAdmin = await papelDaProva(`${PREFIXO}admin`, [...PAPEIS_DA_PROVA.admin, "demand:manage", "demand:assume"]);
    const papelEquipe = await papelDaProva(`${PREFIXO}equipe`, PAPEIS_DA_PROVA.equipe);
    const registrar = (r: string, ok: boolean, d: string) => {
      medidas[`preparo:${r}`] = `${ok ? "OK" : "FALHA"} ${d}`;
    };
    await entrarComo(`${PREFIXO}Alberto`, EMAIL_ADMIN, papelAdmin.id, SENHA, registrar);
    await entrarComo(`${PREFIXO}Ana`, EMAIL_EQUIPE, papelEquipe.id, SENHA, registrar);
    await entrarComo(`${PREFIXO}Bruno`, EMAIL_COLEGA, papelEquipe.id, SENHA, registrar);
  });
}

async function main() {
  if (!SENHA) throw new Error("PROVA_PASSWORD ausente — a captura entra pela tela de login real");
  fs.mkdirSync(SAIDA, { recursive: true });
  await preparar();

  const navegador = await chromium.launch();
  try {
    for (const viewport of ALTOS) {
      // ─── 1. o PRÉ-VENDAS, que é quem vive na fila ──────────────────────────
      const ctx = await navegador.newContext(contextOptionsFor(viewport));
      const p = await ctx.newPage();
      const erros: string[] = [];
      // `pageerror`, e não `console`: exceção não capturada NÃO aparece no
      // console do Playwright, e uma página que morreu no meio do render passa
      // por inteira porque a linha anterior rodou.
      p.on("pageerror", (e) => erros.push(String(e?.message || e)));

      await login(p, { baseUrl: BASE, email: EMAIL_EQUIPE, password: SENHA });
      await stabilize(p);
      await p.getByTestId("card-novas-demandas").waitFor({ state: "visible", timeout: 20000 });
      await p.getByTestId("card-minhas-demandas").waitFor({ state: "visible", timeout: 20000 });
      // A pizza desenha DEPOIS do primeiro quadro. Esperar o `<svg>` acusaria
      // pronto um gráfico ainda vazio; o rótulo com percentual só existe quando
      // as fatias existem.
      await p.waitForFunction(
        `(() => {
          const g = document.querySelector("[data-testid='grafico-verticais']");
          return !!g && /\\d+%/.test(g.innerText || "");
        })()`,
        undefined,
        { timeout: 20000 }
      ).catch(() => undefined);
      await settle(p);

      // ─── o que SAIU, e o que CHEGOU, medidos no mesmo lugar ───────────────
      medidas[`${viewport.id}-inicio`] = await p.evaluate(`(() => {
        const t = document.body.innerText;
        return {
          // Os DOIS cards, e os dois pelo testid: um "innerText contém" passaria
          // com o texto solto em qualquer lugar da página.
          temCardNovas: !!document.querySelector("[data-testid='card-novas-demandas']"),
          temCardMinhas: !!document.querySelector("[data-testid='card-minhas-demandas']"),
          // A ponte da F9 foi SUBSTITUÍDA, não escondida.
          ponteDaF9Sumiu: !document.querySelector("[data-testid='home-fila-de-pre-vendas']"),
          // O card de tarefas saiu de vez (resposta C).
          tarefasPendentesSumiu: !t.includes("Tarefas Pendentes"),
          // A lista de editais repetia a aba Projetos e saiu junto.
          listaDeEditaisSumiu: !t.includes("Lista de Propostas e Editais Ativos"),
          // A pizza entrou no lugar do gráfico por setor: o bloco continua,
          // com o mesmo título, e o que mudou é o desenho.
          // A pizza depende de HAVER licitação: quem não é dono de projeto
          // nenhum vê o estado vazio, que é o comportamento certo e não a
          // prova. Por isso o desenho é medido no administrador, mais abaixo,
          // e aqui fica registrado o que ESTA pessoa de fato vê.
          blocoDaPizza: (document.querySelector("[data-testid='grafico-verticais']") || {}).innerText,
          temGraficoDeDesempenho: !!document.querySelector("[data-testid='grafico-desempenho']"),
          // A frase da D20 não pode sumir por mudar de lugar.
          dizQueOCrmNuncaVeDesempenhoDePessoa: t.includes("nunca o desempenho de quem trabalha nesta fila"),
        };
      })()`);
      await p.screenshot({ path: path.join(SAIDA, `${viewport.id}-inicio-painel.png`) });

      // ─── as quatro colunas, e só elas (resposta H) ────────────────────────
      const colunasNovas = (await p.evaluate(colunasDe("card-novas-demandas"))) as string[];
      medidas[`${viewport.id}-colunas-do-card`] = {
        lidas: colunasNovas,
        // Quatro colunas de dado + a de ações. Cliente, Vertical e Situação
        // saíram para o popup, e a asserção afirma os DOIS lados.
        saoQuatroMaisAcoes: colunasNovas.length === 5,
        asQuatro: ["DEMANDA", "VALOR", "PRAZO DO EDITAL", "PRAZO DO SLA"].every((r) =>
          colunasNovas.some((c) => c.toUpperCase().startsWith(r))
        ),
        naoTemClienteVerticalSituacao: !colunasNovas.some((c) =>
          /^(CLIENTE|VERTICAL|SITUAÇÃO)/.test(c.toUpperCase())
        ),
      };

      // ─── cinco linhas por vez, e a paginação de verdade ───────────────────
      const pagina1 = (await p.evaluate(linhasDe("card-novas-demandas"))) as any[];
      const rotulo1 = await p.getByTestId("card-novas-demandas-paginacao").innerText();
      await p.getByTestId("card-novas-demandas-proxima-pagina").click();
      await p.waitForFunction(
        `(() => {
          const el = document.querySelector("[data-testid='card-novas-demandas-paginacao']");
          return el && (el.innerText || "").trim() !== ${JSON.stringify(rotulo1.trim())};
        })()`,
        undefined,
        { timeout: 15000 }
      );
      await settle(p);
      const pagina2 = (await p.evaluate(linhasDe("card-novas-demandas"))) as any[];
      const rotulo2 = await p.getByTestId("card-novas-demandas-paginacao").innerText();
      const refs1 = pagina1.map((l: any) => l.ref);
      const refs2 = pagina2.map((l: any) => l.ref);
      medidas[`${viewport.id}-paginacao`] = {
        pagina1,
        pagina2,
        rotulo1: rotulo1.replace(/\s+/g, " ").trim(),
        rotulo2: rotulo2.replace(/\s+/g, " ").trim(),
        cincoNaPrimeira: pagina1.length === 5,
        // Os DOIS lados: a página mudou E não repetiu ninguém. Só o primeiro
        // passaria com uma lista embaralhada; só o segundo, com a página vazia.
        // Medido pela REFERÊNCIA: há títulos repetidos nesta instalação, e por
        // título a asserção passaria mesmo com uma linha repetida de verdade.
        semSobreposicao: refs2.every((r: string) => !refs1.includes(r)),
        semRepeticaoDentroDaPagina: new Set(refs1).size === refs1.length && new Set(refs2).size === refs2.length,
        mudouDeVerdade: pagina2.length > 0 && JSON.stringify(refs1) !== JSON.stringify(refs2),
      };
      await p.screenshot({ path: path.join(SAIDA, `${viewport.id}-card-pagina-2.png`) });
      await p.getByTestId("card-novas-demandas-pagina-anterior").click();
      await settle(p);

      // ─── os recortes como botões, e cada card com os seus (resposta G) ────
      const recortes = await p.evaluate(`(() => {
        const ler = (id) => {
          const el = document.querySelector("[data-testid='" + id + "-recortes']");
          return el ? [...el.querySelectorAll("button")].map((b) => (b.innerText || "").trim()) : null;
        };
        return { novas: ler("card-novas-demandas"), minhas: ler("card-minhas-demandas") };
      })()`);
      medidas[`${viewport.id}-recortes`] = {
        ...(recortes as any),
        cadaCardTemOsSeus:
          JSON.stringify((recortes as any).novas) !== JSON.stringify((recortes as any).minhas),
      };

      // ─── a ordenação pelo título da coluna, medida pelo VALOR ─────────────
      await p.getByTestId("card-novas-demandas-ordenar-value").click();
      await p.waitForFunction(
        `(() => { const b = document.querySelector("[data-testid='card-novas-demandas-ordenar-value']"); return b && b.className.includes("text-brand-700"); })()`,
        undefined,
        { timeout: 15000 }
      );
      await settle(p);
      const valoresAsc = (await p.evaluate(valoresDe("card-novas-demandas"))) as Array<number | null>;
      await p.getByTestId("card-novas-demandas-ordenar-value").click();
      await settle(p);
      const valoresDesc = (await p.evaluate(valoresDe("card-novas-demandas"))) as Array<number | null>;
      // A ordem decrescente NÃO é a crescente ao contrário, porque os nulos
      // ficam no fim nas duas direções — de propósito. Afirmar o inverso exato
      // acusaria de defeito o comportamento que a fase escolheu.
      const monotonica = (v: Array<number | null>, sentido: "asc" | "desc") => {
        const comValor = v.filter((x): x is number => x !== null);
        return {
          ordenada: comValor.every((x, i) => i === 0 || (sentido === "asc" ? comValor[i - 1] <= x : comValor[i - 1] >= x)),
          nulosNoFim: v.slice(comValor.length).every((x) => x === null),
          quantos: comValor.length,
        };
      };
      medidas[`${viewport.id}-ordenacao-por-valor`] = {
        valoresAsc,
        valoresDesc,
        crescente: monotonica(valoresAsc, "asc"),
        decrescente: monotonica(valoresDesc, "desc"),
        primeiroMudouComADirecao: valoresAsc[0] !== valoresDesc[0],
      };
      await p.screenshot({ path: path.join(SAIDA, `${viewport.id}-card-ordenado-por-valor.png`) });

      // ─── o filtro no título da coluna ────────────────────────────────────
      const antesDoFiltro = ((await p.evaluate(linhasDe("card-novas-demandas"))) as any[]).length;
      const totalAntes = (await p.getByTestId("card-novas-demandas-paginacao").innerText()).replace(/\s+/g, " ").trim();
      await p.getByTestId("card-novas-demandas-filtro-busca").fill("saneamento");
      await p.waitForFunction(
        `(() => {
          const el = document.querySelector("[data-testid='card-novas-demandas-paginacao']");
          return el && (el.innerText || "").replace(/\\s+/g, " ").trim() !== ${JSON.stringify(totalAntes)};
        })()`,
        undefined,
        { timeout: 15000 }
      );
      await settle(p);
      const depoisDoFiltro = ((await p.evaluate(linhasDe("card-novas-demandas"))) as any[]).map((l: any) => l.titulo);
      medidas[`${viewport.id}-filtro-por-coluna`] = {
        antes: antesDoFiltro,
        depois: depoisDoFiltro,
        recortou: depoisDoFiltro.length < antesDoFiltro,
        soORelevante: depoisDoFiltro.every((t) => /saneamento/i.test(t)),
      };
      await p.screenshot({ path: path.join(SAIDA, `${viewport.id}-card-filtrado.png`) });
      await p.getByTestId("card-novas-demandas-filtro-busca").fill("");
      await settle(p);

      // ─── "Detalhes" abre a gaveta, e o "Assumir" está DENTRO dela ────────
      const primeiraLinha = p.locator("[data-testid='card-novas-demandas'] tbody tr").first();
      const semBotaoDeAto = await primeiraLinha.evaluate((tr: any) => {
        const botoes = [...tr.querySelectorAll("td:last-child button")].map((b: any) => (b.innerText || "").trim());
        return { botoesNaLinha: botoes, soDetalhes: botoes.length === 1 && botoes[0] === "Detalhes" };
      });
      medidas[`${viewport.id}-linha-so-tem-detalhes`] = semBotaoDeAto;
      await primeiraLinha.locator("td:last-child button").click();
      await p.getByTestId("demand-detail-body").waitFor({ state: "visible", timeout: 15000 });
      await settle(p);
      medidas[`${viewport.id}-gaveta`] = await p.evaluate(`(() => {
        const g = document.querySelector("[data-testid='demand-detail-body']");
        if (!g) return null;
        // textContent, e NÃO innerText: os títulos das seções têm
        // text-transform uppercase, e o innerText devolve o texto COMO
        // RENDERIZADO — procurar "Cliente (referência do CRM)" nele responde
        // "não" para uma seção que está ali, escrita exatamente assim no DOM.
        const t = g.textContent || "";
        return {
          // O ato mudou de lugar: está aqui dentro, não na linha.
          temAssumir: !!g.querySelector("[data-testid='assumir-demanda']"),
          // As três colunas que saíram da linha vivem aqui — os dois lados da
          // resposta H medidos no mesmo elemento.
          temSituacao: !!g.querySelector("[data-testid='modal-situacao']"),
          temCliente: t.includes("Cliente (referência do CRM)"),
          temVertical: t.includes("Vertical"),
        };
      })()`);
      await p.screenshot({ path: path.join(SAIDA, `${viewport.id}-gaveta-com-assumir.png`) });
      // Fecha pelo X da própria gaveta: clicar no fundo também fecha, mas
      // depende de a caixa não cobrir o ponto — e em 390px ela cobre quase tudo.
      await p.locator("[data-testid='demand-detail-body'] button[aria-label='Fechar']").click();
      await p.locator("[data-testid='demand-detail-body']").waitFor({ state: "detached", timeout: 10000 });
      await settle(p);

      medidas[`${viewport.id}-erros-equipe`] = erros;

      // ─── a D15 no DOM: o card das novas do COLEGA é o mesmo ───────────────
      //
      // Recarrega antes de ler. A tela desta pessoa está com a ordem por VALOR
      // e o filtro que as medidas anteriores aplicaram; a do colega abre no
      // padrão. Comparar as duas assim acusaria a D15 de violada por uma
      // diferença que é de estado da tela, e não de recorte de fila.
      await p.reload({ waitUntil: "domcontentloaded" });
      await stabilize(p);
      await p.getByTestId("card-novas-demandas").waitFor({ state: "visible", timeout: 20000 });
      await settle(p);
      const linhasDaAna = (await p.evaluate(linhasDe("card-novas-demandas"))) as any[];
      const totalDaAna = (await p.getByTestId("card-novas-demandas-paginacao").innerText()).replace(/\s+/g, " ").trim();
      await ctx.close();

      const ctxColega = await navegador.newContext(contextOptionsFor(viewport));
      const pColega = await ctxColega.newPage();
      const errosColega: string[] = [];
      pColega.on("pageerror", (e) => errosColega.push(String(e?.message || e)));
      await login(pColega, { baseUrl: BASE, email: EMAIL_COLEGA, password: SENHA });
      await stabilize(pColega);
      await pColega.getByTestId("card-novas-demandas").waitFor({ state: "visible", timeout: 20000 });
      await settle(pColega);
      const linhasDoBruno = (await pColega.evaluate(linhasDe("card-novas-demandas"))) as any[];
      const minhasDoBruno = (await pColega.evaluate(linhasDe("card-minhas-demandas"))) as any[];
      const totalDoBruno = (await pColega.getByTestId("card-novas-demandas-paginacao").innerText()).replace(/\s+/g, " ").trim();
      medidas[`${viewport.id}-d15-no-dom`] = {
        novasDaAna: linhasDaAna.map((l: any) => l.ref),
        novasDoBruno: linhasDoBruno.map((l: any) => l.ref),
        totalDaAna,
        totalDoBruno,
        // A D15: a fila das novas é a MESMA para os dois — a página e o total.
        mesmasNovas:
          JSON.stringify(linhasDaAna.map((l: any) => l.ref)) === JSON.stringify(linhasDoBruno.map((l: any) => l.ref)),
        mesmoTotal: totalDaAna === totalDoBruno,
        // …e "Minhas demandas" é a vista que difere. Sem esta segunda medida, a
        // primeira sozinha também passaria numa tela que ignora o recorte.
        minhasDoBruno,
      };
      await pColega.screenshot({ path: path.join(SAIDA, `${viewport.id}-colega-inicio.png`) });
      medidas[`${viewport.id}-erros-colega`] = errosColega;
      await ctxColega.close();

      // ─── o ADMINISTRADOR: a fila completa continua alcançável e intacta ───
      const ctxAdmin = await navegador.newContext(contextOptionsFor(viewport));
      const pAdmin = await ctxAdmin.newPage();
      const errosAdmin: string[] = [];
      pAdmin.on("pageerror", (e) => errosAdmin.push(String(e?.message || e)));
      await login(pAdmin, { baseUrl: BASE, email: EMAIL_ADMIN, password: SENHA });
      await stabilize(pAdmin);
      await pAdmin.getByTestId("card-novas-demandas").waitFor({ state: "visible", timeout: 20000 });
      // A PIZZA, medida em quem tem licitação para ela desenhar. Esperar o
      // rótulo com percentual, e não o `<svg>`: com `recharts` o primeiro
      // quadro é VAZIO, e uma captura feita nele sai sem gráfico nenhum
      // enquanto a asserção de existência passa.
      await pAdmin.waitForFunction(
        `(() => {
          const g = document.querySelector("[data-testid='grafico-verticais']");
          return !!g && /\\d+%/.test(g.textContent || "");
        })()`,
        undefined,
        { timeout: 20000 }
      ).catch(() => undefined);
      await settle(pAdmin);
      medidas[`${viewport.id}-pizza`] = await pAdmin.evaluate(`(() => {
        const g = document.querySelector("[data-testid='grafico-verticais']");
        if (!g) return null;
        const fatias = g.querySelectorAll(".recharts-pie-sector, .recharts-sector").length;
        return {
          ehPizza: !!g.querySelector(".recharts-pie"),
          fatias,
          // O rótulo com percentual é o que separa "o gráfico existe" de "o
          // gráfico desenhou": ele só aparece depois das fatias.
          temRotuloComPercentual: /\\d+%/.test(g.textContent || ""),
          // E o que SAIU: a barra que ocupava este bloco antes da F10 era um
          // <div class="bg-brand-600 h-full ..."> com largura inline. Medir
          // "nenhum div com width inline" nao serve - o proprio recharts usa
          // varios; o que identifica a barra antiga e a classe da pintura.
          semAsBarrasAntigas: g.querySelectorAll("div.bg-brand-600").length === 0,
          titulo: (g.querySelector("h3") || {}).textContent,
        };
      })()`);
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-admin-pizza.png`) });
      // O card leva à fila completa: sem este caminho, tirar a ponte da F9
      // deixaria a tela da fila órfã — que é "corrigir tirando, sem repor" com
      // o sinal trocado.
      await pAdmin.getByTestId("card-novas-demandas-abrir-fila").click();
      await pAdmin.waitForSelector("table tbody tr", { timeout: 20000 });
      await settle(pAdmin);
      medidas[`${viewport.id}-fila-completa`] = await pAdmin.evaluate(`(() => {
        const cabecalhos = [...document.querySelectorAll("thead th")].map((th) => (th.innerText || "").replace(/\\s+/g, " ").trim());
        return {
          alcancada: !!document.querySelector("[data-testid='fila-paginacao']"),
          // A vista completa CONTINUA com as colunas que o card não tem.
          cabecalhos,
          temClienteVerticalSituacao: ["CLIENTE", "VERTICAL", "SITUAÇÃO"].every((r) =>
            cabecalhos.some((c) => c.toUpperCase().startsWith(r))
          ),
          temFiltroDeCliente: !!document.querySelector("[data-testid='filtro-cliente']"),
          temFiltroDeVertical: !!document.querySelector("[data-testid='filtro-vertical']"),
          paginacao: (document.querySelector("[data-testid='fila-paginacao']") || {}).innerText,
        };
      })()`);
      await pAdmin.screenshot({ path: path.join(SAIDA, `${viewport.id}-fila-completa.png`) });
      medidas[`${viewport.id}-erros-admin`] = errosAdmin;
      await ctxAdmin.close();
    }
  } finally {
    await navegador.close();
    await prisma.$disconnect();
  }

  // O TAMANHO de cada PNG, conferido e não presumido: neste shell quem rola é
  // um container interno, `fullPage` capturaria a viewport e nada mais, e uma
  // imagem cortada passa sem erro nenhum. 720px de altura é o sintoma.
  //
  // Lido do cabeçalho IHDR do próprio arquivo, e não por biblioteca: largura e
  // altura moram nos bytes 16..24 de todo PNG, e acrescentar uma dependência
  // (com o alerta de Dependabot que ela traz) para ler oito bytes seria caro
  // pelo motivo errado.
  const arquivos = fs.readdirSync(SAIDA).filter((f) => f.endsWith(".png")).sort();
  medidas["tamanho-dos-png"] = arquivos.map((f) => {
    const b = fs.readFileSync(path.join(SAIDA, f)); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- dev-only script; f comes from fs.readdirSync on the local capture output dir, never external input
    return { arquivo: f, largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
  });

  fs.writeFileSync(path.join(SAIDA, "medidas.json"), JSON.stringify(medidas, null, 2));
  console.log(JSON.stringify(medidas, null, 2));
  console.log(`\ncapturas em ${SAIDA}`);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
