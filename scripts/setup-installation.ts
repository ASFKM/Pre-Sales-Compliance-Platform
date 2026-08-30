// Interactive setup wizard for a brand-new, real installation - replaces the ad-hoc "write a
// throwaway tsx script" bootstrap every fresh install has needed until now (there's no signup
// flow in the product; prisma/seed.ts is CI-only test fixture data, not suitable here - see the
// comment on its own DEFAULT_TENANT_ID/demo users). Internal tool, not customer self-service:
// terse output, assumes the operator knows what a DATABASE_URL/REDIS_URL looks like.
//
// Usage: npm run setup
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import readline from "node:readline/promises";

// ESM ("type": "module" in package.json) has no __dirname - derive it from import.meta.url.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// rl.question()'s one-shot listener-per-call pattern loses lines when stdin is a non-TTY pipe:
// if several lines arrive in the same buffered chunk (the whole file, in automated/piped runs),
// only the line present when a given question() call attaches its listener is captured - any
// lines that arrived in the gap between one question() resolving and the next one being called
// are emitted as 'line' events with no listener and silently dropped, and the process then exits
// clean (code 0) the moment stdin hits EOF with nothing else keeping the event loop alive, even
// though main() never finished - confirmed empirically with a minimal repro before writing this.
// A single persistent 'line' listener registered once, feeding a queue, has no such gap.
const lineQueue: string[] = [];
const lineWaiters: Array<(line: string) => void> = [];
let stdinEnded = false;
rl.on("line", (line) => {
  const waiter = lineWaiters.shift();
  if (waiter) waiter(line);
  else lineQueue.push(line);
});
rl.on("close", () => {
  stdinEnded = true;
  while (lineWaiters.length > 0) lineWaiters.shift()!("");
});

function nextLine(): Promise<string> {
  if (lineQueue.length > 0) return Promise.resolve(lineQueue.shift()!);
  if (stdinEnded) return Promise.resolve("");
  return new Promise((resolve) => lineWaiters.push(resolve));
}

async function ask(question: string, opts: { required?: boolean; default?: string } = {}): Promise<string> {
  const suffix = opts.default ? ` [${opts.default}]` : "";
  while (true) {
    process.stdout.write(`${question}${suffix}: `);
    const answer = (await nextLine()).trim();
    if (answer) return answer;
    if (opts.default !== undefined) return opts.default;
    if (stdinEnded) {
      console.error("\nEntrada terminou antes de responder a uma pergunta obrigatória. Abortando.");
      process.exit(1);
    }
    if (!opts.required) return "";
    console.log("  (obrigatório - tente de novo)");
  }
}

async function askYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? "[S/n]" : "[s/N]";
  process.stdout.write(`${question} ${suffix}: `);
  const answer = (await nextLine()).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("s") || answer.startsWith("y");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function randomSuffix(): string {
  return crypto.randomBytes(4).toString("hex");
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

function generateStrongPassword(): string {
  // 20 chars, alphanumeric + a few symbols - printed once, meant to be rotated/saved by the
  // operator immediately (Admin > Usuários e Acessos has a reset-password action for later).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return Array.from(crypto.randomBytes(20))
    .map((b) => chars[b % chars.length])
    .join("");
}

interface Answers {
  databaseUrl: string;
  redisUrl: string;
  appUrl: string;
  storageMode: "local" | "s3" | "gcs";
  s3?: { bucket: string; region: string; accessKeyId: string; secretAccessKey: string };
  gcs?: { projectId: string; bucketName: string; keyFilePath: string };
  companyName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  passwordWasGenerated: boolean;
  geminiKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  fleetManagerUrl?: string;
  fleetManagerApiKey?: string;
}

async function collectAnswers(): Promise<Answers> {
  console.log("\n=== Pre-Sales Compliance Platform — instalação nova ===\n");

  console.log("--- Banco de dados e cache ---");
  const databaseUrl = await ask("DATABASE_URL (postgresql://user:pass@host:5432/db)", { required: true });
  const redisUrl = await ask("REDIS_URL (redis://:pass@host:6379/0)", { required: true });

  console.log("\n--- Aplicação ---");
  const appUrl = await ask("URL pública desta instalação (APP_URL)", { required: true });

  console.log("\n--- Armazenamento de arquivos ---");
  const storageChoice = await ask("Modo de armazenamento: local / s3 / gcs", { default: "local" });
  const storageMode = (["local", "s3", "gcs"].includes(storageChoice) ? storageChoice : "local") as Answers["storageMode"];

  let s3: Answers["s3"];
  let gcs: Answers["gcs"];
  if (storageMode === "s3") {
    s3 = {
      bucket: await ask("AWS_S3_BUCKET", { required: true }),
      region: await ask("AWS_DEFAULT_REGION", { default: "us-east-1" }),
      accessKeyId: await ask("AWS_ACCESS_KEY_ID", { required: true }),
      secretAccessKey: await ask("AWS_SECRET_ACCESS_KEY", { required: true }),
    };
  } else if (storageMode === "gcs") {
    const projectId = await ask("ID do projeto GCS", { required: true });
    const bucketName = await ask("Nome do bucket GCS", { required: true });
    let keyFilePath = "";
    while (true) {
      keyFilePath = await ask("Caminho local do JSON da service account", { required: true });
      try {
        JSON.parse(fs.readFileSync(keyFilePath, "utf8"));
        break;
      } catch (err) {
        console.log(`  Não consegui ler/parsear "${keyFilePath}" como JSON válido - tente de novo.`);
      }
    }
    gcs = { projectId, bucketName, keyFilePath };
  }

  console.log("\n--- Empresa / tenant ---");
  const companyName = await ask("Nome da empresa/cliente", { required: true });

  console.log("\n--- Administrador inicial ---");
  const adminName = await ask("Nome do administrador", { required: true });
  const adminEmail = await ask("E-mail do administrador", { required: true });
  let adminPassword = await ask("Senha do administrador (Enter para gerar uma forte automaticamente)");
  let passwordWasGenerated = false;
  if (!adminPassword) {
    adminPassword = generateStrongPassword();
    passwordWasGenerated = true;
  }

  console.log("\n--- Provedores de IA (opcional - Enter pra pular, configura depois em Admin > IA) ---");
  const geminiKey = await ask("Chave Gemini");
  const openaiKey = await ask("Chave OpenAI");
  const anthropicKey = await ask("Chave Anthropic");

  console.log("\n--- Conexão com o CMSaaS (opcional - precisa já ter registrado esta instalação lá antes) ---");
  const wantsFleet = await askYesNo("Já tem a URL + chave de API do CMSaaS pra esta instalação?", false);
  let fleetManagerUrl: string | undefined;
  let fleetManagerApiKey: string | undefined;
  if (wantsFleet) {
    fleetManagerUrl = await ask("URL do Fleet Manager (CMSaaS)", { required: true });
    fleetManagerApiKey = await ask("Chave de API desta instalação", { required: true });
  }

  return {
    databaseUrl,
    redisUrl,
    appUrl,
    storageMode,
    s3,
    gcs,
    companyName,
    adminName,
    adminEmail,
    adminPassword,
    passwordWasGenerated,
    geminiKey: geminiKey || undefined,
    openaiKey: openaiKey || undefined,
    anthropicKey: anthropicKey || undefined,
    fleetManagerUrl,
    fleetManagerApiKey,
  };
}

// Só escreve variáveis que o código de fato lê (verificado via grep em server/ e src/ - várias
// entradas de .env.example/DEPLOYMENT.md, como PORT, APP_URL, ENABLE_DEMO_LOGIN, ENABLE_DEMO_MFA,
// COOKIE_SECURE, STORAGE_MODE e todas as AWS_*/GCS_*, não são lidas em lugar nenhum: porta é
// hardcoded em server.ts, cookie-secure/bloqueio de MFA demo vêm de APP_RUNTIME_MODE
// (server/config/runtime.ts), e armazenamento é 100% controlado pela linha PlatformSettings no
// banco (server/utils/storage.ts:createStorageAdapter), não por env - por isso as chaves de
// storage vão pro bootstrapTenant(), não pro .env.
function buildEnvFile(a: Answers, secretEncryptionKey: string, jwtSessionSecret: string): string {
  const lines: string[] = [
    "# Gerado por npm run setup - " + new Date().toISOString(),
    "",
    "# Runtime mode - instalação real, nunca demo (controla bloqueio de MFA demo e cookie secure)",
    "NODE_ENV=production",
    "APP_RUNTIME_MODE=production",
    "VITE_APP_RUNTIME_MODE=production",
    "SESSION_TTL_MINUTES=60",
    "",
    "# Segredos - gerados automaticamente, nunca reaproveite entre instalações",
    `SECRET_ENCRYPTION_KEY="${secretEncryptionKey}"`,
    `JWT_SESSION_SECRET="${jwtSessionSecret}"`,
    "",
    "# Banco de dados",
    `DATABASE_URL="${a.databaseUrl}"`,
    "",
    "# Redis",
    `REDIS_URL="${a.redisUrl}"`,
  ];

  lines.push("", "# Chaves de IA (fallback de primeiro boot - normalmente configuradas por tenant no Admin Console)");
  if (a.geminiKey) lines.push(`GEMINI_API_KEY=${a.geminiKey}`);
  if (a.openaiKey) lines.push(`OPENAI_API_KEY=${a.openaiKey}`);
  if (a.anthropicKey) lines.push(`ANTHROPIC_API_KEY=${a.anthropicKey}`);

  return lines.join("\n") + "\n";
}

const ADMINISTRATOR_PERMISSIONS = [
  "project:create", "project:read", "project:read_all", "project:update", "project:delete",
  "document:upload", "document:read", "document:delete",
  "analysis:run", "analysis:read", "analysis:edit", "analysis:approve",
  "proposal:generate", "proposal:edit", "proposal:approve", "proposal:export",
  "template:manage", "approval:manage", "admin:users", "admin:roles", "admin:settings",
  "admin:audit", "admin:debug", "admin:diagnostics", "ai:settings", "branding:manage",
  "storage:manage", "integrations:manage", "knowledge_base:read", "knowledge_base:write",
  "poc:read", "poc:manage",
];

async function bootstrapTenant(a: Answers): Promise<{ tenantId: string; adminEmail: string }> {
  // Imported here, not at module top level - these modules read env vars (DATABASE_URL etc.) at
  // import time, which only exist once buildEnvFile() has written .env and this process has
  // re-read it via dotenv (see main()'s env reload before calling this function).
  const { prisma } = await import("../src/prisma");
  const { runWithTenant } = await import("../src/tenantContext");
  const { randomId } = await import("../src/idGenerator");
  const { encryptSecret } = await import("../server/utils/security");
  const { BRAND_DEFAULT_PRIMARY, BRAND_DEFAULT_ACCENT } = await import("../src/brandTheme");

  const tenantId = `tenant_${slugify(a.companyName)}_${randomSuffix()}`;
  const normalizedEmail = a.adminEmail.toLowerCase().trim();

  const existingByName = await prisma.tenant.findFirst({ where: { name: a.companyName } });
  if (existingByName) {
    console.log(`\nJá existe um tenant chamado "${a.companyName}" (id: ${existingByName.id}).`);
    const proceed = await askYesNo("Criar um novo tenant separado mesmo assim?", false);
    if (!proceed) {
      console.log("Abortado - nenhuma alteração feita no banco.");
      process.exit(0);
    }
  }

  // User.email is globally unique (not per-tenant) - checked here, unscoped (no tenant context
  // set yet), same pattern the login route uses for its initial lookup-by-email.
  const existingByEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingByEmail) {
    console.log(`\nJá existe um usuário com o e-mail "${normalizedEmail}" (em outro tenant). Escolha outro e-mail e rode de novo.`);
    process.exit(1);
  }

  // Tudo em uma única transação: um Tenant sem Role/User/PlatformSettings é uma instalação
  // quebrada (dbStore.getSettings() lança erro fatal sem a linha de PlatformSettings) - se
  // qualquer passo falhar, nada fica gravado, em vez de deixar um tenant pela metade no banco.
  await runWithTenant({ tenantId }, () =>
    prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { id: tenantId, name: a.companyName, deploymentMode: "onprem", status: "active" },
    });

    const roleId = randomId("role");
    await tx.role.create({
      data: {
        id: roleId,
        tenantId: tenant.id,
        name: "Administrator",
        description: "Full administrative access to all workspace settings, configurations, logs, and users.",
        permissions: ADMINISTRATOR_PERMISSIONS,
      },
    });

    await tx.user.create({
      data: {
        id: randomId("u"),
        tenantId: tenant.id,
        name: a.adminName,
        email: normalizedEmail,
        roleId,
        status: "ACTIVE",
      },
    });

    await tx.platformSettings.create({
      data: {
        id: randomId("settings"),
        tenantId: tenant.id,
        aiProvider: "Google Gemini",
        defaultModel: "gemini-3.5-flash",
        documentAnalysisModel: "gemini-3.5-flash",
        proposalGenerationModel: "gemini-3.5-flash",
        aiApiKeyEncrypted: a.geminiKey ? encryptSecret(a.geminiKey) : undefined,
        openaiApiKeyEncrypted: a.openaiKey ? encryptSecret(a.openaiKey) : undefined,
        anthropicApiKeyEncrypted: a.anthropicKey ? encryptSecret(a.anthropicKey) : undefined,
        storageMode: a.storageMode,
        localStoragePath: a.storageMode === "local" ? "./uploads" : "",
        s3Bucket: a.s3?.bucket || "",
        s3Region: a.s3?.region,
        s3AccessKeyId: a.s3?.accessKeyId,
        s3SecretAccessKeyEncrypted: a.s3?.secretAccessKey ? encryptSecret(a.s3.secretAccessKey) : undefined,
        gcsBucket: a.gcs?.bucketName || "",
        gcsProjectId: a.gcs?.projectId,
        gcsServiceAccountKeyEncrypted: a.gcs?.keyFilePath
          ? encryptSecret(fs.readFileSync(a.gcs.keyFilePath, "utf8"))
          : undefined,
        defaultLanguage: "Portuguese",
        defaultLogLevel: "INFO",
        fleetManagerUrl: a.fleetManagerUrl,
        fleetManagerApiKeyEncrypted: a.fleetManagerApiKey ? encryptSecret(a.fleetManagerApiKey) : undefined,
        fleetManagerEnabled: Boolean(a.fleetManagerUrl && a.fleetManagerApiKey),
      },
    });

    await tx.brandingSettings.create({
      data: {
        id: randomId("branding"),
        tenantId: tenant.id,
        companyName: a.companyName,
        companyLogoPath: "",
        loginLogoPath: "",
        sidebarLogoPath: "",
        reportLogoPath: "",
        faviconPath: "",
        primaryColor: BRAND_DEFAULT_PRIMARY,
        secondaryColor: "#1e293b",
        accentColor: BRAND_DEFAULT_ACCENT,
        // Fase 8: instalação nova nasce com a cor da marca já valendo na interface.
        applyToUi: true,
        backgroundColor: "#f8fafc",
        textColor: "#0f172a",
        fontFamily: "Inter",
        borderRadius: "rounded-xl",
        buttonStyle: "solid",
        defaultTheme: "light",
        customCssVariables: "",
        footerText: `${a.companyName} - Pre-Sales Compliance Platform`,
        supportContact: "",
        legalText: "",
      },
    });
    })
  );

  await prisma.$disconnect();
  return { tenantId, adminEmail: normalizedEmail };
}

async function main() {
  if (fs.existsSync(ENV_PATH)) {
    console.log(`Já existe um .env em ${ENV_PATH}.`);
    const overwrite = await askYesNo("Sobrescrever?", false);
    if (!overwrite) {
      console.log("Abortado - nada foi alterado.");
      rl.close();
      process.exit(0);
    }
  }

  const answers = await collectAnswers();

  console.log("\n--- Resumo ---");
  console.log(`Empresa: ${answers.companyName}`);
  console.log(`Admin: ${answers.adminName} <${answers.adminEmail}>`);
  console.log(`Armazenamento: ${answers.storageMode}`);
  console.log(`IA configurada: ${[answers.geminiKey && "Gemini", answers.openaiKey && "OpenAI", answers.anthropicKey && "Anthropic"].filter(Boolean).join(", ") || "nenhuma (configurar depois)"}`);
  console.log(`CMSaaS: ${answers.fleetManagerUrl ? "configurado" : "não configurado (configurar depois)"}`);
  const confirmed = await askYesNo("\nConfirma e prossegue?", true);
  if (!confirmed) {
    console.log("Abortado - nada foi alterado.");
    rl.close();
    process.exit(0);
  }

  const secretEncryptionKey = generateSecret();
  const jwtSessionSecret = generateSecret();

  console.log("\n[1/4] Escrevendo .env...");
  fs.writeFileSync(ENV_PATH, buildEnvFile(answers, secretEncryptionKey, jwtSessionSecret));
  // Re-exec's environment (not just this process's) needs these for the migrate/bootstrap steps
  // below - dotenv only loads for modules that import it, but execSync spawns a fresh shell.
  process.env.DATABASE_URL = answers.databaseUrl;
  process.env.REDIS_URL = answers.redisUrl;
  process.env.SECRET_ENCRYPTION_KEY = secretEncryptionKey;
  process.env.JWT_SESSION_SECRET = jwtSessionSecret;

  console.log("[2/4] Aplicando migrations (prisma migrate deploy)...");
  try {
    execSync("npx prisma migrate deploy", { cwd: ROOT, stdio: "inherit", env: process.env });
  } catch (err) {
    console.error("\nFalha ao aplicar migrations - verifique DATABASE_URL e se o banco está acessível. Nada mais foi feito.");
    process.exit(1);
  }

  console.log("[3/4] Criando tenant, administrador e configurações iniciais...");
  const { tenantId, adminEmail } = await bootstrapTenant(answers);

  console.log("[4/4] Build de produção (npm run build)...");
  try {
    execSync("npm run build", { cwd: ROOT, stdio: "inherit", env: process.env });
  } catch (err) {
    console.error("\nBuild falhou - o banco já foi configurado, mas dist/ não foi gerado. Rode `npm run build` manualmente depois de corrigir o erro.");
    process.exit(1);
  }

  console.log("\n=== Instalação concluída ===");
  console.log(`Tenant: ${tenantId}`);
  console.log(`Login: ${answers.appUrl}`);
  console.log(`E-mail: ${adminEmail}`);
  if (answers.passwordWasGenerated) {
    console.log(`Senha (gerada agora, não fica salva em nenhum log): ${answers.adminPassword}`);
  } else {
    console.log("Senha: a que você informou.");
  }
  console.log("\nPendências:");
  if (!answers.geminiKey && !answers.openaiKey && !answers.anthropicKey) {
    console.log("- Nenhum provedor de IA configurado. Configure em Admin > IA, Prompts e Custos antes do primeiro uso real.");
  }
  if (!answers.fleetManagerUrl) {
    console.log("- CMSaaS não configurado. Configure em Admin > Assinatura e Licença quando tiver a chave da instalação.");
  }
  console.log("\nPróximo passo: subir o processo (PM2/systemd/docker) — ver DEPLOYMENT.md, seção 2.");

  rl.close();
  // bootstrapTenant() dynamically imports server/utils/security.ts, which imports src/redis.ts -
  // that module opens a live ioredis connection at import time and never closes it, which keeps
  // the event loop alive forever (confirmed empirically: the process hung indefinitely after
  // printing this exact summary, in a real test run). Nothing left to do at this point, so a
  // hard exit is correct for a one-shot CLI script - no graceful shutdown is needed.
  process.exit(0);
}

main().catch((err) => {
  console.error("\nErro inesperado:", err);
  process.exit(1);
});
