import crypto from "crypto";
import { getAppVersion } from "./appVersion";
import os from "os";
import { statfsSync } from "fs";
import { dbStore } from "../../src/dbStore";
import { redis } from "../../src/redis";
import { runWithTenant } from "../../src/tenantContext";
import { prisma } from "../../src/prisma";
import { decryptSecret } from "./security";
import { randomId } from "../../src/idGenerator";
import { logger } from "./logger";
import { createStorageAdapter } from "./storage";
import { reconcileIncomingKnowledgeEntry, IncomingGlobalKbEntry } from "./knowledgeBaseReconciliation";
import { persistLatestRelease, triggerImmediateUpdate } from "./updateScheduler";

// Phase 7 (fleet/license management): the public half of the fleet manager's Ed25519 signing
// keypair, baked into this build (not fetched at runtime - a compromised heartbeat response
// could otherwise swap in an attacker's key and forge an "active" status). Generated once on
// the fleet manager (saasmanager-01) and copied here manually when it's provisioned/rotated.
const FLEET_MANAGER_PUBLIC_KEY = "MCowBQYDK2VwAyEAhHOq3vmwve6en5Zy8CcL5GQwceu5W1FXZlkJ3BQHaxs=";

interface LicenseStatusPayload {
  installation_id: string;
  customer_name: string;
  // Small, discreet company info shown in "Plano e Contrato" - additive fields, a CMSaaS build
  // older than these simply won't send them, and everything below already handles that (all the
  // display code treats them as optional).
  customer_city?: string;
  customer_state?: string;
  customer_logo_base64?: string | null;
  status: "active" | "suspended";
  block_mode: "full_lockout" | "read_only" | null;
  modules: string[];
  plan_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  issued_at: string;
  valid_until: string;
}

interface CachedLicense {
  payload: LicenseStatusPayload;
  signature: string;
  verifiedAt: string;
}

function licenseCacheKey(tenantId: string): string {
  return `fleet:license:${tenantId}`;
}

function lastLogSyncKey(tenantId: string): string {
  return `fleet:last_log_sync:${tenantId}`;
}

function verifyPayload(payload: LicenseStatusPayload, signature: string): boolean {
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(FLEET_MANAGER_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
    const data = Buffer.from(JSON.stringify(payload, Object.keys(payload).sort()), "utf8");
    return crypto.verify(null, data, publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

interface HeartbeatCommand {
  id: string;
  type: string;
  payload?: unknown;
}

interface HeartbeatLatestRelease {
  id: string;
  version: string;
  channel: string;
  code_ref: string;
  published_at: string | null;
}

// Ordena chaves em PROFUNDIDADE e serializa SEM replacer, para que o objeto reconstruído seja
// idêntico ao original a menos da ordem das chaves - que é justamente o que precisa ser estável
// para uma assinatura determinística. Portada byte a byte de canonicalJsonDeep do CMSaaS
// (`server/utils/licenseSigning.ts`, que assina) e do CMCRM
// (`production/infra/temporal/src/platform/cmsaas-client.ts`, que verifica): três implementações
// da mesma canonicalização só continuam intercambiáveis enquanto forem a MESMA implementação -
// duas que divergem no primeiro campo novo fazem um dos lados recusar comando válido.
function canonicalizeDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeDeep);
  if (value !== null && typeof value === "object") {
    const ordenado: Record<string, unknown> = {};
    for (const chave of Object.keys(value as Record<string, unknown>).sort()) {
      ordenado[chave] = canonicalizeDeep((value as Record<string, unknown>)[chave]);
    }
    return ordenado;
  }
  return value;
}

export function canonicalJsonDeep(value: unknown): string {
  return JSON.stringify(canonicalizeDeep(value));
}

// CMS-001 / AUD-001 (auditoria de segurança, 2026-07-19): commands (inclusive apply_update, que
// dispara git checkout + build + restart real nesta própria instalação) e latest_release vinham
// como siblings de license no heartbeat, protegidos só por TLS + API key - qualquer resposta
// adulterada (Fleet Manager comprometido, MITM, bug num proxy) podia injetar um apply_update
// arbitrário sem essa checagem. Assinatura separada da de license (mesma chave, envelope
// próprio), e falha fechado: sem assinatura válida, nem commands nem latest_release são
// processados nesta rodada de heartbeat (mas o heartbeat em si não falha - license/ia_kb/mensagens
// continuam normalmente, mesmo espírito fail-open já usado no resto deste arquivo pra não derrubar
// a instalação por causa do Fleet Manager).
//
// CDC14-F2-001 (24/08/2026): ATÉ ESTA DATA, A MITIGAÇÃO ACIMA NUNCA ESTEVE VALENDO. Esta função
// verificava com `JSON.stringify(payload, Object.keys(payload).sort())`, e o segundo argumento do
// JSON.stringify NÃO é uma lista de ordenação: é um REPLACER ARRAY, aplicado RECURSIVAMENTE a todo
// objeto aninhado. Como as únicas chaves da lista eram `commands` e `latest_release`, todo objeto
// DENTRO de `commands` e o próprio `latest_release` perdiam todas as chaves na serialização. O que
// era verificado era sempre a mesma string, medida com um apply_update real:
//
//     {"commands":[{}],"latest_release":{}}
//
// Trocar `code_ref`, `release_id`, `id` ou `type` de um comando não mudava um byte do que era
// verificado - e `code_ref` é exatamente o valor que segue para triggerImmediateUpdate, que faz
// git checkout + build + restart nesta instalação. A única coisa que a v1 prendia era a QUANTIDADE
// de comandos e se latest_release era nulo. A auditoria de 2026-07-19 não pegou porque os DOIS
// lados usavam a mesma serialização defeituosa: a verificação passava, sem proteger nada.
//
// A licença NÃO tem esse defeito e por isso verifyPayload acima segue inalterada:
// LicenseStatusPayload é um objeto plano e `modules` é array de primitivos, que o replacer array
// não toca (medido, não deduzido). Como é a licença que decide block_mode, ela nunca esteve exposta.
//
// Correção: passa a verificar `commands_signature_v2` (ver a chamada em runHeartbeatForTenant),
// sobre canonicalização recursiva de verdade. Não é "consertar a v1 no lugar": enquanto o CMSaaS
// emitir as duas, o nome antigo continua carregando os bytes antigos, e é a leitura deste lado que
// muda de campo.
export function verifyCommandsSignature(commands: HeartbeatCommand[], latestRelease: HeartbeatLatestRelease | null, signature: string | undefined): boolean {
  if (!signature) return false;
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(FLEET_MANAGER_PUBLIC_KEY, "base64"), format: "der", type: "spki" });
    const payload = { commands, latest_release: latestRelease };
    const data = Buffer.from(canonicalJsonDeep(payload), "utf8");
    return crypto.verify(null, data, publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// Additive payload only: correlation_id/user_id/safe_metadata are new fields alongside the
// original timestamp/operation/level/message - a Fleet Manager build that only reads the
// original 4 keeps working unchanged.
async function collectRecentLogs(tenantId: string): Promise<Record<string, any>[]> {
  const lastSync = await redis.get(lastLogSyncKey(tenantId));
  const since = lastSync ? new Date(lastSync) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  // getDebugLogsSince is tenant-scoped and DB-filtered (the previous dbStore.getDebugLogs() call
  // here had neither: it returned up to 1000 rows across ALL tenants, filtered by "since" in JS
  // afterwards - a multi-tenant install's heartbeat was shipping every other tenant's debug logs
  // to the Fleet Manager too). It also never truncates warn/error/fatal, only caps the info/debug
  // sample - the old .slice(0, 100) applied after filtering could silently drop the oldest events
  // of a busy window regardless of severity.
  const logs = await dbStore.getDebugLogsSince(tenantId, since, 100);
  return logs.map((l) => ({
    timestamp: l.timestamp,
    operation: l.operation,
    level: l.log_level,
    message: l.message,
    correlation_id: l.correlation_id,
    user_id: l.user_id,
    safe_metadata: l.safe_metadata,
  }));
}

interface VulnerabilityFinding {
  package_name: string;
  severity: string;
  title: string;
  url: string;
  root_cause?: string;
  fix_available: boolean;
  fix_is_breaking?: boolean;
}

// Each key in npm audit's `vulnerabilities` object is a distinct package - a stable-enough
// identifier to correlate the same finding across scans (present -> still open, absent from a
// later scan -> resolved). `via` entries are either a string (naming another package in this same
// object that the vulnerability is inherited from) or an object carrying the actual advisory
// title/url - only the object form has that detail. A purely transitive package (e.g. `glob`,
// pulled in only because `minimatch` is vulnerable) has nothing but string entries in its own
// `via`, so its title/url would be empty without walking the chain down to whichever package
// actually owns the advisory. `seen` guards against a pathological cycle in the audit output.
function resolveAdvisory(
  packageName: string,
  vulnerabilities: Record<string, any>,
  seen: Set<string> = new Set()
): { title: string; url: string; rootCause?: string } {
  if (seen.has(packageName)) return { title: "", url: "" };
  seen.add(packageName);

  const via = vulnerabilities[packageName]?.via || [];
  const directAdvisory = via.find((v: any) => typeof v === "object");
  if (directAdvisory) {
    return { title: directAdvisory.title || "", url: directAdvisory.url || "" };
  }

  const nextPackageName = via.find((v: any) => typeof v === "string");
  if (!nextPackageName || !vulnerabilities[nextPackageName]) {
    return { title: "", url: "" };
  }
  const resolved = resolveAdvisory(nextPackageName, vulnerabilities, seen);
  // Keep bubbling up the deepest root cause found so far rather than overwriting it with each
  // intermediate hop, so a 3+ level chain (glob -> minimatch -> brace-expansion) still reports
  // brace-expansion, not minimatch, as the root cause.
  return { title: resolved.title, url: resolved.url, rootCause: resolved.rootCause || nextPackageName };
}

// npm audit's per-package `fixAvailable` is `false` (no fix), `true` (fix within the same major),
// or an object describing a fix that requires a semver-major bump - collapsed here into the two
// booleans the fleet dashboard actually needs to prioritize a backlog.
function normalizeFixAvailable(fixAvailable: any): { fix_available: boolean; fix_is_breaking?: boolean } {
  if (fixAvailable && typeof fixAvailable === "object") {
    return { fix_available: true, fix_is_breaking: fixAvailable.isSemVerMajor === true };
  }
  return { fix_available: fixAvailable === true };
}

function extractFindings(vulnerabilities: Record<string, any>): VulnerabilityFinding[] {
  return Object.entries(vulnerabilities || {}).map(([packageName, info]: [string, any]) => {
    const { title, url, rootCause } = resolveAdvisory(packageName, vulnerabilities);
    const { fix_available, fix_is_breaking } = normalizeFixAvailable(info.fixAvailable);
    return {
      package_name: packageName,
      severity: info.severity || "unknown",
      title,
      url,
      root_cause: rootCause,
      fix_available,
      fix_is_breaking,
    };
  });
}

function parseAuditOutput(raw: string) {
  const parsed = JSON.parse(raw);
  const counts = parsed.metadata?.vulnerabilities || {};
  return {
    report: parsed.metadata || {},
    critical_count: counts.critical || 0,
    high_count: counts.high || 0,
    medium_count: counts.moderate || 0,
    low_count: counts.low || 0,
    findings: extractFindings(parsed.vulnerabilities),
  };
}

type VulnerabilityScanResult = {
  report: Record<string, any>;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  findings: VulnerabilityFinding[];
};

// Not tenant-scoped: every tenant on this install shares the same node_modules, so the same scan
// result applies to all of them - a global cache avoids running npm audit once per tenant on the
// same heartbeat cycle. 24h TTL because the dependency tree only changes on deploy, not between
// heartbeats (every 15-60 min per tenant, per runHeartbeatForTenant below).
const VULN_SCAN_CACHE_KEY = "fleet:vuln_scan:global";
const VULN_SCAN_CACHE_TTL_SECONDS = 24 * 60 * 60;

async function runVulnerabilityScan(): Promise<VulnerabilityScanResult | null> {
  const cached = await redis.get(VULN_SCAN_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through and re-scan on a corrupt cache entry
    }
  }

  const scanned = await performVulnerabilityScan();
  if (scanned) {
    await redis.set(VULN_SCAN_CACHE_KEY, JSON.stringify(scanned), "EX", VULN_SCAN_CACHE_TTL_SECONDS);
  }
  return scanned;
}

// execSync blocked the entire Node event loop for however long npm audit takes (a real network
// call to the npm registry against the full dependency tree - confirmed capable of running many
// seconds), during which no other request on this same process could be served at all. Promisified
// exec runs the subprocess without blocking the loop.
async function performVulnerabilityScan(): Promise<VulnerabilityScanResult | null> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    const { stdout } = await execAsync("npm audit --json", { cwd: process.cwd(), timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    return parseAuditOutput(stdout);
  } catch (err: any) {
    // npm audit exits non-zero when vulnerabilities are found - stdout still has valid JSON.
    if (err.stdout) {
      try {
        return parseAuditOutput(err.stdout.toString());
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * The disk of the filesystem this installation actually runs on.
 *
 * WHICH filesystem: the one holding `process.cwd()`, not `/`. That is where the app is installed
 * and writes (uploads included), and therefore the disk whose filling up takes the installation
 * down - under a containerized deployment `/` can be the image's read-only overlay, which never
 * fills and whose number would say nothing.
 *
 * The CMCRM agent measures by the same rule, and that is a requirement rather than a coincidence:
 * both numbers land in the same meters on the CMSaaS installations screen, and two different
 * rules would make two incomparable fleets look comparable.
 *
 * "Used" is `blocks - bfree`, which is what `df` labels Used - it counts the root-reserved blocks
 * that `bavail` discounts. Using `bavail` would report more than `df` does and nobody could
 * reconcile the screen against a terminal.
 *
 * `statfsSync` is built in from Node 18.15 on, so this adds no dependency. Failing here is
 * deliberately silent: without disk, the heartbeat still goes out complete in everything else - a
 * heartbeat that failed over an optional metric would trade a missing number for an installation
 * that disappears from the panel.
 */
function collectDiskInfo(): { disk_total_mb?: number; disk_used_mb?: number } {
  try {
    const fs = statfsSync(process.cwd());
    const blockSize = Number(fs.bsize);
    const totalBytes = Number(fs.blocks) * blockSize;
    const usedBytes = (Number(fs.blocks) - Number(fs.bfree)) * blockSize;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return {};
    return {
      disk_total_mb: Math.round(totalBytes / (1024 * 1024)),
      // Clamped at zero for the `bfree > blocks` case some network filesystems report, which
      // would otherwise draw an inverted bar on the fleet screen.
      disk_used_mb: Math.max(0, Math.round(usedBytes / (1024 * 1024))),
    };
  } catch {
    return {};
  }
}

export function collectSystemInfo() {
  const totalMemoryMb = Math.round(os.totalmem() / (1024 * 1024));
  const usedMemoryMb = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));
  const cores = os.cpus().length || 1;
  // 1-minute load average as a % of total cores - a simple, dependency-free approximation of
  // CPU utilization (load average isn't a precise "% busy" figure, but it's good enough for a
  // fleet-wide trend chart and doesn't need a sampling window like a true CPU% measurement would).
  const cpuLoadPercent = Math.min(100, Math.round((os.loadavg()[0] / cores) * 100));
  return {
    os_platform: `${os.platform()} ${os.release()}`,
    cpu_cores: cores,
    cpu_load_percent: cpuLoadPercent,
    total_memory_mb: totalMemoryMb,
    memory_used_mb: usedMemoryMb,
    ...collectDiskInfo(),
    node_version: process.version,
    app_version: getAppVersion().version,
    app_git_sha: getAppVersion().gitShaShort,
  };
}

// Strips every *_encrypted field before the snapshot ever leaves this server - the Fleet Manager
// stores this purely as a recovery/diff aid, it should never receive even an encrypted secret.
function sanitizeSettingsForBackup(settings: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.endsWith("_encrypted")) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

// Shared by the full heartbeat and the lightweight license-status poll below - both receive the
// same signed {license, signature} shape and must apply the same signature/anti-replay checks
// before trusting it. Returns whether the response was accepted and cached.
async function verifyAndCacheLicensePayload(tenantId: string, data: { license: LicenseStatusPayload; signature: string }): Promise<boolean> {
  if (!verifyPayload(data.license, data.signature)) {
    logger.error({ tenantId }, "Fleet manager response signature verification FAILED - ignoring response");
    return false;
  }

  // Anti-replay (Fase 1.6 of the Zero Trust rollout): a captured {payload, signature} pair stays
  // validly signed for its whole valid_until window (up to 24h) - without this check, replaying
  // an old "active" response would resurrect that status even after a real suspension. issued_at
  // is set fresh by the Fleet Manager on every response (full heartbeat or lightweight poll
  // alike), so it doubles as a monotonic nonce with no wire-format change on that end: reject
  // anything that isn't strictly newer than what's already cached.
  const previousRaw = await redis.get(licenseCacheKey(tenantId));
  if (previousRaw) {
    const previous: CachedLicense = JSON.parse(previousRaw);
    if (new Date(data.license.issued_at).getTime() <= new Date(previous.payload.issued_at).getTime()) {
      logger.error(
        { tenantId, newIssuedAt: data.license.issued_at, cachedIssuedAt: previous.payload.issued_at },
        "Fleet manager response replay suspected - issued_at not newer than cached, ignoring response"
      );
      return false;
    }
  }

  const cached: CachedLicense = { payload: data.license, signature: data.signature, verifiedAt: new Date().toISOString() };
  const ttlMs = new Date(data.license.valid_until).getTime() - Date.now();
  await redis.set(licenseCacheKey(tenantId), JSON.stringify(cached), "PX", Math.max(ttlMs, 60000));
  return true;
}

// Called periodically (every 15-60 min) for every tenant with fleet reporting enabled. Never
// throws - a fleet manager outage or network failure must not disrupt the Pre-Sales Compliance
// Platform itself (fail-open is the whole point).

// ---------------------------------------------------------------------------------------------
// Status dos servicos essenciais, para o heartbeat.
//
// O conjunto e o do PreSales: banco, cache, storage e autenticacao. Os tres primeiros sao os
// mesmos que `/api/health/readiness` (server.ts) ja decide - reusar a MESMA regra e o ponto:
// duas definicoes de "o banco esta de pe" fariam o readiness e o painel do CMSaaS discordarem
// sobre a mesma instalacao.
//
// A autenticacao e a checagem que faltava: quando ela quebra ninguem entra, e o readiness
// continuava respondendo 200 "ready".
//
// F5 do doc 17 (01/09/2026): o alvo mudou junto com o produto. Era o JWKS do Keycloak; passou a
// ser a autenticacao PROPRIA - segredo de sessao configurado e pelo menos uma conta ativa com
// senha definida. Manter o alvo antigo faria esta linha do painel do CMSaaS reportar a saude de
// um servico do qual o PreSales ja nao depende, nas duas direcoes: vermelho a toa, ou verde com
// o login quebrado. Mesma decisao, mesma forma, nos tres produtos.
type StatusDeServico = "operational" | "degraded" | "down" | "unknown";

interface ServicoReportado {
  key: string;
  label: string;
  status: StatusDeServico;
  latency_ms?: number;
  detail?: string;
}

const TIMEOUT_DE_CHECK_MS = 5000;

async function comTimeout<T>(promessa: Promise<T>, rotulo: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${rotulo}: tempo esgotado em ${TIMEOUT_DE_CHECK_MS}ms`)), TIMEOUT_DE_CHECK_MS);
  });
  try {
    return await Promise.race([promessa, limite]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function medirServico(
  key: string,
  label: string,
  check: () => Promise<boolean>
): Promise<ServicoReportado> {
  const comeco = Date.now();
  try {
    const ok = await comTimeout(check(), key);
    return { key, label, status: ok ? "operational" : "down", latency_ms: Date.now() - comeco };
  } catch (err) {
    // O check estourando NAO e o mesmo que o servico estar fora: `unknown` diz "nao consegui
    // verificar", que e o que de fato aconteceu.
    return {
      key,
      label,
      status: "unknown",
      latency_ms: Date.now() - comeco,
      // Truncado: o CMSaaS aceita 300 caracteres neste campo e uma stack de driver passa disso.
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    };
  }
}

async function checarAutenticacao(): Promise<boolean> {
  // O mesmo minimo que `getJwtSecret()` exige em server/utils/security.ts: sem ele, todo login
  // estoura na assinatura da sessao.
  const segredo = process.env.JWT_SESSION_SECRET;
  if (!segredo || segredo.length < 16) return false;
  const comCredencial = await prisma.user.count({
    where: { status: "ACTIVE", passwordHash: { not: null } },
  });
  return comCredencial > 0;
}

export async function coletarStatusDosServicos(): Promise<ServicoReportado[]> {
  return Promise.all([
    medirServico("database", "Banco de dados", async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    }),
    medirServico("cache", "Cache e filas", async () => (await redis.ping()) === "PONG"),
    medirServico("storage", "Armazenamento", async () => {
      const settings = await dbStore.getSettings();
      return createStorageAdapter(settings).checkReachable();
    }),
    medirServico("auth", "Autenticacao", checarAutenticacao),
  ]);
}

export async function runHeartbeatForTenant(tenantId: string): Promise<void> {
  await runWithTenant({ tenantId }, async () => {
    try {
      const settings = await dbStore.getSettings();
      if (!settings.fleet_manager_enabled || !settings.fleet_manager_url || !settings.fleet_manager_api_key_encrypted) {
        return;
      }

      const apiKey = decryptSecret(settings.fleet_manager_api_key_encrypted);
      const logs = await collectRecentLogs(tenantId);
      const vulnerabilities = await runVulnerabilityScan();

      // The ia_kb add-on gates the global KB sync in BOTH directions - the Fleet Manager's own
      // heartbeat handler already rejects an upload from an installation without the entitlement,
      // but checking here too avoids doing the (cheap, but non-zero) work of gathering entries
      // that would just be thrown away on the other end. Uses the PREVIOUS heartbeat's verified
      // status (this one's own response hasn't arrived yet) - if the add-on was JUST activated,
      // this one heartbeat undersends by one cycle, which is a one-heartbeat-late sync, not a
      // security gap (the Fleet Manager's own check is the real enforcement boundary).
      const previousStatus = await getFleetLicenseStatus(tenantId);
      const hadIaKbBefore = previousStatus.modules.includes("ia_kb");

      // Locally-approved entries not yet uploaded - see dbStore.getKnowledgeBaseEntriesToSync.
      // Received synchronously by the Fleet Manager within this same request (unlike
      // commands/messages below, this direction needs no queue/ack - see
      // knowledgeBaseReconciliation.ts and heartbeat.ts for what happens to these on each end).
      const kbEntriesToSync = hadIaKbBefore ? await dbStore.getKnowledgeBaseEntriesToSync(50) : [];

      // F4 (rodada 09/2026): UMA lista, duas afirmacoes diferentes saindo dela.
      //
      // `ai_task_catalog` e o que o PRODUTO sabe executar: e por produto, so muda quando o codigo
      // muda, e o CMSaaS o adota em lugar da copia escrita a mao que ele mantinha
      // (`TAREFAS_PRESALES` em server/utils/productAiTasks.ts, la). Aquela copia tinha nove
      // entradas contra as onze reais - e um seed defasado e um seed que volta a valer no dia em
      // que o produto parar de declarar, entao declarar aqui e o que impede o defasamento de
      // voltar. `ai_task_config` continua sendo outra coisa: a ESCOLHA desta instalacao (que
      // tarefa usa que provedor/modelo), por instalacao e mudando o tempo todo. As duas saem da
      // mesma constante justamente para que nunca mais divirjam: ate a F4 esta lista tinha NOVE
      // das onze de `AiTaskType` (src/aiOrchestrator.ts) - faltavam `proposal_opinion_panel` e
      // `proposal_generation`, lacuna que o comentario daqui registrava sem corrigir.
      //
      // A ordem do outro lado ja favorece isto: o heartbeat do CMSaaS adota o catalogo declarado
      // ANTES de recortar `ai_task_config` contra ele (comentario explicito em heartbeat.ts:405),
      // entao as duas tarefas novas passam ja neste mesmo heartbeat, nao no seguinte.
      //
      // `capability` nao e decorativa: e ela que define que modelos o CMSaaS oferece para a
      // tarefa. `vision` nas tres que recebem arquivo binario (documento de licitacao, chat do
      // copiloto sobre PDF escaneado, planilha/catalogo de precos), `web_search` na unica que
      // roda busca real, `text` no resto - que so recebe prompt. `requiresModule` espelha o
      // add-on sem o qual a rota nem existe nesta instalacao.
      const AI_TASK_CATALOG = [
        { key: "document_analysis", label: "Analise de Documentos", capability: "vision" },
        { key: "web_grounding", label: "Pesquisa com Grounding Web", capability: "web_search" },
        { key: "spec_copilot", label: "Copiloto de Especificacoes (Chat)", capability: "vision" },
        { key: "document_classification", label: "Classificacao de Documentos", capability: "text" },
        { key: "poc_test_generation", label: "Geracao de Cadernos de Teste (POC)", capability: "text", requires_module: "poc" },
        { key: "poc_schedule_generation", label: "Sugestao de Cronograma (POC)", capability: "text", requires_module: "poc" },
        { key: "poc_final_report_generation", label: "Relatorio Final (POC)", capability: "text", requires_module: "poc" },
        { key: "proposal_opinion_panel", label: "Painel de Pareceres (Propostas)", capability: "text" },
        { key: "pricing_budget_optimization", label: "Otimizacao de Budget (Precificacao)", capability: "text", requires_module: "pricing" },
        { key: "pricing_catalog_extraction", label: "Extracao de Catalogo (Precificacao)", capability: "vision", requires_module: "pricing" },
        { key: "proposal_generation", label: "Geracao de Proposta", capability: "text" },
        // F6 (rodada 09/2026): a doze. Entra pelo mesmo caminho que a F4 abriu - declarar aqui
        // e o que faz o seed do CMSaaS deixar de defasar, e o heartbeat adota o catalogo antes
        // de recortar ai_task_config contra ele, entao ela vale ja neste mesmo heartbeat.
        { key: "proposal_section_rewrite", label: "Reescrita de Secao (Propostas)", capability: "text" },
        // F7 (rodada 09/2026): as tres da revisao assistida, da treze a quinze. Declarar aqui e o
        // que faz o seed do CMSaaS deixar de defasar, e o heartbeat adota o catalogo antes de
        // recortar ai_task_config contra ele - entao valem ja neste mesmo heartbeat.
        { key: "proposal_finding_remediation", label: "Sanacao de Apontamento (Propostas)", capability: "text" },
        { key: "proposal_grammar_check", label: "Revisao Gramatical (Propostas)", capability: "text" },
        { key: "proposal_section_coherence", label: "Coerencia entre Secoes (Propostas)", capability: "text" },
      ] as const;
      const aiTaskCatalog = AI_TASK_CATALOG.map((t) => ({
        key: t.key,
        label: t.label,
        capability: t.capability,
        requires_module: (t as { requires_module?: string }).requires_module,
      }));
      const aiTaskConfig = AI_TASK_CATALOG.map(({ key: taskType }) => ({
        task_type: taskType,
        provider: (settings as any)[`${taskType}_provider`] || "gemini",
        model: (settings as any)[`${taskType}_model`] || settings.default_model,
      }));

      // Os checks nao podem derrubar o heartbeat: um storage fora do ar nao pode fazer a
      // instalacao sumir do painel. `coletarStatusDosServicos` ja converte cada falha em status,
      // mas um erro fora dele viraria excecao aqui.
      const services = await coletarStatusDosServicos().catch(() => undefined);

      const body = JSON.stringify({
        logs,
        vulnerabilities: vulnerabilities || undefined,
        services,
        system_info: collectSystemInfo(),
        config_snapshot: sanitizeSettingsForBackup(settings as unknown as Record<string, any>),
        knowledge_base_entries: kbEntriesToSync.map((e) => ({
          id: e.id,
          category: e.category,
          trigger: e.trigger,
          knowledge: e.knowledge,
          source_project_name: e.source_project_name,
          source_document_name: e.source_document_name,
        })),
        ai_task_config: aiTaskConfig,
        ai_task_catalog: aiTaskCatalog,
      });
      // Fase 1.6 of the Zero Trust rollout: HMAC over the exact bytes being sent, keyed with the
      // same per-installation API key the Bearer header already carries - see the Fleet
      // Manager's requireHmacSignature for what this catches (in-transit tampering independent
      // of TLS) and what it doesn't (an attacker already holding this API key).
      const signature = crypto.createHmac("sha256", apiKey).update(body).digest("hex");

      const res = await fetch(`${settings.fleet_manager_url}/api/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Signature": signature },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        logger.error({ tenantId, httpStatus: res.status }, "Fleet manager heartbeat failed");
        return;
      }

      const data = await res.json();
      if (!(await verifyAndCacheLicensePayload(tenantId, data))) {
        return;
      }
      await redis.set(lastLogSyncKey(tenantId), new Date().toISOString());

      // CMS-001 / AUD-001 + CDC14-F2-001: commands e latest_release só são processados com uma
      // assinatura Ed25519 válida cobrindo os dois juntos - falha fechado (nem persiste
      // latest_release, nem age em nenhum command, nem faz ack deles) se a assinatura estiver
      // ausente ou não bater, sem derrubar o resto do heartbeat (license/ia_kb/mensagens continuam
      // funcionando normalmente).
      //
      // O campo lido é `commands_signature_v2`, e a mudança de nome é o conserto, não um detalhe:
      // a v1 (`commands_signature`) cobria só a QUANTIDADE de comandos, nunca o conteúdo deles -
      // ver o comentário longo de CDC14-F2-001 em verifyCommandsSignature. A premissa registrada
      // aqui até 24/08/2026 - "assinatura válida cobrindo os dois juntos" - venceu no dia em que
      // se mediu que ela não cobria: um apply_update adulterado em trânsito era aceito, e o
      // code_ref recebido ia direto para triggerImmediateUpdate.
      //
      // `data` é `await res.json()` sem tipo estrito, então ler o campo novo não muda interface
      // nenhuma. O CMSaaS emite as duas assinaturas em todo heartbeat desde 23/08/2026, e a v1 só
      // sai de circulação depois que toda instalação PreSales estiver neste código - retirá-la
      // antes faria cada uma delas recusar comandos no instante do deploy. Se um CMSaaS mais
      // antigo que essa data responder, não haverá v2 e este lado recusa: é a falha fechada
      // fazendo o que deve, e o preço deliberado de não aceitar mais uma assinatura que não
      // assina.
      const commandsVerified = verifyCommandsSignature(data.commands || [], data.latest_release || null, data.commands_signature_v2);
      if (!commandsVerified) {
        logger.error({ tenantId }, "Fleet manager commands/latest_release signature verification FAILED - ignoring commands and latest_release for this heartbeat");
      }

      // Sistema de Atualização de Produção: caches this heartbeat's latest_release (sibling of
      // license/commands/messages, signed together via commands_signature_v2 - see
      // signCommandsEnvelopeV2 on the Fleet Manager side and CDC14-F2-001 above) alongside a fresh
      // snapshot of the version this process is actually running.
      if (commandsVerified) {
        await persistLatestRelease(tenantId, data.latest_release || null).catch((err) =>
          logger.warn({ err, tenantId }, "Failed to persist latest_release from heartbeat")
        );
      }

      // ia_kb add-on: on the exact heartbeat where the entitlement transitions from absent/off to
      // enabled, this tenant's own AI provider keys are cleared - from this point on every AI call
      // routes through the Fleet Manager's proxy instead (see server/utils/aiProviders.ts), and a
      // stale self-managed key sitting in platform_settings would be actively misleading (it looks
      // configured but is never used again while the add-on is active). Reuses the exact same
      // clearing path PUT /settings/ai already exposes to an admin manually removing a key -
      // audited as a system action (ip_address "system"), not attributed to whichever admin
      // happened to trigger this heartbeat cycle.
      const hasIaKbNow = (data.license.modules || []).includes("ia_kb");
      if (!hadIaKbBefore && hasIaKbNow) {
        await dbStore.updateSettings({ ai_api_key_encrypted: "", openai_api_key_encrypted: "", anthropic_api_key_encrypted: "" });
        await dbStore.addAuditLog({
          user_id: "system",
          action: "IA/KB Add-on Activated - AI Keys Cleared",
          entity_type: "PlatformSettings",
          entity_id: "",
          ip_address: "system",
          user_agent: "fleet-license-heartbeat",
          metadata: JSON.stringify({ reason: "ia_kb module entitlement newly enabled - tenant now uses Fleet Manager-managed keys" }),
        });
      }

      // Billing snapshot for the Admin Console's usage table (Presales side never sees real
      // provider cost, only the value already marked up - see IaKbBillingSnapshot's own comment).
      if (hasIaKbNow && data.ia_kb_billing) {
        await dbStore.upsertIaKbBillingSnapshot({
          markup_percent: data.ia_kb_billing.markup_percent,
          cycle_start: data.ia_kb_billing.cycle_start,
          cycle_billed_cost_usd: data.ia_kb_billing.cycle_billed_cost_usd,
          cycle_call_count: data.ia_kb_billing.cycle_call_count,
          next_due_date: data.ia_kb_billing.next_due_date,
        }).catch((err) => logger.warn({ err, tenantId }, "Failed to persist ia_kb billing snapshot"));
      }

      // The CMSaaS admin's own per-task provider/model choices - only present once ia_kb is
      // enabled (see heartbeat.ts). resolveProvider() (src/aiOrchestrator.ts) reads this to
      // override this tenant's own platform_settings for the built-in provider/model choice.
      if (hasIaKbNow && Array.isArray(data.ia_kb_task_config)) {
        await dbStore.replaceIaKbTaskConfig(data.ia_kb_task_config).catch((err) => logger.warn({ err, tenantId }, "Failed to persist ia_kb task config"));
      }

      // CMS-001 / AUD-001: sem assinatura válida (commandsVerified acima), nenhum command é
      // processado NEM confirmado (sem ack) - o Fleet Manager reenvia no próximo heartbeat em vez
      // de marcar como entregue, então um bug transitório se autocorrige e uma adulteração de
      // verdade nunca progride silenciosamente.
      if (commandsVerified) {
        for (const command of data.commands || []) {
          // force_log_collection/force_vulnerability_scan already happened above (this heartbeat
          // always sends both) - acknowledging just tells the fleet manager it was delivered.
          // force_kb_sync is different: it clears every locally-approved entry's "already synced"
          // marker so a full resync goes up on the NEXT heartbeat (this one's body was already
          // built before this response arrived) rather than only newly-approved ones.
          if (command.type === "force_kb_sync") {
            await dbStore.resetKnowledgeBaseSyncCursor().catch((err) => logger.warn({ err, tenantId }, "Failed to reset knowledge base sync cursor for force_kb_sync"));
          }
          // Remote "force update now" push (Sistema de Atualização de Produção) - ack'd below same
          // as every other command regardless of whether the trigger itself actually started (e.g.
          // an update already running for this tenant just means this ack simply confirms delivery,
          // the CMSaaS admin still sees the in-progress one in the Atualizações tab either way).
          if (command.type === "apply_update" && command.payload?.release_id && command.payload?.code_ref) {
            await triggerImmediateUpdate(tenantId, {
              releaseId: command.payload.release_id,
              codeRef: command.payload.code_ref,
              triggeredBy: "remote_command",
            }).catch((err) => logger.error({ err, tenantId }, "Failed to trigger remote apply_update command"));
          }
          await fetch(`${settings.fleet_manager_url}/api/heartbeat/commands/${command.id}/ack`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          }).catch(() => {});
        }
      }

      for (const msg of data.messages || []) {
        // fleetMessageId is unique, so a message somehow re-delivered across heartbeats (the
        // Fleet Manager already tracks per-installation delivery, but this is cheap insurance)
        // just no-ops on the second insert instead of showing the same notice twice.
        // Not prisma.systemMessage.upsert(): the tenant-scoping extension (src/prisma.ts) adds
        // `tenantId` to an upsert's `where`, but fleetMessageId's unique constraint doesn't
        // include tenantId - the combined where then matches no unique index, Prisma can't find
        // the existing row, and a re-delivered message would hit the create branch again and
        // fail on the fleetMessageId unique constraint instead of the intended silent no-op.
        const existing = await prisma.systemMessage.findUnique({ where: { fleetMessageId: msg.id } });
        if (!existing) {
          await prisma.systemMessage.create({
            data: {
              id: randomId("sysmsg"),
              tenantId,
              source: "fleet_manager",
              fleetMessageId: msg.id,
              audience: msg.audience,
              body: msg.body,
              createdBy: "AI Pre-Sales Solutions",
              expiresAt: msg.expires_at ? new Date(msg.expires_at) : null,
            },
          });
        }
      }

      // Global Knowledge Base entries pushed down from the Fleet Manager - see
      // server/routes/heartbeat.ts on the Fleet Manager side for how these are queued
      // (PresalesKbDelivery, one per installation) and knowledgeBaseReconciliation.ts for the
      // duplicate/contradiction check each one goes through before landing locally.
      for (const kbItem of (data.knowledge_base_entries || []) as Array<IncomingGlobalKbEntry & { delivery_id: string }>) {
        try {
          const alreadyReceived = await dbStore.findKnowledgeBaseEntryByFleetGlobalId(kbItem.entry_id);
          if (!alreadyReceived) {
            const outcome = await reconcileIncomingKnowledgeEntry(kbItem, settings, tenantId);
            if (outcome.action === "create") {
              await dbStore.createKnowledgeBaseEntry({
                category: kbItem.category as any,
                trigger: kbItem.trigger,
                knowledge: outcome.status === "pending" ? `${outcome.conflictNote}${kbItem.knowledge}` : kbItem.knowledge,
                status: outcome.status,
                source: "fleet_manager_global",
                created_by: "CMSaaS",
                fleet_global_entry_id: kbItem.entry_id,
              });
            }
          }
        } catch (kbErr) {
          logger.warn({ err: kbErr, tenantId, entryId: kbItem.entry_id }, "Failed to apply incoming Fleet Manager knowledge base entry");
        }

        // Acknowledged regardless of outcome above (create/skip/already-received) - the delivery
        // itself was received and processed, which is all the Fleet Manager's ack tracks (same
        // "delivered vs acted-on-already-happened" semantics as the commands loop above).
        await fetch(`${settings.fleet_manager_url}/api/heartbeat/knowledge-base/${kbItem.delivery_id}/ack`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        }).catch((err) => logger.warn({ err, tenantId, entryId: kbItem.entry_id }, "Failed to ACK knowledge base entry to Fleet Manager"));
      }

      if (kbEntriesToSync.length > 0) {
        await dbStore.markKnowledgeBaseEntriesSynced(kbEntriesToSync.map((e) => e.id));
      }
    } catch (err) {
      logger.error({ err, tenantId }, "Fleet manager heartbeat error");
    }
  });
}

// Lightweight poll (every 30-60s, see runLicenseStatusPollForAllEnabledTenants below), separate
// from the full heartbeat's 20min cadence - lets a block/unblock applied in the Fleet Manager
// reach this installation almost immediately, without paying the cost of the full heartbeat's
// log collection, vuln scan and KB sync at that frequency. Silent on failure by design: at this
// polling rate, logging every transient miss the way the full heartbeat does would be noise, and
// a real persistent problem still surfaces there.
export async function runLicenseStatusPollForTenant(tenantId: string): Promise<void> {
  await runWithTenant({ tenantId }, async () => {
    try {
      const settings = await dbStore.getSettings();
      if (!settings.fleet_manager_enabled || !settings.fleet_manager_url || !settings.fleet_manager_api_key_encrypted) {
        return;
      }

      const apiKey = decryptSecret(settings.fleet_manager_api_key_encrypted);
      const res = await fetch(`${settings.fleet_manager_url}/api/heartbeat/license-status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return;

      const data = await res.json();
      await verifyAndCacheLicensePayload(tenantId, data);
    } catch {
      // Fail-open, same reasoning as the full heartbeat: a network blip here just leaves
      // whatever's already cached (still valid for up to 24h) in place.
    }
  });
}

export async function runLicenseStatusPollForAllEnabledTenants(): Promise<void> {
  const tenants = await dbStore.getAllTenantIdsWithFleetReportingEnabled();
  for (const tenantId of tenants) {
    await runLicenseStatusPollForTenant(tenantId);
  }
}

export interface FleetLicenseStatus {
  connected: boolean;
  // CDC 16 F1: quem é ESTA instalação, segundo a licença assinada. Já vinha no
  // payload desde a Fase 7 e era só descartado aqui. A porta de máquina do par
  // (server/utils/pairKey.ts) precisa dele para conferir que o lado PreSales do
  // par que o CMSaaS descreve é esta instalação, e não outra atendida pelo mesmo
  // CMSaaS - sem essa conferência, a chave de um par de outro cliente entraria.
  installation_id: string | null;
  status: "active" | "suspended" | null;
  block_mode: "full_lockout" | "read_only" | null;
  modules: string[];
  plan_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  last_verified_at: string | null;
  customer_name: string | null;
  customer_city: string | null;
  customer_state: string | null;
  customer_logo_base64: string | null;
}

// What the admin console actually shows in "Assinatura e Licença" - the real cached status from
// the last successful, signature-verified heartbeat. Never throws; no cache (fleet reporting
// disabled, never checked in, or a stale/unverifiable entry) just reads as "not connected" rather
// than exposing raw cache-miss/expiry details the customer's admin has no use for.
export async function getFleetLicenseStatus(tenantId: string): Promise<FleetLicenseStatus> {
  const disconnected: FleetLicenseStatus = {
    connected: false,
    installation_id: null,
    status: null,
    block_mode: null,
    modules: [],
    plan_name: null,
    contract_start_date: null,
    contract_end_date: null,
    last_verified_at: null,
    customer_name: null,
    customer_city: null,
    customer_state: null,
    customer_logo_base64: null,
  };
  try {
    const raw = await redis.get(licenseCacheKey(tenantId));
    if (!raw) return disconnected;
    const cached: CachedLicense = JSON.parse(raw);
    if (!verifyPayload(cached.payload, cached.signature)) return disconnected;
    return {
      connected: true,
      installation_id: cached.payload.installation_id ?? null,
      status: cached.payload.status,
      block_mode: cached.payload.block_mode,
      modules: cached.payload.modules,
      plan_name: cached.payload.plan_name,
      contract_start_date: cached.payload.contract_start_date,
      contract_end_date: cached.payload.contract_end_date,
      last_verified_at: cached.verifiedAt,
      customer_name: cached.payload.customer_name || null,
      customer_city: cached.payload.customer_city || null,
      customer_state: cached.payload.customer_state || null,
      customer_logo_base64: cached.payload.customer_logo_base64 || null,
    };
  } catch {
    return disconnected;
  }
}

export type EnforcementResult = { blocked: boolean; readOnly: boolean; message?: string };

// Fail-open by construction: no cached status, an expired one, or a signature that (somehow)
// no longer verifies all resolve to "allowed" - only an explicit, currently-valid, verified
// "suspended" status blocks anything.
export async function checkLicenseEnforcement(tenantId: string): Promise<EnforcementResult> {
  try {
    const raw = await redis.get(licenseCacheKey(tenantId));
    if (!raw) return { blocked: false, readOnly: false };

    const cached: CachedLicense = JSON.parse(raw);
    if (new Date(cached.payload.valid_until).getTime() <= Date.now()) {
      return { blocked: false, readOnly: false };
    }
    if (!verifyPayload(cached.payload, cached.signature)) {
      return { blocked: false, readOnly: false };
    }

    if (cached.payload.status !== "suspended") {
      return { blocked: false, readOnly: false };
    }

    return {
      blocked: cached.payload.block_mode === "full_lockout",
      readOnly: cached.payload.block_mode === "read_only",
      message: "Esta conta está suspensa. Entre em contato com a AI Pre-Sales Solutions para restaurar o acesso.",
    };
  } catch {
    return { blocked: false, readOnly: false };
  }
}

export async function runHeartbeatForAllEnabledTenants(): Promise<void> {
  const tenants = await dbStore.getAllTenantIdsWithFleetReportingEnabled();
  for (const tenantId of tenants) {
    await runHeartbeatForTenant(tenantId);
  }
}
