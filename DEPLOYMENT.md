# Production Deployment & Scaling Manual

This document lists the real environment variables and deployment options for Commercial
Assistant AI, matching `.env.example` and `docker-compose.yml` in this repository.

---

## 1. Environment Variables

### Core / runtime
```env
PORT=3000
APP_URL=https://your-deployment-host
APP_RUNTIME_MODE=production        # "demo" enables demo login + demo MFA fallback codes - never
                                    # use "demo" for a real deployment, see SECURITY.md
VITE_APP_RUNTIME_MODE=production   # keep in sync with APP_RUNTIME_MODE
ENABLE_DEMO_LOGIN=false
ENABLE_DEMO_MFA=false
SESSION_TTL_MINUTES=60
COOKIE_SECURE=true                 # requires HTTPS in front of the app
```

### Cryptographic secrets (required)
```env
SECRET_ENCRYPTION_KEY=<32-byte-minimum-secret>   # encrypts connector/API credentials at rest
JWT_SESSION_SECRET=<strong-random-secret>        # signs session JWTs
```

### Database (required)
```env
DATABASE_URL=postgresql://app_user:<password>@<host>:5432/commercial_assistant
# For TLS-enabled Postgres:
DATABASE_SSL_CA_PATH=/path/to/ca.crt
```

### Redis (required)
```env
REDIS_URL=redis://:<password>@<host>:6379/0
# For TLS-enabled Redis:
REDIS_SSL_CA_PATH=/path/to/ca.crt
```

### File storage (`STORAGE_MODE`: `local`, `s3`, or `gcs`)
```env
STORAGE_MODE=local
```
The local storage directory itself is **not** an environment variable — it's
`PlatformSettings.local_storage_path` (Admin → Settings → Storage), defaulting to `./uploads`
relative to the process working directory if left unset.
```env
# Only if STORAGE_MODE=s3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
AWS_S3_BUCKET=my-presales-tender-bucket

# Only if STORAGE_MODE=gcs
GCS_PROJECT_ID=
GCS_KEY_FILE_PATH=/app/secrets/gcs_key.json
GCS_BUCKET_NAME=my-presales-tender-bucket
```
Storage mode can also be switched later from Admin → Settings without redeploying, as long as the
relevant credentials are present.

### AI providers
No AI provider key is strictly required at the environment level — providers are configured (and
their keys stored, AES-256-CBC encrypted) per-tenant from Admin → IA, Prompts e Custos, with each
task type (document analysis, BOM web-grounded enrichment, spec copilot, Knowledge Base ingestion,
etc.) independently assigned a provider/model. Setting the equivalent environment variable is only
useful as a first-boot fallback before an admin has configured anything in the UI:
```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
```

### Optional: extra trusted CA (corporate proxies / private CAs)
```env
NODE_EXTRA_CA_CERTS=/path/to/extra-ca-bundle.pem
```

---

## 2. Server Deployment Options

### Option A: Virtual Machine (VM / PM2)

```bash
npm ci
npm run build
npm run prisma:migrate:deploy
npm install -g pm2
pm2 start dist/server.cjs --name "commercial-assistant-ai"
```
`prisma:migrate:deploy` applies all committed migrations without prompting (safe for CI/production
— unlike `prisma:migrate:dev`, which is interactive and meant for local development only).

### Option B: Docker Compose (recommended for a self-contained stack)

```bash
docker-compose up --build
```
This brings up:
- `app` — the compiled application (port 3000).
- `postgres` — PostgreSQL 16 with SSL enabled, password read from `secrets/postgres_password.txt`.
- `redis` — Redis 7 with both plaintext and TLS ports, password-protected.
- `minio` — an S3-compatible object store (console on port 9001) so you can exercise the real S3
  storage adapter without an AWS account.

Before running, create the Postgres password secret file:
```bash
mkdir -p secrets
echo "your-strong-password" > secrets/postgres_password.txt
```
and set `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, and `MINIO_ROOT_PASSWORD` in your `.env` (these are
required — the compose file will refuse to start `redis`/`minio` without them).

### Option C: Cloud Containers (Cloud Run / ECS / etc.)

```bash
docker build -t your-registry/commercial-assistant-ai:latest .
docker push your-registry/commercial-assistant-ai:latest
```
Point `DATABASE_URL` and `REDIS_URL` at your managed Postgres/Redis instances (Cloud SQL,
ElastiCache, etc.) rather than the containers in `docker-compose.yml`, which are meant for local/
self-contained deployment.

---

## 3. Scaling & Session Considerations

- **Stateless application tier**: sessions are JWT-based and stored in Redis, so app instances can
  be scaled horizontally without sticky routing.
- **Database migrations**: always run `npm run prisma:migrate:deploy` as part of your deploy
  pipeline, before starting new application instances — never let the app start against a schema
  it doesn't match.
- **AI cost control**: `PlatformSettings.monthly_cost_cap_usd` (Admin → Settings) blocks new AI
  calls once the configured monthly spend cap is reached — set this before exposing the platform
  to real usage.
- **Background analysis jobs**: document analysis and BOM enrichment run as backend tasks tracked
  in the `AIAnalysisJob`/`BackgroundTask` tables and polled by the frontend — they are not
  synchronous HTTP requests, so a slow AI provider does not hold an HTTP connection open.
