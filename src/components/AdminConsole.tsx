import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { Trash2, Star, Check, BookOpen, Pencil, X } from "lucide-react";
import {
  AuditLog,
  BrandingSettings,
  BrandStyle,
  Document,
  IntegrationConnector,
  PlatformSettings,
  Proposal,
  ProposalTemplate,
  PromptTemplate,
  Role,
} from "../types";
import { useAdminConsole } from "../hooks/useAdminConsole";
import ApiClient from "../lib/api";

interface FleetLicenseStatus {
  connected: boolean;
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

// Mirrors scripts/update.sh's own step() calls, in order - used only to compute a rough
// percentage for the progress bar (steps take very different amounts of time, so this is a
// "which stage" indicator, not a time-accurate progress meter).
const UPDATE_STEPS = [
  "Verificando pré-requisitos",
  "Buscando referência",
  "Fazendo backup (banco de dados + .env)",
  "Aplicando atualização: checkout",
  "Instalando dependências (npm ci)",
  "Aplicando migrações",
  "Compilando build de produção",
  "Reiniciando serviço",
  "Verificando saúde pós-atualização",
];
function updateStepIndex(currentStep: string | null): number {
  if (!currentStep) return -1;
  return UPDATE_STEPS.findIndex((s) => currentStep.startsWith(s));
}

interface SystemUpdateState {
  current_version: string | null;
  current_git_sha: string | null;
  last_checked_at: string | null;
  current_step?: string | null;
  latest_release: { id: string; version: string; channel: string; code_ref: string; published_at: string | null; notes_md: string | null } | null;
  scheduled_update_at: string | null;
  scheduled_release_id: string | null;
  scheduled_code_ref: string | null;
  last_attempt_status: "none" | "in_progress" | "success" | "failed" | "rolled_back";
  last_attempt_started_at: string | null;
  last_attempt_finished_at: string | null;
  last_attempt_from_version: string | null;
  last_attempt_to_version: string | null;
  last_attempt_error_log: string | null;
  backup_ref: string | null;
}

interface SystemUpdateHistoryRow {
  id: string;
  from_version: string | null;
  to_version: string;
  from_code_ref: string | null;
  to_code_ref: string;
  release_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: "none" | "in_progress" | "success" | "failed" | "rolled_back";
  triggered_by: "scheduled" | "manual" | "remote_command";
  error_log: string | null;
  backup_ref: string | null;
}

interface SystemMessageRow {
  id: string;
  source: "fleet_manager" | "local";
  audience: "admin_only" | "all_users";
  body: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
}

// AI Orchestrator UI redesign (2026-07): each task needs a different real capability from the
// model that serves it - document analysis and the spec copilot need to read a real PDF/image
// (vision), web-grounded research needs a live web search, document classification only ever
// sends already-extracted text. The model combobox for each orchestrator task is filtered to
// only the models that can actually do what that task requires, instead of a free-text field an
// admin could set to any string regardless of whether it fits.
type TaskCapability = "vision" | "web_search" | "text";

const TASK_CAPABILITY: Record<string, TaskCapability> = {
  document_analysis: "vision",
  spec_copilot: "vision",
  web_grounding: "web_search",
  document_classification: "text",
  poc_test_generation: "text",
  poc_schedule_generation: "text",
  poc_final_report_generation: "text",
  pricing_budget_optimization: "text",
  pricing_catalog_extraction: "vision",
};

// Curated, not exhaustive - especially for OpenAI, whose model lineup changes fast across several
// parallel series (gpt-5.4/5.5/5.6 all shipping at once). Researched against each provider's
// official docs (2026-07): Gemini 3.x and Anthropic's current Claude models all support both
// PDF/vision and native web search; OpenAI gained real PDF support in the Chat Completions API in
// ~March 2026 (same vision-capable models, gpt-4o onward - developers.openai.com/api/docs/guides/
// file-inputs), but its web search is a *separate* dedicated model (gpt-5-search-api) rather than
// a toggle on the normal chat models - it always searches before answering, so it's the only
// valid choice for OpenAI + web-grounded research.
const MODEL_OPTIONS_BY_PROVIDER: Record<string, Record<TaskCapability, string[]>> = {
  gemini: {
    vision: ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-3.1-flash-lite"],
    web_search: ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-3.1-flash-lite"],
    text: ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-3.1-flash-lite"],
  },
  anthropic: {
    vision: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8", "claude-fable-5"],
    web_search: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8", "claude-fable-5"],
    text: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8", "claude-fable-5"],
  },
  openai: {
    vision: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-5.4-mini", "gpt-5.4", "gpt-5.5", "gpt-5.6-sol"],
    web_search: ["gpt-5-search-api"],
    text: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-5.4-mini", "gpt-5.4", "gpt-5.5", "gpt-5.6-sol"],
  },
};

// Fase O: best cost-benefit pick per task, not a restriction - just a visual nudge in the UI
// below. Reasoning (2026-07):
// - document_analysis needs the strongest structured extraction/instruction-following for
//   compliance-grade documents (tenders, specs) - Claude Sonnet 5 has consistently been the more
//   reliable of the three at following a rigid extraction schema without drifting, and it's
//   already what this tenant runs in production for this exact task.
// - web_grounding is the one task Gemini is uniquely well-suited for: native, first-class search
//   grounding built into the API, vs. OpenAI needing an entirely separate dedicated model
//   (gpt-5-search-api, see MODEL_OPTIONS_BY_PROVIDER comment above) and Anthropic's grounding
//   being comparatively less mature - Gemini 3.5 Flash is also the cheapest of the three.
// - spec_copilot is the one place a real quality differential is worth paying for over the
//   cheapest tier (confirmed as a product priority, 2026-07-14): it's a technical spec assistant a
//   presales engineer leans on interactively, and GPT models have a strong track record
//   specifically at this kind of technical/engineering back-and-forth - gpt-4.1 over the flagship
//   5.x tier as the balance point (materially stronger than the Flash-class models on this exact
//   use case without going all the way to the most expensive option).
// - document_classification is a trivial single-label task with no real quality differential
//   between providers at this capability level - cheapest capable model wins (Gemini 3.5 Flash).
// - poc_test_generation/poc_schedule_generation/poc_final_report_generation are the tasks this
//   session's own hallucination fix (Fase H) was built around: they need to follow a strict
//   "ground in real data or explicitly say you can't" instruction under pressure to produce a
//   confident-sounding answer anyway - verified live in this session that Claude Sonnet 5 held
//   that discipline consistently (the DAI test-case/final-report generations came back correctly
//   grounded and correctly flagged missing coverage, not invented).
const RECOMMENDED_MODEL: Record<string, { provider: string; model: string }> = {
  document_analysis: { provider: "anthropic", model: "claude-sonnet-5" },
  web_grounding: { provider: "gemini", model: "gemini-3.5-flash" },
  spec_copilot: { provider: "openai", model: "gpt-4.1" },
  document_classification: { provider: "gemini", model: "gemini-3.5-flash" },
  poc_test_generation: { provider: "anthropic", model: "claude-sonnet-5" },
  poc_schedule_generation: { provider: "anthropic", model: "claude-sonnet-5" },
  poc_final_report_generation: { provider: "anthropic", model: "claude-sonnet-5" },
  // Módulo de Precificação, Fase 6 (add-on): escolhe a estratégia de distribuição de desconto
  // (equal_percent/equal_amount) e explica o porquê - julgamento estruturado com racional em
  // texto, mesma categoria dos 3 task types de POC acima, não classificação simples.
  pricing_budget_optimization: { provider: "anthropic", model: "claude-sonnet-5" },
  pricing_catalog_extraction: { provider: "anthropic", model: "claude-sonnet-5" },
};

type CustomProviderCapabilities = { provider_key: string; display_name: string; default_model: string; supports_vision: boolean; supports_web_search: boolean };

// Custom providers don't have a curated model list of their own - the only model we know it can
// actually serve is whatever the admin configured as its default_model, so that's the single
// option offered once a custom provider is selected for a task it's capable of.
function modelOptionsFor(provider: string, capability: TaskCapability, customProviders: CustomProviderCapabilities[]): string[] {
  if (MODEL_OPTIONS_BY_PROVIDER[provider]) return MODEL_OPTIONS_BY_PROVIDER[provider][capability];
  const custom = customProviders.find((p) => p.provider_key === provider);
  return custom ? [custom.default_model] : [];
}

// A custom provider only shows up as a provider choice for vision/web_search tasks if the admin
// explicitly declared that capability when adding it (see the checkboxes in "Adicionar
// Provedor") - defaults to not showing up, rather than every custom provider being offered for a
// task it almost certainly can't actually do.
function customProvidersForCapability(capability: TaskCapability, customProviders: CustomProviderCapabilities[]): CustomProviderCapabilities[] {
  if (capability === "text") return customProviders;
  return customProviders.filter((p) => (capability === "vision" ? p.supports_vision : p.supports_web_search));
}

// Providers researched as realistically integrable today: all expose an OpenAI-compatible chat
// completions endpoint (including JSON mode), so they work through the same generic custom-
// provider code path with no bespoke integration - these presets just pre-fill the add-provider
// form (including the capability checkboxes). Any other OpenAI-compatible endpoint (Groq,
// Together AI, Fireworks, OpenRouter, etc.) can still be added manually the same way, just
// without a one-click preset - and without the capability boxes pre-checked, since we haven't
// verified those specifically.
// Perplexity Sonar always grounds its answer in a real web search by product design (no opt-in
// "tools" parameter, unlike Gemini/Anthropic/OpenAI's search model) - confirmed against
// docs.perplexity.ai. It doesn't support PDF/vision, so supportsVision stays false.
const KNOWN_PROVIDER_PRESETS: { key: string; name: string; baseUrl: string; defaultModel: string; supportsVision: boolean; supportsWebSearch: boolean }[] = [
  { key: "grok", name: "Grok (xAI)", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4", supportsVision: false, supportsWebSearch: false },
  { key: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", supportsVision: false, supportsWebSearch: false },
  { key: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest", supportsVision: false, supportsWebSearch: false },
  { key: "perplexity", name: "Perplexity Sonar", baseUrl: "https://api.perplexity.ai", defaultModel: "sonar-pro", supportsVision: false, supportsWebSearch: true },
];

// Every AI-spending task type recorded in AiUsageLog (see AI_SPENDING_TASK_TYPES in
// src/aiOrchestrator.ts) - proposal generation itself is template/DOCX filling, not its own AI
// call, so it's correctly absent rather than showing a misleading "$0.00" for it.
const AI_TASK_TYPE_LABEL: Record<string, { pt: string; en: string }> = {
  document_analysis: { pt: "Análise de Documentos", en: "Document Analysis" },
  project_intake_analysis: { pt: "Extração de Metadados (Cadastro de Projeto)", en: "Metadata Extraction (Project Intake)" },
  knowledge_base_analysis: { pt: "Análise de Documentos (Base de Conhecimento)", en: "Document Analysis (Knowledge Base)" },
  spec_copilot_chat: { pt: "Copiloto de Especificações (Chat)", en: "Specification Copilot (Chat)" },
  bom_web_search: { pt: "Busca Web de Equipamentos (BOM)", en: "Equipment Web Search (BOM)" },
  kb_suggest: { pt: "Sugestão da Base de Conhecimento", en: "Knowledge Base Suggestion" },
  document_classification: { pt: "Classificação de Documentos", en: "Document Classification" },
  poc_test_generation: { pt: "Geração de Cadernos de Teste (POC)", en: "Test Script Generation (POC)" },
  poc_schedule_generation: { pt: "Sugestão de Cronograma (POC)", en: "Schedule Suggestion (POC)" },
  poc_final_report_generation: { pt: "Relatório Final (POC)", en: "Final Report (POC)" },
  proposal_opinion_panel: { pt: "Pareceres de IA Multi-Perspectiva (Propostas)", en: "Multi-Perspective AI Opinions (Proposals)" },
  pricing_budget_optimization: { pt: "Otimização de Budget (Precificação)", en: "Budget Optimization (Pricing)" },
  pricing_catalog_extraction: { pt: "Extração de Catálogo (Precificação)", en: "Catalog Extraction (Pricing)" },
};

// Column order for the per-provider cost breakdown table - the 3 providers this platform has
// today; a provider present in the data but not in this list still gets its own column (see the
// render below), it just isn't guaranteed a fixed position.
const COST_TABLE_PROVIDERS = ["anthropic", "openai", "gemini"] as const;
const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

// Single source of truth for the "Create New Role" module checkboxes and the permission set each
// one grants - previously two separate hardcoded lists (the checkbox array and this map), which
// could silently drift apart (a module checkbox with no matching permissions, or vice versa).
const MODULE_PERMISSION_MAP: Record<string, string[]> = {
  workspace: ["project:create", "project:read", "project:update", "document:upload", "document:read", "document:delete", "analysis:run", "analysis:read", "analysis:edit"],
  proposals: ["proposal:generate", "proposal:read", "proposal:approve"],
  templates: ["template:manage"],
  approval: ["approval:manage"],
  admin: ["admin:users", "admin:roles", "admin:settings", "admin:system_updates"],
  integrations: ["integrations:manage"],
  branding: ["branding:manage"],
  audit: ["admin:audit", "admin:debug", "admin:diagnostics"],
};

type AdminSection =
  | "overview" | "users" | "ai" | "templates" | "approval_flow"
  | "subscription" | "system_updates" | "branding" | "integrations" | "storage" | "audit";

interface AdminConsoleProps {
  locale: "en" | "pt";
  tx: (en: string, pt: string) => string;
  currentSessionUser: { id: string; name: string; email: string; role_id: string; role: string; permissions: string[]; enabled_modules?: string[] };
  hasPermission: (perm: string) => boolean;
  canAccessAdminSection: (section: string) => boolean;
  activeAdminSection: AdminSection;
  setActiveAdminSection: (s: AdminSection) => void;
  fetchGlobalConfigs: () => Promise<void> | void;
  documents: Document[];
  proposals: Proposal[];
  auditLogs: AuditLog[];
  users: any[];
  setUsers: (users: any[]) => void;
  roles: Role[];
  platformSettings: PlatformSettings | null;
  setPlatformSettings: Dispatch<SetStateAction<PlatformSettings | null>>;
  brandingSettings: BrandingSettings | null;
  setBrandingSettings: (settings: BrandingSettings) => void;
  promptTemplates: PromptTemplate[];
  aiProviderConfigs: { id: string; provider_key: string; display_name: string; base_url: string; default_model: string; api_key_masked: string; supports_vision: boolean; supports_web_search: boolean }[];
  proposalTemplates: ProposalTemplate[];
  approvalWorkflows: any[];
  setApprovalWorkflows: (workflows: any[]) => void;
  integrations: IntegrationConnector[];
  setIntegrations: (integrations: IntegrationConnector[]) => void;
  setShowAuditModal: (show: boolean) => void;
  setShowDebugConsole: (show: boolean) => void;
  brandLogoDataUrl: string;
  setBrandLogoDataUrl: (url: string) => void;
  brandPrimaryColor: string;
  setBrandPrimaryColor: (color: string) => void;
  brandAccentColor: string;
  setBrandAccentColor: (color: string) => void;
}

export default function AdminConsole({
  locale, tx, currentSessionUser, hasPermission, canAccessAdminSection,
  activeAdminSection, setActiveAdminSection, fetchGlobalConfigs,
  documents, proposals, auditLogs,
  users, setUsers, roles,
  platformSettings, setPlatformSettings,
  brandingSettings, setBrandingSettings,
  promptTemplates, aiProviderConfigs, proposalTemplates,
  approvalWorkflows, setApprovalWorkflows,
  integrations, setIntegrations,
  setShowAuditModal, setShowDebugConsole,
  brandLogoDataUrl, setBrandLogoDataUrl,
  brandPrimaryColor, setBrandPrimaryColor,
  brandAccentColor, setBrandAccentColor,
}: AdminConsoleProps) {
  // Real subscription/license state - reflects the last signature-verified heartbeat from the
  // Fleet Manager (see server/utils/fleetLicense.ts). Not a local simulation: this installation
  // has no way to "activate" itself, plan/status/contract term are only ever set on the Fleet
  // Manager side.
  const [fleetLicenseStatus, setFleetLicenseStatus] = useState<FleetLicenseStatus | null>(null);

  // Sistema de Atualização de Produção: state/history from server/routes/systemUpdates.ts -
  // fetched once on mount like fleetLicenseStatus just above, not gated on activeAdminSection
  // (the payload is small and this mirrors every other section's own fetch-on-mount convention).
  const [systemUpdateState, setSystemUpdateState] = useState<SystemUpdateState | null>(null);
  const [systemUpdateHistory, setSystemUpdateHistory] = useState<SystemUpdateHistoryRow[]>([]);
  const [systemUpdateNotesMd, setSystemUpdateNotesMd] = useState<string | null>(null);
  const [systemUpdateNotesLoading, setSystemUpdateNotesLoading] = useState(false);
  const [systemUpdateMessage, setSystemUpdateMessage] = useState("");
  const [scheduleDraft, setScheduleDraft] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const loadSystemUpdateState = () => {
    ApiClient.get<SystemUpdateState | null>("/api/admin/system-updates/state").then(setSystemUpdateState).catch(() => setSystemUpdateState(null));
    ApiClient.get<SystemUpdateHistoryRow[]>("/api/admin/system-updates/history").then(setSystemUpdateHistory).catch(() => setSystemUpdateHistory([]));
  };

  useEffect(() => {
    loadSystemUpdateState();
  }, []);

  // Barra de progresso ao vivo - mesma técnica (SSE) já usada pelo resto do app para
  // acompanhar tarefas em segundo plano (useBackgroundTasks.ts/tasks/stream), num canal próprio
  // por instalação em vez de por usuário (ver o comentário de subscribeToSystemUpdateProgress no
  // backend) - uma atualização agendada ou disparada remotamente pelo CMSaaS não tem um usuário
  // "dono" para direcionar o evento. Conexão única, aberta uma vez, sem polling.
  useEffect(() => {
    const token = localStorage.getItem("ca_session_token");
    if (!token) return;
    let cancelled = false;
    let es: EventSource | undefined;

    // AUD-006 (auditoria de segurança, 2026-07-19): EventSource não pode setar cabeçalhos, então
    // o token de sessão completo (válido por horas) ia direto na query string - troca por um
    // ticket de curta duração (mesmo mecanismo de useBackgroundTasks.ts), buscado antes via
    // requisição normal com o token no header.
    fetch("/api/auth/sse-ticket", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        es = new EventSource(`/api/admin/system-updates/stream?ticket=${encodeURIComponent(data.ticket)}`);
        // Redis pub/sub has no replay - a message published exactly while this connection is down
        // (the server-side app restart mid-update is the textbook case) is lost for good, not just
        // delayed. Reconciling with a normal fetch on every (re)connect - not just the first one -
        // is what makes a dropped connection self-heal instead of leaving the panel stuck on
        // whatever the last received event said. Same pattern useBackgroundTasks.ts already uses.
        es.onopen = () => loadSystemUpdateState();
        es.onmessage = (ev) => {
          try {
            const data: { status: string; current_step?: string | null } = JSON.parse(ev.data);
            setSystemUpdateState((prev) => (prev ? { ...prev, last_attempt_status: data.status as any, current_step: data.current_step ?? prev.current_step } : prev));
            if (data.status !== "in_progress") {
              // Estados terminais trazem mais campos do que o evento carrega (versão atual, histórico
              // novo) - uma busca completa pega o resto.
              loadSystemUpdateState();
            }
          } catch {
            // ignora mensagem malformada
          }
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  const fetchReleaseNotes = async () => {
    setSystemUpdateNotesLoading(true);
    setSystemUpdateMessage("");
    try {
      const result = await ApiClient.get<{ notes_md: string }>("/api/admin/system-updates/release-notes");
      setSystemUpdateNotesMd(result.notes_md);
    } catch (err: any) {
      setSystemUpdateMessage(err.message || "Não foi possível buscar as notas de versão.");
    } finally {
      setSystemUpdateNotesLoading(false);
    }
  };

  const submitSchedule = async () => {
    if (!scheduleDraft) return;
    setSystemUpdateMessage("");
    try {
      await ApiClient.post("/api/admin/system-updates/schedule", { update_at: new Date(scheduleDraft).toISOString() });
      setScheduleDraft("");
      loadSystemUpdateState();
    } catch (err: any) {
      setSystemUpdateMessage(err.message || "Não foi possível agendar a atualização.");
    }
  };

  const cancelSchedule = async () => {
    setSystemUpdateMessage("");
    try {
      await ApiClient.post("/api/admin/system-updates/cancel", {});
      loadSystemUpdateState();
    } catch (err: any) {
      setSystemUpdateMessage(err.message || "Não foi possível cancelar o agendamento.");
    }
  };

  const runUpdateNow = async () => {
    if (!confirm(locale === "pt" ? "Atualizar agora? O sistema fará backup e reiniciará sozinho." : "Update now? The system will back up and restart on its own.")) return;
    setSystemUpdateMessage("");
    try {
      await ApiClient.post("/api/admin/system-updates/run-now", {});
      setSystemUpdateMessage(locale === "pt" ? "Atualização iniciada." : "Update started.");
      loadSystemUpdateState();
    } catch (err: any) {
      setSystemUpdateMessage(err.message || "Não foi possível iniciar a atualização.");
    }
  };

  // Roadmap item (customer_request): "Identidade Visual em DOCX" Fase 4b - reusable named brand
  // styles a project can opt into instead of the tenant-wide branding above (Fase 4a). Own local
  // state/fetch, not routed through useAdminConsole - a small, independent CRUD surface.
  const [brandStyles, setBrandStyles] = useState<BrandStyle[]>([]);
  const [editingBrandStyle, setEditingBrandStyle] = useState<Partial<BrandStyle> | null>(null);
  const [savingBrandStyle, setSavingBrandStyle] = useState(false);

  useEffect(() => {
    if (activeAdminSection !== "branding") return;
    fetch("/api/brand-styles")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setBrandStyles(data); })
      .catch(() => {});
  }, [activeAdminSection]);

  const saveBrandStyle = async () => {
    if (!editingBrandStyle?.name?.trim()) {
      alert(locale === "pt" ? "O nome do estilo é obrigatório." : "Style name is required.");
      return;
    }
    setSavingBrandStyle(true);
    try {
      const isNew = !editingBrandStyle.id;
      const res = await fetch(isNew ? "/api/brand-styles" : `/api/brand-styles/${editingBrandStyle.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingBrandStyle.name,
          company_name: editingBrandStyle.company_name,
          logo_data_url: editingBrandStyle.logo_data_url,
          primary_color: editingBrandStyle.primary_color,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível salvar o estilo de marca." : "Could not save the brand style."));
        return;
      }
      setBrandStyles((prev) => (isNew ? [...prev, data] : prev.map((s) => (s.id === data.id ? data : s))));
      setEditingBrandStyle(null);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao salvar o estilo de marca." : "Error saving the brand style.");
    } finally {
      setSavingBrandStyle(false);
    }
  };

  const deleteBrandStyle = async (id: string) => {
    if (!confirm(locale === "pt" ? "Remover este estilo de marca? Projetos que o usam voltam a usar a identidade visual padrão." : "Remove this brand style? Projects using it will revert to the default branding.")) return;
    const res = await fetch(`/api/brand-styles/${id}`, { method: "DELETE" });
    if (res.ok) setBrandStyles((prev) => prev.filter((s) => s.id !== id));
  };

  // Only PNG/JPEG accepted - unlike the tenant-wide logo above (which also allows SVG/WebP for
  // on-screen UI use), a brand style's logo is embedded into an exported DOCX via
  // server/utils/docx.ts's buildDocxBuffer, whose image decoder only supports those two formats.
  const handleBrandStyleLogoUpload = (file?: File) => {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg"];
    if (!allowed.includes(file.type)) {
      alert(locale === "pt" ? "Formato inválido. Use PNG ou JPG (formatos suportados na exportação DOCX)." : "Invalid format. Use PNG or JPG (formats supported in DOCX export).");
      return;
    }
    if (file.size > 1024 * 1024) {
      alert(locale === "pt" ? "A logo deve ter no máximo 1 MB." : "Logo must be at most 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setEditingBrandStyle((prev) => (prev ? { ...prev, logo_data_url: dataUrl } : prev));
    };
    reader.readAsDataURL(file);
  };

  // Fase O: each orchestrator field already saves itself on change/blur (handleSavePlatformSettings)
  // - this doesn't change that mechanism, it only gives explicit visual confirmation, since the
  // reported problem was that switching tabs right after a change gave no feedback that anything
  // had actually persisted.
  const [orchestratorSaved, setOrchestratorSaved] = useState(false);

  useEffect(() => {
    ApiClient.get<FleetLicenseStatus>("/api/settings/fleet-license-status")
      .then(setFleetLicenseStatus)
      .catch(() => setFleetLicenseStatus(null));
  }, []);

  // Fase 6 (add-on): the "Geração de Cadernos de Teste (POC)" row in the orchestrator map only
  // makes sense once the tenant's Fleet Manager entitlement actually includes "poc" - same
  // signature-verified source as "Assinatura e Licença" above, not a local guess.
  const pocModuleEnabled = fleetLicenseStatus?.modules?.includes("poc") ?? false;
  const pricingModuleEnabled = fleetLicenseStatus?.modules?.includes("pricing") ?? false;

  // ia_kb add-on: when active, this tenant's AI calls route through the Fleet Manager's own
  // managed-key proxy (server/utils/aiProviders.ts) - the key-configuration UI below has nothing
  // to configure anymore (the tenant's own keys were cleared on activation), and provider/model
  // per task becomes read-only display instead of an editable combobox.
  const iaKbModuleEnabled = fleetLicenseStatus?.modules?.includes("ia_kb") ?? false;

  const [costUSD, setCostUSD] = useState(0);
  const [costByTaskTypeAndProvider, setCostByTaskTypeAndProvider] = useState<Record<string, Record<string, number>>>({});
  const exchangeRate = 5.15; // 1 USD = 5.15 BRL (approximate, not live-fetched)

  useEffect(() => {
    ApiClient.get<{ spend_usd: number; spend_by_task_type_and_provider: Record<string, Record<string, number>> }>("/api/settings/ai-cost-summary")
      .then((r) => {
        setCostUSD(r.spend_usd);
        setCostByTaskTypeAndProvider(r.spend_by_task_type_and_provider || {});
      })
      .catch(() => { setCostUSD(0); setCostByTaskTypeAndProvider({}); });
  }, []);

  interface IaKbBillingSnapshot {
    markup_percent: number;
    cycle_start: string | null;
    cycle_billed_cost_usd: number;
    cycle_call_count: number;
    next_due_date: string | null;
    last_synced_at: string;
  }
  const [iaKbBilling, setIaKbBilling] = useState<IaKbBillingSnapshot | null>(null);
  useEffect(() => {
    if (!iaKbModuleEnabled) return;
    ApiClient.get<IaKbBillingSnapshot | null>("/api/settings/iakb-billing")
      .then(setIaKbBilling)
      .catch(() => setIaKbBilling(null));
  }, [iaKbModuleEnabled]);

  // ia_kb add-on: once active, provider/model per task is chosen by the CMSaaS admin (synced on
  // every heartbeat, see server/utils/fleetLicense.ts) - platformSettings' own per-task fields
  // stop being what's actually used, so the read-only display below must read from here instead,
  // not from the (now potentially stale) platformSettings[field]/[modelField].
  const [iaKbTaskConfig, setIaKbTaskConfig] = useState<Record<string, { provider: string; model: string }>>({});
  useEffect(() => {
    if (!iaKbModuleEnabled) return;
    ApiClient.get<{ task_type: string; provider: string; model: string }[]>("/api/settings/iakb-task-config")
      .then((rows) => {
        const map: Record<string, { provider: string; model: string }> = {};
        for (const r of rows) map[r.task_type] = { provider: r.provider, model: r.model };
        setIaKbTaskConfig(map);
      })
      .catch(() => setIaKbTaskConfig({}));
  }, [iaKbModuleEnabled]);
  const [aiKeyDrafts, setAiKeyDrafts] = useState<Record<string, string>>({ gemini: "", openai: "", anthropic: "" });
  const [showAddProviderForm, setShowAddProviderForm] = useState(false);
  const [newProviderKey, setNewProviderKey] = useState("");
  const [newProviderDisplayName, setNewProviderDisplayName] = useState("");
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState("");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");
  const [newProviderDefaultModel, setNewProviderDefaultModel] = useState("");
  const [newProviderSupportsVision, setNewProviderSupportsVision] = useState(false);
  const [newProviderSupportsWebSearch, setNewProviderSupportsWebSearch] = useState(false);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  // Which version of each prompt type is currently displayed/selected in the combobox - defaults
  // (via a fallback in the render) to whichever version is isActive for that type.
  const [selectedPromptVersionByType, setSelectedPromptVersionByType] = useState<Record<string, string>>({});
  const [newVersionFormForType, setNewVersionFormForType] = useState<string | null>(null);
  const [newVersionLabel, setNewVersionLabel] = useState("");
  const [verticals, setVerticals] = useState<{ id: string; name: string; is_active: boolean }[]>([]);
  const [newVerticalName, setNewVerticalName] = useState("");
  const [newBroadcastMessage, setNewBroadcastMessage] = useState("");
  const [newBroadcastExpiryMinutes, setNewBroadcastExpiryMinutes] = useState("1440");
  const [systemMessages, setSystemMessages] = useState<SystemMessageRow[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageBody, setEditMessageBody] = useState("");
  const [editMessageAudience, setEditMessageAudience] = useState<"admin_only" | "all_users">("all_users");
  const [editMessageExpiryMinutes, setEditMessageExpiryMinutes] = useState("");

  const loadSystemMessages = () => {
    ApiClient.get<SystemMessageRow[]>("/api/messages").then(setSystemMessages).catch(() => setSystemMessages([]));
  };

  useEffect(() => {
    loadSystemMessages();
  }, []);

  const startEditingMessage = (m: SystemMessageRow) => {
    setEditingMessageId(m.id);
    setEditMessageBody(m.body);
    setEditMessageAudience(m.audience);
    setEditMessageExpiryMinutes("");
  };

  const handleUpdateMessage = async (id: string) => {
    if (!editMessageBody.trim()) return;
    try {
      await ApiClient.put(`/api/messages/${id}`, {
        audience: editMessageAudience,
        body: editMessageBody.trim(),
        // Empty selection = leave the current expiry untouched (undefined is dropped by the
        // backend's partial-update schema); "0" is the explicit "never expires" choice.
        ...(editMessageExpiryMinutes !== "" ? { expires_in_minutes: editMessageExpiryMinutes === "0" ? null : parseInt(editMessageExpiryMinutes, 10) } : {}),
      });
      setEditingMessageId(null);
      loadSystemMessages();
    } catch (err: any) {
      alert(err.message || (locale === "pt" ? "Não foi possível salvar a mensagem." : "Could not save the message."));
    }
  };

  const handleDeleteMessage = async (id: string) => {
    if (!confirm(locale === "pt" ? "Excluir esta mensagem?" : "Delete this message?")) return;
    try {
      await ApiClient.delete(`/api/messages/${id}`);
      loadSystemMessages();
    } catch (err: any) {
      alert(err.message || (locale === "pt" ? "Não foi possível excluir." : "Could not delete."));
    }
  };

  const loadVerticals = () => {
    ApiClient.get<{ id: string; name: string; is_active: boolean }[]>("/api/verticals").then(setVerticals).catch(() => setVerticals([]));
  };

  useEffect(() => {
    loadVerticals();
  }, []);

  const handleCreateVertical = async () => {
    if (!newVerticalName.trim()) return;
    try {
      await ApiClient.post("/api/verticals", { name: newVerticalName.trim() });
      setNewVerticalName("");
      loadVerticals();
    } catch (err: any) {
      alert(err.message || (locale === "pt" ? "Não foi possível adicionar a vertical." : "Could not add vertical."));
    }
  };

  const handleToggleVertical = async (v: { id: string; is_active: boolean }) => {
    await ApiClient.put(`/api/verticals/${v.id}`, { is_active: !v.is_active });
    loadVerticals();
  };

  const handleDeleteVertical = async (id: string) => {
    if (!confirm(locale === "pt" ? "Excluir esta vertical?" : "Delete this vertical?")) return;
    try {
      await ApiClient.delete(`/api/verticals/${id}`);
      loadVerticals();
    } catch (err: any) {
      alert(err.message || (locale === "pt" ? "Não foi possível excluir." : "Could not delete."));
    }
  };
  // Real per-provider connection status, derived from platformSettings (never a locally-simulated
  // list) - "PROVIDER_STATUS" reflects whether a key is actually configured on the backend.
  const PROVIDER_STATUS: { id: "gemini" | "openai" | "anthropic"; name: string; configured: boolean; masked: string }[] = [
    { id: "gemini", name: "Google Gemini", configured: Boolean(platformSettings?.ai_api_key_configured), masked: platformSettings?.ai_api_key_masked || "" },
    { id: "openai", name: "OpenAI ChatGPT", configured: Boolean(platformSettings?.openai_api_key_configured), masked: platformSettings?.openai_api_key_masked || "" },
    { id: "anthropic", name: "Anthropic Claude", configured: Boolean(platformSettings?.anthropic_api_key_configured), masked: platformSettings?.anthropic_api_key_masked || "" },
  ];

  const [templateUploadFile, setTemplateUploadFile] = useState<File | null>(null);
  const [templateUploadFileName, setTemplateUploadFileName] = useState<string>("");
  const [templateUploadName, setTemplateUploadName] = useState<string>("");
  const [templateUploadDescription, setTemplateUploadDescription] = useState<string>("");
  const [templateUploadVersion, setTemplateUploadVersion] = useState<string>("v1.0");
  const [templateUploadType, setTemplateUploadType] = useState<ProposalTemplate["template_type"]>("technical");
  const [templateUploadLanguage, setTemplateUploadLanguage] = useState<"Portuguese" | "English" | "Spanish">("Portuguese");
  const [isTemplateDragOver, setIsTemplateDragOver] = useState(false);

  const [newRoleName, setNewRoleName] = useState<string>("");
  const [newRoleDescription, setNewRoleDescription] = useState<string>("");
  const [newRoleModules, setNewRoleModules] = useState<string[]>(["workspace"]);

  const [showNewUserForm, setShowNewUserForm] = useState<boolean>(false);
  const [newUserName, setNewUserName] = useState<string>("");
  const [newUserEmail, setNewUserEmail] = useState<string>("");
  const [newUserRoleId, setNewUserRoleId] = useState<string>("r3");
  const [newUserPassword, setNewUserPassword] = useState<string>("ChangeMe123!");
  const [editingUserId, setEditingUserId] = useState<string>("");
  const [editingUserPassword, setEditingUserPassword] = useState<string>("");
  // Roadmap (segurança): marcado por padrão sempre que o admin define uma senha nova para um
  // usuário existente - o admin desmarca conscientemente se não quiser forçar a troca.
  const [forcePasswordChangeOnReset, setForcePasswordChangeOnReset] = useState<boolean>(true);

  const [showNewConnectorForm, setShowNewConnectorForm] = useState<boolean>(false);
  const [newConnectorName, setNewConnectorName] = useState<string>("");
  const [newConnectorType, setNewConnectorType] = useState<string>("Salesforce");
  const [newConnectorUrl, setNewConnectorUrl] = useState<string>("");
  const [newConnectorToken, setNewConnectorToken] = useState<string>("");

  const [storageValidateResult, setStorageValidateResult] = useState<any>(null);

  const [showNewApprovalWorkflowForm, setShowNewApprovalWorkflowForm] = useState<boolean>(false);
  const [newApprovalWorkflowName, setNewApprovalWorkflowName] = useState<string>("");
  const [newApprovalWorkflowDescription, setNewApprovalWorkflowDescription] = useState<string>("");
  const [newApprovalWorkflowAppliesTo, setNewApprovalWorkflowAppliesTo] = useState<string>("all");

  const {
    handleCreateApprovalWorkflow,
    handleSaveApprovalWorkflow,
    handleDuplicateApprovalWorkflow,
    handleDeleteApprovalWorkflow,
    handleValidateIntegration,
    handleCreateUser,
    handleUpdateUser,
    handleDeleteUser,
    handleCreateConnector,
    handleDeleteConnector,
    handleSaveBrandingSettings,
    handleRemoveBrandLogo,
    handleBrandLogoUpload,
    handleCreateProposalTemplate,
    handleValidateProposalTemplate,
    handleSetDefaultProposalTemplate,
    handleDeleteProposalTemplate,
    handleUpdatePromptTemplate,
    handleCreatePromptVersion,
    handleActivatePromptVersion,
    handleValidateStorageSettings,
    handleSavePlatformSettings,
    handleSaveAiApiKey,
    handleClearAiApiKey,
    handleAddAiProvider,
    handleDeleteAiProvider,
    proposalVariableCatalog,
  } = useAdminConsole({
    locale,
    currentUserName: currentSessionUser.name,
    roles,
    users,
    approvalWorkflows,
    fetchGlobalConfigs,
    setPlatformSettings,
    setBrandingSettings,
    setStorageValidateResult,
    setBrandLogoDataUrl,
    brandPrimaryColor,
    brandAccentColor,
    setBrandPrimaryColor,
    setBrandAccentColor,
    newApprovalWorkflowName,
    newApprovalWorkflowDescription,
    newApprovalWorkflowAppliesTo,
    setShowNewApprovalWorkflowForm,
    setNewApprovalWorkflowName,
    setNewApprovalWorkflowDescription,
    setNewApprovalWorkflowAppliesTo,
    newUserName,
    newUserEmail,
    newUserRoleId,
    newUserPassword,
    setShowNewUserForm,
    setNewUserName,
    setNewUserEmail,
    setNewUserRoleId,
    setNewUserPassword,
    newConnectorName,
    newConnectorType,
    newConnectorUrl,
    newConnectorToken,
    setShowNewConnectorForm,
    setNewConnectorName,
    setNewConnectorType,
    setNewConnectorUrl,
    setNewConnectorToken,
    templateUploadFile,
    templateUploadFileName,
    templateUploadName,
    templateUploadDescription,
    templateUploadVersion,
    templateUploadType,
    templateUploadLanguage,
    proposalTemplates,
    setTemplateUploadFile,
    setTemplateUploadFileName,
    setTemplateUploadName,
    setTemplateUploadDescription,
    setTemplateUploadVersion,
    setTemplateUploadType,
    setTemplateUploadLanguage,
  });

  const updateApprovalWorkflowLocal = (flowId: string, updater: (flow: any) => any) => {
    setApprovalWorkflows(approvalWorkflows.map((flow) => flow.id === flowId ? updater({ ...flow, stages: [...(flow.stages || [])] }) : flow));
  };

  return (
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-slate-100">

              <aside className="w-full lg:w-72 bg-slate-950 text-slate-300 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col shrink-0 max-h-72 lg:max-h-none">
                <div className="p-5 border-b border-slate-800">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500 font-mono mb-1">
                    {locale === "pt" ? "Administração" : "Administration"}
                  </p>
                  <h2 className="text-lg font-bold text-white">
                    {locale === "pt" ? "Configurações" : "Settings"}
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    {locale === "pt" ? "Central de configuração global do sistema." : "Global system configuration center."}
                  </p>
                  <a
                    href="/manuals/manual-administracao.html"
                    target="_blank"
                    rel="noopener"
                    className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 hover:underline"
                  >
                    <BookOpen size={12} />
                    {locale === "pt" ? "Manual de Administração" : "Administration Manual"}
                  </a>
                </div>

                <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:block lg:space-y-1 gap-2 lg:gap-0 overflow-y-auto">
                  {[
                    ["overview", locale === "pt" ? "Visão Geral" : "Overview", locale === "pt" ? "Resumo e saúde do sistema" : "System summary"],
                    ["users", locale === "pt" ? "Usuários e Acessos" : "Users & Access", locale === "pt" ? "Perfis, MFA e permissões" : "Roles, MFA and permissions"],
                    ["ai", locale === "pt" ? "IA, Prompts e Custos" : "AI, Prompts & Costs", locale === "pt" ? "Modelos, chaves e consumo" : "Models, keys and usage"],
                    ["templates", locale === "pt" ? "Templates de Propostas" : "Proposal Templates", locale === "pt" ? "Upload, preview e versionamento" : "Upload, preview and versioning"],
                    ["approval_flow", locale === "pt" ? "Fluxo de Aprovação" : "Approval Workflow", locale === "pt" ? "Etapas, responsáveis e regras" : "Stages, owners and rules"],
                    ["subscription", locale === "pt" ? "Subscrição e Licença" : "Subscription & License", locale === "pt" ? "Plano, chave e limites" : "Plan, key and limits"],
                    ["system_updates", locale === "pt" ? "Atualizações do Sistema" : "System Updates", locale === "pt" ? "Versão, agendamento e histórico" : "Version, scheduling and history"],
                    ["branding", locale === "pt" ? "Identidade Visual" : "Branding", locale === "pt" ? "Logo, cores e aparência" : "Logo, colors and appearance"],
                    ["integrations", locale === "pt" ? "Integrações e APIs" : "Integrations & APIs", locale === "pt" ? "CRM, ERP e conectores externos" : "CRM, ERP and external connectors"],
                    ["storage", locale === "pt" ? "Armazenamento" : "Storage", locale === "pt" ? "Arquivos, buckets e documentos" : "Files, buckets and documents"],
                    ["audit", locale === "pt" ? "Auditoria e Diagnóstico" : "Audit & Diagnostics", locale === "pt" ? "Logs, rastreio e exportação" : "Logs, traces and exports"],
                  ].filter(([id]) => canAccessAdminSection(String(id))).map(([id, label, desc]) => (
                    <button
                      key={id}
                      onClick={() => setActiveAdminSection(id as any)}
                      className={`w-full text-left rounded-lg px-3 py-2.5 border transition-all ${
                        activeAdminSection === id
                          ? "bg-white text-slate-950 border-white shadow"
                          : "border-transparent hover:bg-slate-900 hover:text-white"
                      }`}
                    >
                      <span className="block text-xs font-bold">{label}</span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">{desc}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5 space-y-4">
                <div className="w-full bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-mono">
                      {locale === "pt" ? "Administração do Sistema" : "System Administration"}
                    </p>
                    <h2 className="text-xl font-bold text-slate-900 mt-1">
                      {activeAdminSection === "overview" && canAccessAdminSection("overview") && (locale === "pt" ? "Visão Geral do Sistema" : "System Overview")}
                      {activeAdminSection === "users" && canAccessAdminSection("users") && (locale === "pt" ? "Usuários e Acessos" : "Users & Access")}
                      {activeAdminSection === "ai" && canAccessAdminSection("ai") && (locale === "pt" ? "IA, Prompts e Custos" : "AI, Prompts & Costs")}
                      {activeAdminSection === "templates" && canAccessAdminSection("templates") && (locale === "pt" ? "Templates de Propostas" : "Proposal Templates")}

                {activeAdminSection === "approval_flow" && canAccessAdminSection("approval_flow") && (locale === "pt" ? "Fluxo de Aprovação de Propostas" : "Proposal Approval Workflow")}
                      {activeAdminSection === "subscription" && canAccessAdminSection("subscription") && (locale === "pt" ? "Subscrição e Licença" : "Subscription & License")}
                      {activeAdminSection === "system_updates" && canAccessAdminSection("system_updates") && (locale === "pt" ? "Atualizações do Sistema" : "System Updates")}
                      {activeAdminSection === "branding" && canAccessAdminSection("branding") && (locale === "pt" ? "Personalização e Identidade Visual" : "Branding & Visual Identity")}
                      {activeAdminSection === "integrations" && canAccessAdminSection("integrations") && (locale === "pt" ? "Integrações, CRMs, ERPs e APIs" : "Integrations, CRMs, ERPs and APIs")}
                      {activeAdminSection === "storage" && canAccessAdminSection("storage") && (locale === "pt" ? "Armazenamento e Documentos" : "Storage & Documents")}
                      {activeAdminSection === "audit" && canAccessAdminSection("audit") && (locale === "pt" ? "Auditoria e Diagnóstico" : "Audit & Diagnostics")}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      {locale === "pt" ? "Configure parâmetros globais sem contexto de projeto ou licitação." : "Configure global settings without project or bid context."}
                    </p>
                  </div>
                  <span
                    className="text-xs text-white font-mono font-bold px-3 py-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: brandPrimaryColor }}
                  >
                    SUPER ADMIN
                  </span>
                </div>

                {activeAdminSection === "overview" && canAccessAdminSection("overview") && (
                  <div className="w-full space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                      {[
                        [locale === "pt" ? "Usuários" : "Users", users.length, locale === "pt" ? "contas" : "accounts"],
                        [locale === "pt" ? "Templates" : "Templates", proposalTemplates.length, locale === "pt" ? "modelos" : "templates"],
                        [locale === "pt" ? "Integrações" : "Integrations", integrations.length, locale === "pt" ? "conectores" : "connectors"],
                        [locale === "pt" ? "IAs Ativas" : "Active AIs", PROVIDER_STATUS.filter(p => p.configured).length, locale === "pt" ? "provedores" : "providers"],
                      ].map(([label, value, desc]) => (
                        <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">{label}</p>
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: brandPrimaryColor }}></span>
                          </div>
                          <div className="flex items-end justify-between mt-2">
                            <p className="text-2xl font-black text-slate-950 leading-none">{value}</p>
                            <p className="text-[11px] text-slate-500">{desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-12 xl:col-span-5 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-bold text-slate-800 uppercase font-mono">
                            {locale === "pt" ? "Integrações" : "Integrations"}
                          </h3>
                          <button
                            onClick={() => setActiveAdminSection("integrations")}
                            className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded"
                          >
                            {locale === "pt" ? "Gerenciar" : "Manage"}
                          </button>
                        </div>

                        {integrations.length === 0 ? (
                          <div className="h-28 flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-lg bg-slate-50 px-3">
                            <p className="text-xs text-slate-400 italic">
                              {locale === "pt" ? "Nenhuma integração configurada." : "No integration configured."}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-1">
                              {locale === "pt" ? "Adicione CRM, ERP ou API externa." : "Add CRM, ERP or external API."}
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {integrations.slice(0, 6).map(conn => (
                              <div key={conn.id} className="p-2 bg-slate-50 border border-slate-100 rounded-lg">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-700 text-xs truncate">{conn.name}</span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold shrink-0 ${conn.status === "connected" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                                    {conn.status}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-400 font-mono mt-1 truncate">{conn.type || "API"}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="col-span-12 xl:col-span-4 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-bold text-slate-800 uppercase font-mono">
                            {locale === "pt" ? "Provedores de IA" : "AI Providers"}
                          </h3>
                          <button
                            onClick={() => setActiveAdminSection("ai")}
                            className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded"
                          >
                            {locale === "pt" ? "Configurar" : "Configure"}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {PROVIDER_STATUS.map(prov => (
                            <div key={prov.id} className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                              <div className="flex justify-between items-center gap-2">
                                <span className="font-semibold text-slate-700 text-xs truncate">{prov.name}</span>
                                <span className={`text-[9px] font-bold ${prov.configured ? "text-emerald-600" : "text-slate-400"}`}>
                                  {prov.configured ? (locale === "pt" ? "Configurado" : "Configured") : (locale === "pt" ? "Não configurado" : "Not configured")}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 font-mono mt-1 truncate">{prov.masked || (locale === "pt" ? "Sem chave" : "No key")}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="col-span-12 xl:col-span-3 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <h3 className="text-xs font-bold text-slate-800 uppercase font-mono mb-3">
                          {locale === "pt" ? "Sistema" : "System"}
                        </h3>

                        <div className="space-y-2 text-xs text-slate-600">
                          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                            <p className="text-[9px] uppercase font-mono text-slate-400">{locale === "pt" ? "Licença" : "License"}</p>
                            <p className="font-bold text-slate-800 mt-1">
                              {fleetLicenseStatus?.connected
                                ? `${fleetLicenseStatus.plan_name || (locale === "pt" ? "Sem plano" : "No plan")} / ${fleetLicenseStatus.status === "active" ? (locale === "pt" ? "Ativa" : "Active") : (locale === "pt" ? "Suspensa" : "Suspended")}`
                                : locale === "pt" ? "Não conectado" : "Not connected"}
                            </p>
                          </div>

                          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                            <p className="text-[9px] uppercase font-mono text-slate-400">{locale === "pt" ? "Armazenamento" : "Storage"}</p>
                            <p className="font-bold text-slate-800 mt-1">{platformSettings?.storage_mode || "local"}</p>
                          </div>

                          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                            <p className="text-[9px] uppercase font-mono text-slate-400">{locale === "pt" ? "Visual" : "Branding"}</p>
                            <p className="font-bold text-slate-800 mt-1">
                              {brandLogoDataUrl ? (locale === "pt" ? "Logo personalizada" : "Custom logo") : (locale === "pt" ? "Padrão" : "Default")}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-12 xl:col-span-6 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <h3 className="text-xs font-bold text-slate-800 uppercase font-mono mb-3">
                          {locale === "pt" ? "Atalhos de Configuração" : "Configuration Shortcuts"}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <button onClick={() => setActiveAdminSection("branding")} className="p-2.5 text-left bg-slate-50 border border-slate-100 rounded-lg hover:border-emerald-300">
                            <span className="font-bold text-slate-700 block">{locale === "pt" ? "Visual" : "Branding"}</span>
                            <span className="text-[10px] text-slate-500">{locale === "pt" ? "Logo/cores" : "Logo/colors"}</span>
                          </button>
                          <button onClick={() => setActiveAdminSection("templates")} className="p-2.5 text-left bg-slate-50 border border-slate-100 rounded-lg hover:border-emerald-300">
                            <span className="font-bold text-slate-700 block">{locale === "pt" ? "Templates" : "Templates"}</span>
                            <span className="text-[10px] text-slate-500">{locale === "pt" ? "Modelos" : "Models"}</span>
                          </button>
                          <button onClick={() => setActiveAdminSection("approval_flow")} className="p-2.5 text-left bg-slate-50 border border-slate-100 rounded-lg hover:border-emerald-300">
                            <span className="font-bold text-slate-700 block">{locale === "pt" ? "Aprovação" : "Approval"}</span>
                            <span className="text-[10px] text-slate-500">{locale === "pt" ? "Fluxo" : "Workflow"}</span>
                          </button>
                          <button onClick={() => setActiveAdminSection("storage")} className="p-2.5 text-left bg-slate-50 border border-slate-100 rounded-lg hover:border-emerald-300">
                            <span className="font-bold text-slate-700 block">Storage</span>
                            <span className="text-[10px] text-slate-500">{locale === "pt" ? "Arquivos" : "Files"}</span>
                          </button>
                        </div>
                      </div>

                      <div className="col-span-12 xl:col-span-6 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <h3 className="text-xs font-bold text-slate-800 uppercase font-mono mb-3">
                          {locale === "pt" ? "Resumo Operacional" : "Operational Summary"}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                            <p className="text-[9px] uppercase font-mono text-slate-400">{locale === "pt" ? "Modelo" : "Model"}</p>
                            <p className="font-bold text-slate-800 mt-1 truncate">{platformSettings?.document_analysis_model || "Gemini 2.5 Flash"}</p>
                          </div>
                          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                            <p className="text-[9px] uppercase font-mono text-slate-400">Prompts</p>
                            <p className="font-bold text-slate-800 mt-1">{promptTemplates.length}</p>
                          </div>
                          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                            <p className="text-[9px] uppercase font-mono text-slate-400">{locale === "pt" ? "Auditoria" : "Audit"}</p>
                            <p className="font-bold text-slate-800 mt-1">{auditLogs.length} logs</p>
                          </div>
                          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                            <p className="text-[9px] uppercase font-mono text-slate-400">{locale === "pt" ? "Usuários" : "Users"}</p>
                            <p className="font-bold text-slate-800 mt-1">{locale === "pt" ? "30 / Ilimitado" : "30 / Unlimited"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeAdminSection === "overview" && canAccessAdminSection("overview") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                    <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                      {locale === "pt" ? "Enviar Aviso a Todos os Usuários" : "Send Notice to All Users"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {locale === "pt"
                        ? "Aparece como uma faixa rolante no rodapé do sistema para todos que acessarem enquanto estiver ativo."
                        : "Shows as a scrolling ticker at the bottom of the app for everyone while it's active."}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={newBroadcastMessage}
                        onChange={(e) => setNewBroadcastMessage(e.target.value)}
                        placeholder={locale === "pt" ? "Ex: Manutenção programada hoje das 23h às 3h." : "e.g. Scheduled maintenance tonight 11pm-3am."}
                        className="flex-1 p-2 rounded bg-slate-50 border border-slate-200 text-xs"
                      />
                      <select
                        value={newBroadcastExpiryMinutes}
                        onChange={(e) => setNewBroadcastExpiryMinutes(e.target.value)}
                        className="p-2 rounded bg-slate-50 border border-slate-200 text-xs"
                      >
                        <option value="">{locale === "pt" ? "Nunca expira" : "Never expires"}</option>
                        <option value="60">{locale === "pt" ? "1 hora" : "1 hour"}</option>
                        <option value="240">{locale === "pt" ? "4 horas" : "4 hours"}</option>
                        <option value="1440">{locale === "pt" ? "1 dia" : "1 day"}</option>
                        <option value="4320">{locale === "pt" ? "3 dias" : "3 days"}</option>
                        <option value="10080">{locale === "pt" ? "7 dias" : "7 days"}</option>
                      </select>
                      <button
                        onClick={async () => {
                          if (!newBroadcastMessage.trim()) return;
                          try {
                            await ApiClient.post("/api/messages", {
                              audience: "all_users",
                              body: newBroadcastMessage.trim(),
                              expires_in_minutes: newBroadcastExpiryMinutes ? parseInt(newBroadcastExpiryMinutes, 10) : null,
                            });
                            setNewBroadcastMessage("");
                            loadSystemMessages();
                          } catch (err: any) {
                            alert(err.message || (locale === "pt" ? "Não foi possível enviar." : "Could not send."));
                          }
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded shrink-0"
                      >
                        {locale === "pt" ? "Enviar" : "Send"}
                      </button>
                    </div>

                    <div className="border-t border-slate-100 pt-3 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-600">
                        {locale === "pt" ? "Avisos Enviados" : "Sent Notices"}
                      </h4>
                      {systemMessages.length === 0 && (
                        <p className="text-xs text-slate-400 italic">{locale === "pt" ? "Nenhum aviso ativo." : "No active notices."}</p>
                      )}
                      {systemMessages.map((m) => (
                        <div key={m.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                          {editingMessageId === m.id ? (
                            <>
                              <input
                                type="text"
                                value={editMessageBody}
                                onChange={(e) => setEditMessageBody(e.target.value)}
                                className="w-full p-2 rounded bg-white border border-slate-200 text-xs"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={editMessageAudience}
                                  onChange={(e) => setEditMessageAudience(e.target.value as "admin_only" | "all_users")}
                                  className="p-2 rounded bg-white border border-slate-200 text-xs"
                                >
                                  <option value="all_users">{locale === "pt" ? "Todos os usuários" : "All users"}</option>
                                  <option value="admin_only">{locale === "pt" ? "Somente admins" : "Admins only"}</option>
                                </select>
                                <select
                                  value={editMessageExpiryMinutes}
                                  onChange={(e) => setEditMessageExpiryMinutes(e.target.value)}
                                  className="p-2 rounded bg-white border border-slate-200 text-xs"
                                >
                                  <option value="">{locale === "pt" ? "Manter expiração atual" : "Keep current expiry"}</option>
                                  <option value="60">{locale === "pt" ? "1 hora a partir de agora" : "1 hour from now"}</option>
                                  <option value="240">{locale === "pt" ? "4 horas a partir de agora" : "4 hours from now"}</option>
                                  <option value="1440">{locale === "pt" ? "1 dia a partir de agora" : "1 day from now"}</option>
                                  <option value="4320">{locale === "pt" ? "3 dias a partir de agora" : "3 days from now"}</option>
                                  <option value="10080">{locale === "pt" ? "7 dias a partir de agora" : "7 days from now"}</option>
                                  <option value="0">{locale === "pt" ? "Nunca expira" : "Never expires"}</option>
                                </select>
                                <button
                                  onClick={() => handleUpdateMessage(m.id)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded"
                                >
                                  {locale === "pt" ? "Salvar" : "Save"}
                                </button>
                                <button
                                  onClick={() => setEditingMessageId(null)}
                                  className="text-slate-500 hover:text-slate-700 text-xs font-bold px-3 py-1.5 rounded border border-slate-200"
                                >
                                  {locale === "pt" ? "Cancelar" : "Cancel"}
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs text-slate-700 break-words">{m.body}</p>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  {m.source === "fleet_manager" ? (locale === "pt" ? "Fleet Manager" : "Fleet Manager") : m.created_by}
                                  {" · "}
                                  {m.audience === "admin_only" ? (locale === "pt" ? "Somente admins" : "Admins only") : (locale === "pt" ? "Todos os usuários" : "All users")}
                                  {" · "}
                                  {m.expires_at ? new Date(m.expires_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US") : (locale === "pt" ? "Nunca expira" : "Never expires")}
                                </p>
                              </div>
                              {m.source === "local" && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => startEditingMessage(m)} className="text-slate-400 hover:text-slate-700 p-1" title={locale === "pt" ? "Editar" : "Edit"}>
                                    <Pencil size={13} />
                                  </button>
                                  <button onClick={() => handleDeleteMessage(m.id)} className="text-red-400 hover:text-red-700 p-1" title={locale === "pt" ? "Excluir" : "Delete"}>
                                    <X size={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeAdminSection === "users" && canAccessAdminSection("users") && (
                  <div className="w-full space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {roles.map(role => (
                        <div key={role.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                          <h3 className="text-sm font-bold text-slate-900">{role.name}</h3>
                          <p className="text-xs text-slate-500 mt-1 min-h-8">{role.description}</p>
                          <p className="text-[10px] uppercase font-mono text-slate-400 mt-3 mb-2">{locale === "pt" ? "Permissões do perfil" : "Role permissions"}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(role.permissions || []).map(mod => (
                              <span key={mod} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold">
                                {mod}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">
                        {locale === "pt" ? "Criar Novo Perfil" : "Create New Role"}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder={locale === "pt" ? "Nome do perfil" : "Role name"} className="p-2 bg-slate-50 border border-slate-200 rounded" />
                        <input value={newRoleDescription} onChange={(e) => setNewRoleDescription(e.target.value)} placeholder={locale === "pt" ? "Descrição do perfil" : "Role description"} className="p-2 bg-slate-50 border border-slate-200 rounded" />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        {Object.keys(MODULE_PERMISSION_MAP).map(mod => (
                          <label key={mod} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded p-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newRoleModules.includes(mod)}
                              onChange={(e) => {
                                setNewRoleModules(e.target.checked ? [...newRoleModules, mod] : newRoleModules.filter(m => m !== mod));
                              }}
                            />
                            <span className="font-semibold text-slate-600">{mod}</span>
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={async () => {
                          if (!newRoleName.trim()) {
                            alert(locale === "pt" ? "Informe o nome do perfil." : "Enter the role name.");
                            return;
                          }

                          const permissions = Array.from(new Set(newRoleModules.flatMap((mod) => MODULE_PERMISSION_MAP[mod] || [])));

                          try {
                            const res = await fetch("/api/roles", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                name: newRoleName.trim(),
                                description: newRoleDescription.trim(),
                                permissions,
                              }),
                            });

                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              alert(err.message || (locale === "pt" ? "Não foi possível criar o perfil." : "Could not create role."));
                              return;
                            }

                            await fetchGlobalConfigs();
                            setNewRoleName("");
                            setNewRoleDescription("");
                            setNewRoleModules(["workspace"]);
                            alert(locale === "pt" ? "Perfil criado com sucesso." : "Role created successfully.");
                          } catch (err) {
                            console.error(err);
                            alert(locale === "pt" ? "Erro ao criar perfil." : "Error creating role.");
                          }
                        }}
                        className="bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded"
                      >
                        {locale === "pt" ? "Criar Perfil" : "Create Role"}
                      </button>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("User Access Directory", "Diretório de Acesso de Usuários")}</h3>
                        <button
                          onClick={() => setShowNewUserForm(!showNewUserForm)}
                          className="bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded"
                        >
                          {showNewUserForm ? (locale === "pt" ? "Cancelar" : "Cancel") : (locale === "pt" ? "+ Novo Usuário" : "+ New User")}
                        </button>
                      </div>
                      {showNewUserForm && (
                        <div className="p-4 border-b border-slate-200 bg-slate-50">
                          <h4 className="text-xs font-bold uppercase font-mono text-slate-700 mb-3">
                            {locale === "pt" ? "Criar Novo Usuário" : "Create New User"}
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
                            <input
                              value={newUserName}
                              onChange={(e) => setNewUserName(e.target.value)}
                              placeholder={locale === "pt" ? "Nome completo" : "Full name"}
                              className="p-2 bg-white border border-slate-200 rounded"
                            />
                            <input
                              value={newUserEmail}
                              onChange={(e) => setNewUserEmail(e.target.value)}
                              placeholder="email@empresa.com"
                              className="p-2 bg-white border border-slate-200 rounded"
                            />
                            <select
                              value={newUserRoleId}
                              onChange={(e) => setNewUserRoleId(e.target.value)}
                              className="p-2 bg-white border border-slate-200 rounded"
                            >
                              {roles.map((role) => (
                                <option key={role.id} value={role.id}>{role.name}</option>
                              ))}
                            </select>
                            <input
                              value={newUserPassword}
                              onChange={(e) => setNewUserPassword(e.target.value)}
                              placeholder={locale === "pt" ? "Senha inicial" : "Initial password"}
                              className="p-2 bg-white border border-slate-200 rounded font-mono"
                            />
                            <button
                              onClick={handleCreateUser}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded px-3 py-2"
                            >
                              {locale === "pt" ? "Criar Usuário" : "Create User"}
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-2">
                            {locale === "pt" ? "A senha inicial poderá ser alterada pelo administrador via reset de senha." : "The initial password can be changed later by the administrator."}
                          </p>
                        </div>
                      )}

                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="p-3">{tx("User", "Usuário")}</th>
                            <th className="p-3">{tx("Email", "E-mail")}</th>
                            <th className="p-3">{tx("Role Designation", "Perfil / Função")}</th>
                            <th className="p-3">{tx("MFA Setup", "Configuração MFA")}</th>
                            <th className="p-3">{tx("Access Security Status", "Status de Segurança do Acesso")}</th>
                            <th className="p-3">{tx("Last Login Action", "Última Ação de Login")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-slate-700 font-mono">
                          {users.map(u => (
                            <tr key={u.id} className="hover:bg-slate-50">
                              <td className="p-3 font-sans font-semibold text-slate-800">
                                <input
                                  value={u.name}
                                  onChange={(e) => setUsers(users.map((usr) => usr.id === u.id ? { ...usr, name: e.target.value } : usr))}
                                  onBlur={(e) => handleUpdateUser(u.id, { name: e.target.value })}
                                  className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-emerald-500 rounded px-2 py-1 outline-none"
                                />
                              </td>
                              <td className="p-3 font-semibold text-slate-500">
                                <input
                                  value={u.email}
                                  onChange={(e) => setUsers(users.map((usr) => usr.id === u.id ? { ...usr, email: e.target.value } : usr))}
                                  onBlur={(e) => handleUpdateUser(u.id, { email: e.target.value })}
                                  className="w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-emerald-500 rounded px-2 py-1 outline-none"
                                />
                              </td>
                              <td className="p-3 font-semibold uppercase text-slate-600">
                                <select
                                  value={u.role_id}
                                  onChange={(e) => {
                                    setUsers(users.map((usr) => usr.id === u.id ? { ...usr, role_id: e.target.value } : usr));
                                    handleUpdateUser(u.id, { role_id: e.target.value });
                                  }}
                                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                                >
                                  {roles.map((role) => (
                                    <option key={role.id} value={role.id}>{role.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="p-3 text-center">
                                <label className="inline-flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!u.mfa_enabled}
                                    onChange={(e) => {
                                      setUsers(users.map((usr) => usr.id === u.id ? { ...usr, mfa_enabled: e.target.checked } : usr));
                                      handleUpdateUser(u.id, { mfa_enabled: e.target.checked });
                                    }}
                                  />
                                  <span>{u.mfa_enabled ? tx("Active", "Ativo") : tx("Disabled", "Desativado")}</span>
                                </label>
                              </td>
                              <td className="p-3">
                                <select
                                  value={u.status || "ACTIVE"}
                                  onChange={(e) => {
                                    setUsers(users.map((usr) => usr.id === u.id ? { ...usr, status: e.target.value } : usr));
                                    handleUpdateUser(u.id, { status: e.target.value });
                                  }}
                                  className="bg-white border border-slate-200 rounded px-2 py-1 text-xs font-bold"
                                >
                                  <option value="ACTIVE">{tx("ACTIVE", "ATIVO")}</option>
                                  <option value="INACTIVE">{tx("INACTIVE", "INATIVO")}</option>
                                  <option value="PENDING">{tx("PENDING", "PENDENTE")}</option>
                                </select>
                              </td>
                              <td className="p-3 text-slate-500 leading-none">
                                <div className="flex flex-col gap-2">
                                  <span>{new Date(u.last_login_at || u.created_at).toLocaleString()}</span>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setEditingUserId(editingUserId === u.id ? "" : u.id)}
                                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded text-[10px] font-bold"
                                    >
                                      {locale === "pt" ? "Senha" : "Password"}
                                    </button>
                                    <button
                                      onClick={() => handleDeleteUser(u.id)}
                                      className="bg-red-50 hover:bg-red-600 hover:text-white text-red-700 px-2 py-1 rounded text-[10px] font-bold"
                                      disabled={u.id === currentSessionUser.id}
                                      title={u.id === currentSessionUser.id ? (locale === "pt" ? "Não é possível apagar o usuário logado." : "Cannot delete the current logged-in user.") : ""}
                                    >
                                      {locale === "pt" ? "Apagar" : "Delete"}
                                    </button>
                                  </div>
                                  {editingUserId === u.id && (
                                    <div className="flex flex-col gap-1">
                                      <div className="flex gap-1">
                                        <input
                                          type="password"
                                          value={editingUserPassword}
                                          onChange={(e) => setEditingUserPassword(e.target.value)}
                                          placeholder={locale === "pt" ? "Nova senha" : "New password"}
                                          className="w-28 p-1 border border-slate-200 rounded text-[10px]"
                                        />
                                        <button
                                          onClick={async () => {
                                            if (editingUserPassword.length < 8) {
                                              alert(locale === "pt" ? "A senha deve ter pelo menos 8 caracteres." : "Password must have at least 8 characters.");
                                              return;
                                            }
                                            await handleUpdateUser(u.id, { password: editingUserPassword, force_password_change: forcePasswordChangeOnReset });
                                            setEditingUserId("");
                                            setEditingUserPassword("");
                                            setForcePasswordChangeOnReset(true);
                                            alert(locale === "pt" ? "Senha atualizada." : "Password updated.");
                                          }}
                                          className="bg-emerald-600 text-white px-2 py-1 rounded text-[10px] font-bold"
                                        >
                                          OK
                                        </button>
                                      </div>
                                      <label className="flex items-center gap-1 text-[9px] text-slate-500">
                                        <input
                                          type="checkbox"
                                          checked={forcePasswordChangeOnReset}
                                          onChange={(e) => setForcePasswordChangeOnReset(e.target.checked)}
                                        />
                                        {locale === "pt" ? "Forçar troca de senha no próximo login" : "Force password change on next login"}
                                      </label>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeAdminSection === "ai" && canAccessAdminSection("ai") && (
                  <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Modelos e Provedores de IA" : "AI Models and Providers"}
                      </h3>

                      {iaKbModuleEnabled && (
                        <div className="p-3 rounded-lg border bg-blue-50 border-blue-200 text-blue-800">
                          <p className="text-[10px] uppercase font-bold tracking-wider font-mono">
                            {locale === "pt" ? "Add-on IA/KB ativo" : "IA/KB add-on active"}
                          </p>
                          <p className="text-[11px] mt-1">
                            {locale === "pt"
                              ? "As chaves de API são gerenciadas pela AI Pre-Sales Solutions enquanto este add-on estiver ativo - não há nada para configurar aqui. O consumo é medido e aparece na tabela de cobrança abaixo."
                              : "API keys are managed by AI Pre-Sales Solutions while this add-on is active - there's nothing to configure here. Usage is metered and shown in the billing table below."}
                          </p>
                        </div>
                      )}

                      {!iaKbModuleEnabled && (<>
                      <div className="space-y-3">
                        {PROVIDER_STATUS.map((prov) => (
                          <div key={prov.id} className={`p-3 rounded-lg border ${prov.configured ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div>
                                <p className="text-[10px] uppercase font-bold tracking-wider font-mono">{prov.name}</p>
                                <p className="text-[11px] mt-1 font-semibold">
                                  {prov.configured
                                    ? `${locale === "pt" ? "Configurada" : "Configured"}: ${prov.masked || "********"}`
                                    : (locale === "pt" ? "Não configurada" : "Not configured")}
                                </p>
                              </div>
                              {prov.configured && (
                                <button
                                  onClick={() => handleClearAiApiKey(prov.id)}
                                  className="bg-white/70 hover:bg-white border border-current px-2 py-1 rounded text-[10px] font-bold font-mono shrink-0"
                                >
                                  {locale === "pt" ? "Remover" : "Remove"}
                                </button>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <input
                                type="password"
                                placeholder={prov.configured ? (locale === "pt" ? "deixe em branco para manter" : "leave blank to keep") : (locale === "pt" ? "Cole a API key" : "Paste the API key")}
                                value={aiKeyDrafts[prov.id] || ""}
                                onChange={(e) => setAiKeyDrafts((prev) => ({ ...prev, [prov.id]: e.target.value }))}
                                className="w-full p-1.5 text-[11px] font-mono bg-white border border-current/30 rounded"
                              />
                              <button
                                onClick={() => {
                                  handleSaveAiApiKey(prov.id, aiKeyDrafts[prov.id] || "");
                                  setAiKeyDrafts((prev) => ({ ...prev, [prov.id]: "" }));
                                }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 rounded text-[10px] font-bold font-mono shrink-0"
                              >
                                {locale === "pt" ? "Salvar" : "Save"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="pt-3 border-t border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-700">
                            {locale === "pt" ? "Provedores Personalizados" : "Custom Providers"}
                          </h4>
                          <button
                            onClick={() => setShowAddProviderForm((v) => !v)}
                            className="bg-white border border-slate-300 text-slate-700 font-mono text-[10px] font-bold py-1 px-2 rounded cursor-pointer"
                          >
                            {showAddProviderForm ? (locale === "pt" ? "Cancelar" : "Cancel") : (locale === "pt" ? "+ Adicionar Provedor" : "+ Add Provider")}
                          </button>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          {locale === "pt"
                            ? "Qualquer provedor com endpoint compatível com OpenAI (Grok, DeepSeek, Mistral AI, Groq, Together AI, etc.) pode ser adicionado aqui e passa a aparecer nos seletores de tarefa abaixo."
                            : "Any provider with an OpenAI-compatible endpoint (Grok, DeepSeek, Mistral AI, Groq, Together AI, etc.) can be added here and will show up in the task selectors below."}
                        </p>

                        {aiProviderConfigs.length > 0 && (
                          <div className="space-y-2">
                            {aiProviderConfigs.map((p) => (
                              <div key={p.id} className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-bold text-slate-700 truncate">{p.display_name} <span className="text-slate-400 font-normal">({p.provider_key})</span></p>
                                  <p className="text-[10px] text-slate-400 font-mono truncate">{p.base_url} · {p.default_model} · {p.api_key_masked}</p>
                                  {(p.supports_vision || p.supports_web_search) && (
                                    <p className="text-[9px] text-emerald-600 font-mono mt-0.5">
                                      {[p.supports_vision && (locale === "pt" ? "PDF/visão" : "PDF/vision"), p.supports_web_search && (locale === "pt" ? "busca web" : "web search")]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  )}
                                </div>
                                <button
                                  onClick={() => handleDeleteAiProvider(p.id)}
                                  className="bg-white hover:bg-rose-50 border border-slate-300 hover:border-rose-300 text-slate-500 hover:text-rose-600 px-2 py-1 rounded text-[10px] font-bold font-mono shrink-0"
                                >
                                  {locale === "pt" ? "Remover" : "Remove"}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {showAddProviderForm && (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                              {KNOWN_PROVIDER_PRESETS.map((preset) => (
                                <button
                                  key={preset.key}
                                  onClick={() => {
                                    setNewProviderKey(preset.key);
                                    setNewProviderDisplayName(preset.name);
                                    setNewProviderBaseUrl(preset.baseUrl);
                                    setNewProviderDefaultModel(preset.defaultModel);
                                    setNewProviderSupportsVision(preset.supportsVision);
                                    setNewProviderSupportsWebSearch(preset.supportsWebSearch);
                                  }}
                                  className="text-[10px] bg-white border border-slate-300 text-slate-600 px-2 py-1 rounded font-mono font-bold cursor-pointer"
                                >
                                  {preset.name}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              placeholder={locale === "pt" ? "Chave (ex: grok)" : "Key (e.g. grok)"}
                              value={newProviderKey}
                              onChange={(e) => setNewProviderKey(e.target.value.toLowerCase())}
                              className="w-full p-2 text-xs font-mono bg-white border border-slate-200 rounded"
                            />
                            <input
                              type="text"
                              placeholder={locale === "pt" ? "Nome de exibição (ex: Grok)" : "Display name (e.g. Grok)"}
                              value={newProviderDisplayName}
                              onChange={(e) => setNewProviderDisplayName(e.target.value)}
                              className="w-full p-2 text-xs font-mono bg-white border border-slate-200 rounded"
                            />
                            <input
                              type="text"
                              placeholder="https://api.x.ai/v1"
                              value={newProviderBaseUrl}
                              onChange={(e) => setNewProviderBaseUrl(e.target.value)}
                              className="w-full p-2 text-xs font-mono bg-white border border-slate-200 rounded"
                            />
                            <input
                              type="text"
                              placeholder={locale === "pt" ? "Modelo padrão (ex: grok-4)" : "Default model (e.g. grok-4)"}
                              value={newProviderDefaultModel}
                              onChange={(e) => setNewProviderDefaultModel(e.target.value)}
                              className="w-full p-2 text-xs font-mono bg-white border border-slate-200 rounded"
                            />
                            <input
                              type="password"
                              placeholder={locale === "pt" ? "Chave de API" : "API key"}
                              value={newProviderApiKey}
                              onChange={(e) => setNewProviderApiKey(e.target.value)}
                              className="w-full p-2 text-xs font-mono bg-white border border-slate-200 rounded"
                            />
                            <div className="flex flex-col gap-1 pt-1">
                              <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={newProviderSupportsVision}
                                  onChange={(e) => setNewProviderSupportsVision(e.target.checked)}
                                />
                                {locale === "pt" ? "Suporta PDF/visão (análise de documentos)" : "Supports PDF/vision (document analysis)"}
                              </label>
                              <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={newProviderSupportsWebSearch}
                                  onChange={(e) => setNewProviderSupportsWebSearch(e.target.checked)}
                                />
                                {locale === "pt" ? "Suporta busca web nativa (ex: Perplexity Sonar)" : "Supports native web search (e.g. Perplexity Sonar)"}
                              </label>
                              <p className="text-[10px] text-slate-400">
                                {locale === "pt"
                                  ? "Marque só se você confirmou que o provedor realmente suporta - controla em quais tarefas do orquestrador ele aparece como opção."
                                  : "Only check if you've confirmed the provider genuinely supports it - controls which orchestrator tasks it shows up as an option for."}
                              </p>
                            </div>
                            <button
                              onClick={async () => {
                                const created = await handleAddAiProvider({
                                  provider_key: newProviderKey.trim(),
                                  display_name: newProviderDisplayName.trim(),
                                  base_url: newProviderBaseUrl.trim(),
                                  api_key: newProviderApiKey,
                                  default_model: newProviderDefaultModel.trim(),
                                  supports_vision: newProviderSupportsVision,
                                  supports_web_search: newProviderSupportsWebSearch,
                                });
                                if (created) {
                                  setShowAddProviderForm(false);
                                  setNewProviderKey("");
                                  setNewProviderDisplayName("");
                                  setNewProviderBaseUrl("");
                                  setNewProviderApiKey("");
                                  setNewProviderDefaultModel("");
                                  setNewProviderSupportsVision(false);
                                  setNewProviderSupportsWebSearch(false);
                                }
                              }}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-3 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Adicionar Provedor" : "Add Provider"}
                            </button>
                          </div>
                        )}
                      </div>
                      </>)}

                      <div className="pt-3 border-t border-slate-100 space-y-3">
                        <div>
                          <h4 className="text-xs font-bold text-slate-700">
                            {locale === "pt" ? "Orquestrador de IA: Mapa Tarefa → Provedor → Modelo" : "AI Orchestrator: Task → Provider → Model Map"}
                          </h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {locale === "pt"
                              ? "Uma tarefa configurada para um provedor sem chave configurada usa Gemini como fallback, registrado em auditoria. O combobox de modelo só mostra opções que a tarefa realmente consegue usar (ex: análise de documentos exige um modelo com suporte a PDF/visão; provedores personalizados só aparecem nas tarefas cuja capacidade foi marcada ao adicioná-los)."
                              : "A task configured for a provider without a configured key falls back to Gemini, logged in the audit trail. The model combobox only shows options the task can actually use (e.g. document analysis needs a model with PDF/vision support; custom providers only show up for tasks whose capability was checked when adding them)."}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {[
                            { field: "document_analysis_provider", modelField: "document_analysis_model", taskKey: "document_analysis", label: locale === "pt" ? "Análise de Documentos" : "Document Analysis" },
                            { field: "web_grounding_provider", modelField: "web_grounding_model", taskKey: "web_grounding", label: locale === "pt" ? "Pesquisa com Grounding Web" : "Web-Grounded Research" },
                            { field: "spec_copilot_provider", modelField: "spec_copilot_model", taskKey: "spec_copilot", label: locale === "pt" ? "Copiloto de Especificações (Chat)" : "Spec Copilot (Chat)" },
                            { field: "document_classification_provider", modelField: "document_classification_model", taskKey: "document_classification", label: locale === "pt" ? "Classificação de Documentos" : "Document Classification" },
                            // Add-on (Fase 6): only shown once the tenant's Fleet Manager entitlement includes "poc".
                            ...(pocModuleEnabled ? [{ field: "poc_test_generation_provider", modelField: "poc_test_generation_model", taskKey: "poc_test_generation", label: locale === "pt" ? "Geração de Cadernos de Teste (POC)" : "Test Script Generation (POC)" }] : []),
                            ...(pocModuleEnabled ? [{ field: "poc_schedule_generation_provider", modelField: "poc_schedule_generation_model", taskKey: "poc_schedule_generation", label: locale === "pt" ? "Sugestão de Cronograma (POC)" : "Schedule Suggestion (POC)" }] : []),
                            ...(pocModuleEnabled ? [{ field: "poc_final_report_generation_provider", modelField: "poc_final_report_generation_model", taskKey: "poc_final_report_generation", label: locale === "pt" ? "Relatório Final (POC)" : "Final Report (POC)" }] : []),
                            // Add-on (Módulo de Precificação): only shown once the tenant's Fleet Manager entitlement includes "pricing".
                            ...(pricingModuleEnabled ? [{ field: "pricing_budget_optimization_provider", modelField: "pricing_budget_optimization_model", taskKey: "pricing_budget_optimization", label: locale === "pt" ? "Otimização de Budget (Precificação)" : "Budget Optimization (Pricing)" }] : []),
                            ...(pricingModuleEnabled ? [{ field: "pricing_catalog_extraction_provider", modelField: "pricing_catalog_extraction_model", taskKey: "pricing_catalog_extraction", label: locale === "pt" ? "Extração de Catálogo (Precificação)" : "Catalog Extraction (Pricing)" }] : []),
                          ].map(({ field, modelField, taskKey, label }) => {
                            const capability = TASK_CAPABILITY[taskKey];
                            const currentProvider = (platformSettings as any)?.[field] || "gemini";
                            const validCustomProviders = customProvidersForCapability(capability, aiProviderConfigs);
                            const modelOptions = modelOptionsFor(currentProvider, capability, aiProviderConfigs);
                            const currentModel = (platformSettings as any)?.[modelField] || "";
                            // Bug real encontrado durante o ensaio no Presales Demo (2026-07-17): a
                            // checagem de "é a configuração recomendada?" comparava sempre contra
                            // platformSettings, mesmo com o ia_kb ativo - nesse caso o texto exibido
                            // já lia iaKbTaskConfig (a config de verdade, sincronizada do CMSaaS),
                            // mas a comparação continuava olhando pro campo local desatualizado.
                            const effectiveProvider = iaKbModuleEnabled ? (iaKbTaskConfig[taskKey]?.provider || currentProvider) : currentProvider;
                            const effectiveModel = iaKbModuleEnabled ? (iaKbTaskConfig[taskKey]?.model || currentModel) : currentModel;
                            return (
                              <div key={field}>
                                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{label}</label>
                                {iaKbModuleEnabled ? (
                                  // Read-only with the add-on active - reads the CMSaaS admin's
                                  // synced choice (iaKbTaskConfig), NOT platformSettings' own
                                  // field, which stops being what's actually used the moment this
                                  // add-on takes over (see resolveProvider in src/aiOrchestrator.ts).
                                  <div className="p-2 rounded bg-slate-50 border border-slate-200 text-xs">
                                    {iaKbTaskConfig[taskKey] ? (
                                      <>
                                        <span className="font-semibold text-slate-700">{PROVIDER_DISPLAY_NAME[iaKbTaskConfig[taskKey].provider] || iaKbTaskConfig[taskKey].provider}</span>
                                        <span className="text-slate-400"> · </span>
                                        <span className="font-mono text-slate-600">{iaKbTaskConfig[taskKey].model}</span>
                                      </>
                                    ) : (
                                      <span className="text-slate-400 italic">{locale === "pt" ? "Ainda não configurado pelo suporte" : "Not yet configured by support"}</span>
                                    )}
                                  </div>
                                ) : (
                                <div className="flex gap-2">
                                  <select
                                    value={currentProvider}
                                    onChange={(e) => {
                                      const newProvider = e.target.value;
                                      handleSavePlatformSettings(field, newProvider);
                                      // Keep the model field a valid pair for the newly selected provider -
                                      // this is exactly what broke document analysis before: the provider
                                      // dropdown changed but the model field kept a stale value.
                                      const newModelOptions = modelOptionsFor(newProvider, capability, aiProviderConfigs);
                                      if (newModelOptions.length > 0) {
                                        handleSavePlatformSettings(modelField, newModelOptions[0]);
                                      }
                                    }}
                                    className="w-1/2 p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs font-semibold text-slate-700"
                                  >
                                    <option value="gemini">Google Gemini</option>
                                    <option value="anthropic">Anthropic Claude {!PROVIDER_STATUS.find(p => p.id === "anthropic")?.configured ? (locale === "pt" ? "(não conectado)" : "(not connected)") : ""}</option>
                                    <option value="openai">OpenAI ChatGPT {!PROVIDER_STATUS.find(p => p.id === "openai")?.configured ? (locale === "pt" ? "(não conectado)" : "(not connected)") : ""}</option>
                                    {validCustomProviders.map((p) => (
                                      <option key={p.provider_key} value={p.provider_key}>{p.display_name}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={modelOptions.includes(currentModel) ? currentModel : (modelOptions[0] || "")}
                                    onChange={(e) => handleSavePlatformSettings(modelField, e.target.value)}
                                    disabled={modelOptions.length === 0}
                                    className="w-1/2 p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs font-mono text-slate-700 disabled:opacity-50"
                                  >
                                    {modelOptions.length === 0 && (
                                      <option value="">{locale === "pt" ? "Sem modelo válido" : "No valid model"}</option>
                                    )}
                                    {modelOptions.map((m) => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                </div>
                                )}
                                {RECOMMENDED_MODEL[taskKey] && (() => {
                                  const rec = RECOMMENDED_MODEL[taskKey];
                                  const isRecommended = effectiveProvider === rec.provider && effectiveModel === rec.model;
                                  return isRecommended ? (
                                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                                      <Check size={10} />
                                      {locale === "pt" ? "Configuração recomendada" : "Recommended configuration"}
                                    </div>
                                  ) : (
                                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                      <Star size={10} className="fill-amber-500 text-amber-500" />
                                      {locale === "pt" ? "Recomendado" : "Recommended"}: {PROVIDER_DISPLAY_NAME[rec.provider]} · {rec.model}
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })}
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">
                            {locale === "pt" ? "Teto Mensal de Custo de IA (USD)" : "Monthly AI Cost Cap (USD)"}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={locale === "pt" ? "Sem teto" : "Uncapped"}
                            value={platformSettings?.monthly_cost_cap_usd ?? ""}
                            onChange={(e) => handleSavePlatformSettings("monthly_cost_cap_usd", e.target.value ? parseFloat(e.target.value) : null)}
                            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs font-semibold text-slate-700"
                          />
                          <p className="text-[10px] text-slate-400 mt-1">
                            {locale === "pt"
                              ? "Bloqueia novas análises de IA ao atingir o teto (aviso automático em 80%). Deixe em branco para não limitar."
                              : "Blocks new AI analyses once reached (automatic warning at 80%). Leave blank for no limit."}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                          <button
                            onClick={() => {
                              setOrchestratorSaved(true);
                              setTimeout(() => setOrchestratorSaved(false), 2500);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
                          >
                            {locale === "pt" ? "Salvar" : "Save"}
                          </button>
                          {orchestratorSaved && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <Check size={13} />
                              {locale === "pt" ? "Salvo" : "Saved"}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">
                            {locale === "pt"
                              ? "Cada campo já é salvo assim que alterado - este botão só confirma."
                              : "Each field already saves as soon as it's changed - this button just confirms."}
                          </span>
                        </div>
                      </div>
                    </div>

                    {iaKbModuleEnabled && (
                      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                          {locale === "pt" ? "Consumo e Cobrança (Add-on IA/KB)" : "Usage and Billing (IA/KB Add-on)"}
                        </h3>
                        {iaKbBilling ? (
                          <>
                            <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                <span className="text-[9px] text-slate-400 block uppercase">{locale === "pt" ? "Chamadas no Ciclo" : "Calls This Cycle"}</span>
                                <span className="text-lg font-bold text-slate-800 mt-1 block">{iaKbBilling.cycle_call_count}</span>
                              </div>
                              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                <span className="text-[9px] text-slate-400 block uppercase">{locale === "pt" ? "Valor do Ciclo (USD)" : "Cycle Amount (USD)"}</span>
                                <span className="text-lg font-bold text-slate-800 mt-1 block">${iaKbBilling.cycle_billed_cost_usd.toFixed(2)}</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                <span className="text-[9px] text-slate-400 block uppercase">{locale === "pt" ? "Início do Ciclo" : "Cycle Start"}</span>
                                <span className="text-sm font-bold text-slate-700 mt-1 block">
                                  {iaKbBilling.cycle_start ? new Date(iaKbBilling.cycle_start).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US") : "-"}
                                </span>
                              </div>
                              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                                <span className="text-[9px] text-slate-400 block uppercase">{locale === "pt" ? "Próximo Vencimento" : "Next Due Date"}</span>
                                <span className="text-sm font-bold text-slate-700 mt-1 block">
                                  {iaKbBilling.next_due_date ? new Date(iaKbBilling.next_due_date).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US") : "-"}
                                </span>
                              </div>
                            </div>
                            <p className="text-[10px] text-slate-400">
                              {locale === "pt"
                                ? `Sincronizado pela última vez em ${new Date(iaKbBilling.last_synced_at).toLocaleString("pt-BR")} - atualizado a cada verificação com o Fleet Manager.`
                                : `Last synced ${new Date(iaKbBilling.last_synced_at).toLocaleString("en-US")} - refreshed on every Fleet Manager check-in.`}
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-slate-400 italic py-4 text-center">
                            {locale === "pt" ? "Aguardando a primeira sincronização com o Fleet Manager." : "Waiting for the first Fleet Manager sync."}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Custos de IA e Prompts" : "AI Costs and Prompts"}
                      </h3>
                      <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                        <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                          <span className="text-[9px] text-slate-400 block uppercase">{locale === "pt" ? "Consumo Estimado (USD)" : "Estimated Cost (USD)"}</span>
                          <span className="text-lg font-bold text-slate-800 mt-1 block">${costUSD.toFixed(2)} USD</span>
                        </div>
                        <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                          <span className="text-[9px] text-slate-400 block uppercase">{locale === "pt" ? "Consumo Convertido (BRL)" : "Converted Cost (BRL)"}</span>
                          <span className="text-lg font-bold text-slate-800 mt-1 block">R$ {(costUSD * exchangeRate).toFixed(2)} BRL</span>
                        </div>
                      </div>
                      <div className="border-t border-slate-100 pt-3">
                        <span className="text-[9px] text-slate-400 block uppercase mb-2 font-mono">{locale === "pt" ? "Consumo por Serviço e Provedor (mês atual)" : "Cost by Service and Provider (current month)"}</span>
                        {(() => {
                          // Any provider that actually has spend this month gets a column too,
                          // even if it's not one of the 3 known ones - never silently drops real
                          // cost data because a provider isn't in the fixed list.
                          const extraProviders = Object.values(costByTaskTypeAndProvider)
                            .flatMap((byProvider) => Object.keys(byProvider))
                            .filter((p) => !(COST_TABLE_PROVIDERS as readonly string[]).includes(p));
                          const providerColumns = [...COST_TABLE_PROVIDERS, ...new Set(extraProviders)];
                          const taskTypesWithSpend = Object.keys(AI_TASK_TYPE_LABEL).filter((t) =>
                            Object.values(costByTaskTypeAndProvider[t] || {}).some((v) => v > 0)
                          );

                          if (taskTypesWithSpend.length === 0) {
                            return (
                              <div className="text-xs text-slate-400 italic px-3 py-4 text-center bg-slate-50 border border-slate-100 rounded-lg">
                                {locale === "pt" ? "Nenhum consumo de IA registrado neste mês ainda." : "No AI usage recorded this month yet."}
                              </div>
                            );
                          }

                          return (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs border-collapse">
                                <thead>
                                  <tr className="text-[9px] uppercase text-slate-400 font-mono">
                                    <th className="text-left font-bold pb-1.5 pr-2">{locale === "pt" ? "Serviço" : "Service"}</th>
                                    {providerColumns.map((p) => (
                                      <th key={p} className="text-right font-bold pb-1.5 px-2">{PROVIDER_DISPLAY_NAME[p] || p}</th>
                                    ))}
                                    <th className="text-right font-bold pb-1.5 pl-2">{locale === "pt" ? "Total" : "Total"}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {taskTypesWithSpend.map((taskType) => {
                                    const byProvider = costByTaskTypeAndProvider[taskType] || {};
                                    const rowTotal = Object.values(byProvider).reduce((sum, v) => sum + v, 0);
                                    return (
                                      <tr key={taskType} className="border-t border-slate-100">
                                        <td className="py-2 pr-2 text-slate-600 font-mono">{locale === "pt" ? AI_TASK_TYPE_LABEL[taskType].pt : AI_TASK_TYPE_LABEL[taskType].en}</td>
                                        {providerColumns.map((p) => (
                                          <td key={p} className="py-2 px-2 text-right font-mono text-slate-500">
                                            {byProvider[p] ? `$${byProvider[p].toFixed(2)}` : "—"}
                                          </td>
                                        ))}
                                        <td className="py-2 pl-2 text-right font-mono font-bold text-slate-800">${rowTotal.toFixed(2)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="space-y-4 max-h-[640px] overflow-y-auto pr-1">
                        {Object.entries(
                          promptTemplates.reduce((acc, p) => {
                            (acc[p.type] ??= []).push(p);
                            return acc;
                          }, {} as Record<string, typeof promptTemplates>)
                        ).map(([type, versions]) => {
                          const displayName =
                            type === "classification" ? tx("Document Classification Prompt", "Prompt de Classificação de Documentos")
                            : type === "analysis" ? tx("Pre-Sales Technical Specification Analyser", "Analisador de Especificação Técnica de Pré-Vendas")
                            : type === "poc_test_generation" ? tx("POC Test Case Generation Prompt", "Prompt de Geração de Cadernos de Teste (POC)")
                            : type === "poc_schedule_generation" ? tx("POC Schedule Suggestion Prompt", "Prompt de Sugestão de Cronograma (POC)")
                            : type === "poc_final_report_generation" ? tx("POC Final Report Questionnaire Prompt", "Prompt de Relatório Final (POC)")
                            : type;
                          const activeVersion = versions.find((v) => v.is_active) || versions[0];
                          const selectedId = selectedPromptVersionByType[type] ?? activeVersion?.id;
                          const prm = versions.find((v) => v.id === selectedId) || activeVersion;
                          if (!prm) return null;
                          const isEditing = editingPromptId === prm.id;
                          const isShowingNewVersionForm = newVersionFormForType === type;
                          return (
                          <div key={type} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                            <div className="flex justify-between items-center flex-wrap gap-2">
                              <div>
                                <h4 className="text-xs font-bold text-slate-800 uppercase font-mono">{displayName}</h4>
                                <span className="text-[10px] text-slate-400 uppercase font-mono">{tx("Language Target", "Idioma Alvo")}: {prm.language}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={prm.id}
                                  onChange={(e) => setSelectedPromptVersionByType((prev) => ({ ...prev, [type]: e.target.value }))}
                                  className="text-[11px] font-mono border border-slate-300 rounded px-2 py-1 bg-white text-slate-700"
                                >
                                  {versions.map((v) => (
                                    <option key={v.id} value={v.id}>{v.version}{v.is_active ? (locale === "pt" ? " (ativa)" : " (active)") : ""}</option>
                                  ))}
                                </select>
                                {prm.is_active ? (
                                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase font-mono">{tx("ACTIVE", "ATIVA")}</span>
                                ) : (
                                  <button
                                    onClick={() => handleActivatePromptVersion(prm.id)}
                                    className="text-[10px] bg-amber-50 text-amber-700 hover:bg-amber-100 px-2 py-1 rounded font-bold uppercase font-mono cursor-pointer"
                                  >
                                    {locale === "pt" ? "Ativar Esta Versão" : "Activate This Version"}
                                  </button>
                                )}
                              </div>
                            </div>
                            <textarea
                              value={promptDrafts[prm.id] ?? prm.content}
                              onChange={(e) => setPromptDrafts((prev) => ({ ...prev, [prm.id]: e.target.value }))}
                              disabled={!isEditing}
                              id={`textarea-prm-${prm.id}`}
                              className="w-full h-24 p-3 rounded font-mono text-xs bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none leading-normal text-slate-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                            <div className="flex justify-end gap-2 flex-wrap">
                              {!isEditing ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setNewVersionFormForType(type);
                                      setNewVersionLabel("");
                                    }}
                                    className="bg-white border border-slate-300 text-slate-700 font-mono text-xs font-bold py-1.5 px-3 rounded cursor-pointer"
                                  >
                                    {locale === "pt" ? "Nova Versão" : "New Version"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingPromptId(prm.id);
                                      setPromptDrafts((prev) => ({ ...prev, [prm.id]: prm.content }));
                                    }}
                                    className="bg-white border border-slate-300 text-slate-700 font-mono text-xs font-bold py-1.5 px-3 rounded cursor-pointer"
                                  >
                                    {locale === "pt" ? "Editar" : "Edit"}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setPromptDrafts((prev) => ({ ...prev, [prm.id]: prm.factory_default }))}
                                    className="bg-white border border-slate-300 text-slate-700 font-mono text-xs font-bold py-1.5 px-3 rounded cursor-pointer"
                                  >
                                    {locale === "pt" ? "Padrão de Fábrica" : "Factory Default"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingPromptId(null);
                                      setPromptDrafts((prev) => { const next = { ...prev }; delete next[prm.id]; return next; });
                                    }}
                                    className="bg-white border border-slate-300 text-slate-500 font-mono text-xs font-bold py-1.5 px-3 rounded cursor-pointer"
                                  >
                                    {locale === "pt" ? "Cancelar" : "Cancel"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleUpdatePromptTemplate(prm.id, promptDrafts[prm.id] ?? prm.content);
                                      setEditingPromptId(null);
                                    }}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-3 rounded shadow-sm transition-all cursor-pointer"
                                  >
                                    {locale === "pt" ? "Salvar" : "Save"}
                                  </button>
                                </>
                              )}
                            </div>

                            {isShowingNewVersionForm && (
                              <div className="border-t border-slate-200 pt-3 space-y-2">
                                <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block">
                                  {locale === "pt" ? "Rótulo da nova versão (ex: v1.3)" : "New version label (e.g. v1.3)"}
                                </label>
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={newVersionLabel}
                                    onChange={(e) => setNewVersionLabel(e.target.value)}
                                    placeholder="v1.3"
                                    className="flex-1 p-2 rounded font-mono text-xs bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                                  />
                                  <button
                                    onClick={() => { setNewVersionFormForType(null); setNewVersionLabel(""); }}
                                    className="bg-white border border-slate-300 text-slate-500 font-mono text-xs font-bold py-1.5 px-3 rounded cursor-pointer"
                                  >
                                    {locale === "pt" ? "Cancelar" : "Cancel"}
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (!newVersionLabel.trim()) {
                                        alert(locale === "pt" ? "Informe um rótulo de versão." : "Enter a version label.");
                                        return;
                                      }
                                      const created = await handleCreatePromptVersion({
                                        name: prm.name,
                                        type,
                                        content: promptDrafts[prm.id] ?? prm.content,
                                        language: prm.language,
                                        version: newVersionLabel.trim(),
                                      });
                                      if (created) {
                                        setNewVersionFormForType(null);
                                        setNewVersionLabel("");
                                        setSelectedPromptVersionByType((prev) => ({ ...prev, [type]: created.id }));
                                      }
                                    }}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-3 rounded shadow-sm transition-all cursor-pointer"
                                  >
                                    {locale === "pt" ? "Criar Versão (a partir do texto acima)" : "Create Version (from the text above)"}
                                  </button>
                                </div>
                                <p className="text-[10px] text-slate-400">
                                  {locale === "pt"
                                    ? "A nova versão começa como rascunho - não fica ativa automaticamente."
                                    : "The new version starts as a draft - it is not activated automatically."}
                                </p>
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {activeAdminSection === "templates" && canAccessAdminSection("templates") && (
                  <div className="w-full grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Enviar Template" : "Upload Template"}
                      </h3>
                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsTemplateDragOver(true); }}
                        onDragEnter={(e) => { e.preventDefault(); setIsTemplateDragOver(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setIsTemplateDragOver(false); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsTemplateDragOver(false);
                          const file = e.dataTransfer.files?.[0] || null;
                          setTemplateUploadFile(file);
                          setTemplateUploadFileName(file?.name || "");
                        }}
                        className={`p-4 border-2 border-dashed rounded-xl text-center space-y-3 transition-colors ${isTemplateDragOver ? "border-emerald-500 bg-emerald-50/40" : "border-slate-300 bg-slate-50"}`}
                      >
                        <input
                          type="file"
                          accept=".doc,.docx,.pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setTemplateUploadFile(file);
                            setTemplateUploadFileName(file?.name || "");
                          }}
                          className="text-xs w-full"
                        />
                        <p className="text-[11px] text-slate-500">
                          {locale === "pt"
                            ? "Formatos: DOCX, DOC ou PDF. Arraste e solte o arquivo aqui, ou selecione acima. Veja o glossário de variáveis ao lado para saber quais {{...}} o template pode usar."
                            : "Formats: DOCX, DOC or PDF. Drag and drop the file here, or select above. See the variable glossary alongside for which {{...}} placeholders the template can use."}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Tipo" : "Type"}</label>
                          <select value={templateUploadType} onChange={(e) => setTemplateUploadType(e.target.value as ProposalTemplate["template_type"])} className="w-full p-2 bg-slate-50 border border-slate-200 rounded">
                            <option value="technical">{locale === "pt" ? "Técnica" : "Technical"}</option>
                            <option value="commercial">{locale === "pt" ? "Comercial" : "Commercial"}</option>
                            <option value="technical_commercial">{locale === "pt" ? "Técnico-Comercial" : "Technical-Commercial"}</option>
                            <option value="executive_summary">{locale === "pt" ? "Resumo Executivo" : "Executive Summary"}</option>
                            <option value="risk_report">{locale === "pt" ? "Relatório de Riscos" : "Risk Report"}</option>
                            <option value="bom_report">{locale === "pt" ? "Relatório de BOM" : "BOM Report"}</option>
                            <option value="questions_report">{locale === "pt" ? "Relatório de Perguntas" : "Questions Report"}</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Versão" : "Version"}</label>
                          <input value={templateUploadVersion} onChange={(e) => setTemplateUploadVersion(e.target.value)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-mono" />
                        </div>
                      </div>
                      <div className="p-3 bg-slate-900 text-slate-300 rounded font-mono text-[11px] min-h-20">
                        {templateUploadFileName ? (
                          <>
                            <p>{locale === "pt" ? "Arquivo selecionado" : "Selected file"}: <strong>{templateUploadFileName}</strong></p>
                            <p>{locale === "pt" ? "Tipo" : "Type"}: {templateUploadType}</p>
                            <p>{locale === "pt" ? "Versão" : "Version"}: {templateUploadVersion}</p>
                          </>
                        ) : (
                          <p>{locale === "pt" ? "Nenhum arquivo selecionado para pré-visualização." : "No file selected for preview."}</p>
                        )}
                      </div>
                      <button onClick={handleCreateProposalTemplate} className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded py-2 text-xs font-bold cursor-pointer">
                        {locale === "pt" ? "Preparar Template para Versionamento" : "Prepare Template for Versioning"}
                      </button>
                    </div>

                    <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Biblioteca e Versionamento" : "Library and Versioning"}
                      </h3>
                      <div className="space-y-3">
                        {proposalTemplates.map(tpl => (
                          <div key={tpl.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                            <div className="flex justify-between items-start">
                              <div>
                                <h4 className="text-xs font-bold text-slate-800 uppercase font-mono">
                                  {tpl.name}
                                  {tpl.default_template && (
                                    <span className="ml-2 text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase align-middle">
                                      {locale === "pt" ? "Padrão" : "Default"}
                                    </span>
                                  )}
                                </h4>
                                <p className="text-[11px] text-slate-500 mt-1">{tpl.description}</p>
                                <p className="text-[10px] text-slate-400 font-mono mt-2">
                                  {locale === "pt" ? "Tipo" : "Type"}: {tpl.template_type} • {locale === "pt" ? "Versão" : "Version"}: {tpl.version} • {locale === "pt" ? "Idioma" : "Language"}: {tpl.language}
                                </p>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button onClick={() => handleValidateProposalTemplate(tpl.id)} className="px-2 py-1 rounded bg-white border text-[10px] font-bold cursor-pointer">
                                  {locale === "pt" ? "Visualizar" : "Preview"}
                                </button>
                                <button
                                  onClick={() => handleSetDefaultProposalTemplate(tpl.id)}
                                  disabled={tpl.default_template}
                                  className="px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {locale === "pt" ? "Ativar" : "Set Active"}
                                </button>
                                <button onClick={() => handleDeleteProposalTemplate(tpl.id)} className="px-2 py-1 rounded bg-white border border-rose-200 text-rose-600 text-[10px] font-bold cursor-pointer">
                                  {locale === "pt" ? "Apagar" : "Delete"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeAdminSection === "templates" && canAccessAdminSection("templates") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 mt-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                      {locale === "pt" ? "Glossário de Variáveis" : "Variable Glossary"}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {locale === "pt"
                        ? "Toda variável que um template DOCX pode usar, com o que cada uma traz. Blocos em negrito são listas (loops) - use {{#nome}}...{{/nome}} no Word."
                        : "Every variable a DOCX template can use, with what each one brings. Bold entries are loops - use {{#name}}...{{/name}} in Word."}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {Object.entries(
                        proposalVariableCatalog.reduce((acc: Record<string, typeof proposalVariableCatalog>, entry) => {
                          (acc[entry.category] = acc[entry.category] || []).push(entry);
                          return acc;
                        }, {})
                      ).map(([category, entries]) => (
                        <div key={category} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                          <h4 className="text-[10px] uppercase font-bold text-slate-500 font-mono">{category}</h4>
                          {entries.map((entry) => (
                            <div key={entry.name} className="text-xs border-b border-slate-200 last:border-0 pb-2 last:pb-0">
                              <div className="flex items-center justify-between gap-2">
                                <code className={`text-[11px] font-mono ${entry.kind === "loop" ? "font-bold text-emerald-700" : "text-slate-800"}`}>
                                  {entry.kind === "loop" ? `{{#${entry.name}}}` : `{{${entry.name}}}`}
                                </code>
                                <button
                                  onClick={() => navigator.clipboard.writeText(entry.kind === "loop" ? `{{#${entry.name}}}{{/${entry.name}}}` : `{{${entry.name}}}`)}
                                  className="text-[9px] uppercase font-bold text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
                                >
                                  {locale === "pt" ? "Copiar" : "Copy"}
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5">{entry.description}</p>
                              {entry.loopFields && entry.loopFields.length > 0 && (
                                <ul className="mt-1 space-y-0.5 pl-2 border-l border-slate-200">
                                  {entry.loopFields.map((field) => (
                                    <li key={field.name} className="text-[10px] text-slate-500">
                                      <code className="font-mono text-slate-700">{`{{${field.name}}}`}</code> — {field.description}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeAdminSection === "templates" && canAccessAdminSection("templates") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 mt-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Verticais de Setor" : "Industry Verticals"}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500">
                      {locale === "pt"
                        ? "Lista usada no campo \"Vertical do Setor\" ao criar um projeto."
                        : "List used by the \"Industry Vertical\" field when creating a project."}
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newVerticalName}
                        onChange={(e) => setNewVerticalName(e.target.value)}
                        placeholder={locale === "pt" ? "Nova vertical..." : "New vertical..."}
                        className="flex-1 p-2 rounded bg-slate-50 border border-slate-200 text-xs"
                      />
                      <button onClick={handleCreateVertical} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 rounded">
                        {locale === "pt" ? "Adicionar" : "Add"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {verticals.map((v) => (
                        <span key={v.id} className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border ${v.is_active ? "bg-slate-50 border-slate-200 text-slate-700" : "bg-slate-100 border-slate-200 text-slate-400 line-through"}`}>
                          {v.name}
                          <button onClick={() => handleToggleVertical(v)} className="text-slate-400 hover:text-slate-700" title={v.is_active ? (locale === "pt" ? "Desativar" : "Deactivate") : (locale === "pt" ? "Ativar" : "Activate")}>
                            {v.is_active ? "⏸" : "▶"}
                          </button>
                          <button onClick={() => handleDeleteVertical(v.id)} className="text-red-400 hover:text-red-700" title={locale === "pt" ? "Excluir" : "Delete"}>
                            ×
                          </button>
                        </span>
                      ))}
                      {verticals.length === 0 && <span className="text-xs text-slate-400 italic">{locale === "pt" ? "Nenhuma vertical cadastrada." : "No verticals registered."}</span>}
                    </div>
                  </div>
                )}

                {activeAdminSection === "approval_flow" && canAccessAdminSection("approval_flow") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                          {locale === "pt" ? "Fluxos de Aprovação de Propostas" : "Proposal Approval Workflows"}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                          {locale === "pt" ? "Crie, duplique, edite etapas, responsáveis e regras de aprovação." : "Create, duplicate and edit stages, approvers and approval rules."}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowNewApprovalWorkflowForm(!showNewApprovalWorkflowForm)}
                        className="bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded"
                      >
                        {showNewApprovalWorkflowForm ? (locale === "pt" ? "Cancelar" : "Cancel") : (locale === "pt" ? "+ Novo Fluxo" : "+ New Workflow")}
                      </button>
                    </div>

                    {showNewApprovalWorkflowForm && (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                        <h4 className="text-xs font-bold uppercase font-mono text-slate-700 mb-3">
                          {locale === "pt" ? "Criar Novo Fluxo" : "Create New Workflow"}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                          <input
                            value={newApprovalWorkflowName}
                            onChange={(e) => setNewApprovalWorkflowName(e.target.value)}
                            placeholder={locale === "pt" ? "Nome do fluxo" : "Workflow name"}
                            className="p-2 bg-white border border-slate-200 rounded"
                          />
                          <input
                            value={newApprovalWorkflowDescription}
                            onChange={(e) => setNewApprovalWorkflowDescription(e.target.value)}
                            placeholder={locale === "pt" ? "Descrição" : "Description"}
                            className="p-2 bg-white border border-slate-200 rounded md:col-span-2"
                          />
                          <input
                            value={newApprovalWorkflowAppliesTo}
                            onChange={(e) => setNewApprovalWorkflowAppliesTo(e.target.value)}
                            placeholder={locale === "pt" ? "Aplica-se a" : "Applies to"}
                            className="p-2 bg-white border border-slate-200 rounded"
                          />
                        </div>
                        <button
                          onClick={handleCreateApprovalWorkflow}
                          className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 rounded"
                        >
                          {locale === "pt" ? "Criar Fluxo" : "Create Workflow"}
                        </button>
                      </div>
                    )}

                    <div className="space-y-4">
                      {approvalWorkflows.map(flow => (
                        <div key={flow.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
                          <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
                              <input
                                value={flow.name}
                                onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => ({ ...f, name: e.target.value }))}
                                className="w-full p-2 text-sm font-bold text-slate-900 bg-white border border-slate-200 rounded"
                              />
                              <input
                                value={flow.applies_to || "all"}
                                onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => ({ ...f, applies_to: e.target.value }))}
                                className="w-full p-2 text-xs text-slate-600 bg-white border border-slate-200 rounded font-mono"
                              />
                              <textarea
                                value={flow.description || ""}
                                onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => ({ ...f, description: e.target.value }))}
                                rows={2}
                                className="md:col-span-2 w-full p-2 text-xs text-slate-600 bg-white border border-slate-200 rounded"
                              />
                            </div>

                            <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-600 bg-white border border-slate-200 rounded px-3 py-2">
                              <input
                                type="checkbox"
                                checked={flow.active !== false}
                                onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => ({ ...f, active: e.target.checked }))}
                              />
                              {flow.active !== false ? (locale === "pt" ? "Ativo" : "Active") : (locale === "pt" ? "Inativo" : "Inactive")}
                            </label>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {(flow.stages || []).map((stage: any, idx: number) => (
                              <div key={stage.id || idx} className="bg-white border border-slate-200 rounded-lg p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[10px] font-mono text-slate-400 uppercase">{locale === "pt" ? "Etapa" : "Stage"} {idx + 1}</span>
                                  <button
                                    onClick={() => updateApprovalWorkflowLocal(flow.id, (f) => ({ ...f, stages: f.stages.filter((_: any, i: number) => i !== idx) }))}
                                    className="text-[10px] text-red-600 font-bold"
                                    disabled={(flow.stages || []).length <= 1}
                                  >
                                    {locale === "pt" ? "Remover" : "Remove"}
                                  </button>
                                </div>

                                <input
                                  value={stage.name}
                                  onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => {
                                    f.stages[idx] = { ...f.stages[idx], name: e.target.value };
                                    return f;
                                  })}
                                  className="w-full p-2 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded mb-2"
                                />

                                <select
                                  value={stage.approver_type}
                                  onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => {
                                    f.stages[idx] = {
                                      ...f.stages[idx],
                                      approver_type: e.target.value,
                                      approver_role_id: e.target.value === "role" ? (f.stages[idx].approver_role_id || roles[0]?.id || "r1") : undefined,
                                      approver_user_id: e.target.value === "user" ? (f.stages[idx].approver_user_id || users[0]?.id || "u1") : undefined
                                    };
                                    return f;
                                  })}
                                  className="w-full p-2 text-xs bg-slate-50 border border-slate-200 rounded mb-2"
                                >
                                  <option value="role">{locale === "pt" ? "Perfil / Função" : "Role"}</option>
                                  <option value="user">{locale === "pt" ? "Usuário específico" : "Specific user"}</option>
                                </select>

                                {stage.approver_type === "user" ? (
                                  <select
                                    value={stage.approver_user_id || users[0]?.id || ""}
                                    onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => {
                                      f.stages[idx] = { ...f.stages[idx], approver_user_id: e.target.value };
                                      return f;
                                    })}
                                    className="w-full p-2 text-xs bg-white border border-slate-200 rounded mb-2"
                                  >
                                    {users.map((user) => (
                                      <option key={user.id} value={user.id}>{user.name}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <select
                                    value={stage.approver_role_id || roles[0]?.id || ""}
                                    onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => {
                                      f.stages[idx] = { ...f.stages[idx], approver_role_id: e.target.value };
                                      return f;
                                    })}
                                    className="w-full p-2 text-xs bg-white border border-slate-200 rounded mb-2"
                                  >
                                    {roles.map((role) => (
                                      <option key={role.id} value={role.id}>{role.name}</option>
                                    ))}
                                  </select>
                                )}

                                <input
                                  value={stage.conditions || ""}
                                  onChange={(e) => updateApprovalWorkflowLocal(flow.id, (f) => {
                                    f.stages[idx] = { ...f.stages[idx], conditions: e.target.value };
                                    return f;
                                  })}
                                  placeholder={locale === "pt" ? "Condição" : "Condition"}
                                  className="w-full p-2 text-xs bg-white border border-slate-200 rounded"
                                />
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap justify-between gap-2">
                            <button
                              onClick={() => updateApprovalWorkflowLocal(flow.id, (f) => ({
                                ...f,
                                stages: [
                                  ...(f.stages || []),
                                  {
                                    name: `${locale === "pt" ? "Nova Etapa" : "New Stage"} ${(f.stages || []).length + 1}`,
                                    order: (f.stages || []).length + 1,
                                    approver_type: "role",
                                    approver_role_id: roles[0]?.id || "r1",
                                    mandatory: true,
                                    conditions: "Always mandatory"
                                  }
                                ]
                              }))}
                              className="bg-white border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded"
                            >
                              {locale === "pt" ? "+ Etapa" : "+ Stage"}
                            </button>

                            <div className="flex flex-wrap gap-2">
                              <button onClick={() => handleDuplicateApprovalWorkflow(flow)} className="bg-white border border-slate-200 text-slate-700 text-xs font-bold px-3 py-1.5 rounded">
                                {locale === "pt" ? "Duplicar" : "Duplicate"}
                              </button>
                              <button onClick={() => handleDeleteApprovalWorkflow(flow.id)} className="bg-red-50 text-red-700 hover:bg-red-600 hover:text-white text-xs font-bold px-3 py-1.5 rounded">
                                {locale === "pt" ? "Apagar" : "Delete"}
                              </button>
                              <button onClick={() => handleSaveApprovalWorkflow(flow)} className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded">
                                {locale === "pt" ? "Salvar Fluxo" : "Save Workflow"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeAdminSection === "subscription" && canAccessAdminSection("subscription") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                      {locale === "pt" ? "Plano e Contrato" : "Plan & Contract"}
                    </h3>
                    {!fleetLicenseStatus?.connected ? (
                      <p className="text-xs text-slate-400">
                        {locale === "pt"
                          ? "Ainda não conectado ao CMSaaS - configure a URL e a chave de API abaixo para que o plano, status e vigência do contrato apareçam aqui."
                          : "Not connected to CMSaaS yet - configure the URL and API key below so the plan, status and contract term appear here."}
                      </p>
                    ) : (
                      <>
                        {fleetLicenseStatus.customer_name && (
                          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                            <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 overflow-hidden bg-slate-50 border border-slate-100">
                              {fleetLicenseStatus.customer_logo_base64 ? (
                                <img src={fleetLicenseStatus.customer_logo_base64} alt="" className="max-w-full max-h-full object-contain" />
                              ) : (
                                <span className="text-[9px] font-bold text-slate-400 uppercase">{fleetLicenseStatus.customer_name.slice(0, 2)}</span>
                              )}
                            </div>
                            <div className="leading-tight">
                              <span className="text-xs font-semibold text-slate-600 block">{fleetLicenseStatus.customer_name}</span>
                              {(fleetLicenseStatus.customer_city || fleetLicenseStatus.customer_state) && (
                                <span className="text-[10px] text-slate-400">
                                  {[fleetLicenseStatus.customer_city, fleetLicenseStatus.customer_state].filter(Boolean).join(" / ")}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                          <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                            <span className="text-[10px] text-slate-400 font-mono block uppercase">{locale === "pt" ? "Plano Contratado" : "Contracted Plan"}</span>
                            <span className="text-sm font-extrabold text-emerald-600 font-mono block mt-1">
                              {fleetLicenseStatus.plan_name || (locale === "pt" ? "Sem plano (módulos avulsos)" : "No plan (individual modules)")}
                            </span>
                          </div>
                          <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                            <span className="text-[10px] text-slate-400 font-mono block uppercase">{locale === "pt" ? "Status da Assinatura" : "Subscription Status"}</span>
                            <span
                              className={`text-sm font-extrabold font-mono mt-1 block ${
                                fleetLicenseStatus.status === "active"
                                  ? "text-emerald-600"
                                  : fleetLicenseStatus.block_mode === "read_only"
                                  ? "text-amber-600"
                                  : "text-red-600"
                              }`}
                            >
                              {fleetLicenseStatus.status === "active"
                                ? (locale === "pt" ? "Ativa" : "Active")
                                : fleetLicenseStatus.block_mode === "full_lockout"
                                ? (locale === "pt" ? "Bloqueada - Acesso Total" : "Blocked - Full Lockout")
                                : fleetLicenseStatus.block_mode === "read_only"
                                ? (locale === "pt" ? "Bloqueada - Somente Leitura" : "Blocked - Read Only")
                                : (locale === "pt" ? "Suspensa" : "Suspended")}
                            </span>
                          </div>
                          <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                            <span className="text-[10px] text-slate-400 font-mono block uppercase">{locale === "pt" ? "Vigência do Contrato" : "Contract Term"}</span>
                            <span className="text-sm font-extrabold text-slate-800 font-mono mt-1 block">
                              {fleetLicenseStatus.contract_start_date && fleetLicenseStatus.contract_end_date
                                ? `${new Date(fleetLicenseStatus.contract_start_date).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US")} - ${new Date(fleetLicenseStatus.contract_end_date).toLocaleDateString(locale === "pt" ? "pt-BR" : "en-US")}`
                                : locale === "pt" ? "Não definida" : "Not set"}
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-mono block uppercase mb-1">{locale === "pt" ? "Módulos Habilitados" : "Enabled Modules"}</span>
                          <div className="flex gap-1.5 flex-wrap">
                            {fleetLicenseStatus.modules.length > 0 ? (
                              fleetLicenseStatus.modules.map((m) => (
                                <span key={m} className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                                  {m}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-slate-400">{locale === "pt" ? "Nenhum" : "None"}</span>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {locale === "pt" ? "Última verificação: " : "Last verified: "}
                          {fleetLicenseStatus.last_verified_at ? new Date(fleetLicenseStatus.last_verified_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US") : "-"}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {locale === "pt"
                            ? "Plano, status e vigência são geridos pela AI Pre-Sales Solutions no CMSaaS - não são editáveis por aqui."
                            : "Plan, status and contract term are managed by AI Pre-Sales Solutions in CMSaaS - not editable from here."}
                        </p>
                      </>
                    )}
                  </div>
                )}

                {activeAdminSection === "subscription" && canAccessAdminSection("subscription") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4 mt-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-slate-900">
                        <img src="/cmsaas-icon.png" alt="CMSaaS" className="w-4 h-4 object-contain" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Conexão com o CMSaaS" : "CMSaaS Connection"}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-400">
                      {locale === "pt"
                        ? "Conexão real com o servidor de gestão de licenças e módulos da AI Pre-Sales Solutions (CMSaaS). Sem essa conexão (ou se o servidor estiver fora do ar), a plataforma continua funcionando normalmente."
                        : "Real connection to the AI Pre-Sales Solutions license/module management server (CMSaaS). Without it (or if that server is down), the platform keeps working normally."}
                    </p>
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={platformSettings?.fleet_manager_enabled || false}
                        onChange={(e) => handleSavePlatformSettings("fleet_manager_enabled", e.target.checked)}
                        className="rounded text-emerald-600"
                      />
                      {locale === "pt" ? "Ativar relatório periódico ao CMSaaS" : "Enable periodic reporting to CMSaaS"}
                    </label>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">{locale === "pt" ? "URL do CMSaaS" : "CMSaaS URL"}</label>
                      <input
                        type="text"
                        placeholder="https://cmsaas.aipresales.com"
                        defaultValue={platformSettings?.fleet_manager_url || ""}
                        onBlur={(e) => handleSavePlatformSettings("fleet_manager_url", e.target.value)}
                        className="w-full p-2 rounded bg-slate-50 border border-slate-200 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">
                        {locale === "pt" ? "Chave de API da Instalação" : "Installation API Key"}
                      </label>
                      <input
                        type="password"
                        placeholder="fleet_live_..."
                        onBlur={(e) => {
                          if (e.target.value.trim()) handleSavePlatformSettings("fleet_manager_api_key", e.target.value.trim());
                        }}
                        className="w-full p-2 rounded bg-slate-50 border border-slate-200 text-xs font-mono"
                      />
                    </div>
                  </div>
                )}

                {activeAdminSection === "system_updates" && canAccessAdminSection("system_updates") && (
                  <div className="w-full space-y-4">
                    {systemUpdateMessage && (
                      <div className="text-xs rounded p-3 bg-sky-50 border border-sky-100 text-sky-700">{systemUpdateMessage}</div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                          {locale === "pt" ? "Versão Atual" : "Current Version"}
                        </h3>
                        <p className="text-sm font-mono text-slate-800">{systemUpdateState?.current_version || (locale === "pt" ? "desconhecida" : "unknown")}</p>
                        {systemUpdateState?.current_git_sha && (
                          <p className="text-[11px] font-mono text-slate-400">SHA {systemUpdateState.current_git_sha}</p>
                        )}
                        {systemUpdateState?.current_version?.endsWith("-dirty") && (
                          <span className="inline-block text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100">
                            {locale === "pt" ? "Alterações locais não commitadas" : "Uncommitted local changes"}
                          </span>
                        )}
                        {systemUpdateState?.last_attempt_status === "in_progress" && (() => {
                          const stepIdx = updateStepIndex(systemUpdateState.current_step ?? null);
                          const pct = stepIdx >= 0 ? Math.round(((stepIdx + 1) / UPDATE_STEPS.length) * 100) : 5;
                          return (
                            <div className="space-y-1.5">
                              <p className="text-xs font-bold text-sky-600">
                                {systemUpdateState.current_step || (locale === "pt" ? "Atualização em andamento..." : "Update in progress...")}
                              </p>
                              <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                              </div>
                              <p className="text-[10px] text-slate-400">{pct}%</p>
                            </div>
                          );
                        })()}
                        {(systemUpdateState?.last_attempt_status === "failed" || systemUpdateState?.last_attempt_status === "rolled_back") && (
                          <p className="text-xs font-bold text-red-600">
                            {locale === "pt" ? "Última tentativa falhou" : "Last attempt failed"}
                            {systemUpdateState.last_attempt_status === "rolled_back" ? ` (${locale === "pt" ? "revertida automaticamente" : "auto rolled back"})` : ""}
                          </p>
                        )}
                      </div>

                      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                          {locale === "pt" ? "Última Release Disponível" : "Latest Available Release"}
                        </h3>
                        {!systemUpdateState?.latest_release && (
                          <p className="text-xs text-slate-400">
                            {locale === "pt" ? "Nenhuma atualização detectada ainda - verificado a cada heartbeat (até 20 min)." : "No update detected yet - checked on every heartbeat (up to 20 min)."}
                          </p>
                        )}
                        {systemUpdateState?.latest_release && (() => {
                          // Mesma lógica do lado CMSaaS (Installations.tsx/computeUpdateStatus):
                          // current_version é sempre a forma longa do `git describe` (com sufixo
                          // -N-g<sha>, mesmo exatamente em cima de uma tag), então comparação
                          // exata nunca bate - startsWith("<code_ref>-") cobre o caso comum de
                          // code_ref ser uma tag real.
                          const codeRef = systemUpdateState.latest_release!.code_ref;
                          const upToDate = !!systemUpdateState.current_version?.startsWith(`${codeRef}-`) || systemUpdateState.current_version === codeRef;
                          return (
                            <>
                              <p className="text-sm font-bold text-emerald-600">{systemUpdateState.latest_release!.version}</p>
                              <p className="text-[11px] font-mono text-slate-400">ref {codeRef} · canal {systemUpdateState.latest_release!.channel}</p>
                              {upToDate && (
                                <span className="inline-block text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100">
                                  {locale === "pt" ? "Já instalada" : "Already installed"}
                                </span>
                              )}
                              <button
                                onClick={fetchReleaseNotes}
                                disabled={systemUpdateNotesLoading}
                                className="text-xs font-bold text-slate-600 underline disabled:opacity-50 block"
                              >
                                {systemUpdateNotesLoading ? (locale === "pt" ? "Carregando..." : "Loading...") : (locale === "pt" ? "Ver notas de versão" : "View release notes")}
                              </button>
                              {systemUpdateNotesMd !== null && (
                                <div className="text-xs whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded p-3 max-h-48 overflow-y-auto">{systemUpdateNotesMd}</div>
                              )}
                              {!upToDate && (
                                <div className="flex gap-2 flex-wrap pt-1">
                                  <button
                                    onClick={runUpdateNow}
                                    disabled={systemUpdateState.last_attempt_status === "in_progress"}
                                    className="text-xs font-bold px-3 py-1.5 rounded-lg text-white bg-slate-900 disabled:opacity-50"
                                  >
                                    {locale === "pt" ? "Atualizar Agora" : "Update Now"}
                                  </button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-3">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Agendar Atualização" : "Schedule Update"}
                      </h3>
                      {systemUpdateState?.scheduled_update_at ? (
                        <div className="flex items-center gap-3 flex-wrap">
                          <p className="text-xs text-slate-700">
                            {locale === "pt" ? "Agendada para " : "Scheduled for "}
                            <span className="font-bold">{new Date(systemUpdateState.scheduled_update_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}</span>
                          </p>
                          <button onClick={cancelSchedule} className="text-xs font-bold text-red-600 underline">
                            {locale === "pt" ? "Cancelar agendamento" : "Cancel schedule"}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="datetime-local"
                            value={scheduleDraft}
                            onChange={(e) => setScheduleDraft(e.target.value)}
                            className="p-2 rounded bg-slate-50 border border-slate-200 text-xs font-mono"
                          />
                          <button
                            onClick={submitSchedule}
                            disabled={!scheduleDraft || !systemUpdateState?.latest_release}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg text-white bg-slate-900 disabled:opacity-50"
                          >
                            {locale === "pt" ? "Agendar" : "Schedule"}
                          </button>
                        </div>
                      )}
                      <p className="text-[10px] text-slate-400">
                        {locale === "pt"
                          ? "Um agendamento perdido por até 15 minutos roda automaticamente; além disso, exige reagendamento manual."
                          : "A schedule missed by up to 15 minutes runs automatically; beyond that, it requires manual rescheduling."}
                      </p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-2">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Histórico de Atualizações" : "Update History"}
                      </h3>
                      {systemUpdateHistory.length === 0 && (
                        <p className="text-xs text-slate-400">{locale === "pt" ? "Nenhuma atualização registrada ainda." : "No updates recorded yet."}</p>
                      )}
                      {systemUpdateHistory.map((h) => (
                        <div key={h.id} className="border-t border-slate-100 py-2">
                          <button
                            onClick={() => setExpandedHistoryId(expandedHistoryId === h.id ? null : h.id)}
                            className="w-full flex items-center justify-between text-xs text-left"
                          >
                            <span className="font-mono text-slate-700">{h.from_version || "?"} → {h.to_version}</span>
                            <span className="flex items-center gap-2">
                              <span
                                className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                                  h.status === "success" ? "bg-emerald-50 text-emerald-600" :
                                  h.status === "in_progress" ? "bg-sky-50 text-sky-600" :
                                  "bg-red-50 text-red-600"
                                }`}
                              >
                                {h.status}
                              </span>
                              <span className="text-slate-400">{new Date(h.started_at).toLocaleString(locale === "pt" ? "pt-BR" : "en-US")}</span>
                            </span>
                          </button>
                          {expandedHistoryId === h.id && (
                            <div className="mt-2 text-[11px] space-y-1">
                              <p className="text-slate-500">{locale === "pt" ? "Disparado por" : "Triggered by"}: {h.triggered_by}</p>
                              {h.backup_ref && <p className="text-slate-500">{locale === "pt" ? "Backup" : "Backup"}: {h.backup_ref}</p>}
                              {h.error_log && (
                                <pre className="whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded p-2 max-h-48 overflow-y-auto font-mono">{h.error_log}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeAdminSection === "branding" && canAccessAdminSection("branding") && (
                  <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Logomarca" : "Logo"}
                      </h3>
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleBrandLogoUpload(e.dataTransfer.files?.[0]);
                        }}
                        className="p-6 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg space-y-3 text-center hover:border-emerald-500 hover:bg-emerald-50/30 transition-colors"
                      >
                        <p className="text-sm font-bold text-slate-700">
                          {locale === "pt" ? "Arraste e solte a logo aqui" : "Drag and drop the logo here"}
                        </p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {locale === "pt"
                            ? "Formatos aceitos: PNG, JPG, SVG ou WebP. Tamanho máximo: 1 MB. Dimensão recomendada: 320 x 80 px."
                            : "Accepted formats: PNG, JPG, SVG or WebP. Max size: 1 MB. Recommended dimension: 320 x 80 px."}
                        </p>
                        <label className="inline-flex items-center justify-center bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded cursor-pointer">
                          {locale === "pt" ? "Selecionar Arquivo" : "Select File"}
                          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => handleBrandLogoUpload(e.target.files?.[0])} className="hidden" />
                        </label>
                        <div>
                          <button onClick={() => handleRemoveBrandLogo(brandLogoDataUrl)} className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded disabled:opacity-40 disabled:cursor-not-allowed" disabled={!brandLogoDataUrl}>
                            {locale === "pt" ? "Remover Logo Personalizada" : "Remove Custom Logo"}
                          </button>
                        </div>
                      </div>
                      <div className="h-24 bg-slate-950 rounded-lg flex items-center justify-center border border-slate-800">
                        {brandLogoDataUrl ? (
                          <img src={brandLogoDataUrl} alt="Logo preview" className="max-h-16 max-w-[300px] object-contain" />
                        ) : (
                          <div className="text-white font-black px-4 py-2 rounded" style={{ backgroundColor: brandPrimaryColor }}>PSC</div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Cores e Dados da Marca" : "Colors and Brand Data"}
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Cor Primária" : "Primary Color"}</label>
                          <input type="color" value={brandPrimaryColor} onChange={(e) => setBrandPrimaryColor(e.target.value)} className="w-full h-10" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Cor de Destaque" : "Accent Color"}</label>
                          <input type="color" value={brandAccentColor} onChange={(e) => setBrandAccentColor(e.target.value)} className="w-full h-10" />
                        </div>
                      </div>

                      <button
                        onClick={() => handleSaveBrandingSettings({ primary_color: brandPrimaryColor, accent_color: brandAccentColor })}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded"
                      >
                        {locale === "pt" ? "Salvar Cores" : "Save Colors"}
                      </button>

                      <div className="grid grid-cols-1 gap-3 text-xs">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Nome da Empresa" : "Company Name"}</label>
                          <input
                            defaultValue={brandingSettings?.company_name || "Assistant AI Brasil"}
                            onBlur={(e) => handleSaveBrandingSettings({ company_name: e.target.value })}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Contato de Suporte" : "Support Contact"}</label>
                          <input
                            defaultValue={brandingSettings?.support_contact || ""}
                            onBlur={(e) => handleSaveBrandingSettings({ support_contact: e.target.value })}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">Footer</label>
                          <input
                            defaultValue={brandingSettings?.footer_text || ""}
                            onBlur={(e) => handleSaveBrandingSettings({ footer_text: e.target.value })}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Texto Legal" : "Legal Text"}</label>
                          <textarea
                            defaultValue={brandingSettings?.legal_text || ""}
                            onBlur={(e) => handleSaveBrandingSettings({ legal_text: e.target.value })}
                            rows={3}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded"
                          />
                        </div>
                      </div>

                      <div className="p-4 rounded-lg text-white space-y-2" style={{ background: `linear-gradient(135deg, ${brandPrimaryColor}, ${brandAccentColor})` }}>
                        <p className="font-bold">{brandingSettings?.company_name || (locale === "pt" ? "Pré-visualização da identidade visual" : "Brand preview")}</p>
                        <p className="text-xs opacity-90">{tx("Pre-Sales Compliance Platform", "Plataforma de Compliance de Pré-Vendas")}</p>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 xl:col-span-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                          {locale === "pt" ? "Estilos de Marca Reutilizáveis" : "Reusable Brand Styles"}
                        </h3>
                        <button
                          onClick={() => setEditingBrandStyle({ name: "", primary_color: "#10b981" })}
                          className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded cursor-pointer"
                        >
                          + {locale === "pt" ? "Novo Estilo" : "New Style"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500">
                        {locale === "pt"
                          ? "Um projeto pode adotar um destes estilos em vez da identidade visual padrão acima, para propostas com a marca do próprio cliente."
                          : "A project can adopt one of these instead of the default branding above, for proposals co-branded with the client's own identity."}
                      </p>
                      {brandStyles.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">{locale === "pt" ? "Nenhum estilo cadastrado." : "No styles registered."}</p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {brandStyles.map((style) => (
                            <div key={style.id} className="flex items-center justify-between py-2">
                              <div className="flex items-center gap-2">
                                <div className="w-5 h-5 rounded border border-slate-200 shrink-0" style={{ backgroundColor: style.primary_color || "#cccccc" }} />
                                <span className="text-sm font-semibold text-slate-700">{style.name}</span>
                                {style.company_name && <span className="text-xs text-slate-400">({style.company_name})</span>}
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => setEditingBrandStyle(style)} className="text-slate-400 hover:text-slate-700 cursor-pointer" title={locale === "pt" ? "Editar" : "Edit"}>
                                  <Pencil size={14} />
                                </button>
                                <button onClick={() => deleteBrandStyle(style.id)} className="text-slate-400 hover:text-red-600 cursor-pointer" title={locale === "pt" ? "Remover" : "Delete"}>
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {editingBrandStyle && (
                        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
                          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-3">
                            <div className="flex justify-between items-center">
                              <h4 className="text-sm font-bold text-slate-800">
                                {editingBrandStyle.id ? (locale === "pt" ? "Editar Estilo" : "Edit Style") : (locale === "pt" ? "Novo Estilo" : "New Style")}
                              </h4>
                              <button onClick={() => setEditingBrandStyle(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                                <X size={16} />
                              </button>
                            </div>
                            <input
                              type="text"
                              placeholder={locale === "pt" ? "Nome do estilo (ex: Cliente XYZ)" : "Style name (e.g. Client XYZ)"}
                              value={editingBrandStyle.name || ""}
                              onChange={(e) => setEditingBrandStyle((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                              className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
                            />
                            <input
                              type="text"
                              placeholder={locale === "pt" ? "Nome da empresa exibido na proposta" : "Company name shown on the proposal"}
                              value={editingBrandStyle.company_name || ""}
                              onChange={(e) => setEditingBrandStyle((prev) => (prev ? { ...prev, company_name: e.target.value } : prev))}
                              className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm"
                            />
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-slate-500">{locale === "pt" ? "Cor primária" : "Primary color"}</label>
                              <input
                                type="color"
                                value={editingBrandStyle.primary_color || "#10b981"}
                                onChange={(e) => setEditingBrandStyle((prev) => (prev ? { ...prev, primary_color: e.target.value } : prev))}
                                className="h-8 w-16"
                              />
                            </div>
                            <div>
                              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                                {locale === "pt" ? "Selecionar logo (PNG/JPG)" : "Select logo (PNG/JPG)"}
                                <input type="file" accept="image/png,image/jpeg" onChange={(e) => handleBrandStyleLogoUpload(e.target.files?.[0])} className="hidden" />
                              </label>
                              {editingBrandStyle.logo_data_url && <img src={editingBrandStyle.logo_data_url} alt="Logo preview" className="h-10 mt-1 object-contain" />}
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                              <button onClick={() => setEditingBrandStyle(null)} className="text-xs font-bold uppercase text-slate-500 px-3 py-1.5 rounded hover:bg-slate-100 cursor-pointer">
                                {locale === "pt" ? "Cancelar" : "Cancel"}
                              </button>
                              <button
                                onClick={saveBrandStyle}
                                disabled={savingBrandStyle}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase px-3 py-1.5 rounded disabled:opacity-50 cursor-pointer"
                              >
                                {savingBrandStyle ? (locale === "pt" ? "Salvando..." : "Saving...") : (locale === "pt" ? "Salvar" : "Save")}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeAdminSection === "integrations" && canAccessAdminSection("integrations") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                          {locale === "pt" ? "Conectores Corporativos, CRMs, ERPs e APIs" : "Corporate Connectors, CRMs, ERPs and APIs"}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                          {locale === "pt" ? "Configure endpoints, tokens e integrações externas usadas pelo sistema." : "Configure endpoints, tokens and external integrations used by the system."}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setShowNewConnectorForm(!showNewConnectorForm);
                          setNewConnectorName("");
                          setNewConnectorType("Salesforce");
                          setNewConnectorUrl("https://api.salesforce.com/v1");
                          setNewConnectorToken("");
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded font-bold transition-all shadow-sm cursor-pointer"
                      >
                        {showNewConnectorForm ? (locale === "pt" ? "Cancelar" : "Cancel") : (locale === "pt" ? "+ Adicionar Conector" : "+ Add Connector")}
                      </button>
                    </div>

                    {showNewConnectorForm && (
                      <div className="p-4 bg-slate-50 border border-emerald-500/30 rounded-lg space-y-3">
                        <h4 className="text-xs font-bold text-slate-800 uppercase font-mono border-b border-slate-200 pb-1">
                          {locale === "pt" ? "Adicionar Novo Conector de Integração" : "Add New Integration Connector"}
                        </h4>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <input type="text" placeholder={locale === "pt" ? "Nome do conector" : "Connector name"} value={newConnectorName} onChange={(e) => setNewConnectorName(e.target.value)} className="w-full p-2 bg-white border border-slate-200 rounded" />
                          <select
                            value={newConnectorType}
                            onChange={(e) => {
                              const type = e.target.value;
                              setNewConnectorType(type);
                              if (type === "Salesforce") setNewConnectorUrl("https://api.salesforce.com/v1");
                              else if (type === "HubSpot") setNewConnectorUrl("https://api.hubapi.com/v1");
                              else if (type === "SAP") setNewConnectorUrl("https://api.sap.enterprise.com/v1");
                              else if (type === "SuiteCRM") setNewConnectorUrl("https://crm.suitecloud-opensource.org/v1");
                              else if (type === "Odoo") setNewConnectorUrl("https://odoo-erp.open-source-community.org/v1");
                              else if (type === "vTiger") setNewConnectorUrl("https://vtiger-instance.org/v1");
                              else if (type === "site_rastreio") setNewConnectorUrl("https://seurastreio.com.br/api/public/rastreio");
                              else setNewConnectorUrl("https://api.custom-crm.com/v1");
                            }}
                            className="w-full p-2 bg-white border border-slate-200 rounded"
                          >
                            <option value="Salesforce">Salesforce CRM</option>
                            <option value="HubSpot">HubSpot CRM</option>
                            <option value="SAP">SAP ERP Connector</option>
                            <option value="SuiteCRM">SuiteCRM</option>
                            <option value="Odoo">Odoo CRM/ERP</option>
                            <option value="vTiger">vTiger CRM</option>
                            {pocModuleEnabled && (
                              <option value="site_rastreio">{tx("Site Rastreio (Shipment Tracking)", "Site Rastreio (Rastreio de Envios)")}</option>
                            )}
                            <option value="Custom">{tx("Custom / Other", "Customizado / Outros")}</option>
                          </select>
                          <input type="text" placeholder="https://api.system.com/v1" value={newConnectorUrl} onChange={(e) => setNewConnectorUrl(e.target.value)} className="col-span-2 w-full p-2 bg-white border border-slate-200 rounded font-mono" />
                          <input type="password" placeholder={newConnectorType === "site_rastreio" ? (locale === "pt" ? "chave de API (ex: sr_live_...)" : "API key (e.g. sr_live_...)") : "bearer token ou api key"} value={newConnectorToken} onChange={(e) => setNewConnectorToken(e.target.value)} className="col-span-2 w-full p-2 bg-white border border-slate-200 rounded font-mono" />
                          {newConnectorType === "site_rastreio" && (
                            <p className="col-span-2 text-[10px] text-slate-400">
                              {locale === "pt"
                                ? "Crie uma conta gratuita em seurastreio.com.br e gere uma chave em Dashboard > Chaves de API (1000 consultas/mês grátis)."
                                : "Create a free account at seurastreio.com.br and generate a key under Dashboard > API Keys (1000 free lookups/month)."}
                            </p>
                          )}
                        </div>
                        <div className="flex justify-end">
                          <button type="button" onClick={handleCreateConnector} className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-3 rounded shadow">
                            {locale === "pt" ? "Salvar Conector" : "Save Connector"}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {integrations.length === 0 ? (
                        <div className="col-span-2 text-center py-10 text-xs text-slate-400 italic">
                          {locale === "pt" ? "Nenhum conector de CRM/ERP/API configurado ainda." : "No CRM/ERP/API connector configured yet."}
                        </div>
                      ) : (
                        integrations.map((conn, cIdx) => (
                          <div key={conn.id} className="p-4 bg-slate-50 rounded-lg border border-slate-100 space-y-3 relative group">
                            <button
                              onClick={() => {
                                const ok = confirm(locale === "pt" ? `Deseja apagar a integração "${conn.name}"?` : `Delete integration "${conn.name}"?`);
                                if (ok) handleDeleteConnector(conn.id);
                              }}
                              className="absolute top-4 right-4 bg-red-50 text-red-700 hover:bg-red-600 hover:text-white cursor-pointer px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1"
                              title={locale === "pt" ? "Apagar integração" : "Delete integration"}
                            >
                              <Trash2 size={12} /> {locale === "pt" ? "Apagar" : "Delete"}
                            </button>
                            <div>
                              <h4 className="text-xs font-bold text-slate-800 uppercase font-mono pr-8">{conn.name}</h4>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {tx("Sync Status", "Status de Sincronização")}: <span className="font-bold text-slate-600">{conn.last_sync_status}</span>
                              </p>
                            </div>
                            <input type="text" value={conn.url || `https://api.${conn.id}.enterprise.com/v1`} onChange={(e) => { const updated = [...integrations]; updated[cIdx].url = e.target.value; setIntegrations(updated); }} className="w-full p-1.5 text-[11px] font-mono bg-white border border-slate-200 rounded" />
                            <input type="password" value={conn.token || "••••••••••••••••••••"} onChange={(e) => { const updated = [...integrations]; updated[cIdx].token = e.target.value; setIntegrations(updated); }} className="w-full p-1.5 text-[11px] font-mono bg-white border border-slate-200 rounded" />
                            {conn.error_message && <p className="text-[9px] text-red-500 font-mono italic">Error: {conn.error_message}</p>}
                            <div className="flex justify-end gap-2 pt-1 border-t border-slate-200/50">
                              <button
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`/api/integrations/${conn.id}`, {
                                      method: "PUT",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify(conn)
                                    });
                                    if (res.ok) {
                                      await fetchGlobalConfigs();
                                      alert(locale === "pt" ? `Configurações do ${conn.name} salvas com sucesso!` : `Saved ${conn.name} configurations successfully!`);
                                    } else {
                                      const data = await res.json().catch(() => ({}));
                                      alert(data.message || (locale === "pt" ? "Não foi possível salvar integração." : "Could not save integration."));
                                    }
                                  } catch (e) { console.error(e); }
                                }}
                                className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-mono text-[9px] font-bold py-1 px-2.5 rounded"
                              >
                                {locale === "pt" ? "Salvar" : "Save"}
                              </button>
                              <button onClick={() => handleValidateIntegration(conn.id)} className="bg-slate-800 hover:bg-slate-700 text-white font-mono text-[9px] font-bold py-1 px-2.5 rounded">
                                {locale === "pt" ? "Validar" : "Validate"}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeAdminSection === "storage" && canAccessAdminSection("storage") && (
                  <div className="w-full bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                          {locale === "pt" ? "Armazenamento e Documentos" : "Storage and Documents"}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                          {locale === "pt" ? "Configure o provedor de armazenamento usado nos uploads, templates e exportações." : "Configure the storage provider used by uploads, templates and exports."}
                        </p>
                      </div>
                      <button
                        onClick={handleValidateStorageSettings}
                        className="bg-slate-900 text-white text-xs font-bold px-3 py-2 rounded"
                      >
                        {locale === "pt" ? "Validar Storage" : "Validate Storage"}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div className="lg:col-span-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">
                          {locale === "pt" ? "Provedor de Armazenamento" : "Storage Provider Mode"}
                        </label>
                        <select
                          value={platformSettings?.storage_mode || "local"}
                          onChange={(e) => handleSavePlatformSettings("storage_mode", e.target.value)}
                          className="w-full p-2 rounded-lg bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs font-semibold text-slate-700 font-sans shadow-sm"
                        >
                          <option value="local">{locale === "pt" ? "Diretórios Locais" : "Local directories"}</option>
                          <option value="s3">AWS S3</option>
                          <option value="gcs">Google Cloud Storage</option>
                        </select>
                      </div>

                      <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">Local Path</label>
                          <input
                            value={platformSettings?.local_storage_path || "./uploads"}
                            onChange={(e) => setPlatformSettings(prev => prev ? { ...prev, local_storage_path: e.target.value } : prev)}
                            onBlur={(e) => handleSavePlatformSettings("local_storage_path", e.target.value)}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">S3 Bucket</label>
                          <input
                            value={platformSettings?.s3_bucket || ""}
                            onChange={(e) => setPlatformSettings(prev => prev ? { ...prev, s3_bucket: e.target.value } : prev)}
                            onBlur={(e) => handleSavePlatformSettings("s3_bucket", e.target.value)}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">GCS Bucket</label>
                          <input
                            value={platformSettings?.gcs_bucket || ""}
                            onChange={(e) => setPlatformSettings(prev => prev ? { ...prev, gcs_bucket: e.target.value } : prev)}
                            onBlur={(e) => handleSavePlatformSettings("gcs_bucket", e.target.value)}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    {storageValidateResult && (
                      <div className={`p-3 rounded-lg border text-xs ${storageValidateResult.success ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                        <p className="font-bold uppercase font-mono">{locale === "pt" ? "Resultado do Validatee" : "Validate Result"}</p>
                        <p className="mt-1">{storageValidateResult.message}</p>
                        <p className="mt-1 font-mono break-all">
                          Mode: {storageValidateResult.mode} • Target: {storageValidateResult.target} • Writable: {String(storageValidateResult.writable)}
                          {storageValidateResult.scaffolded ? " • Scaffold" : ""}
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600">
                      <div className="p-3 bg-slate-50 rounded border">
                        <p className="font-bold text-slate-800">{locale === "pt" ? "Uploads de documentos" : "Document uploads"}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{locale === "pt" ? "Usa o storage selecionado no backend." : "Uses the selected backend storage."}</p>
                      </div>
                      <div className="p-3 bg-slate-50 rounded border">
                        <p className="font-bold text-slate-800">{locale === "pt" ? "Templates versionados" : "Versioned templates"}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{locale === "pt" ? "Caminhos persistidos no banco local." : "Paths persisted in local database."}</p>
                      </div>
                      <div className="p-3 bg-slate-50 rounded border">
                        <p className="font-bold text-slate-800">{locale === "pt" ? "Exportações geradas" : "Generated exports"}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{locale === "pt" ? "Preparado para futuras exportações." : "Ready for future exports."}</p>
                      </div>
                    </div>
                  </div>
                )}

                {activeAdminSection === "audit" && canAccessAdminSection("audit") && (
                  <div className="w-full grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Auditoria" : "Audit"}
                      </h3>
                      <p className="text-xs text-slate-500">{locale === "pt" ? "Acesse e exporte logs operacionais do sistema." : "Access and export operational system logs."}</p>
                      <button onClick={() => setShowAuditModal(true)} className="bg-slate-900 text-white px-3 py-2 rounded text-xs font-bold">
                        Audit Logs ({auditLogs.length})
                      </button>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Diagnóstico Técnico" : "Technical Diagnostics"}
                      </h3>
                      <p className="text-xs text-slate-500">{locale === "pt" ? "Console de debug, rastreio de integrações e pacote de diagnóstico." : "Debug console, integration traces and diagnostic package."}</p>
                      <button onClick={() => setShowDebugConsole(true)} className="bg-emerald-600 text-white px-3 py-2 rounded text-xs font-bold">
                        {locale === "pt" ? "Abrir Console de Diagnóstico" : "Open Diagnostic Console"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
  );
}
