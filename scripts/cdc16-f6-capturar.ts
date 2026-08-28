/**
 * CDC 16 — Fase 6. Prova visual do PASSO DO CRM no assistente de intake (D12/D13/D31).
 *
 * Mesmos helpers da rede de captura do produto (`scripts/uiScreens.ts`): login pela tela real,
 * estabilização de animação, as duas larguras. Como na F1 e na F5, as imagens saem FORA de
 * `docs/visual-baseline/` — regravar parte do baseline muda o trajeto de `npm run test:visual`
 * sem ninguém pedir.
 *
 * ## O assistente é dirigido de verdade, pelo caminho do produto
 *
 * Nada é montado à mão: a captura clica em "Nova Proposta", sobe um documento, manda analisar,
 * preenche a ficha, confirma — e é aí que a TERCEIRA etapa aparece, que é o que esta fase
 * acrescentou. Montar o componente sozinho na tela capturaria um retrato de um estado que o
 * produto talvez nunca alcance; a F3 registrou esse gênero de erro ("prova que chama o domínio
 * pula o gancho da rota") e ele vale igual para captura.
 *
 * A análise por IA pode falhar no banco de prova (provedor não configurado), e o assistente já
 * trata isso: ele segue para a validação com o erro na tela e os campos em branco, para
 * preenchimento manual. O caminho até a terceira etapa é o mesmo nos dois casos.
 *
 *   BASE_URL=http://127.0.0.1:3010 PROVA_PASSWORD=… CNPJ_MATRIZ=… SAIDA=/tmp/cdc16-f6 \
 *     npx tsx scripts/cdc16-f6-capturar.ts
 */
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { VIEWPORTS, contextOptionsFor, login, settle, stabilize } from "./uiScreens";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const SAIDA = process.env.SAIDA || "/tmp/cdc16-f6";
const EMAIL = process.env.PROVA_EMAIL || "prova-cdc16-f6-marina@local.invalid";
const SENHA = process.env.PROVA_PASSWORD || "";
const CNPJ = process.env.CNPJ_MATRIZ || "04252011000110";

// Neste shell quem rola é um container interno: `fullPage` captura a viewport e nada mais, e a
// F3 perdeu uma timeline inteira assim. Viewport alta é o que faz o modal caber na imagem.
const ALTOS = VIEWPORTS.map((v) => ({ ...v, height: v.isMobile ? 2000 : 1400 }));

const EDITAL = `PREFEITURA MUNICIPAL DE EXEMPLO
Processo administrativo no 12.345.678/9012-34
Orgao contratante inscrito no CNPJ ${CNPJ}
PREGAO ELETRONICO No 1/2026
Objeto: implantacao de 120 pontos de videomonitoramento com central de operacoes.
Data limite para entrega das propostas: 31/12/2026.
`;

async function main() {
  if (!SENHA) throw new Error("PROVA_PASSWORD ausente.");
  fs.mkdirSync(SAIDA, { recursive: true });

  const navegador = await chromium.launch();
  const medidas: Record<string, unknown> = {};
  try {
    for (const viewport of ALTOS) {
      const contexto = await navegador.newContext(contextOptionsFor(viewport));
      const pagina = await contexto.newPage();

      // Exceção não capturada mata o script da página e deixa a tela pela metade SEM nada no
      // console: `pageerror` é o único evento que a enxerga.
      const erros: string[] = [];
      pagina.on("pageerror", (e) => erros.push(String(e?.message || e)));

      await login(pagina, { baseUrl: BASE, email: EMAIL, password: SENHA });
      await stabilize(pagina);

      // ── etapa 1: o assistente, e o edital
      //
      // O botão que abre o assistente vive no painel esquerdo da ÁREA DE TRABALHO, e não na tela
      // inicial: sem entrar na aba, ele nem é renderizado, e a espera por ele estoura sem dizer
      // por quê.
      await pagina.getByRole("button", { name: /Área de Trabalho/i }).first().click();
      await settle(pagina);
      await pagina.getByRole("button", { name: /Nova Proposta/i }).first().click();
      await settle(pagina);
      /*
       * ESCOPADO AO MODAL. Há DOIS `input[type=file]` nesta tela — o da barra lateral do projeto
       * aberto e o do assistente —, e o seletor solto casa com o primeiro, que é o da barra. O
       * arquivo subia para o projeto errado e o assistente ficava vazio, sem erro nenhum: o
       * sintoma era um timeout esperando o nome do arquivo aparecer na lista do modal.
       */
      const modal = pagina.locator("div.fixed.inset-0").last();
      await modal.locator('input[type="file"]').setInputFiles({
        name: `edital-${Date.now()}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(EDITAL, "utf-8"),
      });
      // O upload é assíncrono e pode falhar por validação do arquivo ou por armazenamento; a
      // captura do estado ANTES da espera é o que transforma um timeout mudo em diagnóstico.
      await settle(pagina);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-1-edital.png`) });
      try {
        await modal.getByText(/edital-\d+\.txt/).waitFor({ state: "visible", timeout: 30000 });
      } catch (e) {
        medidas[`${viewport.id}-upload-nao-apareceu`] = await pagina.evaluate(
          `document.body.innerText.slice(0, 1200)`,
        );
        throw e;
      }

      // ── etapa 2: a validação da ficha
      await pagina.getByRole("button", { name: /Analisar com IA/i }).click();
      try {
        await pagina
          .getByRole("button", { name: /Confirmar e Criar Projeto/i })
          .waitFor({ state: "visible", timeout: 180000 });
      } catch (e) {
        await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-DIAG-analise.png`) });
        medidas[`${viewport.id}-analise-nao-avancou`] = {
          texto: await pagina.evaluate(`document.body.innerText.slice(0, 1500)`),
          botoes: await pagina.evaluate(
            `[...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 40)`,
          ),
          erros_de_pagina: erros,
        };
        fs.writeFileSync(path.join(SAIDA, "medidas.json"), JSON.stringify(medidas, null, 2));
        throw e;
      }
      await settle(pagina);

      // A ficha, preenchida pela IA ou à mão. Preencher o que estiver vazio é o que a pessoa
      // faria — e é o que permite chegar à terceira etapa mesmo sem provedor de IA no banco de
      // prova.
      /*
       * Os campos não têm `name`: o formulário é controlado por estado do React, e o único
       * endereço estável deles é o PLACEHOLDER — que é o que a pessoa também vê. Preencher só o
       * que está vazio é o que a pessoa faria, e é o que permite chegar à terceira etapa mesmo
       * quando o banco de prova não tem provedor de IA configurado.
       */
      await pagina.evaluate(`(() => {
        const setter = (el) => Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          "value"
        ).set;
        const porPlaceholder = (trecho, valor) => {
          const el = [...document.querySelectorAll("input, textarea")].find(
            (e) => (e.placeholder || "").includes(trecho)
          );
          if (!el) return "sem campo: " + trecho;
          if (el.value && el.value.trim().length > 0) return "ja preenchido: " + trecho;
          setter(el).call(el, valor);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return "preenchido: " + trecho;
        };
        return [
          porPlaceholder("Modernização", "Pregao eletronico 1/2026 - videomonitoramento"),
          porPlaceholder("Concessionária", "Prefeitura Municipal de Exemplo"),
          porPlaceholder("ITS-MTA", "PE-1-2026"),
          porPlaceholder("Detalhe o escopo", "Implantacao de 120 pontos de videomonitoramento com central de operacoes.")
        ];
      })()`);
      await settle(pagina);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-2-ficha.png`) });

      // ── etapa 3: o passo do CRM, que é o que esta fase entregou
      await pagina.getByRole("button", { name: /Confirmar e Criar Projeto/i }).click();
      const buscar = pagina.getByRole("button", { name: /^Procurar$/ });
      await buscar.waitFor({ state: "visible", timeout: 60000 });
      await settle(pagina);

      // A busca sai sozinha quando há CNPJ; se ela ainda não voltou, esperar o resultado é o que
      // separa "o campo de busca está lá" de "a busca achou alguém".
      const campo = pagina.locator('input[placeholder*="CNPJ"]');
      await campo.fill(CNPJ);
      await buscar.click();
      await pagina.getByText(/candidata\(s\)/).waitFor({ state: "visible", timeout: 60000 });
      await settle(pagina);
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-3-crm-busca.png`) });

      /*
       * A conferência que separa "a lista apareceu" de "a lista diz alguma coisa": as
       * OPORTUNIDADES ABERTAS de cada candidata são o campo pelo qual esta tela evita abrir a
       * segunda oportunidade, e sem elas o passo seria só um cadastro a mais. A F4 capturou um
       * gráfico no quadro zero e a asserção passou porque olhava o texto ao lado — aqui se conta
       * o que está desenhado.
       */
      const conteudo = (await pagina.evaluate(`(() => {
        /*
         * MINÚSCULAS dos dois lados. Estes rótulos são desenhados por text-transform: uppercase,
         * e innerText devolve o texto COMO RENDERIZADO — "CNPJ EXATO", não "CNPJ exato". A
         * (Sem crase neste comentário: ele vive DENTRO de um template literal, e uma crase aqui
         * fecha a string — o erro sai como sintaxe a dezenas de linhas de distância.)
         * primeira versão comparava com a caixa do código-fonte e respondia "não" sobre um texto
         * que está na tela: uma conferência que sempre responde não é pior do que nenhuma.
         */
        const texto = document.body.innerText.toLowerCase();
        const tem = (s) => texto.indexOf(s.toLowerCase()) >= 0;
        const botoes = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
        return {
          diz_candidatas: tem("CANDIDATA"),
          diz_cnpj_exato: tem("CNPJ exato"),
          diz_oportunidades_abertas: tem("Oportunidades abertas"),
          quantos_vincular: botoes.filter((b) => b.indexOf("Vincular a esta") >= 0).length,
          tem_criar_empresa: botoes.some((b) => b.indexOf("cadastrar empresa nova no CRM") >= 0),
          diz_responsavel_da_candidata: tem("respons\u00e1vel:")
        };
      })()`)) as Record<string, unknown>;
      medidas[`${viewport.id}-o-que-a-tela-diz`] = conteudo;

      // O cadastro da empresa nova, aberto — a outra metade do passo.
      await pagina.getByRole("button", { name: /cadastrar empresa nova no CRM/i }).click();
      await settle(pagina);
      // A frase da D32 só existe DEPOIS de o cadastro abrir — conferi-la antes daria um "não"
      // que não é sobre o produto, e uma conferência que sempre responde não é pior do que
      // nenhuma.
      medidas[`${viewport.id}-cadastro-de-empresa`] = await pagina.evaluate(
        `(() => ({ diz_sem_contato_pessoal: document.body.innerText.indexOf("Nenhum contato pessoal") >= 0 }))()`,
      );
      await pagina.screenshot({ path: path.join(SAIDA, `${viewport.id}-4-crm-empresa-nova.png`) });

      medidas[`${viewport.id}-erros-de-pagina`] = erros;
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }

  fs.writeFileSync(path.join(SAIDA, "medidas.json"), JSON.stringify(medidas, null, 2));
  console.log(JSON.stringify(medidas, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
