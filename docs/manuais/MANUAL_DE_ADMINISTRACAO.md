# Manual de Administração — Pre-Sales Compliance Platform

Este manual cobre a área **Configurações**, disponível para usuários com pelo menos uma permissão
administrativa. Para o uso do dia a dia (projetos, propostas, POC), veja o
[Manual do Usuário](./MANUAL_DO_USUARIO.md).

A área de Configurações tem 10 seções na barra lateral. Cada seção só aparece para quem tem a(s)
permissão(ões) correspondente(s) — é normal um administrador não-técnico não ver, por exemplo,
"Armazenamento e Documentos".

---

## Sumário

1. [Visão Geral do Sistema](#1-visão-geral-do-sistema)
2. [Usuários e Acessos](#2-usuários-e-acessos)
3. [IA, Prompts e Custos](#3-ia-prompts-e-custos)
4. [Templates de Propostas](#4-templates-de-propostas)
5. [Fluxo de Aprovação de Propostas](#5-fluxo-de-aprovação-de-propostas)
6. [Subscrição e Licença](#6-subscrição-e-licença)
7. [Personalização e Identidade Visual](#7-personalização-e-identidade-visual)
8. [Integrações, CRMs, ERPs e APIs](#8-integrações-crms-erps-e-apis)
9. [Armazenamento e Documentos](#9-armazenamento-e-documentos)
10. [Auditoria e Diagnóstico](#10-auditoria-e-diagnóstico)
11. [Boas práticas de administração](#11-boas-práticas-de-administração)

---

## 1. Visão Geral do Sistema

**[PRINT: 26-admin-visao-geral.png]**

**Permissão necessária:** qualquer permissão administrativa.

Painel inicial da área de Configurações, com cards de resumo:

- **Integrações** — atalho e status resumido dos conectores configurados.
- **Provedores de IA** — quais provedores (Gemini, OpenAI, Anthropic, personalizados) estão
  configurados e prontos para uso.
- **Sistema** — licença, modo de armazenamento e branding em um único lugar.
- **Atalhos de Configuração** — links diretos para as seções mais usadas.
- **Resumo Operacional** — modelo de IA padrão, número de prompts customizados, número de logs de
  auditoria e número de usuários cadastrados.
- **Enviar Aviso a Todos os Usuários** — formulário para publicar um comunicado que aparece para
  todos os usuários da instância (útil para avisar sobre manutenção, mudanças de processo, etc.).

---

## 2. Usuários e Acessos

**Permissões necessárias:** `admin:users` (gerenciar usuários) e/ou `admin:roles` (gerenciar
perfis).

### 2.1 Perfis (Roles)

**[PRINT: 27-admin-perfis.png]**

Um **perfil** é um conjunto nomeado de permissões (ex: "Vendedor", "Engenheiro", "Aprovador"). Cada
card de perfil mostra checkboxes com todas as permissões do sistema — marque/desmarque para ajustar
o que aquele perfil pode fazer, e clique em **Criar Novo Perfil** para começar um do zero.

> Mudar as permissões de um perfil afeta **imediatamente** todos os usuários que já têm esse
> perfil atribuído — não é preciso "salvar e aplicar" separadamente por usuário.

Referência rápida das permissões disponíveis:

| Permissão | Controla |
|---|---|
| `project:create` / `project:update` / `project:delete` | Criar, editar, excluir projetos |
| `analysis:run` / `analysis:read` / `analysis:edit` | Rodar, ver e editar análises de IA |
| `proposal:generate` / `proposal:edit` / `proposal:export` / `proposal:approve` | Ciclo de vida da proposta |
| `approval:manage` | Configurar fluxos de aprovação |
| `document:upload` / `document:read` / `document:delete` | Documentos do projeto |
| `knowledge_base:read` / `knowledge_base:write` | Base de Conhecimento |
| `poc:read` / `poc:manage` | Módulo de Prova de Conceito |
| `template:manage` | Templates de proposta e verticais |
| `branding:manage` | Logo e cores da identidade visual |
| `integrations:manage` | Conectores de CRM/ERP |
| `storage:manage` | Modo de armazenamento de arquivos |
| `ai:settings` | Provedores de IA, prompts, teto de custo |
| `admin:users` / `admin:roles` | Gestão de usuários e perfis |
| `admin:settings` | Licença/assinatura e conexão com o CMSaaS |
| `admin:audit` | Log de auditoria |
| `admin:debug` / `admin:diagnostics` | Console de debug e pacote de diagnóstico |

### 2.2 Diretório de Usuários

**[PRINT: 28-admin-usuarios.png]**

Tabela com todos os usuários da instância. **+ Novo Usuário** pede nome, e-mail, senha inicial e
perfil. Cada linha tem uma opção de **redefinir senha** — use quando um usuário esquecer a senha
(não existe fluxo de "esqueci minha senha" self-service).

> Ao criar um usuário, escolha o perfil com cuidado — como não há tela de "editar permissões
> individuais", quem precisar de um conjunto de permissões diferente de qualquer perfil existente
> vai precisar de um perfil novo (seção 2.1).

---

## 3. IA, Prompts e Custos

**Permissão necessária:** `ai:settings`.

Esta é a seção mais densa do Admin Console.

### 3.1 Modelos e Provedores de IA

**[PRINT: 29-admin-ia-provedores.png]**

- Cadastre chaves de API para Gemini, OpenAI e/ou Anthropic, e provedores personalizados
  compatíveis com a API da OpenAI (clique em **+ Adicionar Provedor**).
- No **mapa Tarefa → Provedor → Modelo**, escolha qual provedor/modelo atende cada tipo de tarefa
  de IA do sistema (análise de documento, geração de proposta, classificação, etc.) — não é
  preciso usar o mesmo provedor para tudo.
- **Teto Mensal de Custo (USD)** — defina um limite de gasto mensal com IA; o sistema bloqueia
  novas chamadas ao atingir o teto (com aviso em 80% do valor).

> **Se o add-on IA/KB (gerenciado pelo CMSaaS) estiver ativo** nesta instalação, esta seção vira
> **somente-leitura**, com um aviso explicando que os provedores/modelos agora são geridos
> centralmente. Isso é esperado — não é um bug. Para mudar algo nesse caso, o pedido precisa ir
> para quem administra o CMSaaS, não por aqui.

### 3.2 Custos de IA e Prompts

*(Card visível na mesma tela do print anterior, coluna "Custos de IA e Prompts")*

Mostra o consumo do mês corrente por serviço e provedor, e a data do próximo vencimento de
cobrança. É informativo — a cobrança em si é gerida pelo CMSaaS.

### 3.3 Templates de Prompt

**[PRINT: 30-admin-ia-prompts.png]**

Quatro prompts do sistema podem ser customizados, cada um com histórico de versões:

- Classificação de Documentos
- Geração de Caderno de Teste (POC)
- Sugestão de Cronograma (POC)
- Questionário de Relatório Final (POC)

Para cada um: **criar nova versão** (editar o texto do prompt), **ativar uma versão** (torná-la a
usada em produção), ou **resetar para o padrão de fábrica** se algo sair errado. Versões antigas
ficam guardadas — nada é perdido ao trocar de versão ativa.

---

## 4. Templates de Propostas

**[PRINT: 31-admin-templates.png]**

**Permissão necessária:** `template:manage`.

Envie um arquivo DOCX de modelo para cada um dos 7 tipos de proposta (Técnica, Comercial,
Técnico-Comercial, Resumo Executivo, Relatório de Riscos, Relatório de BOM, Relatório de
Perguntas) em **Enviar Template**. Cada tipo pode ter múltiplas versões enviadas — use **Ativar**
para escolher qual delas é usada quando um usuário gera aquele tipo de proposta.

Nesta mesma tela fica a gestão de **Verticais de Indústria** (Saúde, Educação, Transporte etc.) —
ative, desative ou exclua verticais conforme o mercado de atuação da empresa mudar.

---

## 5. Fluxo de Aprovação de Propostas

**[PRINT: 32-admin-fluxo-aprovacao.png]**

**Permissão necessária:** `approval:manage`.

Um **fluxo** define quantas etapas uma proposta passa antes de ser considerada aprovada, e quem
aprova cada etapa. Clique em **+ Novo Fluxo**, depois **+ Nova Etapa** para cada etapa, definindo:

- **Nome da etapa** (precisa ser único dentro do fluxo).
- **Aprovador** — uma pessoa específica, ou qualquer usuário que tenha um determinado perfil.
- **Obrigatória** (`mandatory`) — ligada por padrão. Veja o efeito exato abaixo.
- **Aplica-se a** (`applies_to`) — um rótulo livre (ex: "Propostas Técnicas", "all"). Hoje esse
  campo é só informativo/organizacional: nenhuma tela filtra automaticamente por ele ao vincular
  um fluxo a um projeto (veja a limitação importante logo abaixo).

### 5.1 Como a decisão realmente funciona

Isso não está descrito em nenhum lugar da interface, então vale entender antes de configurar um
fluxo real:

- **As etapas não são estritamente sequenciais.** O sistema não bloqueia a decisão de uma etapa
  posterior antes de uma anterior ser decidida — cada aprovador configurado pode decidir sua
  própria etapa a qualquer momento, independentemente do estado das outras. A ordem cadastrada
  serve principalmente para exibição.
- **Cada etapa só pode ser decidida uma vez.** Depois de registrada, a decisão daquela etapa é
  definitiva — não existe "mudar de ideia" ou refazer a decisão pela interface.
- **A proposta só vira "Aprovada" quando TODAS as etapas marcadas como obrigatórias tiverem
  decisão "Aprovado".** Etapas não-obrigatórias não precisam ser decididas para a proposta avançar.
- **Uma única rejeição, em qualquer etapa — obrigatória ou não — rejeita a proposta inteira
  imediatamente.** A partir daí, nenhuma outra etapa pode mais ser decidida (o sistema só aceita
  decisões enquanto a proposta está com status "Enviada para Aprovação"). Ou seja: uma etapa
  opcional configurada sem cuidado ainda pode travar/encerrar todo o processo sozinha se seu
  aprovador rejeitar.

> Se o aprovador de uma etapa for um perfil (não uma pessoa), qualquer usuário com aquele perfil
> pode decidir aquela etapa — útil para não travar a aprovação na ausência de uma pessoa
> específica.

### 5.2 Limitação importante: como um fluxo é vinculado a um projeto

**No estado atual do sistema, não existe nenhuma tela para escolher qual fluxo de aprovação se
aplica a um projeto específico.** Esse vínculo (`selected_approval_workflow_id`, no projeto) não
aparece em nenhum formulário — nem na criação do projeto (com IA ou manual), nem na edição.

Na prática, isso significa que o botão **"Enviar para Aprovação de Fluxo"** (Estúdio de Propostas,
veja o Manual do Usuário) vai retornar erro ("fluxo de aprovação ativo não encontrado") em
qualquer projeto criado normalmente pela interface, mesmo depois de você cadastrar um fluxo aqui —
o campo do projeto nunca é preenchido com o ID do fluxo real.

Até que essa tela exista, o vínculo só pode ser feito manualmente no banco de dados (tarefa para o
time técnico/suporte, não para o administrador pela interface). Recomendamos reportar isso como
item de produto a ser corrigido — hoje, cadastrar um fluxo de aprovação aqui não é suficiente para
usá-lo de fato em um projeto real.

---

## 6. Subscrição e Licença

**[PRINT: 33-admin-licenca.png]**

**Permissão necessária:** `admin:settings`.

Esta seção é **somente-leitura** para os dados vindos do CMSaaS via heartbeat automático: nome e
logo do cliente, plano contratado, status da assinatura, vigência do contrato, módulos habilitados
e horário da última verificação. Não é possível editar esses dados por aqui — qualquer mudança de
plano/contrato precisa ser feita do lado do CMSaaS.

Nesta mesma tela, porém, fica a configuração da **conexão** com o CMSaaS em si: ativar/desativar a
integração, URL do Fleet Manager e chave de API. Isso sim é configurável localmente — é o "fio"
que liga esta instalação ao painel de licenciamento central.

---

## 7. Personalização e Identidade Visual

**[PRINT: 34-admin-branding.png]**

**Permissão necessária:** `branding:manage`.

- Envie o logo da empresa (arraste ou clique — aceita PNG, JPEG, SVG ou WEBP) ou remova o logo
  atual.
- Escolha a **Cor Primária** e a **Cor de Destaque** usadas na interface.

---

## 8. Integrações, CRMs, ERPs e APIs

**[PRINT: 35-admin-integracoes.png]**

**Permissão necessária:** `integrations:manage`.

Conecte sistemas externos: conectores prontos para **Salesforce** e **HubSpot** (URL já
pré-preenchida, só falta a credencial), ou um conector do tipo **customizado** para qualquer outro
sistema com API compatível.

---

## 9. Armazenamento e Documentos

**[PRINT: 36-admin-armazenamento.png]**

**Permissão necessária:** `storage:manage`.

Escolha onde os arquivos enviados pelos usuários (documentos de projeto, templates, etc.) são
fisicamente armazenados:

| Modo | Quando usar |
|---|---|
| Diretórios Locais | Instalação on-premise simples, sem dependência de nuvem |
| AWS S3 | Ambiente já usa infraestrutura AWS |
| Google Cloud Storage | Ambiente já usa infraestrutura GCP |

Cada modo pede os campos específicos daquele provedor (caminho local, nome do bucket S3, nome do
bucket GCS).

> Trocar o modo de armazenamento não migra automaticamente os arquivos já enviados no modo
> anterior — planeje essa mudança com cuidado, de preferência logo no início da operação da
> instância.

---

## 10. Auditoria e Diagnóstico

**[PRINT: 37-admin-auditoria.png]**

**Permissões necessárias:** `admin:audit` (log de auditoria), `admin:debug` /
`admin:diagnostics` (console de debug e diagnóstico).

- **Log de Auditoria** — botão "Audit Logs (N)" abre o livro completo de ações administrativas e
  sensíveis realizadas na instância (quem fez o quê e quando). **Exportar Livro CSV** gera um
  arquivo para auditoria externa/compliance.
- **Console de Diagnóstico** — botão "Abrir Console de Diagnóstico" abre uma tela técnica com
  logs de debug do sistema e um botão para **baixar o Pacote de Diagnóstico** (um resumo
  sanitizado do estado do sistema, útil para enviar ao suporte técnico em caso de problema).

**[PRINT: 38-admin-diagnostico.png]**

---

## 11. Boas práticas de administração

- **Prefira perfis a exceções por pessoa.** Se duas ou três pessoas vão precisar do mesmo conjunto
  de permissões, crie um perfil em vez de lembrar manualmente quem tem o quê.
- **Revise o log de auditoria periodicamente**, não só quando algo dá errado — é a forma mais
  simples de perceber uso indevido ou configuração incorreta cedo.
- **Trate os Templates de Propostas como um documento controlado.** Antes de ativar uma nova versão
  de template, revise o conteúdo — ele vira imediatamente o padrão para todas as propostas novas
  daquele tipo.
- **Configure o Teto Mensal de Custo de IA** (seção 3.1) desde o início, mesmo que generoso — evita
  surpresa na fatura do provedor de IA.
- **Ao adicionar um novo tipo de aprovador** em um fluxo (seção 5), prefira vincular por perfil em
  vez de pessoa específica sempre que fizer sentido — reduz a chance de uma aprovação travar por
  ausência de alguém.
