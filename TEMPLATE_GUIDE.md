# Proposal Template & Variable Guide

The DOCX template engine (`server/utils/docxTemplateEngine.ts`, backed by `docxtemplater`) lets you
upload a real Microsoft Word (`.docx`) file with `{{variable}}` placeholders and generate a
compliant proposal document from real project/analysis data.

This guide is a human-readable mirror of the canonical variable catalog
(`server/utils/templateVariableCatalog.ts`) — the same source of truth used by:
- the **variable glossary panel** in Admin → Templates de Propostas (with copy-to-clipboard per
  variable), and
- the **`POST /proposals/:id/validate`** endpoint, which reads the real placeholders out of an
  uploaded `.docx` and flags any that aren't a real recognized variable (those would otherwise
  silently render blank in the generated document).

If you add or rename a variable in `templateVariableCatalog.ts`, the glossary panel and the
validation check both update automatically — there is nothing else to keep in sync.

---

## 1. Simple variables

Place a variable anywhere in the document body using `{{variable_name}}`.

### Cliente e Projeto
| Variable | What it brings |
|---|---|
| `{{cliente}}` | Customer name. |
| `{{projeto}}` | Project title/name. |
| `{{codigo_oportunidade}}` | Associated commercial opportunity name/code. |
| `{{vertical}}` | Market vertical (e.g. Public Security, Retail, Education). |
| `{{escopo}}` | Project scope/description as registered. |
| `{{status_projeto}}` | Current project status in the system. |
| `{{prazo_projeto}}` | Project deadline. |
| `{{data_validade_projeto}}` | Proposal validity date from the project record (distinct from `{{validade_proposta}}` below, which is the commercial text entered for this specific proposal). |
| `{{modalidade_contratacao}}` | Procurement modality/subtype, when applicable (e.g. public tender type). |
| `{{responsavel_projeto}}` | Name of the project owner in the system. |

### Resumo Executivo
| Variable | What it brings |
|---|---|
| `{{resumo_executivo}}` | AI-generated project overview. |
| `{{contexto_cliente}}` | Customer context identified by the analysis (current situation, motivation). |
| `{{principais_requisitos}}` | Synthesis of the most important identified requirements. |
| `{{principais_riscos}}` | Synthesis of the main identified risks. |
| `{{principais_oportunidades}}` | Synthesis of the main identified commercial opportunities. |
| `{{estrategia_recomendada}}` | Recommended sales strategy/approach from the analysis. |
| `{{premissas_tecnicas}}` | Technical assumptions the analysis made interpreting the tender documents. |
| `{{proximos_passos}}` | Recommended next steps from the analysis. |

### Comercial
| Variable | What it brings |
|---|---|
| `{{preco_total}}` | Sum of the pricing table — real Módulo de Precificação data when the project has one, otherwise the manually-typed table (2 decimal places). See `{{#precificacao}}` below. |
| `{{termos_pagamento}}` | Payment terms for this proposal. |
| `{{termos_entrega}}` | Delivery terms for this proposal. |
| `{{validade_proposta}}` | Commercial validity text entered when generating this specific proposal. |
| `{{premissas_comerciais}}` | Commercial assumptions entered for this proposal. |
| `{{exclusoes}}` | Contractual exclusions entered for this proposal. |

---

## 2. Loop variables (repeating tables)

Loop variables repeat a block once per item — in Word, wrap a table row (or any block of text)
between `{{#nome}}` and `{{/nome}}`. When both tags sit in the same table row, `docxtemplater`
repeats the whole row per item (its own documented behavior).

### `{{#bom}}` — Bill of Materials
`{{equipamento}}`, `{{fabricante}}` ("N/D" if not found), `{{quantidade}}`, `{{unidade}}`,
`{{categoria}}`, `{{especificacao}}`.

### `{{#requisitos_criticos}}` — Critical Requirements
`{{descricao}}`, `{{status}}` (`compliant`/`partially_compliant`/`non_compliant`/
`not_enough_information`), `{{prioridade}}` (`high`/`medium`/`low`), `{{obrigatorio}}`
(`mandatory`/`optional`), `{{confianca}}` (AI confidence, 0–1).

### `{{#riscos}}` — Risks
`{{titulo}}`, `{{descricao}}`, `{{severidade}}` (`low`/`medium`/`high`/`critical`),
`{{probabilidade}}`, `{{impacto}}`, `{{mitigacao}}` ("N/D" if not found), `{{area_responsavel}}`.

### `{{#oportunidades}}` — Opportunities
`{{titulo}}`, `{{descricao}}`, `{{valor_negocio}}`, `{{solucao_sugerida}}`,
`{{estrategia_venda}}`, `{{prioridade}}`.

### `{{#cronograma_preliminar}}` — Preliminary Schedule
`{{fase}}`, `{{atividades}}` (semicolon-joined), `{{duracao_estimada}}`, `{{dependencias}}`
(semicolon-joined), `{{area_responsavel}}`, `{{premissas}}`, `{{riscos_fase}}`.

### `{{#matriz_requisitos}}` — Point-to-Point Technical Matrix
One entry per technical discipline (e.g. CFTV, network, electrical) — the underlying matrix has
different columns per discipline, so it can't be looped as a fixed DOCX table. Each entry instead
provides:
`{{disciplina}}` (discipline name), `{{tabela_texto}}` (a ready-to-drop-in plain-text rendering of
that discipline's table, one row per line, columns separated by ` | `).

### `{{#perguntas_esclarecimento}}` — Clarification Questions
`{{pergunta}}`, `{{motivo}}`, `{{prioridade}}`, `{{publico_alvo}}` (e.g. customer vs. internal
technical team).

### `{{#precificacao}}` — Pricing Table
`{{item}}`, `{{quantidade}}`, `{{preco_unitario}}` (2 decimals), `{{preco_total_item}}` (2
decimals), `{{moeda}}`.

Two possible sources, resolved automatically in `docxTemplateEngine.ts` — a template author never
picks one, it's whichever the project actually has:
- **Módulo de Precificação (add-on)**: when the project has a real pricing sheet with priced
  lines, those win — `{{moeda}}` is always `BRL` (the catalog's canonical currency), and BOM lines
  without a catalog match or without a final price are silently left out of the table (not an
  error — the proposal can still be generated with a partial table).
- **Manual pricing table**: the fallback when there's no real pricing sheet — the table typed
  directly into the proposal-generation form, `{{moeda}}` is whatever currency was chosen per row.

Either way, only `{{item}}`/`{{quantidade}}`/`{{preco_unitario}}`/`{{preco_total_item}}`/
`{{moeda}}` are ever available — markup and list price are a deliberate, enforced omission (never
copied into the data structure the template resolver receives in the first place, not just
"not mapped"), so a proposal template can never expose your margin to the customer.

---

## 3. The 7 proposal document types

Every type below is generated from the **same** template engine and the **same** full variable
set above — "type" only categorizes which document a template represents and where it appears in
the Studio, it does not change which variables are available:

| Type | Typical content |
|---|---|
| `technical` | Executive summary, requirements compliance, schedule, point-to-point matrix. |
| `commercial` | Pricing table, discounts, delivery terms, commercial assumptions/exclusions. |
| `technical_commercial` | Fuses technical and commercial content into one document. |
| `executive_summary` | Concise, leadership-facing overview: context, requirements, risks, opportunities, recommended strategy. |
| `risk_report` | Every identified risk with severity, probability, impact, mitigation, owner area. |
| `bom_report` | Standalone bill-of-materials report. |
| `questions_report` | Every clarification question recommended for the customer, with reason and priority. |

---

## 4. Uploading a template

1. Go to **Admin → Templates de Propostas**.
2. Drag-and-drop (or select) your `.docx` file, name it, pick its type from the 7 above.
3. Check the **variable glossary panel** right next to the upload form for the exact variable
   names available — copy-paste them directly into your Word document.
4. After upload, use **Validate** to confirm every placeholder in your file is recognized. Any
   unrecognized placeholder is flagged explicitly — it would otherwise silently render blank in
   every proposal generated from that template.
5. Mark the template "Active"/"Default" as needed. Generate proposals for a project from
   **Workspace → Estúdio de Propostas**, picking the template per type.
