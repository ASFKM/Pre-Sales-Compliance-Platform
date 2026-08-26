# ADR 0001 — Integração com o CMCRM: o PreSales ganha uma porta de máquina, uma fila de demandas e um dono para cada pedido

**Status:** aceito — decisões fechadas com o dono do produto em 26/08/2026. **Nenhuma fase
executada.**
**Data:** 26 de agosto de 2026
**Origem:** sessão de intake da frente CMCRM ↔ PreSales, conduzida por perguntas de decisão até não
sobrar item solto. As 38 decisões foram tomadas pelo dono, uma a uma, sobre medição real dos três
sistemas.
**Plano de execução:** vive em **outro repositório** —
`ASFKM/fleet-manager:docs/cdc/16-integracao-cmcrm-presales.md`, junto das duas specs OpenAPI. Este
ADR registra **decisão**; aquele documento registra **fases**. Não existe um segundo plano de fases
aqui: duas listas mantidas dos dois lados divergiriam.
**ADR irmã, do lado do CRM:** `ASFKM/CMCRM:docs/adr/0014-integracao-presales.md`.
**Painel:** <https://claude.ai/code/artifact/423fe5e8-9b0d-49c5-bb8c-db82a59a70fb>

Esta é a primeira ADR do repositório. O formato segue o que os outros dois produtos do ecossistema
já usam.

---

## 1. Contexto

O CMCRM e o PreSales resolvem metades do mesmo trabalho comercial e hoje não se falam. Quando o
vendedor precisa de pré-venda técnica, o contexto é reconstruído à mão: o cliente é redigitado, o
edital é subido de novo e a oportunidade continua sem saber que existe trabalho técnico acontecendo.

Medido neste repositório em 26/08/2026, contra `main`:

- **Não existe superfície de máquina.** Todas as rotas de `server/routes/` são autenticadas por
  sessão humana (`requireAuth`, `requirePermission`). Não há nada equivalente a uma chave de
  máquina em lugar nenhum do produto. O ADR 0011 do CMCRM já havia medido isso em julho e
  registrado como pré-requisito externo — este é o documento que o assume.
- **Não existe estado de espera.** `Project.ownerUserId` é obrigatório e `ProjectStatus` vai de
  `draft` a `canceled` sem nada que represente trabalho ainda não atribuído. Projeto sem dono não
  existe hoje.
- **Não existe cadastro de cliente.** `Project.customerName` é texto livre, preenchido pela IA de
  intake a partir do edital. O CRM identifica empresa por CNPJ e por raiz de CNPJ; aqui, o cliente
  é prosa.
- **O que já ajuda**: o produto já tem módulos por licença emitidos pelo CMSaaS
  (`requireModule("poc")`, `requireModule("pricing")`, via `server/utils/fleetLicense.ts`), já tem
  adaptador de storage, e o `IntegrationConnector` já guarda segredo cifrado.

## 2. Decisões que mudam o PreSales

### 2.1 — Nasce a primeira porta de máquina do produto

O PreSales passa a expor uma superfície autenticada por **chave do par**, emitida e revogada pelo
CMSaaS quando as duas instalações são vinculadas — o mesmo espírito de `requireInstallationApiKey`
que o CMSaaS já usa, invertido de lado. O contrato está em
`fleet-manager:docs/cdc/16-contratos/presales-inbound.v1.yaml`.

Toda escrita aceita `Idempotency-Key` e reenviar não duplica. É isso que permite ao CRM entregar em
segundo plano, com repetição automática, sem risco de abrir duas demandas para a mesma oportunidade.

### 2.2 — O que chega é uma Demanda, não um Projeto

A **Demanda de pré-vendas** é entidade nova, com ciclo próprio: `queued`, `assigned`,
`in_analysis`, `returned`, `cancelled`, `completed`. Ela entra na fila **sem dono**, e só vira
`Project` quando alguém assume.

A alternativa seria tornar `ownerUserId` anulável e inventar um status de espera. Foi descartada
por três motivos: a lista de projetos passaria a conter o que ninguém triou; uma demanda devolvida
viraria um projeto que nunca existiu; e a fila precisa de campos que Project não deveria ter (quem
enviou, prazo, motivo da devolução, tentativas de entrega). Com a Demanda separada, **o Project
continua nascendo com dono, exatamente como hoje** — nenhuma regressão no modo standalone.

### 2.3 — O cliente é referência, não cadastro

O projeto guarda id, nome e CNPJ do cliente vindos do CRM. **O PreSales não ganha entidade de
cliente**, e a busca consulta o CRM ao vivo. Criar um cadastro espelhado custaria a entidade nova,
a migração dos projetos atuais (que hoje só têm texto livre) e um sincronismo que divergiria. O
preço aceito é não haver tela de "meus clientes" nem agrupamento de projetos por cliente sem
chamar o CRM.

**Nenhum contato pessoal é recebido.** O envelope traz a empresa, e não as pessoas. Quem assume
continua dependendo do vendedor para saber com quem falar — decisão consciente do dono, que reduz
a exposição de dado pessoal entre sistemas.

### 2.4 — Fila única, e três políticas de atribuição

A fila é **visível para toda a equipe**, com filtros por prazo, valor e vertical. A instalação
escolhe entre auto-serviço (padrão, e o único que funciona sem gerente), direcionamento pelo
gerente, e distribuição automática por menor carga. As três compartilham a mesma tela e o mesmo
evento de atribuição.

A distribuição automática exige definir **o que é carga**, e essa definição continua em aberto:
contar projetos ativos é a medida ingênua, e um critério ruim gera injustiça visível.

### 2.5 — Recusa existe, e passa pelo gerente quando houver gerente

Quem assume pode devolver a demanda com motivo escrito; havendo gerente de pré-vendas, ele aprova a
devolução. Sem recusa, pedido incompleto fica parado na fila sem ninguém querer pegar e o vendedor
nunca descobre por quê.

Isso cria uma **permissão nova** e, com ela, o papel de gerente de pré-vendas — que hoje não existe
no RBAC do produto.

### 2.6 — Prazo e medição são parte do produto, não relatório

Prazos por etapa são configurados pelo **administrador da instalação**, e o vencimento alerta o
gerente (ou a equipe, quando não houver gerente). **Toda solicitação gera medição de tempo de
resposta**: até assumir, até a análise, até a proposta.

O recorte de visibilidade é assimétrico de propósito: o CRM recebe o tempo daquela demanda e a
média da equipe; **o desempenho por pessoa fica aqui**, para quem gerencia a operação. O CRM não
vira ranking de gente de outro time.

### 2.7 — Documentos são copiados, e o expurgo é em cascata

O edital chega copiado, com `sha256` e **com o texto que o CRM já extraiu** — a extração de texto
do PDF não se repete, só a análise técnica, que é o que o produto existe para fazer. Hash já
conhecido não regrava, então adendo repetido e reenvio não duplicam armazenamento.

Em troca da autonomia (analisar sem depender do CRM estar no ar), o arquivo passa a existir nos dois
produtos. Por isso o **expurgo é em cascata**: o CRM apagando um documento ou uma empresa, por
retenção ou por pedido do titular, o PreSales apaga a cópia e devolve o que apagou. Sem isso,
apagar de um lado só seria conformidade de mentira.

### 2.8 — O modo integrado é um entitlement, não uma configuração local

O par é declarado no CMSaaS e chega aqui pelo mesmo mecanismo de licença que `poc` e `pricing` já
usam. O PreSales **não tem interruptor próprio** de integração: um lado achando que está integrado
enquanto o outro não sabe receber é um estado que não pode existir.

Quando o par cruza ambientes (produção com homologação, permitido de propósito), a interface
**marca isso visivelmente**.

### 2.9 — O caminho secundário continua, e passa a alimentar o CRM

Subir um edital direto continua funcionando. A diferença é que o PreSales passa a procurar o cliente
no CRM — por CNPJ, e por nome quando não houver CNPJ — e, não encontrando, cria a empresa e a
oportunidade lá, com origem `presales`.

Busca por nome **nunca decide sozinha**: casar "PETROBRAS - EDISE" com "PETRÓLEO BRASILEIRO S.A."
por nome erra, e por isso o resultado por nome sempre volta para confirmação humana. Como
consequência, a extração do intake passa a caçar o CNPJ no documento, que hoje ela não faz.

### 2.10 — O que o produto devolve ao CRM

Marcos com a data real do fato (não a do envio), estado do projeto, riscos técnicos, escopo
resumido, POC com a decisão do aceite, valor de precificação e a **proposta completa** — itens,
documento, versões e o carimbo de quem aprovou aqui. Tudo volta porque tudo entra na medição do
esforço até o fechamento.

A proposta aprovada aqui **não é reaberta** pela alçada de desconto do CRM: uma proposta, um fluxo
de aprovação, e o fluxo é o deste produto.

## 3. Consequências

- **Modo standalone permanece idêntico.** Nada nesta ADR muda o comportamento do produto quando não
  há par: o intake continua criando projeto com dono, o cliente continua sendo texto livre e as
  telas novas não aparecem.
- **Entidades novas**: Demanda, documentos da demanda, atualizações pendentes e eventos.
- **Permissão nova**: gerente de pré-vendas.
- **Campos novos no Project**: referência do cliente, da oportunidade e da demanda no CRM.
- **Custo de IA**: inalterado deste lado. A ficha é montada pelo CRM; a análise técnica continua
  sendo a mesma que já existe.
- **Custo de armazenamento**: cresce, porque todo edital enviado passa a existir aqui também.

## 4. Alternativas descartadas

- **`ownerUserId` anulável com status de espera**, em vez da Demanda (ver §2.2).
- **Cadastro de clientes espelhado do CRM** (ver §2.3).
- **Rotear tudo pelo CMSaaS**, em vez de tráfego direto: poria o CMSaaS no caminho crítico do
  trabalho comercial e faria arquivo grande trafegar duas vezes.
- **Credencial cadastrada à mão em cada lado**: mais rápida, e sem revogação nem rotação
  governadas.
- **Receber os stakeholders do cliente**: seria mais útil para quem analisa e espalharia dado
  pessoal entre sistemas. O dono optou por não receber.

## 5. O que não muda

- O PreSales continua sendo uma instalação gerenciada pelo CMSaaS: licença, módulos, roadmap,
  diagnóstico e proxy de IA seguem como estão.
- As rotas existentes continuam autenticadas por sessão humana. A porta de máquina é uma superfície
  **nova e separada**, não uma flexibilização das rotas atuais.
- O fluxo de aprovação de proposta, os templates, o DOCX e o motor de precificação seguem
  intactos — a integração leva o resultado deles ao CRM, não os substitui.
