# Commercial Assistant AI - Hardened Pre-Sales Enterprise Platform

Commercial Assistant AI is an advanced, production-hardened full-stack pre-sales automation platform. It is engineered to ingest complex commercial tender specifications, run multi-threaded text extraction pipelines, conduct deep compliance and technical AI analysis using Google Gemini models, compile manual pricing tables, manage multi-role approval queues, and generate compliant DOCX/PDF proposal assets.

---

## Key Refactored Enhancements

This version of the Commercial Assistant AI prototype has been fully hardened to support robust B2B requirements:

1. **Production Identity Management**: Fully replaces mock client states with JWT-based session tokens, password hashing, and simulated Multi-Factor Authentication (MFA).
2. **Strict RBAC Authorization**: Connects frontend roles with backend route-level middlewares, securing setting, template, and project scopes.
3. **Robust Request Parsing**: Integrates schema validation on all incoming payloads using Zod schemas.
4. **Physical Storage & Processing**: Multer handles multipart file uploads. Allowed file extensions, MIME types, and file sizes are verified. Safe random file names are generated, preventing path traversal attacks.
5. **Dynamic Document Extraction & AI Analysis**: Extracts text from PDFs, DOCXs, XLSXs, CSvs, and TXTs, compiling context for structured Google Gemini analysis.
6. **Compliant Document Generation**: Facilitates real variable substitutions inside uploaded DOCX templates, outputting clean commercial proposals and rendering exportable PDFs.
7. **B2B Secrets Security**: API tokens are encrypted with AES-256-CBC at rest and masked before exposure to the frontend.
8. **Observability & Diagnostics**: Added Helmet headers, IP-based rate limiting, correlation tracking, and sanitized diagnostic exports.

---

## Local Development Setup

### 1. Prerequisites
- **Node.js**: v20 or v22
- **npm**: v10+
- **Gemini API Key**: Set as `GEMINI_API_KEY` in your environment.

### 2. Configure Environment Variables
Copy `.env.example` into a new `.env` file and set the required variables:
```bash
cp .env.example .env
```
Ensure `GEMINI_API_KEY`, `SECRET_ENCRYPTION_KEY`, and `JWT_SESSION_SECRET` are declared.

### 3. Installation
Install all dependencies:
```bash
npm install
```

### 4. Run Development Server
Boot the Express API backend along with the Vite HMR SPA middleware:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the portal.

---

## Deployment and Production

### Build compiled packages
```bash
npm run build
```
This script compiles the Vite frontend into `/dist` and bundles the Express server into `/dist/server.cjs` using esbuild.

### Run production server
```bash
npm start
```

---

## Containerized Deployment (Docker Compose)
To run the full stack (including local database, cache, and S3 mock storage services):
```bash
docker-compose up --build
```
This mounts PostgreSQL, Redis, and MinIO storage locally.

---

## Project Documentation Registry
- **[Architecture Guide](./ARCHITECTURE.md)**: Deep dive into the full-stack layout and data flow.
- **[Security Controls Guide](./SECURITY.md)**: Specifications on cryptographic operations and RBAC.
- **[Deployment Manual](./DEPLOYMENT.md)**: Step-by-step procedures to scale and provision services.
- **[Template Substitution Guide](./TEMPLATE_GUIDE.md)**: Explains the pre-sales variable injection schemas.
