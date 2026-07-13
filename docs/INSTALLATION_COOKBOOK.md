# Installation Cookbook — From Zero to First Login

This is a step-by-step recipe for standing up a brand new Commercial Assistant AI instance —
either for local evaluation or as the starting point for a real deployment. For the environment
variable reference and other deployment options, see [../DEPLOYMENT.md](../DEPLOYMENT.md). For the
module/data layout, see [../ARCHITECTURE.md](../ARCHITECTURE.md).

---

## 0. Before you start

You need:
- **Node.js** v20 or v22, **npm** v10+.
- **Docker** and **Docker Compose** (recommended path below), or your own PostgreSQL 16+ and
  Redis 7+ instances.
- At least one AI provider API key — Anthropic, OpenAI, or Google (Gemini). You only need one to
  get started; the others can be added later, and different task types can use different
  providers.

---

## 1. Clone and configure

```bash
git clone git@github.com:ASFKM/Pre-Sales-Compliance-Platform.git
cd Pre-Sales-Compliance-Platform
cp .env.example .env
```

Generate two strong secrets and set them in `.env`:
```bash
# SECRET_ENCRYPTION_KEY - encrypts connector credentials & TOTP secrets at rest
openssl rand -hex 32

# JWT_SESSION_SECRET - signs session tokens
openssl rand -hex 32
```

Decide your runtime mode now, in `.env`:
```env
APP_RUNTIME_MODE=demo        # local evaluation only
VITE_APP_RUNTIME_MODE=demo
ENABLE_DEMO_LOGIN=true
ENABLE_DEMO_MFA=true
```
**For any real deployment, all four of the above must be `production`/`false` instead** — see the
production checklist at the end of this document. Demo mode exists purely so you can log in and
click around with the seeded users below before connecting anything real.

---

## 2. Bring up PostgreSQL, Redis, and (optionally) MinIO

### Option A — Docker Compose (fastest path)

```bash
mkdir -p secrets
echo "$(openssl rand -hex 24)" > secrets/postgres_password.txt
```

Add to `.env`:
```env
POSTGRES_PASSWORD=<same value you just put in secrets/postgres_password.txt>
REDIS_PASSWORD=<a strong password>
MINIO_ROOT_PASSWORD=<a strong password>

DATABASE_URL=postgresql://app_user:<POSTGRES_PASSWORD>@localhost:5432/commercial_assistant
REDIS_URL=redis://:<REDIS_PASSWORD>@localhost:6379/0
STORAGE_MODE=local
```

Start just the data services (you'll run the app itself with `npm run dev` for now):
```bash
docker-compose up postgres redis minio
```

### Option B — Your own PostgreSQL/Redis

Just set `DATABASE_URL` and `REDIS_URL` in `.env` to point at them. `STORAGE_MODE=local` needs no
extra service — files go to `./uploads` by default (configurable later from Admin → Settings →
Storage, not via an environment variable).

---

## 3. Install dependencies and initialize the database

```bash
npm install                      # also runs `prisma generate` via postinstall
npm run prisma:migrate:dev       # applies every migration in prisma/migrations/, interactive prompts are expected on a fresh DB
npm run prisma:seed              # creates the default tenant, 3 roles, demo users, a sample project, and starter templates
```

The seed script creates 3 demo users, all with the password `password123`:

| Name | Email | Role |
|---|---|---|
| Alex Rivera | `alex.rivera@enterprise.com` | Administrator (MFA enabled) |
| Marcus Vance | `marcus.vance@enterprise.com` | Sales Manager (MFA disabled) |
| Elena Rostova | `elena.rostova@enterprise.com` | Pre-Sales Engineer (MFA enabled) |

**These are demo-only credentials for a fresh evaluation database.** Change every seeded
password (or delete the seeded users outright) before connecting real users or real tender data —
see the production checklist below.

---

## 4. Run it

```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) and log in as `alex.rivera@enterprise.com` /
`password123`. Since this user has MFA enabled and (in demo mode) hasn't enrolled a real TOTP
secret yet, use one of the demo codes: `123456`, `000000`, or `111111`.

---

## 5. First-run configuration checklist

Once logged in as the Administrator:

1. **Admin → IA, Prompts e Custos**: add your AI provider API key(s) and pick a provider/model for
   each task type (document analysis, BOM web-grounded enrichment, spec copilot, Knowledge Base
   ingestion). Different task types can use different providers/models — there's no requirement
   to standardize on one. Consider setting `monthly_cost_cap_usd` here too.
2. **Admin → Configurações → Storage**: confirm `local` is fine for now, or switch to `s3`/`gcs`
   and fill in the credentials (only needed if you're not using the default local storage).
3. **Admin → Templates de Propostas**: upload your first `.docx` proposal template. Check the
   variable glossary panel next to the upload form, and use **Validate** after uploading to
   confirm every `{{placeholder}}` in your file is recognized — see
   [../TEMPLATE_GUIDE.md](../TEMPLATE_GUIDE.md) for the full variable reference and the 7
   proposal document types.
4. **Admin → Usuários e Perfis**: create real user accounts, assign roles, and either delete the
   seeded demo users or change their passwords.
5. **Admin → Branding**: set your organization's logo and colors if you want them reflected in the
   login screen and proposal documents.
6. Create a real project (Workspace → New Project), upload a tender document, and run an analysis
   to confirm the whole pipeline works end-to-end before onboarding real users.

---

## 6. Production checklist (before exposing this to real users/data)

- [ ] `APP_RUNTIME_MODE=production`, `VITE_APP_RUNTIME_MODE=production`,
      `ENABLE_DEMO_LOGIN=false`, `ENABLE_DEMO_MFA=false` — this hard-blocks the demo MFA fallback
      codes and demo auto-login.
- [ ] `COOKIE_SECURE=true`, and the app is actually served over HTTPS (put a reverse proxy with a
      real TLS certificate in front of it — see [../DEPLOYMENT.md](../DEPLOYMENT.md)).
- [ ] Seeded demo users deleted, or their passwords changed and MFA properly enrolled with a real
      authenticator app.
- [ ] `SECRET_ENCRYPTION_KEY` and `JWT_SESSION_SECRET` are unique, random, and not the values from
      any example/documentation.
- [ ] Postgres and Redis passwords are strong and not reused from `docker-compose.yml` examples;
      TLS enabled on both if they're reachable over an untrusted network.
- [ ] `npm run prisma:migrate:deploy` (not `migrate:dev`) is what your deploy pipeline actually
      runs.
- [ ] `monthly_cost_cap_usd` is set to a sane value for your expected usage.
- [ ] Storage mode matches your real requirements (`local` is fine for a single-node deployment
      with a persistent volume; use `s3`/`gcs` for anything horizontally scaled).
- [ ] Review [../SECURITY.md](../SECURITY.md) in full.
