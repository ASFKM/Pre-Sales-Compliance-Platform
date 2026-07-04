Você está assumindo o projeto Commercial Assistant AI em `/home/sakae/projects/commercial-assistant-ai`.

Leia primeiro:

    docs/handovers/admin-console-enterprise-handover-2026-07-04.md
    docs/checkpoints/rbac-approval-release-2026-07-03.md

Contexto rápido:

- Repositório GitHub: `asakaef/Pre-Sales-Compliance-Platform`
- Branch principal: `main`
- Runtime local: systemd service `commercial-assistant-ai`
- O systemd NÃO roda TypeScript direto. Ele roda:
      node /home/sakae/projects/commercial-assistant-ai/dist/server.cjs
- Após alterar backend em `server/routes/*.ts`, você precisa rodar:
      npm run build
      sudo systemctl restart commercial-assistant-ai
  antes de validar endpoints da API.
- `dist` está no `.gitignore`. Não tente commitar `dist`.
- Mantenha GitHub atualizado: toda entrega fechada deve ter commit, push e CI confirmado.
- Evite `gh run watch`. Use:
      gh run list --repo asakaef/Pre-Sales-Compliance-Platform --branch main --limit 5

O usuário quer a aba Admin Console funcionando como produto final enterprise. A seção `Subscription & License` deve permanecer visível na Admin Console, mas licenciamento/subscrição real deve ser implementado por último, em fase separada. Não remova essa aba.

Situação atual:

- Último HEAD observado: `3fe5126 test: cover admin diagnostics permission hardening`.
- CI para esse commit estava verde.
- Muitos hardenings de Admin Console já foram aplicados e estão no GitHub:
  - diagnostics enterprise-safe;
  - integration validation configuration-only;
  - authenticated actor em audit logs de users/roles;
  - role permission validation;
  - template validation;
  - approval workflow validation;
  - storage validation;
  - branding validation;
  - AI/prompt validation;
  - global settings validation;
  - audit query/csv validation;
  - diagnostics permissions/headers.
- Existem regressões:
      npm run regression:approval-rbac
      npm run regression:workspace-documents
      npm run regression:admin-console

Problema crítico aberto:

A regressão Admin Console falha em:

    FAIL - duplicate user email is blocked
    Expected HTTP 409, got HTTP 201

Causa:

`server/routes/users.ts`, rota `POST /api/users`, ainda não valida duplicidade de e-mail nem role inexistente no create.

Trecho atual aproximado:

    const validated = CreateUserSchema.parse(req.body);
    const normalizedEmail = validated.email.toLowerCase().trim();
    const userId = "u_" + Math.random().toString(36).substring(2, 11);

Correção esperada antes de `userId`:

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

Depois da correção:

1. Rodar lint:
      npm run lint

2. Rodar build:
      npm run build

3. Reiniciar runtime:
      sudo systemctl restart commercial-assistant-ai
      sleep 5
      curl -s -w "\nHTTP:%{http_code}\n" http://127.0.0.1:3000/api/health

4. Rodar regressão Admin:
      npm run regression:admin-console

5. Se passar:
      git diff --check
      git add server/routes/users.ts
      git commit -m "fix: validate admin user creation constraints"
      git push origin main
      gh run list --repo asakaef/Pre-Sales-Compliance-Platform --branch main --limit 5

Use background com log para tarefas longas:

    nohup bash -lc '
    set -euo pipefail
    npm run lint
    npm run build
    sudo systemctl restart commercial-assistant-ai
    sleep 5
    npm run regression:admin-console
    git diff --check
    git add server/routes/users.ts
    git commit -m "fix: validate admin user creation constraints"
    git push origin main
    sleep 10
    gh run list --repo asakaef/Pre-Sales-Compliance-Platform --branch main --limit 5
    git log -1 --oneline
    git status --short
    ' > /tmp/next_ai_user_fix.log 2>&1 &

    cat /tmp/next_ai_user_fix.log

Regras operacionais importantes:

- Não rode comandos gigantes em foreground na sessão SSH.
- Não entre em loop operacional ou loop de validação.
- Uma falha de regressão é um bug objetivo. Corrija aquele bug e rode novamente somente o necessário.
- Sempre confirme se o backend em execução usa o build novo:
      grep -snE "User email already exists|Role does not exist" dist/server.cjs | head
- Não remover Subscription da Admin Console.
- Não implementar Subscription agora. Implementar por último.
- Não commitar `dist`.
- Não deixar GitHub desatualizado após uma entrega fechada.

Depois de corrigir o bug de `POST /api/users` e passar `npm run regression:admin-console`, avance para:

1. auditoria visual/funcional da UI Admin Console;
2. remover qualquer botão visual sem endpoint real;
3. confirmar que todos os painéis Admin têm RBAC consistente;
4. criar documentação/checkpoint da Admin Console enterprise;
5. só depois abrir fase `Subscription & License`.
