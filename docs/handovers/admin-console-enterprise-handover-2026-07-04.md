# Handover: Commercial Assistant AI - Admin Console Enterprise Hardening

Data: 2026-07-04  
Repositório: `asakaef/Pre-Sales-Compliance-Platform`  
Diretório local: `/home/sakae/projects/commercial-assistant-ai`  
Branch principal: `main`  
Runtime systemd: `commercial-assistant-ai`  
Runtime real em produção local: `node dist/server.cjs`  
Arquivo systemd: `/etc/systemd/system/commercial-assistant-ai.service`  
ExecStart observado: `/usr/bin/node /home/sakae/projects/commercial-assistant-ai/dist/server.cjs`

## 1. Resumo executivo

Este projeto é uma plataforma enterprise de pré-vendas chamada Commercial Assistant AI. A aplicação combina:

- frontend React/Vite em `src/App.tsx`;
- backend Express/TypeScript em `server.ts` e `server/routes/*`;
- store local JSON via `src/dbStore.ts` e `db_state.json`;
- geração de propostas DOCX/PDF;
- workspace de documentos;
- análise por IA/Gemini;
- RBAC por permissões;
- Admin Console com usuários, roles, settings, IA, prompts, templates, workflows, branding, integrações, storage, auditoria e diagnósticos;
- regressões shell versionadas em `scripts/`.

O objetivo do ciclo atual foi levar a Admin Console para um padrão enterprise funcional, mantendo a seção `Subscription & License` visível, mas deixando licenciamento/subscrição real para ser implementado por último em fase separada.

## 2. Regra de escopo importante

A aba `Subscription & License` deve permanecer dentro da Admin Console. Ela não deve ser removida.

O usuário deixou claro:

- licenciamento real;
- subscrição real;
- billing;
- ativação/renovação de licença real;
- limites comerciais por plano;

ficam para uma fase separada e devem ser implementados por último.

Não remover a aba. Não ocultar a aba. Apenas não tratar a implementação real até o fechamento das demais áreas enterprise.

## 3. Estado atual no momento deste handover

Último estado observado:

- `HEAD` e `origin/main` estavam em `3fe5126`.
- Commit mais recente: `test: cover admin diagnostics permission hardening`.
- CI mais recente listado para `3fe5126`: sucesso.
- Serviço `commercial-assistant-ai`: ativo.
- Health endpoint: HTTP 200.
- Working tree estava limpo após as tentativas finais.
- `npm run lint` e `npm run build` estavam passando nos últimos ciclos.
- O build local gera `dist/server.cjs`, e o systemd roda esse arquivo, não os arquivos TypeScript diretamente.

Atenção: se alterar `server/routes/*.ts`, é obrigatório rodar:

    npm run build
    sudo systemctl restart commercial-assistant-ai

antes de validar comportamento por API, porque o runtime real usa `dist/server.cjs`.

## 4. Dinâmica operacional que funcionou

A sessão SSH apresentou instabilidade quando comandos grandes eram executados em foreground, principalmente quando misturavam patch, lint, build, restart, regressão, commit, push e CI no mesmo bloco.

O padrão que funcionou foi:

1. aplicar patch pequeno;
2. validar com grep ou inspeção curta;
3. executar lint/commit/push em background com `nohup bash -lc`;
4. ler log em `/tmp/...log`;
5. confirmar CI com `gh run list`, sem `gh run watch`.

Exemplo seguro:

    nohup bash -lc '
    set -euo pipefail
    npm run lint
    git diff --check
    git add <arquivos>
    git commit -m "<mensagem>"
    git push origin main
    sleep 10
    gh run list --repo asakaef/Pre-Sales-Compliance-Platform --branch main --limit 5
    git log -1 --oneline
    git status --short
    ' > /tmp/nome_do_job.log 2>&1 &

Depois ler:

    cat /tmp/nome_do_job.log

Evitar:

- comandos gigantes em foreground;
- `gh run watch`;
- rebuild/restart/regressão/commit no mesmo bloco se não for necessário;
- repetir validações completas sem uma alteração funcional nova;
- rodar regressão contra o serviço sem rebuild/restart depois de alterar backend TypeScript.

## 5. Arquitetura do projeto

### 5.1 Frontend

Arquivo principal:

    src/App.tsx

Ele contém a maior parte da UI e estados da aplicação:

- navegação global;
- Workspace;
- Proposal Studio;
- Approval Center;
- Admin Console;
- modais;
- handlers de upload, proposal generation, approval, admin settings, integrations, diagnostics etc.

Login:

    src/components/Login.tsx

Tipos:

    src/types.ts

### 5.2 Backend

Entry point:

    server.ts

Build:

    npm run build

Esse build roda:

    vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs

Runtime systemd:

    node dist/server.cjs

Rotas principais:

    server/routes/auth.ts
    server/routes/users.ts
    server/routes/roles.ts
    server/routes/settings.ts
    server/routes/templates.ts
    server/routes/approvals.ts
    server/routes/integrations.ts
    server/routes/audit.ts
    server/routes/diagnostics.ts
    server/routes/documents.ts
    server/routes/proposals.ts
    server/routes/projects.ts
    server/routes/analysis.ts

Store:

    src/dbStore.ts
    db_state.json

Utilitários relevantes:

    server/utils/security.ts
    server/utils/storage.ts
    server/utils/extraction.ts
    server/utils/docx.ts

### 5.3 Autenticação e RBAC

Auth e permissões estão em:

    server/routes/auth.ts

Sessões expõem:

- `user.id`
- `user.name`
- `user.email`
- `user.role_id`
- `user.role`
- `user.permissions`

Permissões principais vistas no ciclo:

    project:create
    project:read
    project:update
    project:delete
    document:upload
    document:read
    document:delete
    analysis:run
    analysis:read
    analysis:edit
    analysis:approve
    proposal:generate
    proposal:edit
    proposal:approve
    proposal:export
    template:manage
    approval:manage
    admin:users
    admin:roles
    admin:settings
    admin:audit
    admin:debug
    admin:diagnostics
    ai:settings
    branding:manage
    storage:manage
    integrations:manage

## 6. Regressões versionadas

Atualmente existem regressões importantes:

    npm run regression:approval-rbac
    npm run regression:workspace-documents
    npm run regression:admin-console

Scripts:

    scripts/regression-approval-rbac.sh
    scripts/regression-workspace-documents.sh
    scripts/regression-admin-console.sh

### 6.1 Approval RBAC

Cobre:

- geração de proposta técnica;
- export DOCX;
- bloqueio de submit sem `approval:manage`;
- submit por manager;
- aprovação por alvo de etapa;
- release final;
- auditoria;
- limpeza de arquivos gerados.

### 6.2 Workspace Documents

Cobre:

- listagem de documentos;
- upload inválido;
- upload TXT válido;
- extração de texto;
- preview;
- reclassificação;
- RBAC de delete;
- remoção física;
- auditoria;
- cleanup.

### 6.3 Admin Console Compact

Cobre grande parte da Admin Console:

- Subscription permanece visível e reservada para última fase;
- cópias fake de diagnostics foram removidas;
- Users/Roles;
- Settings/AI/Prompts;
- Branding;
- Storage;
- Templates;
- Approval Workflows;
- Integrations;
- Audit;
- Diagnostics.

A regressão Admin Console atualmente está falhando no teste:

    duplicate user email is blocked

porque o endpoint `POST /api/users` ainda não valida duplicidade no create. Ver seção de bug aberto.

## 7. Checkpoint anterior importante

Tag técnica criada:

    checkpoint-rbac-approval-release-2026-07-03

Ela aponta para:

    0954872ac7daa3422086b450d96cf19218889594

Documento:

    docs/checkpoints/rbac-approval-release-2026-07-03.md

Esse checkpoint fecha o ciclo RBAC/proposals/approval/release/regression antes do endurecimento amplo da Admin Console.

## 8. Histórico funcional fechado neste ciclo

### 8.1 Proposals / Approval / Release

Fechado antes deste handover:

- geração de propostas por templates selecionados;
- geração DOCX/PDF;
- validação de template técnico/comercial;
- submit para aprovação;
- aprovação por etapa e alvo configurado;
- bloqueio de decisão em status inválido;
- bloqueio de decisão duplicada;
- release final somente após approved;
- export protegido por `proposal:export`;
- edição bloqueada após draft;
- UI alinhada ao alvo real da etapa;
- regressão `regression:approval-rbac`.

Commits importantes:

    d73132d feat: generate proposals from selected templates
    d9d9cc2 fix: enforce proposal approval state rules
    9d28629 feat: release approved proposals
    ac87cfc fix: lock proposal edits after draft
    7b595a1 fix: require proposal export permission
    25fa344 feat: expose session permissions and gate proposal UI actions
    5b6c80e feat: gate admin console sections by permission
    0f295ec fix: enforce approval stage approver targets
    5c67c3b fix: align approval UI with stage approver targets
    2c8a93b test: add approval RBAC regression script
    8a28d65 chore: add approval RBAC regression npm script
    0954872 test: clean generated files in approval RBAC regression
    7145e94 docs: document RBAC approval release checkpoint

### 8.2 Workspace Documents

Fechado:

- script de regressão Workspace/Documents;
- npm script `regression:workspace-documents`;
- upload, preview, reclassificação, delete, auditoria e cleanup.

Commits:

    d3343c9 test: add workspace documents regression script
    103057a chore: add workspace documents regression npm script

### 8.3 Admin Console - regressão base

Fechado:

    9d9dc8c test: add compact admin console regression

### 8.4 Admin Diagnostics enterprise-safe

Fechado:

- UI de diagnostics deixou de usar linguagem fake;
- pacote de diagnóstico baixa via endpoint real;
- textos como “Fully Decrypted” e “Active Channels: 3” foram removidos;
- Admin regression verifica que essas cópias fake não existem.

Commits:

    b040c8d fix: make admin diagnostics console enterprise-safe

### 8.5 Integration validation enterprise-safe

Fechado:

- endpoint de teste de integração agora é honesto: valida configuração, não simula sync externo;
- retorna `validation_mode: configuration_only`;
- retorna `external_sync_executed: false`;
- `latency_ms: null`;
- auditoria usa `Validate Integration Configuration`.

Commit:

    abe4fb3 fix: make integration validation enterprise-safe

### 8.6 Audit actor real

Fechado:

- Users/Roles audit logs usam ator autenticado via `x-user-id` em vez de `"System Admin"`.

Commit:

    b2fbf9d fix: record authenticated actor in admin audit logs

### 8.7 Users Admin hardening parcial

Fechado parcialmente:

- `PUT /api/users/:id` valida `role_id`;
- `PUT /api/users/:id` bloqueia e-mail duplicado;
- update de senha mascara metadata com `[password-updated]`;
- `DELETE /api/users/:id` retorna 404 se não existe;
- `DELETE /api/users/:id` bloqueia self-delete;
- audit usa ator autenticado.

Commit:

    f2bcdb2 fix: harden admin user management validation

Bug aberto: `POST /api/users` ainda não valida duplicidade de e-mail nem role inexistente. Ver seção 10.

### 8.8 Roles Admin hardening

Fechado:

- roles agora validam permissões contra allowlist;
- permissões inválidas retornam 400 com `invalid_permissions`;
- built-in roles continuam protegidas.

Commits:

    26f3dba fix: validate admin role permissions
    e4c80df test: cover admin user and role hardening

### 8.9 Templates Admin hardening

Fechado:

- nome duplicado bloqueado;
- `file_path` precisa bater com `file_type`;
- regressão cobre duplicado e mismatch.

Commits:

    73035f0 fix: harden admin proposal template validation
    5f8a72e test: cover admin template validation hardening

### 8.10 Approval Workflows Admin hardening

Fechado:

- nome duplicado bloqueado;
- etapa precisa ter alvo configurado;
- approver role/user precisa existir;
- stage names duplicados bloqueados;
- regressão cobre workflow duplicado e role inexistente.

Commits:

    4589f33 fix: harden admin approval workflow validation
    e7e0b77 test: cover admin approval workflow hardening

### 8.11 Storage Admin hardening

Fechado:

- `storage_mode` apenas `local`, `s3`, `gcs`;
- `local_storage_path` não pode ser vazio, `/`, `.`, nem conter byte nulo;
- `s3_bucket` e `gcs_bucket` precisam ser nome de bucket, não URL/path;
- modo efetivo exige campo correspondente;
- regressão cobre modo inválido, path inválido, URL em bucket e RBAC.

Commits:

    6920f53 fix: harden admin storage settings validation
    2923685 test: cover admin storage validation hardening

### 8.12 Branding Admin hardening

Fechado:

- `company_name` não pode ser vazio;
- cores precisam ser HEX;
- theme apenas `light` ou `dark`;
- logo/path não aceita `javascript:`, URL externa ou `..`, exceto `data:image/...`;
- regressão cobre valores inválidos.

Commits:

    f1a7b8a fix: harden admin branding validation
    360a3ae test: cover admin branding validation hardening

### 8.13 AI Settings e Prompt Templates hardening

Fechado:

- AI settings não aceitam provider/model vazios;
- idioma apenas `Portuguese`, `English`, `Spanish`;
- log level apenas `DEBUG`, `INFO`, `WARN`, `ERROR`;
- prompts aceitam allowlist de campos;
- prompt content/name/type/version não podem ser vazios;
- prompt language validado;
- `is_active` precisa ser booleano;
- regressão cobre inválidos.

Commits:

    ff4b268 fix: harden admin ai and prompt validation
    27dfc5d test: cover admin ai and prompt validation hardening

### 8.14 Global Settings hardening

Fechado:

- `/api/settings` agora deve aceitar apenas:
  - `default_language`;
  - `default_log_level`.
- impede bypass de campos AI/Storage via endpoint global;
- regressão cobre rejeição de campos scoped.

Commits:

    483247b fix: harden global platform settings validation
    dc2bce1 test: cover global settings validation hardening

### 8.15 Audit Admin hardening

Fechado:

- valida `from`, `to`, intervalo invertido e tamanho de `q`;
- CSV export mitiga CSV formula injection prefixando `'` para valores perigosos;
- regressão cobre datas inválidas, intervalo invertido e query longa.

Commits:

    d07678f fix: harden admin audit query and csv export validation
    7c277ec test: cover admin audit validation hardening

### 8.16 Diagnostics Admin hardening

Fechado:

- granularização de permissões:
  - debug logs usam `admin:debug`;
  - system status e diagnostic package usam `admin:diagnostics`;
- headers no-store/nosniff;
- sanitização de correlation id;
- regressão cobre manager bloqueado, admin permitido, download e sanitização.

Commits:

    c6daa26 fix: harden admin diagnostics permissions and headers
    3fe5126 test: cover admin diagnostics permission hardening

## 9. Estado de CI

Últimos CIs observados estavam todos verdes.

Comandos úteis:

    gh run list --repo asakaef/Pre-Sales-Compliance-Platform --branch main --limit 5

Evitar:

    gh run watch

porque a sessão SSH caiu várias vezes quando comandos longos ficavam presos.

## 10. Bug aberto crítico: POST /api/users

O bug mais importante e imediato:

Arquivo:

    server/routes/users.ts

Rota:

    router.post("/", requirePermission("admin:users"), ...)

Estado atual observado no source:

    const validated = CreateUserSchema.parse(req.body);
    const normalizedEmail = validated.email.toLowerCase().trim();
    const userId = "u_" + Math.random().toString(36).substring(2, 11);

Ou seja, no create:

- normaliza e-mail;
- não verifica se `role_id` existe;
- não verifica se o e-mail já existe;
- cria o usuário.

A regressão `npm run regression:admin-console` falha aqui:

    FAIL - duplicate user email is blocked
    Expected HTTP 409, got HTTP 201

Isso precisa ser a primeira correção da próxima IA.

Correção esperada em `POST /api/users`, logo após `normalizedEmail` e antes de `userId`:

    const roleExists = dbStore.getData().roles.some(r => r.id === validated.role_id);
    if (!roleExists) {
      return res.status(400).json({ success: false, message: "Role does not exist." });
    }

    const duplicatedEmail = dbStore.getData().users.some(u =>
      u.email.toLowerCase().trim() === normalizedEmail
    );

    if (duplicatedEmail) {
      return res.status(409).json({ success: false, message: "User email already exists." });
    }

Depois:

    npm run lint
    npm run build
    sudo systemctl restart commercial-assistant-ai
    npm run regression:admin-console

Importante: não validar a API contra código TS sem build/restart, pois o runtime real é `dist/server.cjs`.

## 11. Atenção sobre dist

`dist` está no `.gitignore`.

Não tentar:

    git add dist

O CI usa build próprio. Localmente, para systemd, rode:

    npm run build
    sudo systemctl restart commercial-assistant-ai

O `dist/server.cjs` precisa ser atualizado localmente para a API refletir mudanças.

## 12. Roadmap recomendado a partir daqui

### Fase imediata

1. Corrigir `POST /api/users`:
   - role inexistente retorna 400;
   - e-mail duplicado retorna 409.
2. Rodar:
   - `npm run lint`;
   - `npm run build`;
   - restart systemd;
   - `npm run regression:admin-console`.
3. Se passar:
   - commit;
   - push;
   - confirmar CI.
4. Se falhar:
   - corrigir o próximo ponto objetivo da regressão, sem loops.

### Fase Admin Console enterprise restante

Após Admin regression passar:

1. Revisar UI Admin Console visualmente:
   - Users;
   - Roles;
   - AI;
   - Prompts;
   - Templates;
   - Approval Workflow;
   - Branding;
   - Integrations;
   - Storage;
   - Audit;
   - Diagnostics;
   - Subscription visível mas não implementada.
2. Verificar se botões visuais correspondem a endpoints reais.
3. Remover ou ajustar qualquer texto fake, simulado ou enganoso.
4. Criar checkpoint/tag de fechamento da Admin Console enterprise.

### Fase por último

Subscription & License:

- manter no Admin Console;
- implementar por último;
- tratar como fase separada;
- incluir licenciamento real, billing, planos, limites comerciais, ativação/renovação e auditoria própria.

## 13. Comandos úteis para próxima IA

Status rápido:

    git status --short
    git log -8 --oneline --decorate
    systemctl is-active commercial-assistant-ai
    curl -s -w "\nHTTP:%{http_code}\n" http://127.0.0.1:3000/api/health

Build runtime:

    npm run lint
    npm run build
    sudo systemctl restart commercial-assistant-ai
    sleep 5
    curl -s -w "\nHTTP:%{http_code}\n" http://127.0.0.1:3000/api/health

Regressões:

    npm run regression:approval-rbac
    npm run regression:workspace-documents
    npm run regression:admin-console

CI:

    gh run list --repo asakaef/Pre-Sales-Compliance-Platform --branch main --limit 5

Background seguro:

    nohup bash -lc '
    set -euo pipefail
    npm run lint
    git diff --check
    git add <files>
    git commit -m "<message>"
    git push origin main
    sleep 10
    gh run list --repo asakaef/Pre-Sales-Compliance-Platform --branch main --limit 5
    git log -1 --oneline
    git status --short
    ' > /tmp/job.log 2>&1 &

    cat /tmp/job.log

## 14. Como evitar repetir os erros deste ciclo

A próxima IA deve seguir estas regras:

- não misturar patch grande, lint, build, restart, regressão, commit, push e CI no mesmo comando foreground;
- usar background com log para tarefas longas;
- quando alterar backend TS, lembrar que systemd usa `dist/server.cjs`;
- sempre rodar build e restart antes de validar API;
- não tentar commitar `dist`;
- não repetir regressão completa sem uma nova alteração funcional;
- manter GitHub atualizado a cada entrega fechada;
- confirmar CI com `gh run list`, não com `gh run watch`;
- tratar cada falha da regressão como um bug objetivo;
- não remover Subscription da Admin Console;
- não implementar Subscription antes de fechar o restante da Admin Console enterprise.

## 15. Prompt pronto para a próxima IA

O prompt pronto também foi salvo em:

    docs/handovers/NEXT_AI_PROMPT_admin_console_enterprise_2026-07-04.md
