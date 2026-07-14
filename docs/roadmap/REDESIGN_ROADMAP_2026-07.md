# Roadmap de Redesenho — Pre-Sales Compliance Platform (2026-07)

> **Status deste documento**: fonte de verdade viva. Atualizado a cada fase fechada ou decisão
> tomada. Substitui as seções "Roadmap futuro" do antigo `docs/ROADMAP.md` (mantido só por
> histórico, marcado como superseded).
>
> **Nada neste documento está implementado até que a fase correspondente diga explicitamente
> "implementado" com commit associado.** Ser mencionado aqui não é autorização para codar — é
> registro de decisão já tomada em conversa com o responsável pelo produto.

## Contexto e motivação

A plataforma vinha de um ciclo de hardening de produção e quebra do monólito `App.tsx` (ver
`docs/checkpoints/production-hardening-admin-audit-2026-07-04.md` e o histórico de commits
`2244392`..`cae2260`). Com essa base estável, o próximo passo é um redesenho maior, motivado por
um esclarecimento importante do modelo de negócio: **a plataforma será distribuída em duas
modalidades — SaaS multi-tenant e on-premises** — e a parte de licenciamento (antes tratada como
"só uma tela de ativação") é na verdade um sistema de gestão completo do lado do fornecedor (AI
Pre-Sales Solutions LLC): plano contratado por cliente, validade de licença on-premises, entrega
de atualizações, coleta de logs de debug para suporte, e cadastro geral de clientes.

Esse esclarecimento mudou o escopo de várias decisões que pareciam simples à primeira vista
(isolamento de dados, por exemplo) e está refletido em cada fase abaixo.

## Como este roadmap foi construído

Cada fase foi fechada através de uma sequência de perguntas objetivas ao responsável pelo produto,
sempre que havia mais de uma direção técnica razoável — não foram decisões unilaterais. Nos casos
em que havia informação técnica de mercado relevante e desatualizável só por conhecimento prévio
(estado dos modelos de IA em julho/2026, ferramentas de monitoramento self-hosted, padrões de
multi-tenancy com Prisma), pesquisa real foi feita antes de propor as opções.

---

## Fase 0 — Fundação multi-tenant

**Status**: ✅ implementada e verificada (commit `f7ec4f3`, 2026-07-05). Migration
`20260705033530_add_multi_tenancy` aplicada no banco real (com backup prévio), dados
íntegros após (3 usuários, 4 projetos, 1053 logs de auditoria, todos com tenant_id correto),
CI verde tanto contra Postgres com dados históricos quanto contra Postgres vazio do zero.
Achado durante a implementação: a extensão Prisma não intercepta creates aninhados (tipo
`stages: { create: [...] }`) - só o único lugar do código real que fazia isso
(`createApprovalWorkflow`) precisou de injeção manual de `tenant_id`.

**O que muda**: nova tabela `Tenant` (nome, modo de deployment `saas`/`onprem`, status
`active`/`suspended`). Coluna `tenant_id` adicionada a praticamente todas as ~20 tabelas do schema
atual — checagem confirmou que hoje **toda** tabela é dado específico de uma organização
(configurações, branding, templates, integrações, tudo), nada é global à plataforma. Uma
instalação on-premises usa exatamente o mesmo schema e código — só nasce com 1 único tenant, sem
bifurcar a base de código entre os dois modos de deployment.

**Mecanismo de escopo**: uma Prisma Client Extension intercepta toda operação de banco (`query`,
`create`, `update`, `delete`, `upsert`, etc.) e injeta automaticamente o filtro `tenant_id` com
base no tenant do usuário autenticado, guardado via `AsyncLocalStorage` (módulo
`src/tenantContext.ts`). Isso elimina estruturalmente a categoria de bug "esqueci o filtro de
tenant numa rota" — não depende de disciplina manual em cada arquivo de rota.

**Casos especiais tratados**:
- **Login**: a busca inicial de usuário por e-mail roda *antes* de qualquer tenant ser conhecido
  (é como o tenant é descoberto) — roda deliberadamente sem escopo, e o resto do fluxo de login
  passa a rodar dentro do contexto do tenant assim que o usuário é encontrado.
- **`DebugLog.tenant_id` é opcional** — logs de diagnóstico de eventos pré-autenticação (ex:
  tentativa de login com e-mail inexistente) genuinamente não têm tenant conhecido ainda.
- **Creates aninhados não são interceptados pela extensão** (ela só vê operações de nível
  superior) — o único caso encontrado no código real (`createApprovalWorkflow`, que cria estágios
  aninhados) foi corrigido manualmente para injetar `tenant_id` explicitamente.

**Perfis (Role) passam a ser customizáveis por tenant**: cada cliente nasce com os 3 perfis padrão
(Administrator/Sales Manager/Pre-Sales Engineer) e pode ajustar depois. Isso resolve um estado
morto encontrado no código (`customAdminRoles`, nunca finalizado) — já havia intenção de suportar
isso.

**Papel de suporte cross-tenant**: a equipe da AI Pre-Sales Solutions vai precisar acessar
qualquer tenant para dar suporte/depurar bugs relatados por clientes. A base para isso já está no
desenho da extensão (o contexto de tenant pode ser definido para qualquer tenant, não só o do
usuário autenticado) com **auditoria obrigatória de todo acesso cross-tenant** — o fluxo de
suporte em si (interface, autorização de quem pode fazer isso) é construído em fase futura, mas a
fundação técnica já contempla isso desde já.

**Provisionamento**: manual/script interno por enquanto. Autocadastro público de tenant fica para
a Fase 7 (licenciamento/cobrança).

**Entrega**:
- Tabela `Tenant` + `tenant_id` em todas as tabelas existentes (com índice)
- Prisma Client Extension de escopo automático (`src/prisma.ts`)
- Módulo de contexto (`src/tenantContext.ts`, `AsyncLocalStorage`)
- Perfis (`Role`) tenant-scoped, seed automático dos 3 perfis padrão por tenant novo
- `prisma/seed.ts` atualizado para criar o tenant padrão primeiro
- Script interno de criação de tenant + primeiro usuário Admin (pendente)

---

## Fase 1 — Infraestrutura de tarefas em tempo real

**Status**: ✅ implementada e verificada (commit `6532638`, 2026-07-05). BackgroundTask +
Redis pub/sub + SSE (`/api/tasks/stream`) no ar; análise de IA e geração de propostas já rodam
sobre esse sistema; indicador persistente na barra superior. Achado no caminho: um bug crítico
pré-existente (não relacionado a esta fase) - a aba Área de Trabalho estava completamente em
branco em produção desde o split do App.tsx, só descoberto via smoke test real de navegador -
foi corrigido no mesmo commit.

**Princípio, não só um detalhe de UX**: qualquer operação longa do produto — análise de IA no
Workspace (já existe hoje), geração de proposta, o futuro orquestrador de IA (Fase 5) — passa a
usar **um único sistema de tarefas em segundo plano**, generalizando o modelo `AIAnalysisJob` que
já existe no schema, em vez de cada funcionalidade inventar seu próprio mecanismo de progresso.

**Atualização em tempo real via SSE** (Server-Sent Events), não WebSocket bruto — decisão
explícita do responsável pelo produto ao ser oferecida a escolha entre real-time (SSE/WebSocket) e
polling simples. SSE foi escolhido especificamente por ser mais simples nesse caso de uso (o
servidor só precisa empurrar status, nunca receber de volta pelo mesmo canal) e por reconectar
sozinho após queda de rede — recurso nativo do browser (`EventSource`) e do Express, sem
dependência nova.

**Persistência real**: o estado de cada tarefa mora no backend, não no componente de tela. Trocar
de aba ou recarregar a página inteira nunca perde nem reinicia o progresso — a tela só volta a se
conectar à tarefa pelo ID e retoma de onde ela realmente está. Um indicador discreto e persistente
na barra superior do app, visível em qualquer tela (não só onde a tarefa foi iniciada), mostra que
há algo em andamento e leva de volta ao contexto dela.

**Entrega**:
- Modelo genérico de tarefa em segundo plano (tipo, status, etapa atual, progresso, erro)
- Canal SSE de atualização em tempo real, por usuário/tenant
- Indicador global persistente na barra superior
- Migração da análise de IA e geração de proposta existentes para o novo sistema

---

## Fase 2 — Autenticação robusta

**Status**: ✅ implementada e verificada (commit `98c5337`, 2026-07-05). Rotação de
refresh/access token com detecção de reuso (revoga a família inteira), limite absoluto de
sessão de 7 dias, bloqueio de conta (5/15min, conta+IP, contadores separados senha/MFA),
refresh silencioso no frontend. Refresh token em cookie httpOnly, parse manual (sem
cookie-parser).

**Estado hoje** (verificado em código): sessão é um único JWT de TTL fixo guardado no Redis
(`server/utils/security.ts`, `createSession`) — sem rotação de refresh token, sem bloqueio de
conta por tentativas falhas.

**Decisões**:
- **Access token curto (5–15min) + refresh token rotacionado a cada uso**, guardado em cookie
  HttpOnly (não mais exposto ao frontend como hoje). Se um refresh já trocado for usado de novo, é
  sinal de token roubado e a família inteira de tokens é revogada. Escolhido sobre o padrão mais
  simples de sessão com expiração deslizante, mesmo exigindo um fluxo de refresh silencioso no
  frontend.
- **Limite absoluto de sessão de 7 dias** — força novo login mesmo com uso contínuo, fechando o
  caso de um refresh token vazado ficar válido para sempre enquanto o dono legítimo seguir ativo.
- **Bloqueio de conta: 5 tentativas → 15 minutos**, liberação automática (sem precisar de ação do
  admin).
- **Escopo do bloqueio: conta + IP combinados** — evita o vetor conhecido de bloqueio malicioso
  (alguém errando de propósito a senha de outra pessoa só para bloqueá-la).
- **Contadores de bloqueio separados para senha e código MFA** — são riscos diferentes (senha
  vazada vs. dispositivo autenticador com problema), e combiná-los penalizaria um tipo de falha
  pelos erros do outro.

**Entrega**:
- Par access/refresh token com rotação e detecção de reuso (Redis)
- Limite absoluto de sessão: 7 dias, independente de atividade
- Bloqueio de conta: 5 tentativas → 15 min, escopo conta + IP combinado
- Contadores de bloqueio separados para senha e código MFA
- Fluxo de refresh silencioso no frontend (React)

---

## Fase 3 — RBAC + dono do registro

**Status**: ✅ implementada e verificada (commit `93c6f02`, 2026-07-05). Regra de visibilidade
embutida na extensão Prisma (Project/Proposal/ApprovalDecision), tabela TeamMembership,
permissão `project:read_all`, reatribuição de dono, gestão de equipe. Achado técnico no
caminho: `findUnique`/`update`/`delete` singulares do Prisma exigem o campo único na raiz do
`where` - não aceitam ficar dentro de um `AND` junto com a regra de visibilidade. Corrigido
redirecionando reads pra `findFirst` e update/delete pra `updateMany`/`deleteMany` + re-fetch
quando a visibilidade se aplica.

**Achado útil**: o schema já tem um campo `owner_user_id` no Projeto (rastreamento de quem
criou/é responsável), só nunca foi usado para controle de acesso — só para exibição. Isso reduz
bastante o trabalho de schema desta fase.

**Decisões**:
- Cada **Projeto** tem um dono (`owner_user_id`); a **Proposta** não tem dono próprio — herda a
  visibilidade do projeto que a contém (bate com como o Approval Center já funciona: por proposta,
  dentro de um projeto).
- **Engineers podem pertencer à equipe de mais de um Manager** (vínculo N:N, não uma coluna simples
  de "reporta para") — confirmado que vão existir múltiplos Managers rodando equipes separadas.
- Um **Manager também pode ser dono direto** de um projeto, além de supervisionar a equipe.
- **Administrator sempre vê tudo**, sem exceção.
- **Regra de visibilidade**: um usuário vê um projeto se (a) é o dono, ou (b) é Manager e o dono é
  um Engineer da equipe dele, ou (c) já foi ou é aprovador em alguma etapa daquele projeto —
  visibilidade que **permanece para sempre**, mesmo depois da decisão tomada (evita a confusão de
  "por que sumiu da minha lista" depois de aprovar/rejeitar algo), ou (d) é Administrator.
- **Reatribuição de dono**: Admin ou o dono atual.
- Essa regra de visibilidade é embutida na **mesma** extensão Prisma de escopo de tenant da Fase 0
  — um único lugar central, não `WHERE` espalhado por rota.
- Essa mesma estrutura (dono + equipe) é a base de dados que o futuro módulo de CRM (Fase 6) vai
  precisar (carteira, funil, "projetos por cliente").

**Entrega**:
- Tabela de vínculo N:N Manager↔Engineer
- Regra de visibilidade acima, embutida na extensão Prisma de escopo (Fase 0)
- Ajuste nas listagens (Home, Proposals, Approval) para respeitar o novo filtro
- Ação de reatribuir dono (Admin Console + no próprio projeto para o dono atual)

---

## Fase 4 — Criação de projeto: upload primeiro

**Status**: ✅ implementada e verificada (commit `6267cc5`, 2026-07-05). Assistente de 2 etapas
no ar (upload → staging Redis com TTL → análise IA em background → validação totalmente
editável → confirmação materializa o projeto de verdade), fallback manual preservado.
Bug encontrado no caminho (hotfix separado, commit `adc8f06`): a Fase 3 tinha quebrado
silenciosamente o SSE `/tasks/stream` por ordem de rotas no Express - corrigido.

**Fluxo atual**: clicar em "+ Nova Proposta" abre um formulário (nome, cliente, vertical,
descrição, prazo, etc.) e *só depois* o usuário sobe documentos e roda a análise.

**Fluxo novo**:
- **Um único ponto de entrada**: "+ Nova Proposta" abre o assistente de upload diretamente. Um
  link discreto dentro dele ("não tenho documentos ainda, criar manualmente") leva direto para o
  formulário atual, sem passar pelo resto do fluxo — mantido para a fase de prospecção, quando
  ainda não existe nenhum documento (importante pensando no futuro funil de vendas do CRM).
- **Upload primeiro, projeto depois**: os arquivos sobem para uma área de staging temporária, sem
  nenhum projeto vinculado ainda, rastreados por uma sessão de upload de curta duração (TTL no
  Redis). A IA analisa o material em staging e pré-preenche os campos do projeto (título, cliente,
  vertical, escopo, prazo...).
- **A confirmação é o gatilho real**: o Projeto e os Documentos só nascem de verdade no banco
  quando o usuário confirma a etapa de validação — nesse momento os arquivos migram do staging
  para o armazenamento definitivo do projeto. Staging abandonado expira sozinho via TTL, purgando
  também os arquivos.
- **Todos os campos ficam sempre editáveis na validação**, mesmo os que a IA preencheu com
  confiança — decisão explícita para não deixar um erro da IA passar travado (ex: nome de cliente
  mal interpretado).
- **Progresso via infraestrutura da Fase 1**: upload e análise usam o sistema genérico de tarefas
  em tempo real (SSE, persistente entre trocas de aba e refresh), não um mecanismo próprio.

**Entrega**:
- Assistente em 2 etapas: upload (staging) → validação/confirmação
- Área de staging com TTL (Redis) + purga automática de upload abandonado
- Upload e análise rodando como tarefas da Fase 1
- Formulário manual preservado como atalho discreto dentro do próprio assistente

---

## Fase 5 — Orquestrador de IA

**Status**: ✅ implementada e verificada (commit `ae349ac`, 2026-07-05). Mapa tarefa→provedor
pros 4 tipos de tarefa, teto de custo mensal com bloqueio real (HTTP 402) + aviso em 80%,
fallback pro Gemini com auditoria + alerta de repetição, tela de configuração no Admin
Console. Conectar novos provedores de verdade (OpenAI/Anthropic além do Gemini) continua
sendo trabalho de implementação futura, fora desta fase - a camada de orquestração em si já
está pronta pra quando isso acontecer.

**Esta foi a última das 6 fases centrais do roadmap (0, 1, 3, 4, 2, 5) - todas completas.**
Restam apenas as Fases 6 (POC/CRM) e 7 (licenciamento/fleet/vulnerabilidades), deliberadamente
adiadas para uma sessão de discussão dedicada futura.

**Estado hoje** (verificado em código): só o Google Gemini está de fato conectado no backend
(`server/routes/analysis.ts`), apesar do Admin Console mostrar OpenAI/Anthropic/DeepSeek como
opções — os três são só decoração de UI hoje, sem integração real.

**Mapa tarefa → modelo** (baseado em pesquisa real de julho/2026, não em achismo):
- **Análise de documentos multi-formato**: Gemini por padrão (contexto de 2M tokens, ingere
  coleções inteiras de documentos sem fragmentar, já integrado hoje); Claude como segunda passada
  quando a extração precisa ser crítica (98,2% de acurácia em extração de campos complexos contra
  96,5% do GPT e 95,8% do próprio Gemini, em benchmark de comparação).
- **Pesquisa com busca real na web**: Gemini com "Grounding via Google Search" — é o único
  provedor cujo grounding consulta o índice de verdade do Google (OpenAI e Anthropic usam
  crawlers/buscadores próprios, ambos maduros, só estruturalmente diferentes na fonte do dado).
  Atenção: esse grounding cobra por busca executada, não só por token — pesa no desenho do teto de
  custo.
- **Redação de propostas técnicas/comerciais**: Claude para prosa longa com voz consistente
  (propostas que precisam soar bem escritas e coerentes); GPT quando o conteúdo precisa seguir um
  brief rígido (seções estruturadas de compliance). Gemini não é recomendado aqui apesar de mais
  barato — lidera em benchmark de escrita criativa, mas "criativo" não é o que redação
  compliance-precisa precisa.
- **Manipulação de documentos (geração de DOCX)**: não é uma decisão de modelo — é a biblioteca de
  DOCX que já existe processando o texto que a tarefa de redação gerou.

**Arquitetura de custo e confiabilidade**:
- **Teto de custo mensal configurável por tenant, com bloqueio real** ao estourar (não é só
  rastreamento) — aviso em 80% do teto antes do bloqueio, para ninguém ser pego de surpresa.
- **Rastreamento de custo construído em cima da infraestrutura de tarefas da Fase 1**,
  deliberadamente **sem usar o AI Gateway da Vercel** — decisão explícita do responsável pelo
  produto, já que instalações on-premises não deveriam depender de conectividade externa com a
  infraestrutura da Vercel só para o controle de custo funcionar.
- **Fallback para o Gemini** (hoje o único provedor de fato confiável e integrado) quando o modelo
  ideal para uma tarefa falha ou é limitado por rate-limit — todo fallback é registrado em
  auditoria; **3 ou mais fallbacks do mesmo provedor numa janela curta disparam alerta para o
  Admin** (sinal de provedor com problema real, não uma falha isolada).
- Tela de configuração no Admin Console para o mapa tarefa→modelo, teto de custo por tenant, e
  auditoria de decisões de roteamento + fallbacks.

**Entrega**:
- Mapa tarefa → modelo grounded em benchmarks reais
- Rastreamento de custo por tarefa/tenant sobre a infraestrutura da Fase 1
- Teto de custo mensal por tenant com bloqueio + aviso em 80%
- Fallback para o Gemini com auditoria + alerta de repetição para o Admin
- Desenho da tela de configuração e auditoria no Admin Console

---

## Fase 6 — Módulos futuros: POC e CRM

**Status**: **Gestão de POC** em implementação faseada (plano de 6 fases aprovado em 2026-07-13,
`/home/sakae/.claude/plans/parsed-dancing-fountain.md`). **Fase A concluída e verificada** (commit
`ce18168`, 2026-07-13): schema `Poc`, `enabled_modules` na sessão via `getFleetLicenseStatus`,
middleware `requireModule` (defesa em profundidade ao lado de `requirePermission`), permissões
`poc:read`/`poc:manage`, rotas `/api/pocs`, aba "Gestão de POC · Add-on" com kanban por status e
detalhe editável. Testado ponta a ponta com usuário/role de teste descartáveis (removidos depois);
encontrado e corrigido nesse teste um bug real de `.partial()` + `.refine()` do Zod que resetava o
status silenciosamente em qualquer update parcial. Migração aditiva aplicada com backup prévio, dado
existente intacto.

**Fase B concluída e verificada** (commit `47ab5c0`, 2026-07-13): modelo `PocSuccessCriterion`
(checklist simples, sem rubrica com peso), sub-rotas `/api/pocs/:id/success-criteria` (CRUD),
`owner_name` denormalizado no payload da POC (não depende de `/api/users`, que é admin-gated).
Tela mostra checklist marcável/removível e stakeholders (responsável interno + contato do cliente).
Testado ponta a ponta da mesma forma que a Fase A; migração aditiva aplicada com backup prévio.

**Fase C concluída e verificada** (commit `0dcf8aa`, 2026-07-13): modelo `PocEquipmentItem`
(sem estoque central entre POCs, decisão de produto), upload de NF de envio/devolução reaproveitando
o storage adapter existente (não a tabela `Document`, cujo `projectId` é obrigatório), alerta visual
de prazo vencido com equipamento não devolvido. Dois bugs reais encontrados e corrigidos no teste
ponta a ponta: reanexar um arquivo não apagava o arquivo físico anterior (vazamento de storage), e
excluir um item de equipamento não removia os arquivos físicos anexados.

**Fase D concluída** (commit `a6d023d`, 2026-07-13): modelo `PocTask` com dependência de
predecessor único (finish-to-start), caminho crítico calculado no frontend, componente
`PocGanttChart.tsx` próprio (sem biblioteca de terceiros) reaproveitando a interação já validada
no mockup — arrastar para mover, redimensionar, conectores, linha de hoje. Backend (CRUD, validação
de dependência, reagendamento, exclusão sem cascata) verificado ponta a ponta via API. **Limitação
registrada**: a interação de arrastar/redimensionar no navegador em si não foi verificada
visualmente nesta sessão — sem ferramenta de browser disponível, só a lógica de persistência que o
drag aciona no `mouseup` foi testada de verdade. Recomendo uma passada manual no navegador antes de
liberar esta fase para uso real.

Faltam Fases E–F (Cadernos de Teste por IA, Aceite do Cliente).
**CRM** continua apenas nomeado, sem detalhe (fica para sessão futura dedicada).

Dois módulos novos, ambos vendidos por assinatura separadamente (ligado à Fase 7 — um cliente pode
contratar um sem o outro):

- **CRM**: "simples e funcional" — inspirado em ideias de CRMs de sucesso do mercado, mas aderente
  à forma real desta plataforma, não um clone genérico. Blocos já nomeados pelo responsável pelo
  produto: cadastro de cliente, projetos de cada cliente, acompanhamento, integração com Google
  Workspace e/ou Microsoft 365, funil de vendas, carteira. Usa exatamente a mesma base de dono +
  equipe construída na Fase 3.

### Gestão de POC (provas de conceito) — desenho conceitual

**Mecanismo de add-on (confirmado em código, não é suposição)**: o lado fornecedor (Fleet Manager,
`saasmanager-01`) já tem tudo que este módulo precisa consumir — `enum ModuleName { base, poc, crm }`,
`model Plan { modules: String[] }` e `model ModuleEntitlement { installationId, module, enabled }`
no schema do Fleet Manager, e o heartbeat (`server/routes/heartbeat.ts`) já envia
`modules: entitlements.map(e => e.module)` a cada check-in. Do lado desta instalação,
`server/utils/fleetLicense.ts` já cacheia e verifica a assinatura dessa lista, hoje só consumida para
*exibir* "Assinatura e Licença" no Admin Console (`AdminConsole.tsx`). Ou seja: o módulo POC nasce
como consumidor novo de um cano que já existe — só falta a "torneira".

**Gap identificado a fechar na implementação**: `GET /api/settings/fleet-license-status` hoje exige
`admin:settings`, então só admin vê os módulos habilitados. A aba de POC precisa aparecer pra
qualquer usuário de pré-vendas, não só admin — então a lista de módulos habilitados do tenant precisa
entrar no bootstrap de sessão que todo usuário já recebe no login, com o gate replicado no backend
(bloquear as rotas de API da POC por entitlement, não só esconder a aba no front — mesmo padrão de
defesa em profundidade já usado no resto do sistema).

**Navegação**: nova aba de nível superior "Gestão de POC" na barra de topo, mesmo padrão visual das
abas existentes (`slate-900` + destaque `emerald-500` na aba ativa, sem nenhum token de cor/fonte
novo — a paleta e a fonte do sistema não mudam). Aba só existe quando o tenant tem o módulo
contratado (`modules.includes('poc')`) e o usuário tem a permissão correspondente; sem o módulo, a
aba simplesmente não aparece — não é um cadeado visível.

**Vínculo com `Project`**: uma POC pode nascer a partir de um `Project` existente (herdando cliente,
oportunidade, vertical, dono) **ou** existir de forma independente (POC exploratória sem oportunidade
formal ainda), com um mini-cadastro próprio de cliente/contato espelhando os mesmos campos que
`Project` já usa.

**Telas**:
- **Lista/Kanban** de todas as POCs do tenant, colunas por status
  (`planejada → em andamento → bloqueada → concluída [ganha/perdida]`).
- **Detalhe da POC**, em 5 abas internas:
  1. **Visão Geral** — objetivo, critérios de sucesso (checklist), stakeholders (responsável interno
     + contato técnico do cliente), projeto vinculado.
  2. **Cronograma** — tarefas da POC com **dependências e Gantt interativo completo** (arrastar pra
     reagendar, redimensionar duração, caminho crítico destacado). É o item de maior investimento
     técnico do módulo — foge do padrão de tarefa simples já existente (`Task`/`UserTask` são lista
     plana, sem predecessor/sucessor) e exige escolha de abordagem/biblioteca de Gantt em um spike
     técnico à parte antes de codar.
  3. **Equipamento** — itens físicos emprestados ao cliente durante a POC (serial, descrição,
     status), cada um com anexo de **NF de envio** e **NF de devolução** (reaproveita o padrão de
     upload/storage do `Document` já existente), com alerta automático se o prazo da POC vencer sem
     devolução registrada. **Sem estoque central** entre POCs na v1 — cada POC só registra o que ela
     própria enviou.
  4. **Cadernos de Teste (IA)** — casos de teste gerados a partir do objetivo/critérios de sucesso da
     POC, **regeneráveis e editáveis** (mesmo padrão "IA rascunha, humano valida" já usado no Estúdio
     de Propostas), plugando como mais um tipo de tarefa no orquestrador de IA já existente (Fase 5) —
     sem infraestrutura nova. Exportação formatada reaproveitaria o motor de templates DOCX já usado
     nas propostas.
  5. **Aceite do Cliente** — registro de decisão final (ganha/perdida) com upload de documento
     assinado como placeholder; **mecanismo de assinatura eletrônica formal fica para decidir depois**
     (registrado aqui deliberadamente como aberto, não é omissão).

**Protótipo**: mockup HTML navegável (lista Kanban + detalhe com as 5 abas, Gantt arrastável de
verdade) construído e aprovado pelo responsável do produto em 2026-07-13, fiel aos tokens de cor e
fonte reais do app (nenhuma paleta nova, nenhuma fonte nova) — serve de referência visual para a
implementação, não é o produto final.

**Itens deliberadamente em aberto para a próxima sessão (não bloqueiam o desenho, mas bloqueiam
codar)**:
- Escolha técnica da biblioteca/abordagem de Gantt (arrastar/redimensionar/caminho crítico).
- Mecanismo de aceite do cliente (assinatura eletrônica vs. upload manual definitivo).
- Granularidade de permissões dentro do módulo POC (quem cria, quem edita, quem só visualiza).
- Modelagem exata de tabelas novas no Prisma schema desta instalação (POC, tarefas com dependência,
  itens de equipamento, casos de teste, registro de aceite) — desenhada em conceito acima, não em
  schema ainda.

---

## Fase 7 — Licenciamento, fleet management e vigilância contínua

**Status**: nomeado, deliberadamente deixado para o final.

**Reformulação importante**: esta fase não é "uma tela de ativar licença" — é, na prática, um
**painel de controle do lado do fornecedor** (AI Pre-Sales Solutions LLC gerindo os próprios
clientes): gestão do plano contratado por cliente, validade de licença nas instalações
on-premises, entrega de atualizações, recebimento de logs de debug para suporte/correção de bugs,
e cadastro geral dos clientes da plataforma. É, na prática, uma superfície de produto separada
(um backend de gestão de frota/licenças) da aplicação que o usuário final usa — instalações
on-premises precisam de alguma forma de autenticar de volta a esse sistema central.

Junto entra o **gerenciamento contínuo de vulnerabilidades**, também deliberadamente adiado para
esta fase:
- Varredura de dependências (CVE/npm-audit) com relatório periódico, complementando o Dependabot
  já ativo no repositório GitHub.
- Disponibilidade/monitoramento de produção via **Uptime Kuma** self-hosted — confirmado ativo e
  leve o suficiente para rodar dentro de cada instalação on-premises sem depender de um SaaS de
  monitoramento externo.

**Superseder desta seção**: as antigas seções "Roadmap futuro: Subscrição e Licença" e "Roadmap
futuro: Observabilidade, Logs e Debug Avançado" do `docs/ROADMAP.md` anterior — o escopo detalhado
ali (planos Free/Professional/Enterprise/On-premises/Trial, grace period, auditoria de violação de
limites, retenção de logs, dashboard de saúde, etc.) continua válido e deve ser revisitado quando
esta fase for desenhada em detalhe, agora com o contexto adicional do fleet management
multi-tenant.

---

## Verificação de tecnologia (stack atual vs. o que muda)

| Ponto | Decisão | Muda o stack? |
|---|---|---|
| Orquestração de IA | **Vercel AI SDK** (`ai` + adapters por provedor), sem LangChain.js (overkill para "rotear tarefa X para modelo Y") e **sem o AI Gateway** (rastreamento de custo por conta própria, sem dependência externa) | Sim — nova dependência |
| Multi-tenancy | Schema compartilhado com `tenant_id` + Prisma Client Extension via AsyncLocalStorage | Não — recurso nativo do Prisma |
| Refresh token rotation | Implementação própria sobre `jsonwebtoken` + Redis (já no stack) — não existe lib de nicho madura para isso | Não |
| Monitoramento self-hosted | **Uptime Kuma** | Container separado, sem mexer no código da aplicação |
| Progresso em tempo real | **SSE** (Server-Sent Events) — nativo do browser e do Express | Não |

## Pendências pequenas encontradas (não corrigidas ainda, sem urgência)

- Não existe forma de editar um projeto depois de criado (só criar existe hoje).
- `RUN AI ANALYSIS` não pôde ser testado manualmente neste ambiente por falta de uma chave de API
  de IA configurada — bloqueou parte do teste manual do Workspace (edição de BOM/requisitos/riscos,
  geração de proposta), já que nada disso tem dado sem um resultado de análise real.

## Item deferido, não relacionado a este redesenho

A ativação de licença fake da aba "Subscrição e Licença" continua deliberadamente sem tocar — foi
uma decisão explícita e reafirmada do responsável pelo produto, anterior a este redesenho (ver
`docs/checkpoints/production-hardening-admin-audit-2026-07-04.md`). Só deve ser tratada quando a
Fase 7 for aberta oficialmente.
