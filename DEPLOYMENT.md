# Production Deployment \& Scaling Manual

This document outlines standard deployment, configuration, and environment setup guidelines to host Commercial Assistant AI in production or staging environments.

\---

## 1\. Environment Variable Configuration

Below are the variables that must be defined in your deployment environment (such as GCP Cloud Run, AWS ECS, or Kubernetes Secrets). Define these variables in your `.env` or container startup registry:

```env
# Server Binding
PORT=3000
NODE\_ENV=production

# Cryptographic Keys (Required)
SECRET\_ENCRYPTION\_KEY=<32-byte-secret>
JWT\_SESSION\_SECRET=<strong-session-secret>

# Google Gemini API Configuration (Required)
GEMINI\_API\_KEY=<set-in-secret-manager>

# Storage Adaptor (local, s3, or gcs)
STORAGE\_MODE=local

# AWS S3 Storage Config (Only if STORAGE\_MODE=s3)
AWS\_ACCESS\_KEY\_ID=
AWS\_SECRET\_ACCESS\_KEY=
AWS\_DEFAULT\_REGION=us-east-1
AWS\_S3\_BUCKET=my-presales-tender-bucket

# Google Cloud Storage Config (Only if STORAGE\_MODE=gcs)
GCS\_PROJECT\_ID=
GCS\_KEY\_FILE\_PATH=/app/secrets/gcs\_key.json
GCS\_BUCKET\_NAME=my-presales-tender-bucket
```

\---

## 2\. Server Deployment Options

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
   gcloud run deploy commercial-assistant-ai \\
     --image gcr.io/my-project/commercial-assistant-ai:latest \\
     --platform managed \\
     --port 3000 \\
     --set-env-vars="NODE\_ENV=production,STORAGE\_MODE=local,SECRET\_ENCRYPTION\_KEY=yourkey,JWT\_SESSION\_SECRET=yoursecret,GEMINI\_API\_KEY=yourkey"
   ```

\---

## 3\. Scaling \& Session Considerations

* **Stateless Backend Design**: The backend communicates via JWT verification mechanisms, making server pods fully stateless.
* **Session Store**: Currently, sessions are tracked via symmetric JWT validations. To scale to multiple nodes, sessions do not require sticky routing.
* **Document Processing**: For high-volume pre-sales teams, consider scaling the text extraction pipeline by offloading processing from the web containers to the background `worker` process (fully scaffolded in `docker-compose.yml`).

