# Production Deployment & Scaling Manual

This document outlines standard deployment, configuration, and environment setup guidelines to host Commercial Assistant AI in production or staging environments.

---

## 1. Environment Variable Configuration

Below are the variables that must be defined in your deployment environment (such as GCP Cloud Run, AWS ECS, or Kubernetes Secrets). Define these variables in your `.env` or container startup registry:

```env
# Server Binding
PORT=3000
NODE_ENV=production

# Cryptographic Keys (Required)
SECRET_ENCRYPTION_KEY=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p  # Must be exactly 32 bytes (hex or string)
JWT_SESSION_SECRET=super_secure_jwt_session_jwt_secret_token_2026

# Google Gemini API Configuration (Required)
GEMINI_API_KEY=AIzaSyD-Your-Actual-Gemini-API-Key-Here

# Storage Adaptor (local, s3, or gcs)
STORAGE_MODE=local

# AWS S3 Storage Config (Only if STORAGE_MODE=s3)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1
AWS_S3_BUCKET=my-presales-tender-bucket

# Google Cloud Storage Config (Only if STORAGE_MODE=gcs)
GCS_PROJECT_ID=
GCS_KEY_FILE_PATH=/app/secrets/gcs_key.json
GCS_BUCKET_NAME=my-presales-tender-bucket
```

---

## 2. Server Deployment Options

### Option A: Standard Virtual Machine (VM / PM2)
1. Install Node.js v22 and git.
2. Clone repository and install dependencies:
   ```bash
   npm ci
   ```
3. Run the compiler:
   ```bash
   npm run build
   ```
4. Start with PM2 to manage uptime, clustering, and log rotation:
   ```bash
   npm install -g pm2
   pm2 start dist/server.cjs --name "commercial-assistant-ai"
   ```

### Option B: Cloud Containers (Cloud Run / AWS Fargate)
1. Build the Docker container:
   ```bash
   docker build -t gcr.io/my-project/commercial-assistant-ai:latest .
   ```
2. Push to your registry:
   ```bash
   docker push gcr.io/my-project/commercial-assistant-ai:latest
   ```
3. Deploy to Google Cloud Run:
   ```bash
   gcloud run deploy commercial-assistant-ai \
     --image gcr.io/my-project/commercial-assistant-ai:latest \
     --platform managed \
     --port 3000 \
     --set-env-vars="NODE_ENV=production,STORAGE_MODE=local,SECRET_ENCRYPTION_KEY=yourkey,JWT_SESSION_SECRET=yoursecret,GEMINI_API_KEY=yourkey"
   ```

---

## 3. Scaling & Session Considerations

- **Stateless Backend Design**: The backend communicates via JWT verification mechanisms, making server pods fully stateless.
- **Session Store**: Currently, sessions are tracked via symmetric JWT validations. To scale to multiple nodes, sessions do not require sticky routing.
- **Document Processing**: For high-volume pre-sales teams, consider scaling the text extraction pipeline by offloading processing from the web containers to the background `worker` process (fully scaffolded in `docker-compose.yml`).
