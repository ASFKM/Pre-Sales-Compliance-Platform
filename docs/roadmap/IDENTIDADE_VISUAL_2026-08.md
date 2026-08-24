# Plano de Implementação — Identidade visual do Pre-Sales Compliance Platform
## (Repaletização ancorada na marca + substituição da logomarca + tokenização)

**Repositório:** `ASFKM/Pre-Sales-Compliance-Platform` (`commercial-assistant-ai`), dev em
`home-comercial-01:/home/sakae/projects/commercial-assistant-ai`, branch `main` em `b19b56e`.

**Origem:** decisão do dono em 24/08/2026 — "apesar de estar harmônico, não tem nada a ver com a
logomarca oficial do produto; o amarelo destoa". Diagnóstico e proposta em
[[project_presales_marca_oficial_paleta]] e no artifact
https://claude.ai/code/artifact/06e9e05b-5c11-4bda-bd50-891f2f24b7bf

**Grafia (fontes e tamanhos) está aprovada e NÃO muda.** Este plano é exclusivamente sobre cor,
tokens e ativos de marca.

**Painel do programa (fonte de verdade visual e onde vive o prompt da fase corrente):**
https://claude.ai/code/artifact/06e9e05b-5c11-4bda-bd50-891f2f24b7bf

**Este arquivo é a fonte de verdade do status do programa.** Vive no repositório desde a Fase 0,
versionado junto com o código que descreve. A cópia de trabalho que existia em
`~/.claude/plans/presales-identidade-visual.md` foi aposentada — não editar mais lá.

## Metodologia de implantação

Cada fase roda em **uma conversa nova**, sem histórico compartilhado
([[feedback_phased_implementation_new_chats]]). O prompt de abertura vive **no artifact**, não
aqui — é de lá que o dono copia para abrir a próxima conversa.

**Ritual de fechamento — toda fase termina assim, sem exceção:**

1. **Implementar** direto no `home-comercial-01` por SSH, sem cópia local; branch criada via
   `sudo -u sakae -i --`.
2. **Validar de verdade:** `lint`, `build` e o raio de impacto de testes, executados no próprio
   dev. O gate é execução real, nunca `gh pr checks`.
3. **Fechar a cadeia no GitHub:** commit → push → PR → merge, sem parar para pedir cada passo
   ([[feedback_git_cadeia_completa_ate_merge]]).
4. **Atualizar este arquivo no mesmo PR:** status da fase, commit, e o que ficou pendente.
5. **Atualizar o artifact:** marcar a fase com o chip `✓ Concluída`, avançar o contador de
   progresso e registrar commit/PR. **Republicar NA MESMA URL** — nunca criar artifact novo
   ([[feedback_cmcrm_artifact_update_forgotten]], [[feedback_marcar_fase_concluida_no_painel]]).
6. **Escrever o prompt da fase seguinte dentro do artifact**, substituindo o anterior, já
   contextualizado: o que esta fase entregou, o que ficou aberto, e os cuidados que só apareceram
   durante a execução.
7. **Gravar memória** apenas do que for durável e reutilizável.

**Template do prompt de cada fase:** contexto e onde ler · onde desenvolver e os cuidados do host
· escopo numerado · por que a fase existe · critério de aceite · como fechar.

---

## Tabela de status (atualizar ao final de cada fase)

| Fase | Nome | Status | Commit | Observações |
|---|---|---|---|---|
| 0 | Tokens `@theme` + rede de segurança visual | **✓ concluída** (24/08/2026) | `906668f` (PR #52) | 36 capturas de baseline; 11 tokens de marca + 4 rampas semânticas; zero mudança visual, provada |
| 1 | Ativos de marca (vetor, favicon, logo) | **✓ concluída** (24/08/2026) | `c68067c` (PR #53) | símbolo e wordmark vetorizados dos pixels oficiais; 11 ativos em `public/brand/`; favicon criado do zero |
| 2 | Shell e portas de entrada | **✓ concluída** (24/08/2026) | `f7dc15b` (PR #54) | 86 trocas em 5 arquivos + "Reportar problema" movido para o rodapé; login em `brand-950`/`brand-600` (5,20:1); `draft` neutro e idêntico nas 3 telas |
| 3 | Área de Trabalho | não iniciada | — | maior densidade de cor do produto |
| 4 | Propostas, Aprovação e Conhecimento | não iniciada | — | — |
| 5 | Módulo POC | não iniciada | — | add-on por entitlement |
| 6 | Módulo Precificação | não iniciada | — | add-on por entitlement |
| 7 | Admin Console e resíduos | não iniciada | — | maior arquivo (3.338 linhas) |
| 8 | DOCX + branding por tenant | não iniciada | — | torna real a tela "Identidade Visual" |
| 9 | Validação visual, contraste e release | não iniciada | — | **gate humano** |

### Trilha B — Enriquecimento com a biblioteca de componentes

| Fase | Nome | Status | Commit | Observações |
|---|---|---|---|---|
| E0 | Fundação de composição (`cn` + primitivas próprias) | não iniciada | — | depende da Fase 0 |
| E1 | Home: KPI animado, funil e distribuição | não iniciada | — | depende de E0 + Fase 2 |
| E2 | Login: fundo animado | não iniciada | — | depende de E0 + Fase 2 |
| E3 | Auditoria e Debug: tabela de logs interativa | não iniciada | — | depende de E0 + Fase 7 |
| E4 | Copiloto: input de chat rico | não iniciada | — | depende de E0 + Fase 3 |
| E5 | Cartão de conformidade | não iniciada | — | depende de E0 + Fase 3 |

---

## Decisões já tomadas pelo dono (24/08/2026) — não reabrir

1. **Não existe vetor original da logo.** A Fase 1 inclui vetorizar o símbolo.
2. **Tokenizar** — variáveis de tema, não troca literal de classe.
3. **O verde é aposentado como cor de marca** — passa a significar exclusivamente sucesso/conforme.
4. **Login escuro + aplicação clara é mantido** e assumido como decisão, não incoerência.
5. **O DOCX gerado entra no escopo.**

**Assunção declarada** (não perguntada, derivada da decisão 3 + do fato de a logo do produto
existir): no login, a logo principal passa a ser a **PreSales**; a Cloud Mountain continua no
rodapé "POWERED BY", papel que já ocupa hoje em `Login.tsx:388`. Se o dono quiser a Cloud
Mountain como protagonista, é só dizer na Fase 1 — é uma linha.

---

## A paleta (fonte de verdade para todas as fases)

Extraída dos pixels da logomarca oficial. Matiz H 211°–222°. Os ★ são pixels literais da marca.

```
--color-brand-50:  #ebf6ff    --color-brand-500: #288bf9  ★ azul vivo do ícone
--color-brand-100: #d2eafe    --color-brand-600: #236cc7  ★ "COMPLIANCE PLATFORM"
--color-brand-200: #a7d3fb    --color-brand-700: #1a539e
--color-brand-300: #77b8f8    --color-brand-800: #113774
--color-brand-400: #52a1f4    --color-brand-900: #061a3d  ★ wordmark "PRESALES"
                              --color-brand-950: #03102c  ★ fundo oficial da versão dark
```

**Papéis semânticos — a regra que governa cada troca:**

| Papel | Token | Onde |
|---|---|---|
| Identidade e ação | `brand-600` (hover `brand-700`) | botão primário, link, foco, seleção, nav ativa |
| Acento vivo / gráficos | `brand-500` | séries de gráfico neutras, destaque em fundo escuro |
| Superfície escura | `brand-900` / `brand-950` | topbar, login, rodapé |
| **Sucesso** | `emerald-700` (5,48:1) | conforme, aprovado, concluído, item atendido |
| **Atenção** | `amber-700` sobre `amber-50` (5,02:1) | pendência, fora de faixa, prazo próximo |
| **Erro** | `red-700` | falha, não conforme, destrutivo |
| **Neutro** | `slate-*` | rascunho, inativo, estrutura, texto secundário |

Contrastes verificados: `brand-600` sobre branco = **5,20:1** ✓ AA. Substitui `emerald-600`
(3,77:1) e `emerald-500` (2,54:1), que **reprovam** AA hoje.

---

## A armadilha número um — leia antes de qualquer fase de repaletização

**Não existe `sed s/emerald/brand/g` correto neste projeto.** As 571 ocorrências de `emerald`
carregam dois papéis diferentes que só o contexto distingue:

- `emerald` como **marca/ação** → vira `brand` (botão "Adicionar Nova", avatar, foco de campo,
  barra de progresso de carga, nav ativa).
- `emerald` como **sucesso/conforme** → **fica verde**, só ajusta o tom para `emerald-700` onde o
  contraste reprovar (item conforme na matriz, aprovado, "Conectado", teste passou).

Uma substituição cega pinta "conforme" de azul e destrói informação que o produto existe para
comunicar. **Cada ocorrência é uma decisão, não um replace.** Mesma regra para `amber`: fica onde
é aviso, sai de onde virou cor de ação — os call-sites já mapeados são `Login.tsx:226/242/258/267`
(campos e botão), `PocAcceptancePanel.tsx:212`, `Workspace.tsx:431/462`, `App.tsx:926`.

Ver [[feedback_verificar_refatoracao_comportamental_preservada]]: provar contra o original real
(`git show`), nunca reescrever de memória. E [[feedback_chart_generic_color_rotation_vs_semantic]]:
cor de gráfico por índice não pode contradizer a cor semântica de severidade na mesma tela.

---

## Princípios não-negociáveis (herdados do produto)

- Desenvolvimento **direto no `home-comercial-01` por SSH**, sem cópia local
  ([[feedback_desenvolver_no_servidor_de_dev]]).
- SSH nesse host loga como **root** e o repo é do `sakae` — criar branch/commit sempre via
  `sudo -u sakae -i --`, senão o `.git` fica com refs root-owned
  ([[project_presales_cmsaas_hosts]]).
- Nada aplicado direto em "PreSales Demo" — dev → release no CMSaaS → apply step-up-gated
  ([[feedback_no_direct_deploy_presales_demo]]). A Demo está **fora do ar desde 30/07**.
- Nenhuma fase intermediária roda a suíte inteira — cada uma roda o **raio de impacto**
  ([[feedback_suite_e2e_completa_so_na_ultima_fase]]).
- Screenshot não é prova de que ficou bom: olhar alinhamento, espaçamento e hierarquia de verdade
  ([[feedback_screenshot_visual_critique_not_just_render_check]]).
- Gate de qualidade é **execução real no dev**, nunca `gh pr checks`
  ([[feedback_desenvolvimento_sem_dependencia_billing_externo]]).

---

## Fase 0 — Tokens `@theme` + rede de segurança visual — ✓ CONCLUÍDA (24/08/2026)

**Por quê primeiro:** o projeto usa **Tailwind v4** com o plugin Vite e **não tem
`tailwind.config.js`** — tokens vivem em `@theme` dentro de `src/index.css`. E, mais importante:
**não existia nenhuma ferramenta de captura visual instalada** (só `vitest`; as 30+ capturas do
manual foram feitas à mão). Repaletizar 2.900 classes em 22 componentes sem baseline era o maior
risco do plano.

### O que foi entregue

**1. Tokens de tema em `src/index.css`** — um bloco `@theme static` com 55 variáveis:

- **11 tons de marca** (`--color-brand-50` … `--color-brand-950`), com os cinco valores medidos
  nos pixels da logomarca oficial marcados no próprio arquivo.
- **4 rampas semânticas completas** — `success-*` (herdada de `emerald`), `warning-*` (de
  `amber`), `danger-*` (de `red`) e `neutral-*` (de `slate`) — para que as fases seguintes troquem
  cor **por intenção** e não por matiz.

Três decisões que valem registro:

- **`@theme static`, e não só `@theme`.** O Tailwind v4 poda variável de tema não usada. Sem
  `static`, os tokens sumiriam do CSS enquanto ninguém os aplicasse — e duas coisas planejadas
  quebrariam em silêncio: a Fase 5, que precisa referenciar o token de atenção dentro de um
  `@keyframes` (CSS puro, fora do alcance do scanner de classes), e a Fase 8, que pretende
  sobrescrever a cor da marca em runtime por tenant. Verificado no CSS construído: as 55
  variáveis saem em `:root`.
- **Rampas semânticas com valores literais, não `var(--color-emerald-700)`.** Copiadas de
  `node_modules/tailwindcss/theme.css`. Isso torna a troca `emerald-700` → `success-700`
  pixel-idêntica contra o baseline (provado: `--color-success-700` e `--color-emerald-700` saem
  byte a byte iguais no CSS construído) e, a partir daqui, desacopla o significado de "sucesso" no
  produto de uma eventual mudança da paleta do Tailwind.
- **`neutral-*` redefine a paleta embutida do Tailwind, de propósito.** É seguro porque
  `neutral-*`, `gray-*`, `zinc-*` e `stone-*` têm **zero ocorrência** em `src/` (medido antes da
  mudança). O efeito é positivo: o produto passa a ter uma escala de cinza só, e `neutral-*` vira
  sinônimo exato de `slate-*` em vez de um segundo cinza concorrente.

**2. Rede de segurança visual** — Playwright 1.62.1 como **devDependency** (dev-only: o servidor é
construído com `esbuild --packages=external` e o cliente parte de `index.html`; `scripts/` e
`tests/` ficam fora dos dois bundles). Três arquivos novos:

| Arquivo | Papel |
|---|---|
| `scripts/uiScreens.ts` | fonte de verdade das telas, da navegação e das opções de recorte |
| `scripts/capture-ui.ts` | grava o baseline (`npm run capture:ui`) |
| `tests/visual/screens.spec.ts` | compara a tela viva com o baseline (`npm run test:visual`) |
| `tests/visual/global-setup.ts` | autentica uma vez por rodada e guarda a sessão em `.auth/` |
| `playwright.config.ts` | aponta a comparação para as mesmas imagens que a captura grava |

Capturar e comparar **compartilham o mesmo módulo de navegação** de propósito: se cada lado
tivesse a sua cópia da lista de telas, os dois divergiriam na primeira fase e a comparação
passaria a medir a diferença entre os dois scripts, não entre duas versões do produto.

**3. Baseline capturado com o visual ATUAL** (verde), em `docs/visual-baseline/`: **36 imagens** —
18 telas × 2 larguras (`desktop-1440/` a 1440×900 e `mobile-390/` a 390×844), ~4,5 MB.

As 18 telas: `login` · `home` · `projects` · `workspace-summary` · `workspace-requirements` ·
`workspace-risks` · `workspace-bom` · `workspace-proposal-builder` · `workspace-explorer` ·
`proposals` · `approval` · `knowledge-base` · `poc` · `pricing` · `admin-overview` ·
`admin-users` · `admin-branding` · `admin-audit`.

### Como usar a rede nas fases seguintes

```bash
# no home-comercial-01, como sakae, com o servidor de dev no ar
npm run test:visual                             # compara tudo com o baseline
npm run test:visual -- --project=desktop-1440   # só uma largura
npm run test:visual -- -g workspace             # só as telas da Área de Trabalho
npm run capture:ui                              # regrava o baseline (só quando a cor mudou de propósito)
npm run capture:ui -- --out /tmp/depois         # captura em outro lugar, sem tocar no baseline
```

A tolerância é **`maxDiffPixels: 0`**. Numa fase de repaletização "quase igual" não prova nada.
Quando uma fase mudar cor de propósito, o caminho é **recapturar e revisar as imagens novas no
PR** — nunca afrouxar a tolerância no `playwright.config.ts`.

### Cuidados que só apareceram executando

- **A conta de captura é dedicada e não vive no repositório.** As credenciais de seed
  (`password123`) não funcionam mais neste servidor: ele roda com `APP_RUNTIME_MODE=production`,
  e o `/api/auth/login` recusa a senha demo de propósito. A captura usa
  `visual-capture@presales.local` (tenant `tenant_default`, papel Administrator, **MFA
  desligado** — um código que muda a cada execução impede baseline reprodutível), com a senha em
  `.env.capture.local` no servidor de dev, arquivo coberto pelo `.gitignore` (`.env.*.local`).
  Quem for rodar em outra máquina precisa criar a sua.
- **`CAPTURE_PROJECT_ID` fixa qual projeto abre na Área de Trabalho.** Sem ele o script abre o
  primeiro da lista, e o baseline fica refém da ordenação e de quantos projetos existirem no banco
  naquele dia. No dev está fixado em `p_ad14d8ba2e29c8e1` (CFTV Via Sorocabana) — o projeto com
  mais dado real: análise, 6 propostas, 2 POCs e 3 planilhas de precificação.
- **O recorte é de uma tela, não da página inteira.** O shell é `h-screen` com `overflow-hidden` e
  a rolagem acontece dentro dos painéis, então `fullPage` equivale ao viewport. O baseline vê o
  que o usuário vê ao abrir a tela — **conteúdo abaixo da dobra não é comparado**. É a limitação
  conhecida da rede: uma fase que mexa em tela longa (`AdminConsole.tsx` tem 3.338 linhas) deve
  acrescentar entradas roladas em `SCREENS` antes de confiar num verde.
- **Os dois limitadores de requisição do servidor moldaram o desenho da rede** — e essa foi a
  descoberta cara desta fase. `server/middleware/security.ts` tem um limitador dedicado de **20
  logins por IP a cada 15 minutos** e um geral de **1.000 requisições por IP** na mesma janela.
  A primeira versão da rede autenticava uma vez por tela (34 logins por rodada) e abria um
  contexto novo por tela (36 cargas frias da aplicação, ~1.000 requisições). Bateu nos dois. E o
  sintoma é traiçoeiro: a falha aparece como "esperando o `<nav>` ficar visível" e a imagem
  capturada é a tela de login — um problema de orçamento de requisições disfarçado de defeito de
  interface. O desenho final autentica **uma vez por rodada** (estado de sessão guardado em
  `.auth/`) e percorre todas as telas de uma largura **numa aba só**, navegando entre as abas do
  produto. Medido: **154 requisições por rodada** (era ~1.000) e a comparação inteira em **60
  segundos**. Captura e comparação usam o mesmo desenho de propósito — se uma reaproveitasse a
  aba e a outra não, estado carregado de uma tela para a outra apareceria como diferença de pixel
  sem nada ter mudado no produto. E `scripts/uiScreens.ts` agora reconhece o 429 e falha com a
  mensagem certa em vez do tempo esgotado.
- **Ownership no `home-comercial-01`.** O SSH loga como root e o repositório é do `sakae`. Havia
  23 arquivos root-owned (incluindo `.git/HEAD`, `.git/index` e `dist/`) que impediriam commit e
  build como `sakae`; corrigidos com `find . -not -user sakae -exec chown sakae:sakae {} +` antes
  de qualquer coisa. Branch criada via `sudo -u sakae -i --`, como manda o plano.

### Como ficou provado que nada mudou

O baseline foi capturado com o `src/index.css` **de `main`** — sem o bloco `@theme`. Só depois o
bloco foi restaurado, o projeto reconstruído e a comparação executada contra aquelas mesmas 36
imagens. **As 36 passaram com `maxDiffPixels: 0`**, em 60 segundos. Ou seja: a prova não é
"capturei e comparei comigo mesmo", é **o produto antes dos tokens contra o produto depois dos
tokens**.

Junto com isso, no próprio servidor de dev: `npm run lint` (`tsc --noEmit`) limpo, `npm run build`
completo e `npm run test` com **16 arquivos e 98 testes passando**. O gate é execução real, não
`gh pr checks`.

**Rollback:** remover o bloco `@theme` de `src/index.css` e a devDependency. Nada além disso foi
tocado no código do produto.

## Fase 1 — Ativos de marca — ✓ CONCLUÍDA (24/08/2026)

**Por que existia:** o produto se apresentava com a marca da **empresa** (Cloud Mountain, montanha
azul-glacial H≈202°) nos dois lugares onde deveria estar a marca do **produto**, e não tinha
favicon nenhum — a aba usava o ícone padrão do navegador. A rampa `brand-*` que a Fase 0 instalou
saiu dos pixels da logo do produto; sem trocar o ativo, a cor nova ficaria ancorada numa marca que
não aparecia em lugar nenhum da tela.

### O que foi entregue

**1. O símbolo virou vetor de verdade.** Não existe original vetorial (decisão do dono), então a
geometria foi **medida nos pixels** de `PreSales Ico Transparent.png` (1254²), não desenhada a
olho: rastreamento de contorno das três peças (anel hexagonal, haste do "P", check) seguido de
simplificação, e cada vértice do desenho final é uma coordenada medida. A silhueta reconstruída
diverge do bitmap oficial em **1,47%** dos pixels — só borda de anti-aliasing.

O resultado é um SVG de **2,5 KB com 8 paths**: cinco faces do prisma isométrico, a haste e o
check. As sete faces recebem `linearGradient` com `gradientUnits="userSpaceOnUse"`, e as paradas
saíram das medições — inclusive `#75c1fd`, que aparece literalmente na face superior-direita da
versão para fundo escuro (`#77c2fe` medido).

**2. Wordmark vetorizado a partir da arte real.** "PRESALES" e "COMPLIANCE PLATFORM" foram
rastreados de `PreSales Logo.png` e ajustados com curvas de Bézier cúbicas (algoritmo de
Schneider). A escolha foi deliberada: identificar a fonte e recompor o texto produziria um
wordmark *parecido*, não o aprovado — o arquivo tem tracking próprio. A reconstrução diverge do
bitmap em **0,76%** (linha 1) e **3,04%** (linha 2), toda a divergência em anti-aliasing.

**3. Onze ativos, nomeados por destino.** Em `public/brand/` (e `public/favicon.ico` na raiz, onde
os navegadores procuram por convenção):

| Arquivo | Papel |
|---|---|
| `symbol.svg` / `symbol-on-dark.svg` | símbolo isolado, uma variante por fundo |
| `logo-on-light.svg` / `logo-on-dark.svg` | logo horizontal (símbolo + wordmark) |
| `favicon.svg` + `favicon-16.png` + `favicon-32.png` | ícone de aba |
| `favicon.ico` | 16 + 32 + 48, cada tamanho rasterizado do próprio vetor |
| `apple-touch-icon.png` (180) / `icon-512.png` / `app-icon.svg` | ícone de aplicativo |

**Nomear por destino, e não pela cor da arte, era o ponto.** A pasta do Drive usa "Dark" com dois
sentidos opostos — em `Logo Dark` significa "para fundo escuro" (arte clara), em `Ico Dark`
significa "arte escura" — e o mesmo erro já custou uma sessão em outro produto
([[feedback_marca_polaridade_dark_light_invertida]]).

**4. Pontos de uso trocados.**

| Onde | Antes | Depois |
|---|---|---|
| `App.tsx` topbar | `/logo-mountain.png` | `/brand/symbol-on-dark.svg` |
| `Login.tsx` marca do cartão | `/logo-mountain.png` | `/brand/logo-on-dark.svg` |
| `index.html` | **nenhum `<link rel="icon">`** | 6 declarações + `theme-color` |
| `Login.tsx` rodapé "POWERED BY" | `/logo-cloudmountain-full.png` | **inalterado, de propósito** |
| `AdminConsole.tsx` `cmsaas-icon.png` | — | **não tocado** (não é marca do produto) |

O logo por tenant (`brandLogoDataUrl`) continua vencendo quando existe — a troca foi só no
*fallback*. Nenhuma classe de cor foi alterada: esta é fase de ativo, e misturá-la com
repaletização destruiria a validação visual.

**Na topbar entrou o símbolo isolado, não a logo horizontal**, porque o `<span>` ao lado já diz
"Plataforma de Compliance de Pré-Vendas" — a horizontal repetiria o nome do produto duas vezes
lado a lado. No login a horizontal cabe: lá o wordmark é a apresentação da marca.

**5. "Commercial Assistant AI" saiu do login** (pedido do dono durante a execução). Era o `<h1>`
logo abaixo da logo, e depois da troca ficava contradizendo o wordmark PRESALES que passou a estar
acima dele. Saíram o `<h1>` e as duas chaves `title` do dicionário, que ficariam órfãs.

### Cuidados que só apareceram executando

- **SVG sem `width`/`height` no elemento raiz colapsa para 0×0 dentro de um `<img>` dimensionado
  só por `max-*`.** Foi o defeito que quase passou: a primeira versão dos ativos tinha apenas
  `viewBox`, e a logo **desapareceu de todas as telas** — sem erro de rede, sem falha de console,
  com `complete: true` e `naturalWidth: 150` (o *default sizing* do Chrome). O `test:visual`
  acusou até **45% da tela** diferente em mobile, porque a topbar sem a imagem reflowou de duas
  linhas para uma e empurrou a página inteira. O sintoma parecia deslocamento de layout; a causa
  era a logo não existir. Corrigido adicionando `width`/`height` explícitos ao `<svg>`.
  Ver [[feedback_svg_sem_width_height_colapsa_em_img]].
- **Validar o que é PINTADO, não o que é baixado.** O SVG era servido com `200` e
  `Content-Type: image/svg+xml` correto *enquanto a logo não aparecia na tela*. Só a inspeção do
  `getBoundingClientRect()` no navegador revelou o `0x0`. Os seis ícones declarados no
  `index.html` foram conferidos um a um por `currentSrc` + dimensão natural real.
- **O xadrez não pode aparecer porque nenhum pixel do original foi copiado.** Os PNGs do Drive são
  RGB sem canal alfa, com o xadrez de transparência rasterizado (~`#f4f4f4`). Como os ativos são
  geometria medida e não bitmap reamostrado, a prova é estrutural: zero `<image>` e zero `base64`
  nos seis SVGs, e `symbol.svg`/`logo-on-light.svg` rasterizados a 512px têm **0,000%** de pixels
  na faixa do xadrez.
- **O favicon precisou de fundo próprio.** O símbolo transparente funciona em aba clara e
  **desaparece em aba escura** — a haste e o V do "P" são navy (`#112447`) contra o `#35363a` da
  aba escura do Chrome. Quatro desenhos foram rasterizados a 16px e 32px sobre os dois fundos e
  comparados; venceu o símbolo *on-dark* sobre o navy oficial da marca (`#03102c`, `brand-950`),
  com 8% de margem e raio de 18% — idêntico nas duas abas e coerente com o app icon oficial, que
  também é símbolo claro sobre navy.
- **A 16px o check é sugerido, não legível.** É limite do desenho, não da vetorização: o símbolo
  tem detalhe interno fino. A 32px — o que a maioria dos navegadores usa em tela HiDPI — está
  nítido. Nenhum ajuste óptico foi aplicado à marca para forçar os 16px.
- **O limitador de login mordeu de novo.** Cada `capture:ui` e cada `test:visual` gasta uma das
  20 tentativas por IP a cada 15 minutos, e esta fase precisou de várias rodadas (comparar, achar
  o `0x0`, corrigir, comparar de novo, remover o `<h1>`, comparar mais uma vez). A rodada que
  estoura o teto falha com `TimeoutError` esperando o `#login-card` — de novo um problema de
  orçamento de requisições disfarçado de defeito de interface.

### Como ficou provado

`npm run lint` limpo, `npm run build` completo e `npm run test` com **16 arquivos e 98 testes**
passando, tudo no próprio `home-comercial-01`.

Na comparação visual, a diferença ficou **confinada às faixas onde a marca aparece**: em desktop,
`y[10,54]` (a topbar) em 17 telas e `y[197,703]` no cartão de login; em mobile, `y[2,37]` e a
mesma região do login. Nenhum deslocamento vertical de conteúdo. Os dois únicos pixels fora dessa
regra são o anti-aliasing do canto arredondado do avatar na Home mobile (`#019866` → `#038f62`).
O deslocamento **horizontal** dos itens da topbar é consequência direta e esperada da troca: a
montanha ocupava 67×36 px, o símbolo do produto é quadrado e ocupa 36×36.

Baseline regravado com `npm run capture:ui` e `npm run test:visual` de volta a **36 verdes**, com
a tolerância intacta em `maxDiffPixels: 0`.

### O que ficou aberto

- **"Commercial Assistant AI" ainda vive em três lugares fora da interface**, e sair de cada um
  tem custo próprio: `server/utils/security.ts:441` é o **issuer do TOTP** — mudá-lo invalida a
  entrada no aplicativo autenticador de quem já cadastrou MFA, e é migração, não renomeação;
  `server/utils/docx.ts:371-372` são metadados do documento gerado, que já são escopo declarado da
  **Fase 8**; `server/routes/diagnostics.ts:150` é o rótulo do motor na tela de diagnóstico.
- **`public/logo-mountain.png` ficou órfão** — nenhum ponto de uso o referencia. Mantido de
  propósito: é a marca da empresa e a Fase 8 mexe em branding por tenant.
- **`logo-on-light.svg` ainda não tem consumidor na interface** (o produto é escuro nos dois
  pontos de marca). Foi gerado para o DOCX e o branding por tenant da Fase 8.

---

## Fase 2 — Shell e portas de entrada — ✓ CONCLUÍDA (24/08/2026)

**Arquivos:** `App.tsx` (45 emerald / 11 amber), `Login.tsx` (4/8), `Home.tsx` (19/7),
`ProjectsList.tsx` (8/4), `SystemMessageBanner.tsx` (0/3).

**86 trocas de cor em 5 arquivos, cada uma decidida pelo contexto** — o script de aplicação
(descartado depois de rodar) ancorava cada troca em `(arquivo, linha, texto exato)` e abortava sem
gravar nada se um só trecho não casasse. Foi o que aconteceu na primeira execução: quatro âncoras
tinham a linha errada, e nenhum arquivo foi tocado. É o antídoto do `sed` cego que o plano proíbe.

### O que virou marca, o que continuou semântico

| Papel | Onde | Resultado |
|---|---|---|
| Ação e identidade | botões primários, links, foco de campo, nav ativa, avatar, barras de progresso, badge "Add-on", dropzone | `brand-600` em fundo claro (hover `brand-700`), `brand-400`/`brand-500` em fundo escuro |
| **Sucesso** | ponto de saúde do LLM no rodapé, badge "CONCLUÍDO", status `completed` nos gráficos | **continua verde**, agora escrito `success-*` |
| **Atenção** | `ShieldAlert` da troca obrigatória de senha, status "aguardando" em `ProjectsList` | **continua âmbar**, agora escrito `warning-*` |
| **Erro** | status "cancelado" | continua vermelho, agora `danger-*` |
| **Neutro** | `draft` nas três telas | `slate-100`/`slate-700` (badge) e `slate-400` (barra) |

**Em fundo escuro o hover clareia, não escurece.** A regra do plano (`brand-600` → hover
`brand-700`) foi escrita para fundo claro. No login os três botões já clareavam no hover
(`amber-600`→`amber-500`, `emerald-600`→`emerald-500`); manter `hover:bg-brand-500` preserva a
affordance. Escurecer sobre `brand-950` faria o botão sumir ao passar o mouse.

### Quatro coisas que o mapeamento do plano não previa

1. **O login tinha TRÊS botões primários, em três cores.** Âmbar (trocar senha), verde (entrar) e
   **`sky-600`** (verificar MFA) — este último invisível para um grep de `emerald|amber`, que é
   como o escopo da fase foi dimensionado. Mesmo papel, três cores; e `sky` é um azul que
   competiria diretamente com a marca. Os três viraram `brand-600`, e o foco do campo de MFA
   (`sky-500`) acompanhou.
2. **O fundo do login era pintado por `rgba()` literal, não por classe.** Dois gradientes radiais
   decorativos com `rgba(16,185,129,…)` (emerald-500) e `rgba(14,165,233,…)` (sky-500) escritos à
   mão. O verde aposentado estava literalmente pintando o fundo da porta de entrada do produto e
   nenhum grep de classe o encontraria. Primeira tentativa com alfa alto (0,10 / 0,18) clareou o
   fundo a ponto de o cartão perder destaque — corrigido para 0,08 / 0,05, ambos `brand-500`.
3. **O defeito do `draft` tinha uma terceira ocorrência.** O plano mapeava duas
   (`ProjectsList.tsx:17` neutro, `Home.tsx:375` âmbar). Havia uma terceira em `App.tsx:1120`: o
   badge de status na barra do projeto, que cai no `else` da cadeia de status e portanto pintava
   **RASCUNHO de âmbar em todas as telas internas do produto**. As três agora são idênticas,
   provado por cor computada.
4. **`SystemMessageBanner.tsx` não usava classe Tailwind nenhuma.** Fundo e borda eram
   `style={{ background: "#78350f" }}` inline — `amber-900`/`amber-800` em hexadecimal. Passou a
   `bg-brand-800 border-brand-600` com tokens. Comunicado de manutenção não tem campo de
   severidade no modelo de dados; pintá-lo de âmbar prometia "atenção" para qualquer aviso.

### Pedido do dono durante a execução: "Reportar problema" saiu de cima do rodapé

A pastilha `position: fixed` do CloudMountain Diagnostics Agent (`BugReportButton.tsx`, renderizada
em `main.tsx` fora da árvore do `App`) ficava ancorada no canto inferior direito e **cobria o
próprio rodapé de diagnóstico** — tapava "Audit Logs" e parte do "Debug Console". Está visível
assim em todas as 36 imagens do baseline da Fase 1, e ninguém tinha reparado até o dono apontar.

Virou um link do rodapé, ao lado de "Manual do Usuário", com exatamente as mesmas classes dos
vizinhos. Isso expôs um transbordo que a pastilha escondia: **o rodapé já não cabia em 1440px**.
O bloco de links ganhou `shrink-0` (ação tem prioridade sobre valor informativo) e o bloco de
diagnóstico virou rolável com a barra suprimida
(`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`) — encolhe primeiro, mas
nada fica inacessível. Resolver o transbordo de vez exige decidir **o que sai** do rodapé, e isso
é decisão do dono: fica para a Fase 9.

### Decisões conscientes de NÃO trocar

- **`getDocTag()` em `App.tsx:670-672`** — as tags de extensão (PDF vermelho, DOCX azul, XLSX
  verde, CAD roxo, IMG âmbar) são uma legenda **categórica** por tipo de arquivo, não um papel
  semântico. Trocar o verde por azul faria XLSX colidir com DOCX; neutralizar tudo apagaria a
  legenda. Ficam como estão — as duas únicas ocorrências de `emerald`/`amber` que sobrevivem nos
  cinco arquivos da fase.
- **Os 4 cards de KPI da Home foram tratados como conjunto, não como uma ocorrência.** Eram
  emerald / blue / purple / âmbar — quatro cores arbitrárias. Trocar só o verde deixaria o card 1
  idêntico ao card 2. Os quatro ícones passaram a `brand-50`/`brand-100`/`brand-600`: a distinção
  já é feita pelo ícone e pelo rótulo, e o âmbar do card "POCs Ativas" deixou de sugerir alerta
  onde só há contagem. **Reversível numa linha** se o dono preferir a variedade cromática.

### Como ficou provado

**Cor computada no navegador, não classe no JSX** — a lição da Fase 1 aplicada à cor. Um script
temporário mediu `getComputedStyle` e, como o Tailwind v4 serializa as cores embutidas em
`oklch()`, **pintou cada valor num canvas 1×1 e leu o pixel**: é a cor que o usuário vê.

```
fundo do login          #03102c  (brand-950)      cartão do login   #061a3d  (brand-900)
botão "Entrar"          #236cc7  sobre #ffffff -> 5,20:1  PASSA WCAG AA  (era 3,77:1)
foco do campo           #288bf9  (brand-500)      nav ativa         #288bf9
avatar                  #236cc7  (brand-600)      valor do rodapé   #52a1f4  (brand-400)
ponto de saúde do LLM   #00bc7d  VERDE preservado
badge RASCUNHO          #f1f5f9 / #314158  IDÊNTICO em App.tsx, Home.tsx e ProjectsList.tsx
barra "Rascunho"        #90a1b9  (slate-400)
```

A varredura final classificou **por matiz do pixel pintado** (não por string de classe) o fundo de
todo `<button>` e `<a>` das três telas do shell: zero elementos com matiz verde (90°–175°) ou
âmbar (25°–70°). Os verdes que ainda aparecem no Admin Console são escopo da Fase 7.

No próprio dev: `npm run lint` limpo, `npm run build` completo, `npm run test` com **16 arquivos e
98 testes passando**, e as 36 capturas do baseline regravadas e revisadas. Antes de qualquer
edição a rede visual foi executada contra o baseline da Fase 1 e deu **36/36 verdes** — a fase
começou de um estado provadamente são.

### Cuidados que só apareceram executando

- **`getComputedStyle` mente sobre a cor quando ela vem do Tailwind v4.** As rampas embutidas
  (`slate`, `emerald`, e as rampas semânticas da Fase 0, copiadas de `theme.css`) são `oklch()`, e
  o Chromium devolve `oklch(0.696 0.17 162.48)`. Um parser ingênuo de números leu isso como
  `#0100a2` e reprovou o ponto de saúde verde do rodapé — um falso defeito do medidor, não do
  produto. Só os tokens `brand-*`, que a Fase 0 escreveu em hexadecimal, voltam como `rgb()`.
  **Deixe o navegador pintar e leia o pixel.**
- **`tsx` quebra `page.evaluate()` com funções internas nomeadas.** O esbuild injeta o auxiliar
  `__name`, que não existe dentro do navegador, e o erro é `ReferenceError: __name is not
  defined` — sem relação aparente com o código. Passar a função como string resolve.
- **`text-is('RASCUNHO')` não encontra um badge que diz RASCUNHO.** O texto no DOM é `Rascunho`;
  as maiúsculas vêm de `uppercase` no CSS. O Playwright casa contra o DOM.
- **`.auth/capture-state.json` não sobrevive entre rodadas** — qualquer verificação com Playwright
  gasta uma das 20 tentativas de login por IP a cada 15 minutos. Esta fase consumiu 6 (comparação
  inicial, captura para análise, três execuções do medidor, recaptura do baseline) e não chegou
  perto do teto, mas o orçamento precisa ser planejado antes, não descoberto no meio.
- **`.git/index` estava root-owned de novo** ao começar a fase, exatamente como na Fase 0. O
  `chown` é o primeiro comando, antes de qualquer `git`.

### Achados registrados, fora do escopo desta fase

- **`waiting_internal` tem duas cores diferentes.** É `purple` em `App.tsx`/`Home.tsx` e `amber`
  em `ProjectsList.tsx` — o mesmo defeito do `draft`, num estado que o escopo desta fase não
  mandava corrigir. Decidir entre "aguardando = pendência (âmbar)" e "aguardando = etapa do
  pipeline (roxo)" é decisão de produto, não de repaletização. **Levar para a Fase 9.**
- **A topbar quebra com nome de usuário longo.** O cartão do usuário cobre o último item de
  navegação ("Base de Conhecimento") em 1440px. É **pré-existente** — está idêntico no baseline da
  Fase 1 — e é defeito de layout, não de cor.
- **`analysis_in_progress` é `blue-*`**, vizinho do azul da marca. Não colide hoje (`blue-700` vs
  `brand-600` são distinguíveis) mas convém revisar quando as fases 3–7 aumentarem a densidade de
  azul.

---

## Fase 3 — Área de Trabalho

**Arquivo:** `Workspace.tsx` (101 emerald / 39 amber / 1.908 linhas) — a maior densidade de cor do
produto e o coração do fluxo (requisitos, riscos, BOM, matriz de conformidade).

**Atenção especial:** é aqui que "conforme / não conforme / parcial" vive. É o lugar onde pintar
sucesso de azul faria mais estrago. A matriz de conformidade mantém verde/âmbar/vermelho
semânticos; o que vira `brand` é ação e navegação (abas, botões, barra de progresso em
`:431/:462`).

**Critério de aceite:** matriz de conformidade preserva integralmente o significado das cores;
ações e abas em azul da marca; nenhuma regressão nas sub-abas.

---

## Fase 4 — Propostas, Aprovação e Conhecimento

**Arquivos:** `Proposals.tsx` (19/24), `KnowledgeBase.tsx` (29/5), `Approval.tsx` (9/4),
`ProjectFieldsForm.tsx` (21/1), `NewProjectWizard.tsx` (6/6), `CreateProjectModal.tsx`,
`ClassifyDocumentModal.tsx`.

**Atenção:** `Proposals.tsx` tem mais âmbar que verde (24 vs 19) — é o painel de pareceres, onde
severidade é informação. Severidade fica; cor de ação sai.

---

## Fase 5 — Módulo POC

**Arquivos:** `PocManagement.tsx` (82/21), `PocGanttChart.tsx` (22/9), `PocTestCases.tsx` (22/6),
`PocAcceptancePanel.tsx` (17/11).

**Atenção:** o Gantt usa cor para caminho crítico e status de etapa — semântico. E existe a
animação `poc-start-glow` em `src/index.css` com âmbar cravado em `rgba(245,158,11,...)`: é um
aviso legítimo (POC cuja data de início chegou), então **fica** — mas passa a referenciar o token
de warning em vez do literal.

---

## Fase 6 — Módulo Precificação

**Arquivos:** os 7 `Pricing*.tsx` (60 emerald / 11 amber somados).

**Atenção:** "Extrações pendentes" e "fora de faixa" (markup fora de min/max) são avisos reais —
âmbar fica. Confiança de match e desconto usam cor como escala, não como marca.

---

## Fase 7 — Admin Console e resíduos

**Arquivos:** `AdminConsole.tsx` (90/15, 3.338 linhas), `DebugConsoleModal.tsx`,
`AuditLogsModal.tsx`.

**Escopo adicional — varredura final:** eliminar literais hex remanescentes em `src/`
(`#10b981`, `#059669` etc. aparecem cravados em configurações de gráfico) e trocá-los pelos
tokens. Ao final desta fase, `grep -rE '#[0-9a-fA-F]{6}' src/` não deve retornar cor de marca
hardcoded.

---

## Fase 8 — DOCX + branding por tenant

**Escopo:**
- Default de `BrandingSettings.primaryColor` passa a `#236cc7`. **Migração ancorada no valor real
  por linha** — instalações que já customizaram a cor mantêm a sua; só quem está no default antigo
  migra ([[feedback_migration_seed_nunca_afrouxa_default]]).
- `server/utils/docx.ts` (`BrandingHeader`) e `resolveBrandingHeader` em `proposals.ts`: conferir
  que o cabeçalho do documento gerado usa a cor nova e que `ProjectBrandStyle` continua
  sobrepondo por projeto.
- **Cumprir a promessa da tela "Identidade Visual":** hoje `primaryColor`/`accentColor` só chegam
  ao DOCX; a UI ignora. Com os tokens da Fase 0 sendo CSS vars, injetar a cor do tenant em runtime
  passa a ser viável. **Guarda obrigatória:** cor de tenant arbitrária pode reprovar contraste —
  validar o valor e cair no default da marca se não atingir 4,5:1, nunca servir uma UI ilegível.
- Preservar a garantia de margem: markup e preço de lista nunca chegam ao resolvedor de template
  (`docxTemplateEngine.ts`) — vale para qualquer dado novo.

**Critério de aceite:** proposta gerada sai com a cor da marca; tenant com cor customizada
continua com a sua; cor que reprova contraste é rejeitada com mensagem clara, não aplicada.

---

## Fase 9 — Validação visual, contraste e release (gate humano)

- Comparar baseline (Fase 0) × final em todas as telas capturadas, nos dois breakpoints.
- Auditoria de contraste de todos os pares texto/fundo introduzidos — meta: zero par abaixo de
  4,5:1 para texto e 3:1 para elementos de UI.
- Rodar a suíte completa e os 3 scripts de regressão (`regression:approval-rbac`,
  `regression:workspace-documents`, `regression:admin-console`).
- Atualizar as capturas dos manuais (`docs/manuais/screenshots/`) — 30+ imagens que hoje mostram a
  interface verde e ficariam mentindo.
- **Não avança sozinha:** aprovação explícita do dono antes de cortar release.
- Release: tag `vX.Y.Z-identidade-visual` + Release no CMSaaS + apply step-up-gated. A "PreSales
  Demo" está fora do ar desde 30/07 — publicar continua correto (é canary), mas ela só recebe
  quando voltar.

---

## Trilha B — Enriquecimento com a biblioteca de componentes

O dono entregou 12 componentes de referência em `/home/sakae/projects/ui/components/`, usados
durante a implementação do CMCRM. Auditados um a um em 24/08/2026 contra as telas reais do
PreSales e contra as dependências que o projeto realmente tem.

### Por que é uma trilha separada, e não parte das fases 2–7

Recolorir e trocar componente na mesma fase **destrói a validação**. O baseline visual da Fase 0
existe para provar que só a cor mudou; se o componente mudar junto, uma regressão de cor deixa de
ser detectável e não se sabe se um defeito veio da paleta ou do componente novo. Além disso a
repaletização tem critério objetivo (contraste, papel semântico) e o enriquecimento é uma decisão
de produto. **Cada fase E só começa depois que a tela correspondente já foi repaletizada.**

### O que o PreSales tem e não tem (define o custo de adoção)

**Já instalado:** React 19, Tailwind v4, `motion` ^12.23.24 (**já usado em `Login.tsx:2`** — o
sucessor do framer-motion; portar é trocar o import), `recharts` ^3.10.1, `lucide-react`.

**Não existe:** `src/components/ui/` (nenhuma camada de primitivas), shadcn/ui, qualquer Radix,
`clsx`/`tailwind-merge` (o `cn()`), `class-variance-authority`, `@tanstack/react-table`, `reaviz`.

Vários componentes trazem as primitivas shadcn na própria pasta `deps/` — o custo real não é
"instalar shadcn", é o que essas primitivas importam de fora.

### Veredito por componente

| Componente | Alvo no PreSales | Dependência real | Veredito |
|---|---|---|---|
| `chart-cartao-animado` | os 3 KPIs da Home (hoje cards estáticos) | `clsx`+`tailwind-merge` | **Adotar** — E1 |
| `chart-funil` | "Pipeline de Status" da Home, que **é** um funil e hoje é uma barra chapada | `motion/react` (já tem) + `clsx`/`tw-merge` | **Adotar** — E1 |
| `chart-pizza` | "Licitações por setor/vertical" da Home | `recharts` (já tem) + `cva`; `deps/card` é trivial | **Adotar** — E1 |
| `hero-login-background` | tela de Login, que fica `brand-950` e hoje é fundo chapado | framer-motion → `motion/react` | **Adotar** — E2 |
| `shine-border` | um único caso: cartão que exige atenção real | `cn` apenas (o AEGIS fez só com CSS) | **Adotar com parcimônia** — E1 |
| `interactive-logs-table` | Audit Logs do Admin + `DebugConsoleModal` (hoje listas simples) | `cva` + `@radix-ui/react-slot` (descartável) + motion | **Adaptar** — E3 |
| `ai-chat-input` | o Copiloto do Workspace (`chatHistory`/`chatMessage`, hoje input simples) | `cn` apenas — mas são 980 linhas | **Adaptar** — E4 |
| `statistics-card-13` | matriz de conformidade — o demo é literalmente "Compliance Checks" | `@tanstack/react-table` + `radix-ui` + `cva` | **Só a ideia** — E5 |
| `ai-agent-pipeline` | etapas da "Executar Análise IA" | framer-motion → `motion/react` | **Adiar** — exige backend |
| `tool-calls-section` | trilha de ações da IA | `cn` + lucide | **Adiar** — para o plano de IA |
| `calendario-eventos` | nenhum — o POC precisa de Gantt, que já existe | 4 pacotes Radix + 9 primitivas | **Descartar** |
| `heat-map-middle` | nenhum — o produto não tem incidentes | **`reaviz`**, motor de gráfico inteiro | **Descartar** |

**Por que os dois descartes.** `calendario-eventos` é um calendário mensal com convidados,
categorias e diálogo de edição — o produto tem `PocGanttChart` (drag/resize, caminho crítico) e
`preliminary_schedule`, que são outra coisa; adotá-lo seria construir uma feature nova, não
enriquecer a existente, ao maior custo de dependência do lote. `heat-map-middle` traria `reaviz`,
uma segunda biblioteca de gráficos, quando o projeto já padronizou `recharts` — dois motores no
mesmo bundle é dívida que não se paga por um heatmap sem alvo.

**Por que os dois adiamentos.** `tool-calls-section` e `ai-agent-pipeline` são bons, mas exibem
dado que **hoje não existe**: o primeiro precisa das tool calls que só nascem na Trilha A do plano
`presales-ia-bom-e-propostas.md`; o segundo precisa que o backend emita fases discretas da análise,
e hoje ele emite só `progress_pct`. Adotar agora seria construir a vitrine antes do produto.

### E0 — Fundação de composição

- Adicionar `clsx` + `tailwind-merge` e criar o helper `cn()`. São duas dependências pequenas que
  destravam quase todos os adotados.
- Criar `src/components/ui/` com as primitivas mínimas — `Card`, `Badge`, `Input`, `Button` —
  escritas **no estilo do PreSales**, usando os tokens da Fase 0. **Não** portar as primitivas
  shadcn das pastas `deps/`: elas trazem `cva` e Radix e impõem um vocabulário visual que não é o
  do produto. As telas atuais já têm um estilo definido; a camada nova serve para parar de repetir
  classe, não para trocar a linguagem visual.
- Decidir sobre `cva`: só vale se as primitivas ganharem variantes de verdade. Na dúvida, ficar sem.

**Critério de aceite:** `cn()` disponível, 4 primitivas cobrindo os padrões já usados hoje, uma
tela existente refeita com elas sem diferença visual perceptível contra o baseline.

### Cuidados registrados

- `chart-funil`/`chart-pizza` referenciam `var(--chart-1..5)`. Mapear esses tokens para a paleta da
  Fase 0 — e **cor de série por índice não pode contradizer cor semântica de severidade na mesma
  tela** ([[feedback_chart_generic_color_rotation_vs_semantic]]).
- Os demos vêm com cromo de marketing (fundo laranja no `ai-chat-input`, `bg-black` no
  `ai-agent-pipeline`, copy de vitrine no `hero-login-background`). Portar o componente, nunca a
  vitrine.
- KPI animado: a grafia está aprovada e não muda; cuidado com escala de rótulo vencendo o número
  ([[feedback_h2_rotulo_de_metrica_nao_e_secao]]).
- Toda animação precisa respeitar `prefers-reduced-motion` de verdade — foi assim que o AEGIS
  portou o `hero-login-background` ([[project_aegis_revisao_interface_fase2]]).
- `shadcn`/`TanStack`/`Playwright` mudam de API rápido: conferir `node_modules/**/*.d.ts` antes de
  codar, não confiar na memória ([[feedback_shadcn_tanstack_playwright_api_drift]]).
- O AEGIS já portou 3 destes (`chart-pizza` → `ProportionChart`, `shine-border` → `ShineBorder`,
  `hero-login-background` → `LoginBackground`) **sem** framer-motion. Ler aquelas implementações
  antes de refazer do zero — ver [[project_aegis_ui_reference_library_audit]].

---

## Sequenciamento e paralelismo

- **Fase 0 bloqueia todas as outras** (tokens + baseline). É pequena.
- **Fase 1 é independente das fases 2–7** (ativos vs. classes de cor) e pode rodar em paralelo.
- **Fases 3, 5, 6 e 7 não compartilham arquivo** — podem rodar em paralelo entre si depois da
  Fase 2, em sessões diferentes. Nunca duas sessões no mesmo arquivo.
- **Fase 2 vem antes das demais de repaletização**: ela fixa o vocabulário (que token para que
  papel) que as outras copiam.
- **Fase 8 depende da 0** (tokens) e não das telas.
- **Fase 9 depende de todas.**

## Fora de escopo (não reabrir)

- Tipografia, tamanhos e espaçamento — aprovados pelo dono, não mudam.
- Tema escuro completo da aplicação — login escuro + app claro é decisão tomada.
- Redesenho de layout, componentes ou navegação. Isto é repaletização, não redesign.
- Trocar a marca Cloud Mountain do rodapé "POWERED BY" ou o `cmsaas-icon`.

---

## Onde está o prompt da fase corrente

**No artifact**, não neste arquivo:
https://claude.ai/code/artifact/06e9e05b-5c11-4bda-bd50-891f2f24b7bf (seção "Prompt da próxima
fase"). Manter o prompt em dois lugares só produz divergência — a página é a fonte de verdade
dele, e cada fase que fecha o substitui pelo da fase seguinte.
