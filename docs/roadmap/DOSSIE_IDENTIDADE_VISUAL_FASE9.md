# Dossiê da Fase 9 — validação visual, contraste e prontidão de release

**Programa:** identidade visual do Pre-Sales Compliance Platform (`docs/roadmap/IDENTIDADE_VISUAL_2026-08.md`)
**Data:** 25/08/2026 · **Branch:** `feature/identidade-visual-fase9-validacao-release`
**Estado:** validação concluída. **Nenhuma tag, nenhum Release, nenhum apply foi feito** — esta
fase para no gate humano.

---

## 1. Veredito

O programa fez o que dizia que faria, e nada além disso. As **36 imagens** do baseline mudaram
entre o produto verde (`906668f`, Fase 0) e o produto azul de hoje; a transição dominante em 32
delas é verde/âmbar → azul de marca, e cada exceção tem explicação escrita. Os **sete comandos**
do critério de aceite passam por execução real no servidor de desenvolvimento. A auditoria de
contraste mediu **1.752 pares pintados no navegador**: nenhum par que usa cor de marca reprova, e
as 14 reprovações remanescentes são todas da **escala de cinza herdada**, comprovadamente anteriores
ao programa.

Esta fase também **corrigiu 55 pontos** que oito fases haviam registrado como pendência — incluindo
dois defeitos semânticos reais que ninguém tinha visto: "Precisa de Informação" era pintado de
vermelho de não-conformidade, e a coluna Prioridade da tabela de oportunidades pintava as três
prioridades de verde.

---

## 2. O antes e o depois, tela a tela

Comparação pixel a pixel entre `git show 906668f:docs/visual-baseline/…` (o retrato do produto
verde) e o baseline de hoje. Não é `test:visual` — aquele compara o vivo com o baseline atual, que
já foi regravado fase a fase; esta é a comparação que o programa inteiro existe para permitir.


**Desktop 1440×900**

| tela | px alterados | % da tela | transição dominante de matiz | troca de cor com mais pixels |
|---|---:|---:|---|---|
| `admin-audit` | 43.277 | 3.34% | azul -> azul (36.9%) | `#009966->#236cc7` (6.170 px) |
| `admin-branding` | 238.640 | 18.41% | azul -> quase-branco (28.4%) | `#f8fafc->#ffffff` (40.374 px) |
| `admin-overview` | 38.335 | 2.96% | azul -> azul (30.6%) | `#009966->#236cc7` (2.759 px) |
| `admin-users` | 159.059 | 12.27% | verde -> azul (68.3%) | `#ecfdf5->#ebf6ff` (77.548 px) |
| `approval` | 30.745 | 2.37% | azul -> azul (25.1%) | `#009966->#007a55` (1.758 px) |
| `home` | 49.922 | 3.85% | verde -> azul (28.5%) | `#009966->#236cc7` (8.925 px) |
| `knowledge-base` | 31.923 | 2.46% | verde -> azul (39.7%) | `#009966->#236cc7` (10.353 px) |
| `login` | 1.295.998 | 100% | azul -> azul (98.3%) | `#020618->#03102c` (297.936 px) |
| `poc` | 22.105 | 1.71% | azul -> azul (28.4%) | `#009966->#236cc7` (3.169 px) |
| `pricing` | 24.471 | 1.89% | verde -> azul (31.5%) | `#009966->#236cc7` (5.180 px) |
| `projects` | 23.156 | 1.79% | azul -> azul (29.6%) | `#009966->#236cc7` (3.481 px) |
| `proposals` | 31.068 | 2.4% | azul -> azul (32.8%) | `#eff6ff->#ebf6ff` (2.398 px) |
| `workspace-bom` | 48.242 | 3.72% | verde -> azul (34.6%) | `#009966->#236cc7` (13.603 px) |
| `workspace-explorer` | 45.544 | 3.51% | verde -> azul (36.4%) | `#009966->#236cc7` (13.523 px) |
| `workspace-proposal-builder` | 80.596 | 6.22% | verde -> azul (66%) | `#009966->#236cc7` (39.245 px) |
| `workspace-requirements` | 42.258 | 3.26% | verde -> azul (39.2%) | `#009966->#236cc7` (13.497 px) |
| `workspace-risks` | 40.538 | 3.13% | verde -> azul (41%) | `#009966->#236cc7` (13.525 px) |
| `workspace-summary` | 101.190 | 7.81% | verde -> azul (36.8%) | `#ecfdf5->#ebf6ff` (18.552 px) |

**Telefone 390×844**

| tela | px alterados | % da tela | transição dominante de matiz | troca de cor com mais pixels |
|---|---:|---:|---|---|
| `admin-audit` | 20.443 | 6.21% | azul -> azul (42.9%) | `#0f172b->#236cc7` (3.668 px) |
| `admin-branding` | 18.097 | 5.5% | azul -> azul (29.7%) | `#ffffff->#0f172b` (1.435 px) |
| `admin-overview` | 16.776 | 5.1% | azul -> azul (32.9%) | `#ffffff->#0f172b` (1.435 px) |
| `admin-users` | 33.083 | 10.05% | verde -> azul (55.8%) | `#ecfdf5->#ebf6ff` (10.600 px) |
| `approval` | 13.304 | 4.04% | azul -> azul (27.2%) | `#ffffff->#0f172b` (1.435 px) |
| `home` | 22.432 | 6.81% | azul -> azul (43.8%) | `#020618->#236cc7` (4.637 px) |
| `knowledge-base` | 25.009 | 7.6% | verde -> azul (58.5%) | `#009966->#236cc7` (12.431 px) |
| `login` | 329.158 | 100% | azul -> azul (94.3%) | `#0f172b->#061a3d` (116.172 px) |
| `poc` | 15.090 | 4.58% | verde -> azul (28.7%) | `#009966->#236cc7` (3.169 px) |
| `pricing` | 11.960 | 3.63% | azul -> azul (27.7%) | `#ffffff->#0f172b` (1.435 px) |
| `projects` | 13.090 | 3.98% | verde -> azul (32.1%) | `#009966->#236cc7` (3.481 px) |
| `proposals` | 15.015 | 4.56% | azul -> azul (32.7%) | `#ffffff->#0f172b` (1.435 px) |
| `workspace-bom` | 11.546 | 3.51% | quase-branco -> azul (30.7%) | `#ffffff->#f8fafc` (1.675 px) |
| `workspace-explorer` | 11.506 | 3.5% | quase-branco -> azul (30.8%) | `#ffffff->#f8fafc` (1.675 px) |
| `workspace-proposal-builder` | 11.482 | 3.49% | quase-branco -> azul (30.8%) | `#ffffff->#f8fafc` (1.675 px) |
| `workspace-requirements` | 11.486 | 3.49% | quase-branco -> azul (30.8%) | `#ffffff->#f8fafc` (1.675 px) |
| `workspace-risks` | 11.558 | 3.51% | quase-branco -> azul (30.6%) | `#ffffff->#f8fafc` (1.675 px) |
| `workspace-summary` | 25.968 | 7.89% | verde -> azul (55.5%) | `#009966->#236cc7` (11.042 px) |

**Total: 2.964.070 pixels alterados em 36 imagens; nenhuma ficou idêntica.**

### O que cada diferença é

Cada troca foi classificada **por matiz do pixel**, não por leitura de código, e as regiões foram
localizadas por caixa envolvente antes de receberem um nome:

- **`#009966 → #236cc7` (emerald-600 → brand-600)** é a troca com mais pixels em 11 das 18 telas de
  desktop: é o botão primário, a aba ativa, o ícone de identidade e o foco de campo.
- **`#ecfdf5 → #ebf6ff` (emerald-50 → brand-50)** domina `admin-users` (77.548 px): são os ~60 chips
  de permissão dos três perfis.
- **`login` mudou 100% dos pixels** — a superfície inteira saiu de `slate-950` para `brand-950`
  (`#020618 → #03102c`, 297.936 px), o botão "Entrar" saiu do verde e o cartão trocou o título
  "Commercial Assistant AI" pelo **wordmark oficial PRESALES**, com a Cloud Mountain preservada no
  rodapé "POWERED BY".
- **`#ffffff → #0f172b`, ~1.400 px espalhados em todas as telas autenticadas**: é a substituição da
  logomarca na barra superior — a montanha Cloud Mountain deu lugar ao símbolo do produto.
- **`#fe9a00 → #90a1b9` (amber-500 → slate-400), 5.108 px na Home**: o status `draft` deixou de ser
  âmbar (que significava atenção) e virou neutro, nas três telas onde aparecia.
- **`#eff6ff → #fffbeb` (blue-50 → amber-50)** em `workspace-bom` e `proposals`: "Sugestão via busca
  web" e a proposta "ENVIADA" passaram a ser pendência, não informação azul genérica.
- **`#009966 → #007a55` e `#e7000b → #c10007`** em `approval`: verde e vermelho que **ficaram** na
  sua família e só escureceram um degrau para passar o contraste — a prova de que a substituição não
  foi cega.
- **`admin-branding` mudou 18,41%** porque ganhou o interruptor "aplicar à interface" da Fase 8, que
  empurrou a coluna inteira para baixo.

Seis telas foram inspecionadas visualmente lado a lado, não só medidas: `home`, `login`,
`workspace-bom`, `approval`, `admin-users` e `workspace-requirements`.

---

## 3. Auditoria de contraste

**Ferramenta nova, versionada:** `scripts/audit-contrast.ts`, rodável com `npm run audit:contrast`.
Três decisões a fazem valer alguma coisa:

1. **Mede a cor pintada, não a classe.** Cada valor computado é pintado num canvas 1×1 pelo próprio
   navegador e lido de volta em pixel — é assim que `oklch()` (como voltam os tokens semânticos) e
   `rgb()` (como voltam os da marca) chegam ao mesmo lugar sem conversão à mão.
2. **Compõe o alfa subindo pelos ancestrais** até encontrar opacidade 1. Foi a falta disso que
   produziu, na Fase 5, dois achados falsos de 2,46:1 e 1,61:1 nos chips da barra superior.
3. **A conta é `contrastRatio` de `src/brandTheme.ts`** — a mesma função que o servidor usa para
   aceitar ou recusar a cor de um tenant. Duas implementações da mesma regra seriam duas verdades.

Além das 17 telas vivas, a ferramenta monta **amostras sintéticas com as classes reais do código**
dentro da aplicação viva, para alcançar o que o banco de desenvolvimento não renderiza. Combinação
com dois `text-*` na mesma string é descartada (são ramos alternativos de um ternário, nunca
coexistem), e um par com texto preto e razão absurda é sinalizado como classe ausente do CSS
construído, em vez de virar um "passou".

**Resultado:** 1.752 amostras · **88 pares únicos** · **14 abaixo do piso**.

### O que passa (amostra dos pares que sustentam o vocabulário)

| par | razão | papel |
|---|---:|---|
| `brand-600` sobre branco | 5,20:1 | ação primária em fundo claro |
| `brand-700` sobre branco | 7,57:1 | hover da ação primária |
| `brand-50` / `brand-700` | 6,90:1 | ação secundária e badge "em análise" |
| `brand-100` / `brand-800` | 9,30:1 | badge de tipo de arquivo |
| `success-50` / `success-700` | 5,09:1 | conforme / aprovado |
| `warning-50` / `warning-700` | 4,85:1 | pendência |
| `danger-50` / `danger-700` | 5,87:1 | não conforme |
| `slate-100` / `slate-700` | 9,45:1 | rascunho / neutro |
| `brand-400` sobre `brand-500/20` | 4,99:1 | nível INFO do console escuro |
| `slate-400` sobre `brand-950` | 6,53:1 | rodapé do login (corrigido nesta fase) |

### O que ainda reprova — e por que não foi corrigido aqui

**Nenhuma das 14 reprovações usa cor de marca.** Todas vêm da escala de cinza herdada, e a prova é
contável: `text-slate-400` aparecia **371 vezes** no código do produto verde (`906668f`) e aparece
376 hoje — as 5 novas são justamente correções desta fase, que **melhoram** o contraste em superfície
escura. O valor do token não mudou em nenhuma fase.

| família | pior razão | volume | decisão |
|---|---:|---:|---|
| `text-slate-400` como texto auxiliar sobre fundo claro | 2,13:1 | ~236 renderizações, 17 telas | **registrado, não corrigido** |
| `text-slate-500` sobre `slate-100`/`brand-50` | 4,35:1 | 46 renderizações | **registrado, não corrigido** |
| borda de campo (`slate-200`/`slate-300`; `brand-800` no login) | 1,23:1 | 66 controles | **registrado, não corrigido** |
| botão desabilitado (`disabled:opacity-40/60`) | 1,38:1 | 10 pontos | **decidido: manter a isenção** |
| `bg-success-600` + ícone branco (✓ da caixa de seleção) | 3,65:1 | 1 | **passa**: é objeto gráfico, piso 3:1 |

**Por que as três primeiras ficaram de fora desta fase, com o número na mão:** mudar `text-slate-400`
exige decisão por chamada, não substituição cega — sobre a barra superior escura, sobre o rodapé e
sobre o login o mesmo token dá 6,5:1 a 7,7:1 e trocá-lo **pioraria** o contraste. São ~310 pontos a
decidir um a um, e o efeito é mudar o tom de todo texto secundário do produto, em todas as telas.
Isso altera a hierarquia visual que o dono aprovou e não é repaletização de marca: é uma fase
própria. A recomendação está no item 8.

**A decisão sobre o botão desabilitado, escrita:** a WCAG 1.4.3 isenta explicitamente controles
desabilitados do critério de contraste, e o produto tem 10 pontos apoiados nessa isenção. Manter é
legítimo; o lugar certo para revisitar é a primitiva `Button` da Trilha B (fase E0), onde o estado
desabilitado passa a existir num só lugar em vez de dez.

---

## 4. Desfecho de cada achado aberto

Os dez que oito fases acumularam, mais quatro que esta fase encontrou. **55 pontos de código
alterados**, todos por aplicador ancorado `(arquivo, linha, texto, contagem)` que aborta sem gravar
se uma só âncora não casar — oitava fase seguida com esse método.

| # | achado | desfecho |
|---|---|---|
| 1 | **primário `bg-slate-900`/`slate-800` em quatro telas** | **CORRIGIDO — e era maior do que o registrado.** O levantamento encontrou **20** botões de ação sólida sobre fundo claro em cinza-escuro, contra 84 já em `brand-600`: mesmo papel, duas cores, às vezes na mesma tela ("Criar Perfil" cinza ao lado de "Criar Vertical" azul). Todos foram para `brand-600`/`hover:brand-700`. O par de modo da Precificação (`PricingProjectSheet.tsx:346/359`) virou seleção em marca. Em `AdminConsole.tsx:3248/3252` a hierarquia estava invertida — "Salvar" era `slate-200` e "Validar" `slate-800`, o secundário pesando mais que o primário: agora "Salvar" é primário em marca e "Validar" é secundário `brand-50/brand-700`. **Não** foram tocadas as superfícies escuras estruturais (barra superior, rodapé, barra lateral do Admin, cabeçalho de modal, balão do Gantt, véu `fixed inset-0`): ali o cinza-escuro não é ação. |
| 2 | **4 barras do "Pipeline de Status" abaixo de 3:1** | **CORRIGIDO, escala tomada inteira.** Medido contra a trilha `slate-100` com `contrastRatio`: no degrau 500 três das quatro reprovavam (1,95 / 2,26 / 3,12) e no degrau 600 o âmbar **ainda** reprovava (2,92). O degrau **700** é o único em que as quatro passam — e é exatamente o tom que o rótulo do badge de cada status já usa. Ficou `brand-700` 6,91:1 · `success-700` 4,90:1 · `warning-700` 4,59:1. A barra de rascunho ficou em **`slate-500` (4,35:1)**, e não em 700: a inspeção visual da tela mostrou que o cinza escuro passava o contraste mas invertia a hierarquia — o estado mais neutro virava o elemento mais escuro da tela. |
| 3 | **"Precisa de Informação" (`not_enough_information`)** | **CORRIGIDO — era um defeito semântico, não um buraco.** O seletor tem quatro opções e a cadeia de cor tinha três ramos: o quarto caía no `else` e era pintado com `danger` — **falta de informação aparecia como não-conformidade**. Ganhou ramo próprio, neutro (`slate-100`/`slate-700`, 9,45:1), coerente com o servidor, que já exclui esse status dos dois lados do cálculo de conformidade (`server/routes/dashboard.ts:24`): não é um desfecho ruim, é um requisito ainda não avaliado. Visível no baseline recapturado. |
| 4 | **coluna "Prioridade" da tabela de oportunidades** | **CORRIGIDO — também era defeito.** As três prioridades eram pintadas de `success-700`/`success-50`: alta, média e baixa saíam **todas verdes**, e a cor não dizia nada. Passou a escala de intensidade em marca — alta `brand-100/brand-800` (9,30:1), média `brand-50/brand-700` (6,90:1), baixa `slate-100/slate-700` (9,45:1). Não usa a escala de severidade da tabela de requisitos de propósito: ali prioridade alta é risco (`danger`), aqui é oportunidade comercial, e pintar de vermelho uma boa oportunidade inverteria o significado. |
| 5 | **erro exibido como aviso** | **CORRIGIDO, e eram 10, não 6.** Toda mensagem de falha (`saveError`, `generateError`, `formError`, `createError`, `deleteError`, `reportError`, `error`) saiu de `warning-50/200/900` para `danger-50/200/900`, em POC, Gantt, Casos de Teste, Base de Conhecimento e no assistente de novo projeto. |
| 6 | **`disabled:opacity-60` no primário** | **RECUSADO, com motivo.** A WCAG 1.4.3 isenta controles desabilitados. Medido em tela: o "Remover Logo Personalizada" desabilitado dá 1,38:1. Manter a isenção é legítimo e mudar exige um tratamento novo de estado desabilitado — decisão de design system, cujo lugar é a primitiva `Button` da fase E0. |
| 7 | **Precificação não responsiva a 390px** | **RECUSADO, fora de escopo.** É estrutura de layout, não cor, e é anterior a este programa (a tabela transborda e o selo de cotação sobrepõe o cabeçalho no baseline da Fase 0 exatamente como hoje). Corrigir é redesenhar a tela para telefone, o que o plano lista em "fora de escopo — redesenho de layout". Fica registrado como tarefa própria. |
| 8 | **`accent_color` não tem papel na interface** | **DECIDIDO: continua sem papel — e a decisão rendeu uma correção.** A rampa inteira é derivada do primário; dar um segundo eixo de cor arbitrária à interface reabriria o problema de contraste em pares que a guarda não cobre. Mas a auditoria encontrou a consequência do acento onde ele **existe**: a pré-visualização da identidade visual pinta `text-white` sobre o gradiente `primary → accent`, e com `tenant_default` (accent `#ffffff`) isso mediu **1,00:1 — branco sobre branco**. **CORRIGIDO**: a cor do rótulo passa a seguir a pior das duas pontas, com a mesma função de contraste do resto do produto. |
| 9 | **rampa copiada em dois lugares** | **MANTIDO, deliberado.** `src/index.css` e `src/brandTheme.ts` guardam os mesmos 11 valores porque o servidor também deriva rampa e ler CSS no backend seria pior. Está travado por teste que lê o CSS real, então divergir vira teste vermelho. Só vale eliminar se o projeto ganhar um passo de build que gere um do outro. |
| 10 | **chips "ADD-ON" e "IA/KB"** | **JÁ RETIRADO na Fase 7**, não reaberto. A auditoria confirma: passam AA com o alfa composto. |
| **A** | **escala de cinza do texto auxiliar** (novo) | **REGISTRADO com número.** `text-slate-400` dá 2,13–2,63:1 em ~236 renderizações e `text-slate-500` dá 4,35:1 sobre `slate-100` em 46. Anterior ao programa (371 ocorrências já no produto verde). Ver item 8. |
| **B** | **borda de campo abaixo de 3:1** (novo) | **REGISTRADO.** `slate-200` sobre branco dá 1,23:1 em 60 controles; `slate-300` dá 1,42–1,49:1; no login, `brand-800` sobre `brand-950` dá 1,49:1. É o indicador visual do campo — WCAG 1.4.11. Anterior ao programa e sistêmico. Ver item 8. |
| **C** | **barra de progresso da Base de Conhecimento** (novo) | **CORRIGIDO.** `brand-500` sobre trilha `brand-100` dava **2,75:1**, abaixo do piso — e **nenhuma varredura de tela viva encontraria**, porque a barra só existe durante uma análise em andamento, que o banco de desenvolvimento não tem. Apareceu na medição das combinações do código. Junto com ela subiram para `brand-600` as barras equivalentes do Gantt e dos Casos de Teste (3,12:1, raspando), fechando a decisão que a Fase 7 tomou para a barra de atualização do sistema. |
| **D** | **indicadores e rótulos pontuais** (novo) | **CORRIGIDO.** "Powered by" no login (2,26:1 → 6,53:1), papel do usuário no rodapé (3,74:1 → 6,78:1), três rótulos da barra lateral do Admin (4,23:1 → 7,66:1), badge "PENDENTE" (3,86:1 → 8,40:1), etiqueta "HOJE" do Gantt (3,81:1 → 4,77:1) e os pontos da escala do quadro de POC (1,95 e 2,40 → 4,59 e 4,76:1). |

---

## 5. Os sete comandos do critério de aceite

Todos executados no próprio `home-comercial-01`. O gate é execução real, nunca `gh pr checks`.

| comando | resultado |
|---|---|
| `npm run lint` | limpo (`tsc --noEmit`) |
| `npm run test` | **18 arquivos, 123 testes** |
| `npm run build` | completo |
| `npm run test:visual` | **36/36**, com `maxDiffPixels: 0` intacto |
| `npm run regression:approval-rbac` | **REGRESSION PASSED** |
| `npm run regression:workspace-documents` | **REGRESSION PASSED** |
| `npm run regression:admin-console` | **ADMIN CONSOLE REGRESSION PASSED** |

**Os três de regressão exigiram trabalho para poder rodar — e o achado vale o registro.** Eles
nunca haviam sido executados neste programa, e na primeira tentativa os três falharam no primeiro
passo com `Invalid credentials`. A causa não tem relação com cor: os scripts autenticam contas de
seed com a senha demo, e este servidor roda `APP_RUNTIME_MODE=production`, que recusa essa senha de
propósito (`server/config/runtime.ts`). O próprio workflow do CI documenta isso — ele define
`APP_RUNTIME_MODE: demo` com um comentário explicando que sem isso os três passos falhariam.
Ou seja: **os três eram inexecutáveis fora do CI, por desenho**, desde antes deste programa (a
credencial embutida é a mesma no commit `906668f`), e esta fase não tocou um único arquivo de
servidor.

Em vez de apenas registrar, a fase os tornou executáveis: as 109 URLs fixas viraram
`${REGRESSION_BASE_URL:-http://127.0.0.1:3000}` — **o default preserva exatamente o comportamento
do CI** — e os três rodaram contra uma instância descartável em modo demo (Postgres e Redis em
contêineres temporários, banco próprio semeado do zero, aplicação numa porta alta). Os três
passaram. O ambiente foi derrubado no fim, os dois arquivos que a regressão gerou em `uploads/`
foram removidos por nome, e o banco de desenvolvimento terminou com exatamente as mesmas contagens
com que começou (20 usuários, 8 projetos, 6 documentos, 8 propostas).

**Oitavo comando, novo:** `npm run audit:contrast` — a auditoria do item 3, versionada e repetível.
Sai com código 1 enquanto houver par abaixo do piso, então serve de gate quando o produto decidir
fechar as três famílias registradas.

---

## 6. Capturas dos manuais — o que foi confirmado e o que falta

**Confirmado, não presumido:**

1. **As 31 imagens de `docs/manuais/screenshots/` estão mesmo mentindo.** `03-home.png` foi aberta e
   inspecionada: mostra a logomarca Cloud Mountain, a aba ativa sublinhada em verde, os quatro
   ícones de KPI em quatro cores, as barras de setor em verde, "RASCUNHO" em âmbar e "Ir para Área
   de Trabalho" em cinza-escuro. É o produto de antes das nove fases.
2. **O tenant de demonstração está pronto.** `manual_demo_tenant` tem `primary_color #236cc7`,
   `accent_color #288bf9` e `apply_to_ui = true` no banco; e a rampa derivada de `#236cc7` é
   **idêntica byte a byte** à rampa oficial nos onze degraus (Δ máximo 0 por canal, medido com
   `deriveBrandRamp` contra `REFERENCE_BRAND_RAMP`). A interface desse tenant é a interface padrão —
   as capturas dos manuais não vão sair de uma cor "de cliente".
3. **O dado de demonstração continua lá:** 4 projetos, 2 propostas e 2 documentos, com nomes
   fictícios próprios para manual ("Sistema de Telemedicina e Monitoramento Remoto de Pacientes
   Crônicos", "Prefeitura Municipal de São Gonçalo do Sul").
4. **Existe um usuário dedicado:** `admin@manual-demo.local`, com MFA desligado — exatamente o perfil
   que uma captura reprodutível pede.

**O que falta, e é a única pendência de execução desta fase:** a **senha** dessa conta não existe em
lugar nenhum do repositório nem em `.env.capture.local` (que guarda apenas a conta de captura do
baseline, do `tenant_default`), e este servidor roda `APP_RUNTIME_MODE=production`, onde a senha de
seed não vale. Sem credencial não há como pilotar a interface daquele tenant — e as capturas
**precisam** ser feitas nele: fazê-las com a conta do baseline traria os dados reais de
desenvolvimento para dentro dos manuais, o que é pior do que a cor desatualizada.

Também não existe script de captura para os manuais: as 31 imagens foram feitas à mão, e o
`README.md` da pasta diz que o caminho certo é "Playwright pilotando a UI de verdade, num tenant
descartável dedicado a isso". A ferramenta de navegação já existe (`scripts/uiScreens.ts`) e cobre
18 das superfícies; as demais são fluxos (assistente de novo projeto, envio na base de conhecimento,
copiloto) que precisam de passos próprios.

**A decisão é do dono** e está no item 8.

---

## 7. O que muda para quem usa o produto

- **A identidade agora é a do produto.** A logomarca PreSales substitui a Cloud Mountain na barra
  superior e no login; a Cloud Mountain permanece como "POWERED BY" no rodapé do login.
- **Azul quer dizer "aja aqui".** Todo botão primário, aba ativa, foco de campo e barra de progresso
  fala a mesma língua. Depois desta fase não há mais botão cinza-escuro disputando esse papel com um
  botão azul na mesma tela.
- **Verde voltou a significar uma coisa só: conforme.** Não é mais a cor da marca, do botão de
  salvar nem do console de depuração.
- **Âmbar é pendência, vermelho é erro.** Dez mensagens de falha que apareciam em âmbar agora
  aparecem em vermelho, e o "Precisa de Informação" deixou de aparecer em vermelho de
  não-conformidade.
- **Prioridade de oportunidade agora informa.** Antes, alta, média e baixa saíam todas verdes.
- **Quatro barras do funil da Home e seis indicadores ficaram legíveis** para quem tem baixa visão ou
  usa a tela sob luz forte.
- **A personalização por tenant continua funcionando** e a guarda de contraste continua recusando
  cor ilegível, agora inclusive na pré-visualização da tela de identidade visual.
- **Nada de layout, tipografia ou navegação mudou.** As 36 imagens do baseline provam.

---

## 8. O que precisa da sua decisão

**8.1 — Cortar o release.** A validação está fechada e o produto está pronto para
`vX.Y.Z-identidade-visual` + Release no CMSaaS + apply step-up-gated. **Nada disso foi feito.**
A "PreSales Demo" está fora do ar desde 30/07 — publicar continua correto (é canary), mas ela só
recebe quando voltar.

**8.2 — Capturas dos manuais.** Preciso de uma destas três:
   - a senha de `admin@manual-demo.local` (o caminho mais limpo: nada muda no banco);
   - autorização para **criar** uma conta de captura dedicada nesse tenant, com senha em
     `.env.manual.local` fora do git — exatamente o que a Fase 0 fez com `visual-capture@presales.local`,
     sem tocar na conta que já existe;
   - ou deixar as capturas para depois do release, assumindo que os manuais mostram o produto antigo
     por mais um tempo.

**8.3 — As três famílias de contraste registradas** (achados A e B). Elas são anteriores ao programa
e a correção muda o tom de todo texto secundário e de toda borda de campo do produto — é uma fase
própria, e a recomendação é fazê-la **antes** da Trilha B, para que as primitivas de E0 já nasçam com
a escala corrigida. Ordem de grandeza: ~310 pontos de `text-slate-400` a decidir por chamada
(porque sobre superfície escura o mesmo token está correto), ~46 de `text-slate-500` e ~66 bordas.

**8.4 — Duas questões de desenho que a Fase 8 deixou** e que continuam abertas por decisão, não por
esquecimento: dar ou não papel de interface ao `accent_color`, e a Precificação a 390px.

---

## 9. Onde está cada evidência

| evidência | onde |
|---|---|
| Auditoria de contraste, par a par | `docs/roadmap/auditoria-contraste-fase9.json` (88 pares, com razão, piso, telas e exemplos) |
| Ferramenta da auditoria | `scripts/audit-contrast.ts` · `npm run audit:contrast` |
| Baseline visual atual | `docs/visual-baseline/` (36 imagens, 26 regravadas nesta fase) |
| Comparação Fase 0 × hoje | item 2 deste dossiê |
| Relato completo da fase | seção "Fase 9" de `docs/roadmap/IDENTIDADE_VISUAL_2026-08.md` |
