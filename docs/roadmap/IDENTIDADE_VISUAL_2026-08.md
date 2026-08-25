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
| 3 | Área de Trabalho | **✓ concluída** (24/08/2026) | `4a5c4f9` (PR #55) | 106 trocas num arquivo só; matriz de conformidade preservada e medida (5,09 / 4,85 / 5,87:1); 12 imagens do baseline regravadas |
| 4 | Propostas, Aprovação e Conhecimento | **✓ concluída** (24/08/2026) | `63157e9` (PR #56) | 195 trocas em 7 arquivos; ciclo de vida da proposta em 5 cores distintas; 4 modais fora do baseline provados por captura, medição e hover real |
| 5 | Módulo POC | **✓ concluída** (24/08/2026) | `27e8628` (PR #57) | 243 trocas em 4 arquivos; Gantt decidido barra a barra; animação `poc-start-glow` tokenizada; 5 sub-abas fora do baseline provadas no navegador |
| 6 | Módulo Precificação | **✓ concluída** (24/08/2026) | `db4f031` (PR #58) | 103 trocas em 7 arquivos; primeiro gráfico recharts do programa tokenizado; duas escalas decididas inteiras; 6 superfícies para 1 imagem do baseline |
| 7 | Admin Console e a varredura final | **✓ concluída** (25/08/2026) | `__COMMIT__` (PR #59) | 222 trocas em 8 arquivos; `sky` e `rose` decididos; família dos 5 badges de arquivo unificada; `waiting_internal` com uma cor; zero cor não-semântica em todo o `src/` |
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

## Fase 3 — Área de Trabalho — ✓ CONCLUÍDA (24/08/2026)

**Arquivo:** `Workspace.tsx` (1.908 linhas) — a maior densidade de cor do produto e o coração do
fluxo (requisitos, riscos, BOM, matriz de conformidade).

**106 trocas de cor num único arquivo, cada uma decidida pelo contexto.** O mapeamento do plano
falava em 101 `emerald` e 39 `amber`; a varredura completa achou **173 ocorrências de cor não
neutra** — os 140 previstos mais 19 `red`, 11 `blue` e 3 `purple`, que nenhum grep de
`emerald|amber` encontraria e que fazem parte das mesmas famílias visuais. Depois da fase,
`Workspace.tsx` tem **zero** ocorrência de `emerald`, `amber`, `red`, `blue` ou `purple`: tudo é
`brand` (106), `success` (12), `warning` (32), `danger` (19) ou `slate`.

O script de aplicação (descartado depois de rodar) ancorava cada troca em
`(arquivo, linha, texto exato)` com a **contagem esperada de ocorrências na linha**, e abortava sem
gravar nada se uma só não casasse. Com 173 ocorrências num arquivo só, esse é o único jeito seguro:
metade das linhas tinha duas cores diferentes na mesma string de classes.

### A matriz de conformidade: o que foi preservado, e como ficou provado

O significado das cores está **integralmente preservado**. Conforme continua verde, parcial
continua âmbar, não conforme continua vermelho — só passaram a ser escritos por intenção. Provado
medindo a cor **pintada num canvas 1×1**, não a classe no JSX:

```
conforme      fundo #ecfdf5  texto #007a55  VERDE     contraste 5,09:1  ✓ AA
parcial       fundo #fffbeb  texto #bb4d00  ÂMBAR     contraste 4,85:1  ✓ AA
não conforme  fundo #fef2f2  texto #c10007  VERMELHO  contraste 5,87:1  ✓ AA
ação          fundo #236cc7 (brand-600) sobre branco  contraste 5,20:1  ✓ AA
```

Os quatro estados foram medidos em **amostras sintéticas com as classes reais do componente**,
porque o projeto de captura só tem requisitos num estado — medir só o que está no banco provaria um
quarto da matriz.

Também ficaram verdes, como manda o escopo: os **badges de confiança do BOM** (85%/90%/95%, escala
`warning`/`slate`/`success`) e o aviso **"Lógica desatualizada"** em âmbar.

### O que virou marca, e por quê

| Papel | Onde | Resultado |
|---|---|---|
| Navegação | as 6 sub-abas (`border-emerald-600` na aba ativa) | `border-brand-600` |
| Ação | "Salvar", "Gerar Proposta", "Criar Documento", "ENVIAR", "Adicionar Item", "Abrir Configurações de IA", "Exportar (DOCX)", "Voltar para Raiz" | `brand-600`, hover `brand-700` |
| Foco e seleção | 14 `focus:ring`, breadcrumb da pasta corrente, bordas de hover dos cartões | `brand-500` / `brand-600` |
| Barras de progresso | `:421`, `:431`, `:442` (os dois call-sites de âmbar-como-ação do plano, mais o irmão azul) | `brand-600` sobre trilha `brand-200` |
| Identidade | selo "RESUMO DE COMPLIANCE IA", ícones dos 7 cartões do Estúdio, bolhas e ícone do Copiloto | `brand-*` |

### Seis decisões que um `sed` teria errado

1. **Os 3 cartões de KPI do resumo são uma família, não três ocorrências.** Eram verde
   (Especificações), âmbar (Mitigações) e azul (Dúvidas) — três cores arbitrárias para três
   contagens do mesmo projeto. Trocar só o verde deixaria o cartão 1 idêntico ao cartão 3. Os três
   viraram `brand-*`: a distinção já é feita pelo rótulo e pelo número, e o âmbar deixou de sugerir
   alerta onde só há contagem. Mesmo tratamento que os 4 KPIs da Home na Fase 2, e **reversível numa
   linha**.
2. **As oportunidades continuam verdes.** `business_value` e o badge de prioridade em
   `emerald-700` não são "conforme", mas estão na **mesma sub-aba** da tabela de riscos, que é
   vermelha e âmbar. O verde ali é a polaridade positiva contraposta ao risco — pintá-lo de azul
   apagaria o contraste que a tela inteira comunica. Ficam verdes, escritos `success-*`.
3. **"Prioridade baixa" deixou de ser azul.** A escala de prioridade dos requisitos era
   vermelho/âmbar/**azul**. Com a marca virando azul, "baixa prioridade" passaria a parecer ação.
   Virou `slate` — e a escala melhorou: vermelho → âmbar → neutro é uma urgência decrescente
   legível, que o azul não expressava.
4. **A procedência do part number é uma família de três estados exclusivos**, e o azul dela também
   colidiria com a marca. Cada um foi para o token fiel ao seu próprio `title`: "Editado por
   {pessoa}" (*"valor corrigido/verificado manualmente"*) → `success`; "Via Base de Conhecimento"
   (era `purple`, cor sem papel no vocabulário) → `brand`; "Sugestão via busca web" (*"valide antes
   de usar na proposta final"*) → `warning`.
5. **O botão primário da sub-aba BOM era cinza-escuro.** "Adicionar Item" estava em `slate-800`
   enquanto todos os outros primários do arquivo eram `emerald-600`: mesmo papel, duas cores, e
   invisível para um grep de `emerald|amber`. É o mesmo defeito do `sky-600` do MFA na Fase 2. Foi
   para `brand-600`.
6. **"Flagged QA" continua âmbar de propósito.** A varredura final aponta quatro `<button>` com
   fundo âmbar — e eles estão certos: é o marcador de "risco precisa de esclarecimento do cliente",
   um indicador de pendência que por acaso é clicável, não um botão de ação. O critério "nenhum
   botão primário verde ou âmbar" está cumprido; este não é primário.

### O ícone de pasta: a crítica visual mudou a decisão

Os quatro cartões de diretório do Explorador tinham ícone `amber-50`/`amber-500` com hover verde.
Âmbar ali era falso alerta (as quatro pastas têm a mesma cor, logo não distingue nada), então a
primeira versão neutralizou para `slate`. **Olhando a captura, ficou errado:** o ícone sumia dentro
do cartão branco e a grade perdia o ponto que ancora o olhar. Ficou `bg-brand-50`/`text-brand-600`
em repouso, intensificando para `brand-100`/`brand-700` no hover — presença de volta, sem prometer
atenção onde não há. É o tipo de coisa que só aparece **olhando** a imagem, não conferindo classes.

### Como ficou provado

Antes de tocar em qualquer arquivo, `npm run test:visual` deu **36/36 verdes** — a fase começou de
um estado provadamente são. No fim, com o baseline regravado, **36/36 de novo**.

No próprio dev: `npm run lint` limpo, `npm run build` completo, `npm run test` com **16 arquivos e
98 testes passando** (executados duas vezes, antes e depois do ajuste do ícone de pasta).

A varredura final classificou **por matiz do pixel pintado** todo elemento visível das 6 sub-abas:
1.439 elementos com cor, e nenhum `<button>` ou `<a>` com fundo verde ou âmbar exceto os quatro
"Flagged QA" descritos acima. Os verdes restantes são os 17 badges de confiança do BOM, os 4 badges
de oportunidade e o ponto de saúde do LLM no rodapé (`App.tsx`, Fase 2) — todos semânticos.

**12 das 36 imagens do baseline foram regravadas** (as 6 sub-abas × 2 larguras) e revisadas uma a
uma. `workspace-summary.png` mudou 62.237 pixels, trocando `#009966` (emerald-600) por `#236cc7`
(brand-600): é a borda da aba ativa, exatamente o que a fase existe para fazer.

### Cuidados que só apareceram executando

- **`home.png` e `pricing.png` "mudaram" sem terem mudado.** A recaptura marcou as duas como
  modificadas; a comparação pixel a pixel achou **11 e 16 pixels com delta ±1** nos cantos
  arredondados — ruído de antialiasing do Chromium entre execuções, não cor. Passam no
  `toHaveScreenshot` porque `maxDiffPixels: 0` convive com o `threshold` perceptual padrão (0,2),
  que ignora delta de 1/255. As duas foram **restauradas do HEAD** para o PR conter só o escopo da
  fase. Diferença de tamanho de arquivo (aqui, 1 byte) não prova nada: compare os pixels.
- **Amostra sintética só mede classe que existe no CSS construído.** `bg-brand-700` voltou
  transparente na medição porque essa classe **não aparece como estática** em lugar nenhum do
  código — só como `hover:bg-brand-700`, e o Tailwind v4 gera apenas o que o scanner encontra. Não
  era defeito do produto: os estados de hover foram provados procurando as regras
  (`hover\:bg-brand-700` e as outras dez) no CSS de `dist/`.
- **`.git/index` estava root-owned pela terceira fase seguida** (Fases 0, 2 e 3). O `chown` é o
  primeiro comando, antes de qualquer `git`.
- **Orçamento de login:** 6 rodadas de Playwright (comparação inicial, captura para análise,
  medidor de cor, recaptura do baseline, comparação final), dentro do teto de 20 por IP a cada 15
  minutos.

### Achados registrados, fora do escopo desta fase

- **"Precisa de Informação" é pintado de vermelho igual a "Não Conforme".** A cadeia de
  `compliance_status` tem quatro valores mas só três ramos: `not_enough_information` cai no `else`
  de `non_compliant`. Um requisito que só falta informação aparece como reprovado — e no projeto de
  captura os **10 requisitos** estão nesse estado. Dar cor própria ao quarto valor é decisão de
  produto, não de repaletização. **Levar para a Fase 9.**
- **A coluna "Prioridade" da tabela de oportunidades tem cor fixa.** O badge é verde para `high`,
  `medium` e `low` igualmente — a cor não carrega a informação que a coluna promete. Comparar com a
  coluna homônima dos requisitos, que é uma escala real. **Levar para a Fase 9.**
- **`waiting_internal` não encosta nesta fase.** A Área de Trabalho tem **zero** ocorrência desse
  status (só `App.tsx`, `Home.tsx` e `ProjectsList.tsx` o exibem), então a divergência
  `purple` × `amber` herdada da Fase 2 segue intocada e continua sendo assunto da Fase 9.
- **As tabelas de requisitos, riscos e BOM transbordam em 1440px** — a coluna "Status de
  Conformidade" fica cortada na captura de 1440. É **pré-existente** (idêntico no baseline da Fase
  2) e é defeito de layout, não de cor.

---

## Fase 4 — Propostas, Aprovação e Conhecimento — ✓ CONCLUÍDA (24/08/2026)

**Arquivos:** `Proposals.tsx` (559 linhas), `KnowledgeBase.tsx` (624), `Approval.tsx` (164),
`ProjectFieldsForm.tsx` (349), `NewProjectWizard.tsx` (280), `ClassifyDocumentModal.tsx` (56),
`CreateProjectModal.tsx` (68).

**195 trocas de cor em 7 arquivos, cada uma decidida pelo contexto.** O mapeamento original do
plano contava 130 (`emerald`+`amber`); a varredura completa achou **195** — as outras 65 eram
`red`, `blue` e `purple`, as famílias que criam colisão com o azul da marca. Depois da fase os sete
arquivos têm **zero** ocorrência de `emerald`, `amber`, `red`, `blue` ou `purple`: tudo é `brand`,
`success`, `warning`, `danger` ou `slate`.

As 113 âncoras do script de aplicação — `(arquivo, linha, texto exato, contagem esperada)`, com
aborto sem gravar se uma só não casasse — **casaram de primeira**, como na Fase 3.

### O ciclo de vida da proposta: cinco estados, cinco cores

O mesmo bloco de status aparece em `Proposals.tsx` e em `Approval.tsx`. Era
roxo/verde/azul/vermelho/âmbar; dois desses (o roxo sem papel no vocabulário e o azul de
"ENVIADA") competiam com a marca, e o âmbar de "RASCUNHO" repetia o defeito que a Fase 2 já tinha
corrigido nas outras três telas. Ficou assim, com os cinco distinguíveis e todos aprovando AA:

```
RASCUNHO   slate-100 / slate-700     9,45:1   alinhado às Fases 2 e 3 (draft é neutro)
ENVIADA    warning-50 / warning-700   4,85:1   aguardando decisão É uma pendência
APROVADA   success-50 / success-700   5,09:1   inalterado, verde
REJEITADA  danger-50 / danger-700     5,87:1   inalterado, vermelho
LIBERADA   brand-50 / brand-700       6,90:1   marco final, casa com o botão que o produz
```

**"ENVIADA" trocou de matiz (azul → âmbar).** É a decisão mais visível da fase e a mais fácil de
reverter numa linha: mantê-la azul faria um badge de estado parecer ação em toda a tela de
aprovação. Mesma lógica da "prioridade baixa deixou de ser azul" na Fase 3.

### Aprovação e curadoria: onde o verde ficou de propósito

- **`Approval.tsx` — os botões "Approve"/"Reject" continuam verde e vermelho.** Ali a cor **é** a
  informação: são um par de decisão binária, não o botão primário da tela (esse é "Liberar Versão
  Final", que virou `brand-600`). O critério "nenhum botão primário verde ou âmbar" está cumprido.
  Aproveitou-se para corrigir o contraste: `emerald-600` (3,77:1, **reprova** AA) virou
  `success-700` (**5,36:1**), e `red-600` (4,77:1) virou `danger-700` (**6,42:1**).
- **`KnowledgeBase.tsx` — "Aprovar" verde, "Rejeitar" vermelho, "Editar" azul.** Só o "Editar",
  que é ação neutra e era `blue`, foi para a marca.
- **Cartões de etapa e badges de decisão** (`approved`/`rejected`/`PENDENTE`) intactos em
  `success`/`danger`/`slate`.

### Seis decisões que um `sed` teria errado

1. **Os 4 chips de perspectiva do parecer de IA são uma família.** Eram azul (Técnico), verde
   (Comercial), âmbar (Financeiro) e roxo (Jurídico) — e o cartão que os contém já carrega
   severidade em vermelho/âmbar na borda esquerda e num badge. O chip âmbar de "Financeiro" era
   indistinguível do badge âmbar "atenção" ao lado dele. Os quatro viraram `brand-100`/`brand-700`:
   quem distingue a perspectiva é o **ícone** (chave, aperto de mão, cifrão, escudo) e o rótulo, e
   a cor do cartão passa a significar **só** severidade — que é literalmente o que o comentário no
   topo do arquivo dizia querer. O comentário foi reescrito para registrar isso.
2. **"Analisando..." e "Analisado" eram dois verdes quase iguais.** Progresso virou `brand-100`,
   conclusão ficou `success-50`. A distinção que o rótulo prometia passou a existir na cor.
3. **A barra de progresso da análise da Base de Conhecimento não é sucesso.** `emerald-500`
   pulsando durante o trabalho virou `brand-500` — mesma decisão das barras de progresso da Fase 3.
4. **"Obrigatório" deixou de ser verde.** Na tabela de preços, o par era verde (Obrigatório) e
   âmbar (Opcional). Obrigatório é o caso **padrão** — toda linha ganhava um badge verde chamativo,
   ruído puro. Virou `slate`; "Opcional", que é a exceção que muda o total, ficou em `warning`.
5. **Os três botões secundários de `Proposals.tsx` eram azul, âmbar e roxo.** "Revisar e Editar",
   "Verificar Riscos de SLA" e "Gerar Pareceres de IA" tinham três cores para o mesmo papel, ao
   lado de dois "Exportar" cinza e um primário verde: sete cores numa barra. Viraram um tratamento
   secundário único (`brand-50`/`brand-700`/borda `brand-200`), e a barra passou a ter hierarquia
   real — um primário sólido, três secundários de marca, dois terciários neutros.
6. **O total bruto da planilha não é "sucesso".** `emerald-800` no maior número da tabela virou
   `brand-800` (10,52:1): destaque de identidade, sem prometer aprovação.

O quadrado `TECH`/`COMM` seguiu o mesmo tratamento dos KPIs da Fase 3: os dois em `brand-50`, já
que o próprio texto do quadrado e o título ao lado dizem qual é. Reversível numa linha.

### Os 4 modais: como foram verificados, já que o baseline não os cobre

**41 das 195 trocas estão em modais, e as 36 imagens do baseline não contêm modal nenhum.**
`test:visual` verde não prova nada sobre eles. Os quatro foram abertos no navegador, um a um:

| Modal | Como foi aberto | O que ficou provado |
|---|---|---|
| `NewProjectWizard` | "Nova Proposta" na Área de Trabalho | link e primário em `brand-600`; erro em `warning-*` |
| `CreateProjectModal` | "criar manualmente" dentro do wizard | primário `brand-600`; renderiza o `ProjectFieldsForm` inteiro |
| `ProjectFieldsForm` | edição de projeto em Projetos | 15 anéis de foco em `brand-500`; chip de fabricante `brand-100/800` |
| `ClassifyDocumentModal` | botão de reclassificar no painel de documentos | **hover real**: borda `#e2e8f0` → `#288bf9` (`brand-500`) |

O `ClassifyDocumentModal` é o caso extremo: suas 4 trocas são **só** `hover:border-emerald-500`, um
estado que não existe em repouso e que amostra sintética não mede (Fase 3). Foi provado com
`page.hover()` de verdade, medindo a borda antes e depois. Os outros hovers da fase foram medidos
do mesmo jeito — primário `brand-600`→`brand-700`, "Editar" `brand-50`→`brand-100`, "Rejeitar"
`danger-50`→`danger-100`, excluir documento neutro→`danger`.

### Como ficou provado

`npm run test:visual` deu **36/36 verdes antes de qualquer mudança** e **36/36 de novo** com o
baseline regravado. No próprio dev: `npm run lint` limpo, `npm run build` completo, `npm run test`
com **16 arquivos e 98 testes** passando.

**O banco de desenvolvimento não tem proposta em todos os estados** — a fila de aprovação da Base
de Conhecimento está zerada e nenhuma proposta está `approved`, `rejected` ou `released`. Como na
Fase 3, os estados que o dado não cobre foram medidos em **amostras sintéticas com as classes reais
do componente**, pela cor **pintada num canvas 1×1**: 51 amostras, todas ≥ 4,5:1 exceto dois badges
`slate` pré-existentes que a fase não tocou (`PENDENTE` 3,86:1 e `Pendente` 4,35:1).

**6 das 36 imagens do baseline foram regravadas** (proposals, approval e knowledge-base × 2
larguras) e revisadas uma a uma.

### Cuidados que só apareceram executando

- **`home.png` e `pricing.png` "mudaram" de novo, e de novo não mudaram.** 11 e 16 pixels com
  delta ±1 — o mesmíssimo ruído de antialiasing da Fase 3, nas mesmas duas imagens. Restauradas do
  HEAD. Compare pixels, nunca `ls -la`.
- **Navegar direto para uma aba não reproduz o baseline.** As telas do baseline rodam em série na
  mesma página, e `proposals`/`approval` só têm conteúdo porque uma tela anterior abriu o projeto
  certo. Um script que vai direto para a aba encontra o **estado vazio** e mede o nada — foi o que
  aconteceu na primeira verificação desta fase, e por pouco não passou por "tela sem cor".
- **`.git/index` NÃO estava root-owned** — a primeira vez em quatro fases. O `chown` continua
  sendo o primeiro comando, mas a varredura veio limpa.
- **Orçamento de login: 4 rodadas** (comparação inicial, verificação, recaptura, comparação final).
  As medições de cor e de hover reaproveitaram `.auth/capture-state.json` da rodada anterior em vez
  de logar de novo — vale a pena tentar o reuso antes de gastar uma tentativa.

### Decisão registrada: `AuditLogsModal` e `DebugConsoleModal` ficam na Fase 7

`src/components/modals/` tem outros dois arquivos com cor — `AuditLogsModal.tsx` (4 `emerald`) e
`DebugConsoleModal.tsx` (7 `emerald`, 2 `amber`, 2 `red`). **O plano já os aloca na Fase 7**, junto
com o `AdminConsole.tsx`, e é onde eles pertencem: são abertos pelo rodapé de diagnóstico, não pelo
fluxo de propostas. **Não foram incluídos nesta fase**, deliberadamente.

### Achados registrados, fora do escopo desta fase

- **Erro exibido como aviso.** Em `NewProjectWizard.tsx` (:214, :254) e `KnowledgeBase.tsx` (:380)
  a variável se chama `error` mas o bloco é pintado de âmbar, não de vermelho. A fase manteve a
  aparência (`warning-*`) porque trocar aviso por erro é decisão de produto, não repaletização.
  **Levar para a Fase 9.**
- **`waiting_internal` não encosta nesta fase.** Nem `Proposals.tsx` nem `Approval.tsx` exibem esse
  status — a divergência `purple` × `amber` herdada da Fase 2 segue intocada.
- **A coluna "Prioridade" e o quarto valor de `compliance_status`** continuam como a Fase 3 os
  deixou: assunto da Fase 9.
- **`ProjectsList.tsx:152` tem `hover:text-blue-600 hover:bg-blue-50` sobrevivente da Fase 2** — o
  botão "Editar Projeto" da tabela. É arquivo da Fase 2, não desta; some na varredura final da
  Fase 7.

---

## Fase 5 — Módulo POC — ✓ CONCLUÍDA (24/08/2026)

**Arquivos:** `PocManagement.tsx` (1.660 linhas), `PocGanttChart.tsx` (651), `PocTestCases.tsx`
(339), `PocAcceptancePanel.tsx` (390).

**243 trocas de cor, cada uma decidida pelo contexto** — a maior fase de repaletização do
programa. O mapeamento original contava 130 (`emerald`+`amber`); a varredura completa achou
**239** (as outras 106 eram `red` e `blue`), mais 4 fora de classe Tailwind: os dois `#94a3b8`
cravados no SVG do Gantt e os dois `bg-slate-400` das barras. Depois da fase os quatro arquivos
têm **zero** ocorrência de `emerald`, `amber`, `red` ou `blue`, e **zero** hex ou `rgba()`.

As **165 âncoras** do script `(arquivo, linha, texto exato, contagem esperada naquela linha)`,
com aborto sem gravar se uma só não casasse, **casaram de primeira** — como nas Fases 3 e 4. A
contagem por linha importou: metade das linhas tem duas cores diferentes na mesma string de
classes, e o casamento precisou de `token(?![0-9])` para `emerald-50` não casar dentro de
`emerald-500`.

### O Gantt: onde uma substituição cega faria o dano mais caro

A barra tem três estados, e a legenda os nomeia. Nenhum deles é "sucesso", e o verde de hoje
dizia exatamente isso:

```
                    antes                    depois                  texto branco na barra
concluída           slate-400  2,30:1        slate-500               4,76:1  ✓
caminho crítico     emerald-600  3,77:1      warning-700  #bb4d00    5,03:1  ✓
fora do crítico     blue-400  2,54:1         brand-600    #236cc7    5,20:1  ✓
```

**Os três reprovavam AA com o texto branco que a própria barra imprime dentro de si** — o nome da
tarefa. Não era um detalhe: era o rótulo principal do gráfico, ilegível nos três casos.

**Por que o caminho crítico virou âmbar e não vermelho.** Vermelho é a convenção de mercado, e foi
a primeira escolha — até a leitura da tela mostrar que a **linha "HOJE" já é vermelha** (e fica),
e que vermelho no módulo POC significa "reprovado"/"perdida". Duas informações diferentes na mesma
cor é o defeito que a Fase 4 registrou nos chips de perspectiva. Âmbar é o papel canônico de
atenção no vocabulário do produto e não colide com nada no Gantt. O caminho crítico exige atenção;
não é erro nem sucesso.

**"Em andamento" não pinta barra.** O prompt da fase supunha quatro estados de etapa; o código tem
três ramos e `planned`/`in_progress` compartilham cor. Não foi inventada semântica nova — isto é
repaletização. Fica registrado para a Fase 9.

### O aceite: o terceiro lugar onde azul destruiria informação

- **Ganha/Perdida continuam verde e vermelho.** Par de decisão binária, como o Approve/Reject da
  Fase 4 — a cor **é** a informação. `text-danger-600` sobre `danger-50` dava **4,36:1** e
  reprovava; virou `danger-700` (**5,87:1**), o mesmo tom do badge PERDIDA do cartão, e o par
  ficou simétrico com "Ganha" (`success-700`, 5,09:1).
- **"Finalizar" é o primário e virou `brand-600`** (5,20:1). Nenhum botão primário verde ou âmbar
  sobrou nas quatro telas.
- **O documento de aceite assinado continua verde** (`success-50/700/200`), assim como as NFs e o
  datasheet na tabela de equipamento: ali o verde não é "ação de baixar", é "o documento existe" —
  o estado alternativo é uma caixa tracejada cinza.

**`PocAcceptancePanel.tsx:212` era âmbar-usado-como-ação e foi para a marca.** A linha foi lida
antes de decidir, como o plano manda: é um `<button onClick={approve}>` com rótulo "Aprovar", não
um marcador de pendência clicável (que teria ficado em `warning`, como os quatro "Flagged QA" da
Fase 3). A **tarja continua âmbar** e só o botão dentro dela virou azul: 5,01:1 do botão contra o
fundo da tarja, 5,20:1 do texto branco contra o botão.

### Sete decisões que um `sed` teria errado

1. **O ciclo de vida do equipamento é uma jornada, não três categorias.** "Enviado" (em trânsito)
   → `brand`, "Na casa do cliente" (o equipamento está fora e precisa voltar) → `warning`,
   "Devolvido" (fim do ciclo) → `success`.
2. **As 5 colunas do kanban.** `in_progress` era verde e virou `brand` — progresso é marca, como
   nas barras das Fases 3 e 4. `planned` era azul e teria colidido; virou o tom claro-vivo da
   mesma família, e a dupla ficou uma **escada de peso**: dot `brand-500` (3,30:1) → `brand-700`
   (7,40:1). A primeira tentativa usou `brand-300`, que dava **2,01:1** contra o fundo `slate-50`
   da coluna e ficava perto demais do vizinho — só a comparação da imagem nova contra a antiga
   mostrou isso. **`completed` ficou `slate` de propósito:** o cartão concluído já carrega o
   desfecho em verde ou vermelho na borda, e pintar a coluna de verde brigaria com "GANHA".
3. **O chip "editado" foi para o neutro.** Era `blue`; virar `brand` o deixaria indistinguível do
   badge "Em execução" (`brand-50/700`) na mesma linha do mesmo cartão. Quem diz o que é são o
   ícone de caneta e o rótulo.
4. **Os dois avatares de stakeholder são lados opostos, não uma família.** Responsável interno →
   `brand` (é a nossa gente); contato do cliente → `slate`. Antes eram verde e azul.
5. **Critério de sucesso atendido continua verde**, com o checkbox marcado em `success-600`.
6. **O feedback "Salvo!" subiu de tom.** `emerald-600` em texto de 11px dava 3,77:1 e reprovava;
   `success-700` dá **5,36:1**. Continua verde — é sucesso de verdade.
7. **Os modais mantiveram os papéis:** "Confirmar" virou `brand` (era azul genérico), "Excluir
   POC" continua `danger`.

### A animação `poc-start-glow`

`rgba(245, 158, 11, 0.35)` era `amber-500` da paleta do **Tailwind v3** cravado em CSS puro, fora
do alcance de qualquer busca por classe. Virou
`color-mix(in srgb, var(--color-warning-500) 35%, transparent)`.

Provado no CSS construído e no navegador, não no fonte: `--color-warning-500` sai em `:root` em
`dist/assets/*.css`, a regra `@keyframes` a referencia, e o elemento com a classe computa
`animation: poc-start-glow 2.4s` com `box-shadow: oklab(0.769 0.064053 0.176752 / 0.35)`. **É por
isto que a Fase 0 usou `@theme static`:** sem `static` a variável seria podada por falta de uso em
classe e a regra quebraria em silêncio.

**O tom mudou de propósito, e isso é o ganho:** o literal era `#f59e0b` (amber-500 do v3) e o
token pinta `#fe9a00` (o v4). O aviso agora é **o mesmo âmbar de "Bloqueada"** e de todas as
tarjas do produto, em vez de um âmbar solto que ninguém mais usava.

**Os dois `#94a3b8` do SVG do Gantt** (as setas de dependência entre etapas) viraram
`var(--color-neutral-400)` — barato, então foi feito. Confirmado no navegador que `var()` resolve
em atributo de apresentação SVG: `stroke` computa `oklch(0.704 0.04 256.788)`, pintado `#90a1b9`,
o mesmo cinza neutro de antes. A varredura geral de hex continua sendo escopo da Fase 7.

### Como ficou provado, já que o baseline cobre UMA tela das cinco

`npm run test:visual` deu **36/36 antes de qualquer mudança** e **36/36 de novo** com o baseline
regravado. Mas isso vale pouco aqui: **a tela `poc` do baseline é só o kanban**, e o Gantt, os
casos de teste e o aceite vivem em sub-abas que nenhuma das 36 imagens fotografa. Foi o inverso da
Fase 3, que tinha seis sub-abas capturadas.

As cinco sub-abas foram abertas no navegador e capturadas em pasta separada
(`--out /tmp/...`, sem tocar no baseline), com a cor **pintada num canvas 1×1** — o Tailwind v4
serializa os tokens semânticos como `oklch()`, e um parser ingênuo de números lê
`oklch(0.696 0.17 162.48)` como `#0100a2`.

**O dado de dev cobre um quarto da matriz:** todas as tarefas estão em `planned`, todos os casos de
teste em `pending`, todo equipamento em `shipped`. Pior: **só uma POC não está arquivada** — e é a
vazia. As sete com tarefas, casos de teste, equipamento e aceite assinado estão atrás do botão
"Arquivadas", e um script que ficasse no kanban mediria o nada (o mesmo buraco que a Fase 4 teve
com `proposals`/`approval`). A verificação abre uma POC arquivada, e o que o banco não cobre foi
medido em **29 amostras sintéticas com as classes reais**: todas ≥ 4,5:1.

Estados que não existem em repouso foram provados com interação real: `page.hover()` no primário
(`#236cc7` → `#1a539e`), no cartão do kanban (borda `#e2e8f0` → `#52a1f4`) e no secundário "Gerar
com IA" (fundo transparente → `#ebf6ff`); foco real de campo (anel `rgb(40, 139, 249)` =
`brand-500`); e clique em "Perdida" para medir o estado **selecionado**. A tarja "Aguardando
aprovação", que o banco não tem em nenhuma POC, foi montada com o markup real do componente.

**2 das 36 imagens do baseline foram regravadas** (`poc` nas duas larguras) e revisadas contra a
versão antiga. As outras 34 ficaram intactas — nove delas apareceram "modificadas" na recaptura, e
a comparação pixel a pixel mostrou 4 a 11 pixels **todos em `y=16..19, x≈1158..1185`**: a borda
arredondada do chip "ADD-ON" da topbar, que esta fase não tocou. Restauradas do HEAD, como nas
Fases 3 e 4.

### Cuidados que só apareceram executando

- **`stabilize()` zera `animation-duration` com `!important`.** A primeira medição da animação
  devolveu `box-shadow: none` e parecia que a tokenização tinha quebrado. Não tinha: a folha de
  estabilização da rede visual, aplicada em toda captura, congela animação de propósito. **Medir a
  animação antes de qualquer `stabilize()`**, e ler o `@keyframes` pelo CSSOM para separar "o CSS
  entrega" de "o elemento aplica".
- **String em `page.evaluate()` não recebe argumento.** Além de precisar ser IIFE (Fase 4), uma
  string `(el) => ...` passada a `locator.evaluate()` é avaliada como expressão e **a função nunca
  é chamada com o elemento**. Para medir um elemento existente, use função de verdade (arrow sem
  função interna nomeada não dispara o `__name` do `tsx`); para pintar um valor, interpole-o na
  string com `JSON.stringify`.
- **Prisma 7 exige adapter.** `new PrismaClient()` sozinho falha; é
  `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. E os campos do schema são
  `pocId`, não `poc_id` — o snake_case do JSON não é o do cliente.
- **`.auth/capture-state.json` foi reusado em 3 das 6 rodadas** de navegador. A fase gastou **5**
  tentativas de login (comparação inicial, verificação, duas capturas e comparação final) dentro do
  teto de 20 por 15 minutos.
- **`.git/index` não estava root-owned** — segunda fase seguida com a varredura limpa.

### Achados registrados, fora do escopo desta fase

- **Erro exibido como aviso, de novo.** `reportError` (`PocAcceptancePanel.tsx:235`),
  `generateError` e `formError` (`PocTestCases.tsx:191`, `PocGanttChart.tsx:388`/`:430`) são erros
  pintados de âmbar. A aparência foi mantida em `warning-*`, como a Fase 4 fez em
  `NewProjectWizard` e `KnowledgeBase` — trocar aviso por erro é decisão de produto. **Fase 9.**
- **Os chips "ADD-ON" e "IA/KB" da topbar reprovam AA**: 2,46:1 e 1,61:1 (medidos). São da Fase 2,
  não desta. **Fase 9.**
- **O botão "Salvar" (`slate-800`) pesa mais que o primário de marca** nas sub-abas de teste e
  cronograma — hierarquia herdada, não introduzida aqui.
- `waiting_internal`, "Precisa de Informação" e a coluna "Prioridade" seguem como as Fases 3 e 4 as
  deixaram.

---

## Fase 6 — Módulo Precificação — ✓ CONCLUÍDA (24/08/2026)

**Arquivos:** `PricingProjectSheet.tsx` (745 linhas), `PricingCatalog.tsx` (532),
`PricingExtractionReview.tsx` (375), `PricingFileUploadModal.tsx` (259), `PricingTaxSettings.tsx`
(132), `PricingPendingItems.tsx` (115), `PricingModule.tsx` (86).

**103 trocas em 7 arquivos** — 99 classes Tailwind (o número que o levantamento previa, casado
exatamente) e **4 literais hex cravados em atributo JSX do recharts**, fora do alcance de qualquer
busca por classe. Depois da fase os sete arquivos têm **zero** ocorrência de `emerald`, `amber`,
`red` ou `blue`, e **zero** hex ou `rgba()`. As **103 âncoras**
`(arquivo, linha, texto exato, contagem esperada naquela linha)`, com aborto sem gravar se uma só
não casasse, **casaram de primeira** — quinta fase seguida.

### O gráfico: o primeiro recharts do programa

`PricingCatalog.tsx` desenha o histórico de preço por item, e a cor estava em atributo de
apresentação SVG:

```
        antes                          depois                       pintado no navegador
grade   stroke="#e2e8f0"               var(--color-neutral-200)     #e2e8f0   idêntico
eixos   fill: "#64748b"                var(--color-neutral-500)     #62748e   deslocou 3 bits
linha   stroke="#059669"  emerald-600  var(--color-brand-600)       #236cc7   5,06:1 ✓
pontos  (herdam do Line)               var(--color-brand-600)       #236cc7
```

**A linha do gráfico não é sucesso — é uma série de dados.** `#059669` era a cor de marca
aposentada cravada à mão; virou `brand-600`. A paleta reserva `brand-500` para "séries de gráfico",
mas aqui é **uma** série de 2px sobre a linha expandida da tabela (`slate-50/60`, pintada
`#fbfcfd`): `brand-500` daria 3,2:1 e `brand-600` dá **5,06:1**. Escolhido o 600 e registrado o
porquê.

**Confirmado no navegador, não presumido** — se `var()` não resolvesse, a série ficaria preta:
`stroke` computa `rgb(35, 108, 199)`. E vale a nota da Fase 5 ao contrário: **os tokens da marca
voltam como `rgb()` e os semânticos como `oklch()`** (`--color-neutral-500` →
`oklch(0.554 0.046 257.417)`).

**O eixo mudou de tom de propósito, como o âmbar da animação na Fase 5.** O literal `#64748b` era o
`slate-500` do **Tailwind v3**; o token pinta `#62748e`, o `slate-500` do v4 — o mesmo cinza que o
resto do produto usa. A grade não mudou um pixel (`#e2e8f0` é igual nas duas versões).

### As duas escalas, decididas inteiras de uma vez

**1. Status do casamento da linha do BOM** (`MATCH_COLOR`) — era verde / azul / âmbar:

```
Casado com catálogo    success-50 / success-700   5,09:1   resolvido pelo catálogo, é conforme
Mapeado manualmente    slate-100  / slate-700     9,45:1   resolvido por uma pessoa: procedência
Sem preço cadastrado   warning-50 / warning-700   4,85:1   bloqueia a linha — é o degrau ruim
```

O azul de "Mapeado manualmente" **não virou `brand`**: um chip azul-marca numa coluna de status
lê como clicável, e a Fase 4 já pagou esse preço nos chips de perspectiva. Foi para o neutro, como
o chip "editado" da Fase 5. O verde **ficou** onde significa "veio do catálogo", e o âmbar ficou
onde o prompt manda: a linha sem preço é pendência de verdade — o campo de desconto dela nem
existe, mostra "—".

**2. Confiança do casamento na revisão de extração** — três notas de 9px sob o código do item:

```
"PN já existe: usar X"          brand-600     5,20:1   é um <button>, ação de um clique
"Atualiza item existente"       success-700   5,36:1   PN e código batem: casamento limpo
"PN já existe c/ outro código"  warning-700   5,03:1   conflito, exige julgamento humano
```

Os três reprovavam ou raspavam AA antes (`blue-600`, `emerald-600` 3,77:1, `amber-600` 3,19:1) em
texto de **9px**, que não é texto grande. Os três agora passam.

### Seis decisões que um `sed` teria errado

1. **O contador de extrações pendentes virou `brand-600`, não âmbar.** Foi o caso mais disputado da
   fase. O precedente âmbar do produto é o dot da aba "Equipamento" (Fase 5), e ele só aparece com
   `equipmentPendingReturn > 0 && pocIsOverdue` — é **alarme**, não contagem. Este badge aparece com
   `extractionCount > 0`, sem prazo e sem nada quebrado: é uma **contagem numa superfície de
   navegação**, como o badge do kanban (que é neutro). Ficou `bg-brand-600` com texto branco
   (**5,20:1**; `warning-600` com branco daria 3,19:1 e reprovaria). O aviso de verdade continua
   âmbar **dentro** da aba: a tarja das notas de confiança e a tarja da linha incompleta.
2. **O resumo do BOM importado não é sucesso.** `bg-emerald-50 / emerald-200 / emerald-800` virou
   `brand-*` (**10,51:1**). A caixa diz "72 itens — 12 casados, **60 sem preço**": pintá-la de verde
   promete um desfecho que ela não tem. Mesma decisão do total bruto da planilha na Fase 4.
3. **O desconto sugerido pela IA virou `brand-700`** (7,57:1). Era `emerald-700` ao lado do desconto
   atual em `slate-500`. É uma **proposta a aceitar**, não um resultado bom — e o botão que a aplica
   é da marca.
4. **A margem fora da faixa de markup continua âmbar, com tom corrigido.** `amber-600` dava
   **3,19:1** e reprovava; `warning-700` dá **5,03:1**. O check de "dentro da faixa" era
   `emerald-500` (**2,54:1**, reprovava até o piso de 3:1 de objeto gráfico) e virou `success-600`
   (**3,65:1**). Continua verde: ali o verde é "esta linha está conforme", e o estado alternativo é
   um alerta âmbar.
5. **O spinner de "enviando/processando" era âmbar e virou marca.** `text-amber-500` (2,36:1) em
   `PricingFileUploadModal.tsx:213` não avisava nada — enviar arquivo não é uma pendência. Progresso
   é marca, como as barras das Fases 3 e 4: `brand-600` (**5,20:1**).
6. **"Configurações salvas." continua verde.** É o único sucesso literal do módulo
   (`success-50/700`, 5,09:1, medido **de verdade** clicando em Salvar), e agora fica ao lado de um
   primário azul — exatamente a separação que o programa existe para criar.

Os seis pontos de erro do módulo já eram `red` e foram para `danger` sem discussão. **A Precificação
não tem o defeito "erro exibido como aviso"** que as Fases 4 e 5 acharam em seis lugares — vale
registrar o negativo.

### Como ficou provado, já que o baseline cobre UMA das seis superfícies

`npm run test:visual` deu **36/36 antes de qualquer mudança** e **36/36 de novo** com o baseline
regravado. Isso vale pouco aqui: a tela `pricing` do baseline é só a aba **"Tabela de preços"**. As
outras quatro abas e o modal de upload — **6 superfícies para 1 imagem**, pior proporção que a Fase
5 — foram abertas no navegador e fotografadas em pasta separada (`--out /tmp/fase6/...`), com a cor
**pintada num canvas 1×1**.

**O dado de dev não cobre metade da matriz, e o banco disse isso em segundos:**

- **As 34 extrações do banco estão TODAS em `confirmed`/`rejected`.** O endpoint filtra
  `status in (pending, edited)` — a aba "Extrações pendentes" nasce **vazia** e o contador **nunca
  renderiza** com dado real. Foi o mesmo buraco da Fase 5 ("só uma POC não arquivada"), mas total.
- **`ProjectPricingLine` tem `matched=12` e `unmatched=60`, e ZERO `manual`.** Dois dos três degraus
  da escala de status existem na tela; o terceiro, não.
- **Só 1 dos 33 itens do catálogo tem ≥2 entradas de histórico** — e o gráfico só desenha com duas.
  O script varre as linhas até achar a que abre o `recharts`.

O que o banco não tem foi medido em **23 amostras sintéticas com as classes reais do componente**, e
o que existe em repouso foi medido no elemento vivo. Estados que só existem em interação foram
provados com interação de verdade: `page.hover()` no primário (`#236cc7` → `#1a539e`, 5,20 → 7,57),
no lápis e na lixeira da tabela; `focus()` real no campo de busca (anel `rgb(40, 139, 249)` =
`brand-500`) e no campo obrigatório (borda `danger-300` → `brand-500`); **um evento `dragover` de
verdade** na área de arraste do modal (borda `#cad5e2` → `#288bf9`, fundo → `#ebf6ff`); e um clique
real em "Salvar" no Motor fiscal para a tarja verde.

**Comparação antes × depois de verdade, não só "renderizou".** As 13 capturas foram tiradas duas
vezes — com `git stash` + `npm run build` no HEAD para o "antes" e de novo com a mudança — e
comparadas pixel a pixel. Todas mudaram no lugar esperado, e a leitura das imagens ampliadas
confirmou o que os números diziam: a escala de três degraus do status é legível a 12px, e a escala
de confiança a 9px.

**2 das 36 imagens do baseline foram regravadas** (`pricing` nas duas larguras). No desktop a
diferença é de **5.721 px em `y=104..183`** — a barra de abas e o primário do cabeçalho; no
telefone, **94 px em `x=24..70, y=242..243`**: a régua de 2px da aba ativa. `home.png` apareceu
"modificada" na recaptura e a comparação deu **0 pixel** de diferença — restaurada do HEAD, como nas
Fases 3, 4 e 5. Espere que aconteça de novo.

No próprio dev: `npm run lint` limpo, `npm run build` completo, `npm run test` com **16 arquivos e
98 testes** passando.

### Cuidados que só apareceram executando

- **`:has-text()` e `:text-is()` são seletores do Playwright e não existem no DOM.** Um
  `document.querySelectorAll('button:has-text("Salvar")')` dentro de `page.evaluate()` estoura
  `SyntaxError`. Para medir um elemento achado por eles: marcar o nó pelo lado do Playwright
  (`locator.evaluate` com arrow anônima) e medir pelo atributo.
- **`--tw-ring-color` é onde o anel de foco mora.** `boxShadow` truncado em 60 caracteres esconde o
  anel: ele é a **quarta** sombra da lista. Ler a propriedade customizada é direto.
- **Script com `import` do repo precisa rodar DENTRO do repo.** `npx tsx /tmp/x.ts` não resolve
  `@prisma/client`; o arquivo tem que estar sob a raiz do projeto.
- **Prisma 7: os nomes do schema não são os do cliente.** `PriceHistoryEntry.itemId` (não
  `catalogItemId`), `PriceCatalogExtractionDraft` sem `sourceFileName` (vem de
  `priceListUpload.fileName`), `ProjectPricingSheet` sem `standalone` (é `projectId == null`). Ler o
  `schema.prisma` antes de escrever o `select`.
- **`.auth/capture-state.json` expirou na primeira rodada e foi reaproveitado nas cinco seguintes.**
  A fase gastou **4** tentativas de login (a comparação inicial, a verificação, a recaptura e a comparação final) dentro
  do teto de 20 por 15 minutos.
- **`.git/index` não estava root-owned** — terceira fase seguida com a varredura limpa.

### Achados registrados, fora do escopo desta fase

- **O par de botões de modo `bg-slate-800`** ("Vinculada a projeto" / "Avulsa") em
  `PricingProjectSheet.tsx:346`/`:359` pesa mais que o "Importar BOM" de marca logo ao lado — é a
  mesma família do achado do botão "Salvar" das Fases 4 e 5. **Fase 9.**
- **A Precificação não é responsiva a 390px**: a tabela transborda na horizontal e o selo de cotação
  se sobrepõe ao texto do cabeçalho. É estrutura, não cor, e é anterior a esta fase. **Fase 9.**
- **Primário desabilitado usa `disabled:opacity-60`**, o que põe texto branco sobre um azul de
  ~2,5:1. É padrão do produto inteiro e a WCAG isenta controle desabilitado — registrado só para não
  se perder. **Fase 9.**
- **O chip "ADD-ON" da própria aba "Precificação"** continua nos 2,46:1 medidos na Fase 5. É da Fase
  2. **Fase 9.**
- `waiting_internal`, "Precisa de Informação" e a coluna "Prioridade" **não aparecem neste módulo**;
  seguem como as Fases 3 e 4 as deixaram.

---

## Fase 7 — Admin Console e a varredura final — ✓ CONCLUÍDA (25/08/2026)

**Arquivos:** `AdminConsole.tsx` (3.338 linhas — o maior do produto), `App.tsx`, `Login.tsx`,
`ProjectsList.tsx`, `Home.tsx`, `DebugConsoleModal.tsx`, `AuditLogsModal.tsx`, e
`diagnostics/BugReportModal.tsx` (entrou pela varredura de hex).

**222 trocas em 8 arquivos:** as **219 classes** que o levantamento previa, casadas exatamente,
mais **3 literais** fora de classe Tailwind. As **214 âncoras** do script de aplicação
`(arquivo, linha, token, contagem naquela linha)` — com aborto sem gravar se uma só não casasse —
**casaram de primeira**, sexta fase seguida. O aplicador desta fase acrescentou uma trava nova:
além de exigir que cada âncora exista, ele **recusa a linha se sobrar na string qualquer token de
família sem âncora**. É o que garante que nenhuma cor escapou por descuido de mapeamento, e não só
que as mapeadas foram trocadas.

**A varredura final valeu para o produto inteiro, não só para os sete arquivos:** depois desta
fase, `grep -rE '(emerald|amber|red|blue|sky|rose|purple|green|orange|yellow|indigo|violet|teal|cyan|fuchsia|pink|lime)-[0-9]{2,3}' src/`
não retorna **nada**. As sete famílias do critério de aceite e mais dez que ninguém tinha
procurado: zero ocorrências em todo o `src/`.

### `sky` e `rose`: as duas famílias que nenhuma fase anterior encontrou

Foram decididas **antes** de qualquer troca, lendo os call-sites:

- **`sky` (7 ocorrências) é a seção "Atualizações do Sistema" inteira** — a tarja de informe
  (`systemUpdateMessage`), o texto "Atualização em andamento...", a barra de progresso e o degrau
  `in_progress` do histórico. Não é uma cor decorativa: é **progresso e informação**, e a escala já
  fixada diz que progresso é marca. Foi para `brand`. O ganho não é só tirar a colisão com o azul
  da marca — é que o produto tinha **dois azuis vizinhos** dizendo coisas diferentes na mesma tela,
  e agora tem um.
- **`rose` (5 ocorrências) são dois botões destrutivos** — "Remover" um provedor de IA e "Apagar"
  um template de proposta. O produto já tem `danger` para destrutivo, e a três telas de distância
  o "Apagar" de um fluxo de aprovação era `red-50/700` enquanto o de um template era
  `rose-200/600`: **mesmo papel, dois vermelhos**. Foram para `danger`, e o par ficou simétrico.

**A barra de progresso subiu de tom, de propósito.** `sky-500` virou **`brand-600`**, não
`brand-500`: a trilha é `slate-100` e `brand-500` sobre ela dá **3,12:1**, raspando o piso de 3:1
de objeto gráfico. `brand-600` dá 5,20:1. Mesma lógica da linha do gráfico da Fase 6.

### A família dos 5 badges de tipo de arquivo, decidida inteira

`getDocTag()` (`App.tsx:669-673`) pintava PDF de vermelho, DOCX de azul, XLSX de verde, CAD de roxo
e IMG de âmbar — **cinco cores para cinco categorias**, num produto onde vermelho significa erro,
âmbar significa pendência e verde significa conforme. Um PDF numa lista de documentos aparecia
igual a um item com problema.

A Fase 2 tinha decidido **não** tocá-los ("trocar o verde por azul faria XLSX colidir com DOCX;
neutralizar tudo apagaria a legenda"). A Fase 4 resolveu o caso gêmeo — os 4 chips de perspectiva
do parecer de IA — uniformizando a família e deixando o ícone e o rótulo distinguirem. **Aqui o
argumento é mais forte ainda: o rótulo do badge JÁ É a extensão** ("PDF", "DOCX", "XLSX"). A cor
não acrescenta informação que o texto não dê; só compete com o vocabulário semântico.

Os cinco viraram `bg-brand-100 / text-brand-700 / border-brand-200` — **6,10:1**, uma família só.
Não foram para `slate` porque o badge vive dentro de um cartão `bg-slate-50` e desapareceria.
**Reversível numa linha**, como os KPIs das Fases 2 e 3, se o dono preferir a variedade cromática.

Esta é a única decisão da fase que muda pixel **fora** dos sete arquivos: `getDocTag` é passado
como prop para o `Workspace`, então o badge aparece nas **6 sub-abas da Área de Trabalho** também.

### Os dois consoles escuros: uma frase, e por que ela vence o VT100

`DebugConsoleModal` e `AuditLogsModal` usavam `emerald-400`/`emerald-500` como verde de terminal
sobre fundo escuro. É idioma legítimo — console é verde fosforado desde o VT100 — e mesmo assim
saiu:

> **O verde fosforado é idioma de terminal, mas neste produto o verde acabou de ser reservado para
> "conforme" — e num painel onde o vizinho do INFO é o ERROR vermelho e o WARN âmbar, verde lê como
> "passou", que é exatamente o que o nível INFO não afirma.**

O trio `ERROR`/`WARN`/`INFO` **é uma escala de severidade**, e o INFO é o degrau mais baixo dela,
não um desfecho bom. Ficou `danger` / `warning` / **`brand`** — a mesma decisão que o informe da
seção "Atualizações do Sistema" recebeu, em dois lugares distintos do produto. Medido no navegador,
com a transparência `/20` composta pelos ancestrais:

```
ERROR  #ff6467 sobre #391526   5,13:1  ✓        (danger-400 sobre danger-500/20)
WARN   #ffb900 sobre #3a2b1b   7,17:1  ✓        (warning-400 sobre warning-500/20)
INFO   #52a1f4 sobre #142e54   4,99:1  ✓        (brand-400 sobre brand-500/20)
```

**Em botão sólido de fundo escuro o piso é `brand-600`, não `brand-500`.** A regra da Fase 2 diz
"ação em fundo escuro → `brand-500`/`brand-400`", mas ela vale para texto e ícone. Os dois botões
dos consoles têm **texto branco**: sobre `brand-500` isso daria 2,54:1. Ficaram
`bg-brand-600 hover:bg-brand-500` — 5,20:1 em repouso, e o hover **clareia**, como no login.

### `waiting_internal`: uma cor no produto inteiro

O achado aberto desde a Fase 2 — `purple` em `App.tsx:1120` e `Home.tsx:439`, `warning` em
`ProjectsList.tsx` — foi resolvido: **o âmbar venceu**. Três razões, nesta ordem:

1. **Roxo não existe no vocabulário do produto.** Não tem papel atribuído em nenhuma das sete
   fases; é uma cor órfã que sobrou do desenho original.
2. **"Aguardando Interno" é literalmente uma pendência** — alguém do nosso lado precisa agir. Âmbar
   é o papel canônico de atenção, e o irmão `waiting_customer` já era âmbar nas três telas.
3. **`ProjectsList` já estava em âmbar desde a Fase 2**, então unificar no âmbar mexe em duas telas
   em vez de três.

Na mesma passada, `analysis_in_progress` saiu de `blue` para **`brand`** nas três telas — o achado
que a Fase 2 registrou como "vizinho do azul da marca, revisar quando a densidade de azul
aumentar". Ele não era só vizinho: **"em progresso" é marca** pela escala fixada desde a Fase 3. A
escala de status de projeto agora é idêntica em `App.tsx`, `Home.tsx` e `ProjectsList.tsx`:

```
RASCUNHO             slate-100 / slate-700    9,45:1
ANÁLISE EM ANDAMENTO brand-50  / brand-700    6,90:1     (era azul genérico)
AGUARDANDO INTERNO   warning-50/ warning-700  4,85:1     (era ROXO em 2 das 3 telas)
CONCLUÍDO            success-50/ success-700  5,09:1
```

### Os 9 hex: 3 resolvidos, 6 adiados com o motivo escrito

| Onde | O que era | Desfecho |
|---|---|---|
| `App.tsx:924` | `bg-[#f8fafc]`, o fundo da aplicação inteira | → `bg-slate-50`, **pixel-idêntico** |
| `AdminConsole.tsx:3005` | `"#cccccc"`, amostra de cor sem valor | → `var(--color-neutral-300)` (`#cad5e2`) |
| `BugReportModal.tsx:79` | `"#b23b3b"` inline, texto de erro | → `var(--color-danger-700)`, **6,42:1** |
| `App.tsx:352/353/464/465` · `AdminConsole.tsx:2987/3051` | `#059669`/`#10b981` | **adiados para a Fase 8** |

**`bg-slate-50` foi confirmado pintando o pixel, não presumido**: computa `#f8fafc`, o mesmo valor
do literal que substituiu. É a única troca da fase com zero diferença de pixel.

**Por que os seis foram adiados — e não é preguiça.** Eles são o *default* da cor de marca por
tenant (`brandPrimaryColor`/`primary_color`). `BrandingSettings.primaryColor` é `String` **sem
default no schema**: os literais do código são o fallback de leitura e o default de criação de um
estilo novo. Trocá-los agora, sem a migration da Fase 8, criaria **duas verdades** —
um tenant com `#059669` já gravado (valor que ele nunca escolheu) continuaria verde, enquanto um
tenant sem registro nasceria azul — e a tela "Identidade Visual" mostraria azul enquanto o DOCX
gerado, que lê do banco por `resolveBrandingHeader`, sairia verde. A troca certa é
`código + migration ancorada no valor real por linha`, que é escopo declarado da Fase 8
([[feedback_migration_seed_nunca_afrouxa_default]]). Fazer metade agora é pior que não fazer.

O `#b23b3b` **não** ficou de fora, ao contrário do que o levantamento supunha: o modal não usa
Tailwind, mas CSS var resolve em `style={{}}` inline como resolve em atributo SVG (Fases 5 e 6).
Custou uma linha e subiu o contraste de ~5,3:1 para 6,42:1.

### Como as seções fora do baseline e os dois modais foram verificados

O Admin Console tem **11 seções** e o baseline fotografa **4** (`overview`, `users`, `branding`,
`audit`). As outras sete — `ai`, `templates`, `approval_flow`, `subscription`, `system_updates`,
`integrations`, `storage` — e os **dois modais**, que o baseline **nunca** cobre, foram abertos um
a um no navegador e capturados em pasta separada (`--out /tmp/fase7/...`, sem tocar no baseline).
São **13 superfícies**, e cada uma foi capturada **duas vezes**: com `git stash` + `npm run build`
no HEAD para o "antes", e de novo com a mudança. As 13 mudaram, e a troca dominante de cada uma é
exatamente a que a fase existe para fazer — `#009966` (emerald-600) → `#236cc7` (brand-600) em oito
delas.

A varredura mediu **19.709 elementos com cor** classificados **por matiz do pixel pintado**, e o
resultado é o critério de aceite: **zero `<button>` ou `<a>` com fundo verde ou âmbar** nas 13
superfícies.

**O dado de dev cobre menos da metade da matriz, e o banco disse isso em segundos:**

- **os 8 projetos estão TODOS em `draft`** — os badges `analysis_in_progress`, `waiting_internal` e
  `completed` que esta fase acabou de unificar **nunca renderizam** com dado real;
- as **3 linhas do histórico de atualização estão TODAS em `failed`**, e o estado atual é `failed`
  sem agendamento: dos onze pontos de cor da seção, cinco não aparecem;
- as **5 versões de prompt estão TODAS ativas** — o botão "Ativar" (que era âmbar-como-ação) não
  renderiza;
- a tabela `brand_styles` está **vazia** — a amostra de cor e a lixeira não renderizam;
- só **4 PDFs e 2 TXTs** entre os documentos: **4 dos 5 badges de tipo** nunca aparecem.

O que o banco não cobre foi medido em **33 amostras sintéticas com as classes reais do
componente**, montadas dentro da aplicação viva — e todas passam AA. O que existe em repouso foi
medido no elemento vivo; o que só existe em interação, com interação de verdade: `page.hover()` no
primário (`#236cc7` → `#1a539e`, 5,20 → 7,57), no atalho de configuração (borda `#f1f5f9` →
`#77b8f8`) e no "Apagar" fluxo (invertendo para sólido `#e7000b` com texto branco), e **foco real
de campo** com o anel em `#288bf9` (`brand-500`), lido de `--tw-ring-color`.

Os quatro estados que **nem o banco nem a interação alcançam** — o hover do "Remover" provedor de
IA (`hover:bg-danger-50`, `hover:border-danger-300`, `hover:text-danger-700`) e o do "Ativar"
versão (`hover:bg-brand-100`) — foram provados **procurando as regras no CSS construído**, como a
Fase 3 fez: as 12 regras de `hover:` da fase existem em `dist/assets/*.css`.

### Um achado corrigido: os chips da topbar PASSAM AA

A Fase 5 registrou os chips "ADD-ON" e "IA/KB" da topbar em **2,46:1 e 1,61:1** e mandou para a
Fase 9. **Medidos com a transparência composta pelos ancestrais, eles dão 5,68:1 e 7,49:1.**

O mecanismo do erro antigo: os chips são `text-*-300/400` sobre `bg-*-500/10`, e esse `/10` vive
sobre a **topbar escura**. Medir o texto claro contra o `/10` renderizado sobre **branco** (que é o
que um medidor sem composição faz) dá exatamente ~1,6:1. O fundo real composto é `#112340`, não
`#e8f2ff`. **Achado retirado da Fase 9** — e vale a regra geral: cor com alfa só pode ser medida
subindo pelos ancestrais até encontrar opacidade 1.

### Como ficou provado

`npm run test:visual` deu **36/36 verdes antes de qualquer mudança** — a fase começou de um estado
provadamente são — e **36/36 de novo** com o baseline regravado, tolerância intacta em
`maxDiffPixels: 0`. No próprio dev: `npm run lint` limpo, `npm run build` completo e `npm run test`
com **16 arquivos e 98 testes** passando.

**20 das 36 imagens do baseline foram regravadas** e revisadas uma a uma:

- as **4 telas admin × 2 larguras** (8 imagens) — `admin-users` mudou 129.143 px, quase tudo
  `#ecfdf5 → #ebf6ff`: são os ~60 chips de permissão dos 3 perfis;
- as **6 sub-abas do Workspace no desktop** (6 imagens), todas com os mesmos 1.276 px em
  `y[587,618]` — o badge PDF do painel de documentos, `#fef2f2 → #d2eafe`. É a única mudança fora
  dos sete arquivos, e é consequência direta da decisão da família de badges;
- **`knowledge-base`, `poc` e `pricing`** nas duas larguras (6 imagens), com ~915 px em `y[18,35]`
  (desktop) e `y[114,131]` (telefone): o chip "IA/KB" da topbar, `#8ec5ff → #77b8f8`.

**`home.png` apareceu "modificada" e a comparação pixel a pixel deu 11 px com Δmax=3** — delta ≤1
por canal, o ruído de antialiasing do Chromium. **Restaurada do HEAD.** Aconteceu nas Fases 3, 4,
5, 6 e agora 7: é regra, não exceção. Diferença de tamanho de arquivo nunca prova mudança de
imagem.

### Duas correções de contraste que só a medição encontrou

O `text-red-400` de dois botões destrutivos **em fundo claro** foi traduzido para `danger-400` na
primeira passada, preservando o tom — e a medição mostrou **2,89:1** (ícone de excluir comunicado,
`AdminConsole:1195`) e **2,76:1** (o "×" de excluir vertical, `:2337`, texto de 12px/600). Abaixo
do piso de 3:1 de objeto gráfico e dos 4,5:1 de texto. Subiram para `danger-600` (**4,77:1**).

Os `danger-400` que **ficaram** são os de fundo **escuro** — `App.tsx:1084` na topbar e o `ERROR`
do console (5,13:1) — onde claro-sobre-escuro é justamente o certo.

### Cuidados que só apareceram executando

- **`Escape` não fecha os modais do produto.** O overlay `fixed inset-0` continua no DOM e
  **intercepta o clique seguinte**, com o erro apontando para o elemento errado ("`<p>` … subtree
  intercepts pointer events"). Fechar pelo botão de fechar; e gravar o resultado da varredura
  **a cada passo**, não no fim, senão uma falha no último passo joga fora a rodada inteira.
- **Script fora da raiz do repositório não resolve módulo do repositório** — a lição da Fase 6
  vale para `pngjs` e `@playwright/test` tanto quanto para `@prisma/client`. `node /tmp/x.mjs`
  falha com `ERR_MODULE_NOT_FOUND`.
- **Prisma 7: os nomes do cliente são camelCase, os do banco são snake_case.** `isActive` (não
  `is_active`), `defaultTemplate`, `logLevel`, `originalFilename`, `storageMode`,
  `lastAttemptStatus`. Ler o `schema.prisma` antes de escrever o `select`, terceira fase seguida
  em que isso custa uma rodada.
- **Script temporário na raiz quebra `npm run lint`.** O `tsc --noEmit` varre a raiz inteira, e um
  script de sondagem com um nome de campo errado reprova o gate sem que nada do produto esteja
  errado. Apagar os scripts antes de rodar os gates finais — e não confundir o erro deles com erro
  do código.
- **Classe que não existe no CSS construído volta preta na amostra sintética.** `text-danger-500`
  mediu `#000000` (20,07:1!) porque nenhum arquivo do produto a usa. O número absurdo é o sinal —
  a lição da Fase 3, agora com o sintoma nomeado.
- **`.git/index` não estava root-owned** — quarta fase seguida com a varredura limpa
  (`find . -path ./node_modules -prune -o -not -user sakae -print` vazio antes e depois).
- **Orçamento de login: 1 tentativa gastada em 9 execuções de navegador.** O
  `.auth/capture-state.json` foi reaproveitado em **todas** as rodadas de verificação — a melhor
  marca do programa (a Fase 6 gastou 4 em 7). Testar o estado salvo antes de logar paga sempre.

### Achados registrados, fora do escopo desta fase

- **O primário `bg-slate-900` de novo, agora na quarta tela.** "Atualizar Agora", o botão que
  dispara a atualização do sistema, é cinza-escuro ao lado de um cartão cuja informação principal
  está em azul de marca. É a mesma família do "Salvar" das Fases 4 e 5, do par de modo da Fase 6 e
  do "Adicionar Item" que a Fase 3 corrigiu. **Fase 9.**
- **As 4 barras do "Pipeline de Status" da Home reprovam o piso de 3:1 contra a trilha
  `slate-100`** — e a que esta fase trocou é a **única** que passa: `brand-500` **3,12:1**,
  `warning-500` 1,95:1, `success-500` 2,26:1, `slate-400` 2,40:1. Manter o degrau `-500` preservou
  a escala herdada da Fase 2; subir um só a desequilibraria. A escala inteira é decisão de
  desenho. **Fase 9.**
- **"Precisa de Informação" segue como a Fase 3 o deixou.** `not_enough_information` só aparece em
  `Workspace.tsx` (como `<option>` do seletor, linha 622) — o ramo faltante da cadeia de
  `compliance_status` está na Área de Trabalho, **não** no Admin Console. **Fase 9**, como o
  escopo previa.
- **A coluna "Prioridade" da tabela de oportunidades** também vive no `Workspace.tsx`. **Fase 9.**
- **Erro exibido como aviso** (6 lugares), o `disabled:opacity-60` do primário e a
  **Precificação não responsiva a 390px** seguem como as Fases 4, 5 e 6 os deixaram. **Fase 9.**
- **Os chips "ADD-ON" e "IA/KB" saem da lista da Fase 9** — passam AA (5,68:1 e 7,49:1), medidos
  com o alfa composto.

---

## Fase 8 — DOCX + branding por tenant

**Escopo:**
- **Os 6 literais hex que a Fase 7 adiou** (`App.tsx:352/353/464/465`, `AdminConsole.tsx:2987/3051`)
  saem junto com a migration, nunca antes: trocar o fallback do código sem migrar as linhas cria
  duas verdades (tenant com `#059669` gravado fica verde, tenant sem registro nasce azul) e faz a
  tela divergir do DOCX gerado.
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
