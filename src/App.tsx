import React, { useState, useEffect, useRef } from "react";
import ApiClient from "./lib/api";
import Login from "./components/Login";
import SystemMessageBanner from "./components/SystemMessageBanner";
import AdminConsole from "./components/AdminConsole";
import Workspace from "./components/Workspace";
import ProjectsList from "./components/ProjectsList";
import KnowledgeBase from "./components/KnowledgeBase";
import Home from "./components/Home";
import Proposals from "./components/Proposals";
import Approval from "./components/Approval";
import PocManagement from "./components/PocManagement";
import PricingModule from "./components/PricingModule";
import NewProjectWizard from "./components/modals/NewProjectWizard";
import { useBackgroundTasks } from "./hooks/useBackgroundTasks";
import { useSilentRefresh } from "./hooks/useSilentRefresh";
import { PROPOSAL_TYPES } from "../server/utils/proposalTypes";
import ClassifyDocumentModal from "./components/modals/ClassifyDocumentModal";
import AuditLogsModal from "./components/modals/AuditLogsModal";
import DebugConsoleModal from "./components/modals/DebugConsoleModal";
import {
  Plus,
  Trash2,
  RefreshCw,
  LogOut,
  FileSpreadsheet,
  Globe
} from "lucide-react";
import {
  Project,
  Document,
  AnalysisResult,
  Proposal,
  AuditLog,
  DebugLog,
  BrandingSettings,
  PromptTemplate,
  PlatformSettings,
  IntegrationConnector,
  Role,
  ApprovalWorkflow
} from "./types";

const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI ChatGPT",
  anthropic: "Anthropic Claude",
};

// ai_orientation_mode is a fixed English enum validated by the backend (server/routes/projects.ts)
// - translate only how it's displayed here, never the stored value itself.
const AI_ORIENTATION_MODE_LABEL: Record<string, string> = {
  "Vendor-neutral": "Neutro em relação ao fornecedor",
  "Preferred manufacturer": "Fabricante preferencial",
  "Mandatory manufacturer": "Fabricante obrigatório",
  "Existing customer standard": "Padrão já existente do cliente",
  "Free AI recommendation": "Recomendação livre da IA",
  "Custom instruction": "Instrução personalizada",
};

// `locale` (below) is a hardcoded "pt" literal type with no setter anywhere in the app - there
// was never a way to reach translations.en, so it and the whole en/pt split were unreachable
// dead code. t() now just reads directly from this single dictionary.
const translations = {
  workspace: "Área de Trabalho",
  proposalsStudio: "Estúdio de Propostas",
  approvalCenter: "Centro de Aprovação",
  adminConsole: "Configurações",
  geminiOnline: "Gemini 2.5 Flash Ativo",
  bidsManager: "Gestor de Licitações",
  newBid: "Nova Proposta",
  clientDetails: "Detalhes do Cliente",
  aiOrientationMode: "Modo de Orientação IA",
  specifications: "Especificações",
  tenderDocs: "Docs de Licitação",
  clickToImport: "Clique para importar especificação",
  noDocs: "Nenhum documento enviado ainda",
  runAi: "Executar Análise IA",
  compiling: "Compilando Especificações...",
  execSummary: "Resumo Executivo de Conformidade",
  reqsGrid: "Matriz de Requisitos",
  risksOpps: "Riscos e Oportunidades",
  bomBuilder: "Mecanismo de BOM & Conformidade",
  proposalStudioGen: "Estúdio de Geração de Propostas",
  language: "Idioma",
  parsedDocs: "Docs Analisados",
  complianceScore: "Pontuação de Conformidade",
  criticalActionItems: "Ações Críticas Pendentes",
  bidsOverview: "Visão Geral de Pré-Vendas",
  tenderAnalysis: "Relatório de Análise de Licitação",
  complianceTitle: "Painel Executivo de Conformidade",
  risksFound: "Riscos Detectados",
  oppsFound: "Op. Encontradas",
  pricingEstimate: "Avaliação Estimada da BOM",
  clarificationQuestions: "Registro de Dúvidas / Esclarecimentos",
  suggestedFeatures: "Sugestões de Recursos & Melhorias na Plataforma",
  suggestedFeaturesDesc: "Abaixo estão as recomendações premium de melhorias e novas funcionalidades propostas para a próxima versão da plataforma:",
  sug1Title: "📊 Auditorias de Conformidade de SLA em Tempo Real",
  sug1Desc: "Cruza instantaneamente as penalidades de SLA propostas com a telemetria histórica de execução de projetos para mitigar vazamento de margem.",
  sug2Title: "💱 Cálculo Automatizado de Propostas Multimoeda",
  sug2Desc: "Modelagem financeira inteligente que gerencia parâmetros cambiais localizados, impostos regionais e matrizes de risco de entrega.",
  sug3Title: "🎨 Mecanismo Personalizado de Estilo de Marca DOCX",
  sug3Desc: "Permite sobrepor esquemas visuais corporativos dinâmicos, aplicando paletas de cores e espaçamentos automaticamente de arquivos RFP.",
  sug4Title: "🔒 Modelo de Conformidade Local Isolado (Airgapped)",
  sug4Desc: "Execução totalmente offline e isolada de modelos locais para atender aos rígidos padrões de segurança de defesa e inteligência pública.",
  sug5Title: "🤖 Loop de Consenso Multiagente de Pré-Vendas",
  sug5Desc: "Executa agentes Gemini simultâneos (Técnico, Comercial, Jurídico e Financeiro) para alcançar validação unânime antes da assinatura humana.",

  // Help Tooltips
  workspaceHelp: "Área de Trabalho: Envie especificações, analise conformidade, monte precificação da BOM e gere propostas.",
  proposalsHelp: "Estúdio de Propostas: Elabore rascunhos comerciais e técnicos personalizados com templates assistidos por IA.",
  templatesHelp: "Modelos de Licitação: Gerencie cláusulas jurídicas/técnicas padrão e variáveis de preenchimento automático.",
  approvalHelp: "Centro de Aprovação: Fluxo de aprovação em vários estágios mostrando assinaturas e decisões da gerência.",
  adminHelp: "Console de Administração: Acesse usuários, instruções do sistema, chaves de modelos, consumo de API e licenças.",
  bomHelp: "Mecanismo de BOM: Elabore a lista de itens vinculada a requisitos e calcule margens interativas em USD e BRL.",
  costHelp: "Gestor de Custos: Monitore taxas de consumo detalhado de tokens de API convertidas de USD para BRL.",
  licenseHelp: "Licenciamento Corporativo: Status da assinatura, chaves de ativação validadas, limites de usuários e upgrades.",
  apiModelsHelp: "Configuração de Modelos: Adicione Anthropic, OpenAI, DeepSeek e chaves de API para rodar análises concorrentes.",
};

// Global window fetch interceptor to inject Authorization header
if (typeof window !== "undefined") {
  const originalFetch = window.fetch;
  window.fetch = function (url, options: any = {}) {
    const token = localStorage.getItem("ca_session_token");
    if (token) {
      if (!options.headers) {
        options.headers = {};
      }
      if (options.headers instanceof Headers) {
        options.headers.set("Authorization", `Bearer ${token}`);
      } else if (Array.isArray(options.headers)) {
        options.headers.push(["Authorization", `Bearer ${token}`]);
      } else {
        options.headers["Authorization"] = `Bearer ${token}`;
      }
    }
    return originalFetch(url, options);
  };
}

export default function App() {
  // Português é o único idioma da interface - inglês fica só para termos sem tradução.
  const locale: "pt" = "pt";

  // Real authentication & session states
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);

  // Phase 1: real-time background task progress (analysis, proposal generation, ...)
  const { activeTasks, waitForTask, tasks } = useBackgroundTasks(isAuthenticated);

  // Phase 2: keeps the short-lived access token renewed in the background via the httpOnly
  // refresh cookie - same "unauthorized" event every other 401 already triggers if it fails.
  useSilentRefresh(isAuthenticated, () => window.dispatchEvent(new Event("unauthorized")));

  // Aviso de nova versão: reaproveita o /api/health que já existe (nenhum endpoint novo) -
  // captura o git_sha servido no carregamento da aba e compara periodicamente. Uma atualização
  // do sistema (agendada, manual ou empurrada pelo CMSaaS) troca o processo no servidor sem
  // avisar as abas já abertas - decisão do usuário durante o ensaio no Presales Demo
  // (2026-07-17): quem está numa aba aberta deve ser avisado, não descobrir sozinho recarregando
  // manualmente. Não recarrega sozinho (evitaria perder trabalho não salvo em algum formulário) -
  // só mostra o aviso, quem decide quando recarregar é o usuário.
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  useEffect(() => {
    let loadedGitSha: string | null = null;
    let cancelled = false;
    const check = () => {
      fetch("/api/health")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data.git_sha) return;
          if (loadedGitSha === null) {
            loadedGitSha = data.git_sha;
          } else if (data.git_sha !== loadedGitSha) {
            setNewVersionAvailable(true);
          }
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const [currentSessionUser, setCurrentSessionUser] = useState({
    id: "",
    name: "",
    email: "",
    role_id: "",
    role: "",
    permissions: [] as string[],
    enabled_modules: [] as string[]
  });

  const hasPermission = (permission: string) =>
    Array.isArray(currentSessionUser.permissions) && currentSessionUser.permissions.includes(permission);

  // Add-on gating (Fase 6): a nav tab like "Gestão de POC" only renders when the tenant's Fleet
  // Manager entitlement includes the module AND the user's role has the matching permission -
  // the backend re-checks both independently (requirePermission + requireModule) on every route.
  const hasModule = (moduleName: string) =>
    Array.isArray(currentSessionUser.enabled_modules) && currentSessionUser.enabled_modules.includes(moduleName);

  // Resolves what will actually run a task: iaKbTaskConfig (CMSaaS-managed) once the add-on is
  // active, platformSettings' own field otherwise - same distinction AdminConsole.tsx's
  // orchestrator map already draws, just needed here too for the "Powered by" captions.
  const effectiveTaskProvider = (taskType: string, settingsField: string | undefined) =>
    (hasModule("ia_kb") ? iaKbTaskConfig[taskType]?.provider : undefined) || settingsField || "gemini";
  const effectiveTaskModel = (taskType: string, settingsField: string | undefined) =>
    (hasModule("ia_kb") ? iaKbTaskConfig[taskType]?.model : undefined) || settingsField || "";

  const adminSectionPermissions: Record<string, string[]> = {
    overview: [
      "admin:users",
      "admin:roles",
      "admin:settings",
      "admin:audit",
      "admin:system_updates",
      "ai:settings",
      "template:manage",
      "approval:manage",
      "branding:manage",
      "integrations:manage",
      "storage:manage"
    ],
    users: ["admin:users", "admin:roles"],
    ai: ["ai:settings"],
    templates: ["template:manage"],
    approval_flow: ["approval:manage"],
    subscription: ["admin:settings"],
    system_updates: ["admin:system_updates"],
    branding: ["branding:manage"],
    integrations: ["integrations:manage"],
    storage: ["storage:manage"],
    audit: ["admin:audit", "admin:debug", "admin:diagnostics"]
  };

  const hasAnyPermission = (permissions: string[]) => permissions.some((permission) => hasPermission(permission));

  const canAccessAdminSection = (section: string) =>
    hasAnyPermission(adminSectionPermissions[section] || []);

  const canAccessAdminConsole = () =>
    Object.keys(adminSectionPermissions).some((section) => canAccessAdminSection(section));

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("ca_session_token");
      if (token) {
        try {
          const res: any = await ApiClient.get("/api/auth/me");
          if (res.success && res.user) {
            setCurrentSessionUser(res.user);
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem("ca_session_token");
            localStorage.removeItem("ca_user");
            setIsAuthenticated(false);
          }
        } catch (e) {
          localStorage.removeItem("ca_session_token");
          localStorage.removeItem("ca_user");
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
      }
      setAuthChecking(false);
    };

    checkAuth();

    const handleUnauthorized = () => {
      setIsAuthenticated(false);
    };
    window.addEventListener("unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("unauthorized", handleUnauthorized);
    };
  }, []);

  // AUD-006 (auditoria de segurança, 2026-07-19): avaliado migrar o token de sessão de
  // localStorage para um cookie httpOnly (elimina o acesso via JS, então um XSS não consegue
  // roubar o token) - decisão consciente de NÃO fazer essa migração nesta correção. Motivo: exige
  // reescrever requireAuth pra aceitar cookie (hoje só Bearer), CSRF protection nova (cookie é
  // enviado automaticamente pelo browser em toda requisição, diferente de Authorization que exige
  // JS explícito - abre uma classe de vulnerabilidade nova que não existe hoje), e tocar todo
  // ponto do frontend que lê o token (dezenas de call sites). Risco de regressão/quebra
  // desproporcional ao ganho numa mudança feita sem ciclo de design/teste dedicado - já mitigado
  // via CSP restrito (script-src 'self', sem 'unsafe-inline') como principal defesa contra XSS
  // hoje. Query string do token no EventSource (o vetor mais barato de vazar, via log de
  // acesso/histórico) já foi corrigido acima com ticket de curta duração.
  const handleLoginSuccess = (user: any, token: string) => {
    localStorage.setItem("ca_session_token", token);
    localStorage.setItem("ca_user", JSON.stringify(user));
    setCurrentSessionUser(user);
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    try {
      await ApiClient.post("/api/auth/logout", {});
    } catch (e) {
      // ignore
    }
    localStorage.removeItem("ca_session_token");
    localStorage.removeItem("ca_user");
    setIsAuthenticated(false);
    setCurrentSessionUser({
      id: "",
      name: "",
      email: "",
      role_id: "",
      role: "",
      permissions: [],
      enabled_modules: []
    });
  };

  const t = (key: string): string => (translations as any)[key] || key;

  const tx = (en: string, pt: string) => locale === "pt" ? pt : en;


  // Navigation / Views
  const [activeTab, setActiveTab] = useState<"home" | "workspace" | "projectsList" | "proposals" | "approval" | "knowledgeBase" | "admin" | "pocManagement" | "pricing">("home");
  const [activeAdminSection, setActiveAdminSection] = useState<"overview" | "users" | "ai" | "templates" | "approval_flow" | "subscription" | "system_updates" | "branding" | "integrations" | "storage" | "audit">("overview");

  // Shared with fetchGlobalConfigs (auto-selects defaults) and Workspace's proposal builder -
  // one entry per proposal type (see server/utils/proposalTypes.ts) rather than a separate
  // useState per type, since there are 7 of them now.
  const [selectedTemplateIdByType, setSelectedTemplateIdByType] = useState<Record<string, string>>({});
  // Shared with fetchProjectDetails (loads history on project switch) and Workspace's chat panel
  const [chatHistory, setChatHistory] = useState<{role: string, message: string}[]>([]);

  // Branding (shared across the whole app chrome, not just the Admin Console's own settings screen)
  const [brandLogoDataUrl, setBrandLogoDataUrl] = useState<string>(() => localStorage.getItem("ca_brand_logo") || "");
  const [brandPrimaryColor, setBrandPrimaryColor] = useState<string>(() => localStorage.getItem("ca_brand_primary_color") || "#059669");
  const [brandAccentColor, setBrandAccentColor] = useState<string>(() => localStorage.getItem("ca_brand_accent_color") || "#10b981");

  useEffect(() => {
    localStorage.setItem("ca_brand_logo", brandLogoDataUrl);
    localStorage.setItem("ca_brand_primary_color", brandPrimaryColor);
    localStorage.setItem("ca_brand_accent_color", brandAccentColor);
  }, [brandLogoDataUrl, brandPrimaryColor, brandAccentColor]);

  // Core Data State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);

  // UI Controls & Lists
  const [, setIsLoading] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string>("");
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [showDocumentTypeModal, setShowDocumentTypeModal] = useState<Document | null>(null);

  // Admin Console States
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  // ia_kb add-on: once active, this is the actual source of truth for provider/model per task -
  // platformSettings' own fields stop being read (see AdminConsole's own comment on this same
  // distinction). Bug found during the Presales Demo rehearsal (2026-07-17): the "Powered by"
  // captions below kept reading platformSettings directly even with the add-on active, always
  // showing the stale/default value instead of what's actually configured via the CMSaaS.
  const [iaKbTaskConfig, setIaKbTaskConfig] = useState<Record<string, { provider: string; model: string }>>({});
  const [brandingSettings, setBrandingSettings] = useState<BrandingSettings | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [aiProviderConfigs, setAiProviderConfigs] = useState<any[]>([]);
  const [proposalTemplates, setProposalTemplates] = useState<any[]>([]);
  const [approvalWorkflows, setApprovalWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [approvalDecisions, setApprovalDecisions] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConnector[]>([]);
  const [, setSystemStatus] = useState<any>(null);

  // Modals / Overlays
  const [showDebugConsole, setShowDebugConsole] = useState<boolean>(false);
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);

  // Helper to translate project data dynamically
  // active project object
  const safeProjects = Array.isArray(projects) ? projects : [];
  const activeProject = safeProjects.find(p => p.id === selectedProjectId) || safeProjects[0];
  // isAnalyzing (local state) gives instant feedback the moment the button is clicked, but
  // resets to false on any page reload even though the real background task keeps running -
  // activeTasks (fetched fresh from the server, survives reloads) is the real source of truth for
  // whether THIS project has a document_analysis task in flight. Combining both means the button
  // disables immediately on click AND stays correctly disabled after a reload, preventing the
  // user from accidentally starting a second simultaneous analysis for the same project.
  const isProjectAnalyzing = isAnalyzing || activeTasks.some((t) => t.type === "document_analysis" && t.result_id === selectedProjectId && t.status !== "completed" && t.status !== "failed");
  // Real progress for the "Executar Análise IA" button's own embedded bar - undefined until the
  // background task actually reports a percentage (isAnalyzing can be true before that first
  // update arrives), so the button falls back to an indeterminate look rather than a stuck 0%.
  const projectAnalysisTask = activeTasks.find((t) => t.type === "document_analysis" && t.result_id === selectedProjectId && t.status !== "completed" && t.status !== "failed");
  const displayAnalysisResult = analysisResult;

  // Fetch initial system settings & logs
  // Each config is independent of every other (only the two template-default lookups depend on
  // the templates fetch, so that logic stays inside its own task) - these used to run as 13
  // sequential awaits, so the whole call took the sum of every request's latency instead of just
  // the slowest one. Promise.all lets them all fly at once; each task swallows its own fetch
  // error so one failing config (e.g. a 500 on /api/audit-logs) doesn't stop the others from
  // updating.
  const fetchGlobalConfigs = async () => {
    const tasks = [
      // /api/settings, /api/branding and /api/settings/prompts now require the same permission
      // as their write counterpart (admin:settings / branding:manage / ai:settings - Fase 0 of
      // the Zero Trust rollout) - skip the call entirely for roles that don't have it instead of
      // firing a request that will 403. Built-in roles like "Pre-Sales Engineer" have none of
      // these by default, so this is the normal path for a lot of real users, not an edge case.
      ...(hasPermission("admin:settings")
        ? [
            (async () => {
              const res = await fetch("/api/settings");
              const data = await res.json();
              if (res.ok) setPlatformSettings(data.platform ?? data ?? null);
            })()
          ]
        : []),
      // Same permission the backend route itself requires (ai:settings) - matches
      // platformSettings' own gating just above, so a role without either permission still just
      // falls back to the generic default caption, same as it always has.
      ...(hasPermission("ai:settings")
        ? [
            (async () => {
              const res = await fetch("/api/settings/iakb-task-config");
              const data = await res.json();
              if (res.ok && Array.isArray(data)) {
                const map: Record<string, { provider: string; model: string }> = {};
                for (const row of data) map[row.task_type] = { provider: row.provider, model: row.model };
                setIaKbTaskConfig(map);
              }
            })()
          ]
        : []),
      ...(hasPermission("branding:manage")
        ? [
            (async () => {
              const res = await fetch("/api/branding");
              const data = await res.json();
              if (res.ok && data) {
                setBrandingSettings(data);
                setBrandLogoDataUrl(data.company_logo_path || "");
                setBrandPrimaryColor(data.primary_color || "#059669");
                setBrandAccentColor(data.accent_color || "#10b981");
              }
            })()
          ]
        : []),
      (async () => {
        const res = await fetch("/api/users");
        const data = await res.json();
        if (res.ok) setUsers(Array.isArray(data) ? data : []);
      })(),
      (async () => {
        const res = await fetch("/api/roles");
        const data = await res.json();
        if (res.ok) setRoles(Array.isArray(data) ? data : []);
      })(),
      ...(hasPermission("ai:settings")
        ? [
            (async () => {
              const res = await fetch("/api/settings/prompts");
              const data = await res.json();
              if (res.ok) setPromptTemplates(Array.isArray(data) ? data : []);
            })()
          ]
        : []),
      // /api/settings/ai-providers already required ai:settings before this session - same
      // unguarded-call bug as prompts above, fixed here too since it's the identical pattern.
      ...(hasPermission("ai:settings")
        ? [
            (async () => {
              const res = await fetch("/api/settings/ai-providers");
              const data = await res.json();
              if (res.ok) setAiProviderConfigs(Array.isArray(data) ? data : []);
            })()
          ]
        : []),
      (async () => {
        const res = await fetch("/api/templates/proposals");
        const data = await res.json();
        if (!res.ok) return;
        const safeTemplates = Array.isArray(data) ? data : [];
        setProposalTemplates(safeTemplates);

        setSelectedTemplateIdByType((current) => {
          const next = { ...current };
          for (const type of PROPOSAL_TYPES) {
            if (next[type]) continue;
            const defaultTpl = safeTemplates.find((tpl: any) => tpl.template_type === type && tpl.default_template && tpl.active)
              || safeTemplates.find((tpl: any) => tpl.template_type === type && tpl.active);
            if (defaultTpl) next[type] = defaultTpl.id;
          }
          return next;
        });
      })(),
      (async () => {
        const res = await fetch("/api/approval-workflows");
        const data = await res.json();
        if (res.ok) setApprovalWorkflows(Array.isArray(data) ? data : []);
      })(),
      (async () => {
        const res = await fetch("/api/approval-decisions");
        const data = await res.json();
        if (res.ok) setApprovalDecisions(Array.isArray(data) ? data : []);
      })(),
      (async () => {
        const res = await fetch("/api/integrations");
        const data = await res.json();
        if (res.ok) setIntegrations(Array.isArray(data) ? data : []);
      })(),
      (async () => {
        const res = await fetch("/api/admin/system/status");
        const data = await res.json();
        if (res.ok) setSystemStatus(data);
      })(),
      (async () => {
        const res = await fetch("/api/admin/logs/debug");
        const data = await res.json();
        if (res.ok) setDebugLogs(Array.isArray(data) ? data : []);
      })(),
      (async () => {
        const res = await fetch("/api/audit-logs");
        const data = await res.json();
        if (res.ok) setAuditLogs(Array.isArray(data) ? data : []);
      })(),
    ];

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "rejected") console.error("Error loading an administration parameter", r.reason);
    }
  };

  // Fetch projects list
  const fetchProjects = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/projects");
      const data = await res.json();
      const projectList = Array.isArray(data) ? data : [];
      setProjects(projectList);
      if (projectList.length > 0 && !selectedProjectId) {
        setSelectedProjectId(projectList[0].id);
      }
    } catch (e) {
      console.error("Error loading project list", e);
    } finally {
      setIsLoading(false);
    }
  };

  // Guards against rapidly switching projects: if the user clicks project B before project A's
  // fetch has resolved, A's response could land after B's and overwrite B's freshly-loaded data
  // with A's - each task below checks this ref before applying its result, so only the request
  // for whichever project is actually still selected gets to update state.
  const latestProjectRequestRef = useRef<string | null>(null);

  // Fetch documents, analysis results, proposals & chat history for the active project - these 4
  // are independent of each other, so they run concurrently instead of one after another.
  const fetchProjectDetails = async (projId: string) => {
    if (!projId) return;
    latestProjectRequestRef.current = projId;
    const isStillCurrent = () => latestProjectRequestRef.current === projId;

    const tasks = [
      (async () => {
        const res = await fetch(`/api/projects/${projId}/documents`);
        const data = await res.json();
        if (res.ok && isStillCurrent()) setDocuments(Array.isArray(data) ? data : []);
      })(),
      (async () => {
        const res = await fetch(`/api/projects/${projId}/analysis-result`);
        if (!isStillCurrent()) return;
        if (res.ok) {
          const data = await res.json();
          if (isStillCurrent()) setAnalysisResult(data);
        } else {
          setAnalysisResult(null);
        }
      })(),
      (async () => {
        const res = await fetch(`/api/projects/${projId}/proposals`);
        const data = await res.json();
        if (res.ok && isStillCurrent()) setProposals(Array.isArray(data) ? data : []);
      })(),
      (async () => {
        const res = await fetch(`/api/projects/${projId}/chat`);
        const data = await res.json();
        if (!res.ok || !isStillCurrent()) return;
        setChatHistory(Array.isArray(data) && data.length > 0 ? data : [
          {
            role: "model",
            message: tx(
              "Hi, I'm your Technical Pre-Sales Assistant. Ask me questions about this project's specifications, or run the AI analysis first for deeper context.",
              "Olá, sou seu Assistente Técnico de Pré-Vendas. Pergunte sobre as especificações deste projeto, ou rode a análise de IA primeiro para um contexto mais completo."
            )
          }
        ]);
      })(),
    ];

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "rejected") console.error("Error fetching project specifications detail", r.reason);
    }
  };

  useEffect(() => {
    // Runs once on initial mount (before login, no session token yet) and again the moment
    // login completes - without the isAuthenticated dependency this only ever ran pre-login,
    // so platformSettings/roles/users/etc. stayed permanently stuck on that first 401 response
    // (silently coerced into state, never null) for the rest of the session.
    if (!isAuthenticated) return;
    fetchProjects();
    fetchGlobalConfigs();
  }, [isAuthenticated]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectDetails(selectedProjectId);
    }
  }, [selectedProjectId]);

  // Handle Project Creation (form state/submit now owned by CreateProjectModal)
  const handleProjectCreated = (created: Project) => {
    setProjects([created, ...projects]);
    setSelectedProjectId(created.id);
    fetchGlobalConfigs(); // update audits
  };

  // Handle Document Delete
  const handleDeleteDocument = async (id: string) => {
    if (!confirm(locale === "pt" ? "Tem certeza que deseja descartar esta especificação?" : "Are you sure you want to discard this specification?")) return;
    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDocuments(documents.filter(d => d.id !== id));
        fetchGlobalConfigs(); // update audits
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getDocTag = (filename: string) => {
    const ext = filename.split(".").pop()?.toUpperCase() || "DOC";
    if (ext === "PDF") return { label: "PDF", style: "bg-red-50 text-red-700 border border-red-200" };
    if (["DOCX", "DOC"].includes(ext)) return { label: ext, style: "bg-blue-50 text-blue-700 border border-blue-200" };
    if (["XLSX", "XLS", "CSV"].includes(ext)) return { label: ext, style: "bg-emerald-50 text-emerald-700 border border-emerald-200" };
    if (["DWG", "DXF", "CAD"].includes(ext)) return { label: "CAD", style: "bg-purple-50 text-purple-700 border border-purple-200" };
    if (["PNG", "JPG", "JPEG"].includes(ext)) return { label: "IMG", style: "bg-amber-50 text-amber-700 border border-amber-200" };
    return { label: ext, style: "bg-slate-50 text-slate-700 border border-slate-200" };
  };

  const handleUploadDocumentFile = async (file: File) => {
    if (!selectedProjectId) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/documents`, {
        method: "POST",
        body: formData
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert(payload.message || (locale === "pt" ? "Não foi possível enviar o documento." : "Could not upload document."));
        return;
      }

      setDocuments(prev => [...prev, payload]);
      await fetchProjectDetails(selectedProjectId);
      await fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao enviar documento." : "Error uploading document.");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const fileList = input.files;

    if (!fileList) return;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList.item(i);
      if (file) {
        await handleUploadDocumentFile(file);
      }
    }

    input.value = "";
  };

  const handleUploadSampleDocument = async () => {
    const sampleContent = `Documento de exemplo para análise de pré-vendas
Cliente: Concessionária de Rodovias
Requisito: câmera IP externa com OCR/ALPR para leitura de placas.
Requisito: integração REST com sistema legado.
Risco: prazo curto para instalação em campo.
Pergunta: confirmar disponibilidade de energia e fibra no ponto de instalação.`;

    const file = new File(
      [sampleContent],
      `documento_exemplo_${Date.now()}.txt`,
      { type: "text/plain" }
    );

    await handleUploadDocumentFile(file);
  };

  // Reclassify Document Type
  const handleReclassifyDoc = async (docId: string, manualType: string) => {
    try {
      const res = await fetch(`/api/documents/${docId}/reclassify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual_document_type: manualType })
      });
      if (res.ok) {
        const updatedDoc = await res.json();
        setDocuments(documents.map(d => d.id === docId ? updatedDoc : d));
        setShowDocumentTypeModal(null);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Execute Pre-Sales AI Analysis
  const handleRunAnalysis = async () => {
    if (!selectedProjectId) return;

    setAnalysisError("");
    setIsAnalyzing(true);

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analyze`, {
        method: "POST"
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data.message || (locale === "pt"
          ? "Não foi possível executar a análise de IA."
          : "Could not run AI analysis.");

        const isMissingAiKey = message.includes("Gemini API key is not configured");
        const isInvalidAiKey = message.includes("API key not valid") || message.includes("API_KEY_INVALID") || message.includes("INVALID_ARGUMENT");

        let friendlyMessage = message;

        if (isMissingAiKey) {
          friendlyMessage = locale === "pt"
            ? "A chave da API Gemini ainda não está configurada. Acesse Admin > IA, Prompts e Custos e salve a chave antes de executar a análise."
            : "Gemini API key is not configured yet. Go to Admin > AI, Prompts & Costs and save the key before running analysis.";
        } else if (isInvalidAiKey) {
          friendlyMessage = locale === "pt"
            ? "A chave da API Gemini configurada está inválida ou expirada. Acesse Admin > IA, Prompts e Custos, remova a chave atual e salve uma chave válida."
            : "The configured Gemini API key is invalid or expired. Go to Admin > AI, Prompts & Costs, remove the current key, and save a valid key.";
        }

        setAnalysisError(friendlyMessage);
        setActiveTab("workspace");
        setIsAnalyzing(false);
        return;
      }

      // /analyze now responds immediately with a task id (Phase 1) - the real result comes
      // once the background task reaches a terminal state, watched over the SSE stream.
      const finished = await waitForTask(data.task_id);

      if (finished.status === "failed") {
        setAnalysisError(finished.error_message || (locale === "pt"
          ? "Erro inesperado ao executar a análise. Verifique os logs de diagnóstico."
          : "Unexpected error while running analysis. Check diagnostic logs."));
        setActiveTab("workspace");
        setIsAnalyzing(false);
        return;
      }

      await fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
      setAnalysisError("");
    } catch (e) {
      console.error(e);
      setAnalysisError(locale === "pt"
        ? "Erro inesperado ao executar a análise. Verifique os logs de diagnóstico."
        : "Unexpected error while running analysis. Check diagnostic logs.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Record Approval Decision
  const handleReleaseProposal = async (propId: string) => {
    if (!hasPermission("proposal:approve")) {
      alert(locale === "pt" ? "Você não tem permissão para liberar a versão final." : "You do not have permission to release final proposals.");
      return;
    }

    try {
      const res = await fetch(`/api/proposals/${propId}/release`, { method: "POST" });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.message || "Failed to release proposal.");
      }

      if (selectedProjectId) {
        fetchProjectDetails(selectedProjectId);
        fetchGlobalConfigs();
        setActiveTab("proposals");
      }
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = async () => {
    try {
      const res = await fetch("/api/audit-logs/export/csv");

      if (!res.ok) {
        const err = await res.text();
        alert(err || (locale === "pt" ? "Não foi possível exportar auditoria." : "Could not export audit logs."));
        return;
      }

      const blob = await res.blob();
      downloadBlob("commercial_assistant_audit_log.csv", blob);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao exportar auditoria." : "Error exporting audit logs.");
    }
  };

  const handleExportDiagnosticsPackage = async () => {
    try {
      const res = await fetch("/api/admin/diagnostics/package/download");

      if (!res.ok) {
        const err = await res.text();
        alert(err || (locale === "pt" ? "Não foi possível baixar o pacote de diagnóstico." : "Could not download diagnostic package."));
        return;
      }

      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || "commercial_assistant_diagnostic_package.txt";
      const blob = await res.blob();

      downloadBlob(filename, blob);

      alert(locale === "pt"
        ? "Pacote de diagnóstico sanitizado baixado com sucesso."
        : "Sanitized diagnostic package downloaded successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao exportar diagnóstico." : "Error exporting diagnostics.");
    }
  };

  // Active document counts
  const docsCount = documents.length;
  const reqsCount = analysisResult?.critical_requirements.length || 0;
  const risksCount = analysisResult?.risks.length || 0;
  const oppsCount = analysisResult?.opportunities.length || 0;

  if (authChecking) {
    return (
      <div id="app-loading-screen" className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 font-mono text-xs">{tx("COMMERCIAL ASSISTANT AI - SECURE PORTAL BOOTING...", "COMMERCIAL ASSISTANT AI - INICIANDO PORTAL SEGURO...")}</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login locale={locale} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">

      {newVersionAvailable && (
        <div className="shrink-0 z-20 bg-amber-500 text-amber-950 text-xs font-bold px-4 py-2 flex items-center justify-center gap-3">
          <span>{tx("A new version was installed on the server.", "Uma nova versão foi instalada no servidor.")}</span>
          <button onClick={() => window.location.reload()} className="underline">
            {tx("Reload page", "Recarregar página")}
          </button>
        </div>
      )}

      {/* 1. TOP NAV BAR */}
      <nav className="h-auto min-h-14 bg-slate-900 text-white flex items-center justify-between px-3 lg:px-6 shrink-0 z-10 shadow-md flex-wrap lg:flex-nowrap gap-2">
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          {brandLogoDataUrl ? (
            <div className="h-10 max-w-[190px] rounded bg-white/5 border border-white/10 px-2 py-1 flex items-center justify-center">
              <img src={brandLogoDataUrl} alt="Company logo" className="max-h-8 max-w-[170px] object-contain" />
            </div>
          ) : (
            <div className="h-10 max-w-[190px] flex items-center justify-center">
              <img src="/logo-mountain.png" alt="CloudMountain" className="max-h-9 max-w-[170px] object-contain" />
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 font-mono">{tx("Pre-Sales Compliance Platform", "Plataforma de Compliance de Pré-Vendas")}</span>
          </div>
        </div>

        {/* Global Nav Targets */}
        <div className="order-3 lg:order-none w-full lg:w-auto flex items-center gap-3 lg:gap-6 text-xs lg:text-sm font-medium text-slate-300 overflow-x-auto whitespace-nowrap pb-1 lg:pb-0">
          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("home")}
              className={`py-4 px-1 border-b-2 transition-all ${activeTab === "home" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              {locale === "pt" ? "Início" : "Home"}
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("workspace")}
              className={`py-4 px-1 border-b-2 transition-all ${activeTab === "workspace" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              {t("workspace")}
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("projectsList")}
              className={`py-4 px-1 border-b-2 transition-all ${activeTab === "projectsList" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              Projetos
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("proposals")}
              className={`py-4 px-1 border-b-2 transition-all ${activeTab === "proposals" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              {t("proposalsStudio")}
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("approval")}
              className={`py-4 px-1 border-b-2 transition-all ${activeTab === "approval" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              {t("approvalCenter")}
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("knowledgeBase")}
              className={`py-4 px-1 border-b-2 transition-all flex items-center gap-1.5 ${activeTab === "knowledgeBase" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              Base de Conhecimento
              {hasModule("ia_kb") && (
                // Same Globe-icon language as the per-entry "Base Global" badge inside the
                // Knowledge Base page itself (KnowledgeBase.tsx) - this is the glance-level signal,
                // visible from anywhere in the app, that the tenant is on the full ia_kb add-on
                // (managed AI + shared global Knowledge Base), not just the local/base experience.
                <span
                  title="Add-on IA/KB ativo: IA gerenciada e Base de Conhecimento global compartilhada via CMSaaS"
                  className="inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase text-blue-300 bg-blue-500/10 border border-blue-400/30 rounded-full px-1.5 py-0.5"
                >
                  <Globe size={9} />
                  IA/KB
                </span>
              )}
            </button>
          </div>

          {hasModule("poc") && hasAnyPermission(["poc:read", "poc:manage"]) && (
            <div className="flex items-center">
              <button
                onClick={() => setActiveTab("pocManagement")}
                className={`py-4 px-1 border-b-2 transition-all flex items-center gap-2 ${activeTab === "pocManagement" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
              >
                Gestão de POC
                <span className="text-[9px] font-bold tracking-wide uppercase text-emerald-400 bg-emerald-400/10 border border-emerald-400/40 rounded-full px-1.5 py-0.5">
                  Add-on
                </span>
              </button>
            </div>
          )}

          {hasModule("pricing") && hasAnyPermission(["pricing:read", "pricing:manage"]) && (
            <div className="flex items-center">
              <button
                onClick={() => setActiveTab("pricing")}
                className={`py-4 px-1 border-b-2 transition-all flex items-center gap-2 ${activeTab === "pricing" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
              >
                Precificação
                <span className="text-[9px] font-bold tracking-wide uppercase text-emerald-400 bg-emerald-400/10 border border-emerald-400/40 rounded-full px-1.5 py-0.5">
                  Add-on
                </span>
              </button>
            </div>
          )}

          {canAccessAdminConsole() && (
            <div className="flex items-center">
              <button
                onClick={() => {
                  if (!canAccessAdminSection(activeAdminSection)) {
                    const firstAllowedSection = Object.keys(adminSectionPermissions).find((section) => canAccessAdminSection(section));
                    setActiveAdminSection((firstAllowedSection || "overview") as any);
                  }
                  setActiveTab("admin");
                }}
                className={`py-4 px-1 border-b-2 transition-all ${activeTab === "admin" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
              >
                {t("adminConsole")}
              </button>
            </div>
          )}
        </div>

        {/* User Context & AI Health */}
        <div className="flex items-center gap-2 lg:gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 bg-slate-800 p-1.5 rounded-lg border border-slate-700/80 transition-colors"
            >
              <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center text-xs font-bold text-white uppercase font-sans">
                {currentSessionUser.name ? currentSessionUser.name.split(" ").map(n => n[0]).join("") : "U"}
              </div>
              <div className="hidden md:flex flex-col text-left">
                <span className="text-xs font-semibold leading-tight text-white">{currentSessionUser.name}</span>
                <span className="text-[10px] text-emerald-400 font-mono leading-none font-bold">{currentSessionUser.role}</span>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer flex items-center justify-center border border-transparent hover:border-slate-700"
              title={locale === "pt" ? "Sair da Conta" : "Logout"}
            >
              <LogOut className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      </nav>

      {/* 2. CONTEXT SUB-HEADER - not on Knowledge Base either, it's tenant-wide, not per-project.
          Not on Gestão de POC either (Fase 6 add-on) - a POC's own project (if any) is shown in
          its own detail view, and this sub-header showing an unrelated *other* project's
          status/deadline/owner while managing a POC was confusing (reported directly). */}
      {activeTab !== "home" && activeTab !== "admin" && activeTab !== "projectsList" && activeTab !== "knowledgeBase" && activeTab !== "pocManagement" && activeTab !== "pricing" && (
        <div className="h-11 bg-white border-b border-slate-200 flex items-center px-6 gap-2 text-xs font-medium shrink-0 shadow-sm">
          <span className="text-slate-400 font-mono">{locale === "pt" ? "Projetos" : "Projects"}</span>
          <span className="text-slate-400">/</span>
          <div className="flex items-center gap-2">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="font-bold text-slate-900 bg-slate-50 border border-slate-200 px-2 py-1 rounded hover:bg-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono uppercase">{activeProject?.vertical}</span>
          </div>

          <span className="ml-auto flex items-center gap-6">
            <span className="text-slate-400">
              {locale === "pt" ? "Status" : "Pipeline"}:
              <span className={`ml-1 text-[11px] font-bold px-2 py-0.5 rounded border ${
                activeProject?.status === "completed" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                activeProject?.status === "analysis_in_progress" ? "text-blue-700 bg-blue-50 border-blue-200" :
                activeProject?.status === "waiting_internal" ? "text-purple-700 bg-purple-50 border-purple-200" :
                "text-amber-700 bg-amber-50 border-amber-200"
              }`}>
                {locale === "pt" ?
                  (activeProject?.status === "completed" ? "CONCLUÍDO" :
                   activeProject?.status === "analysis_in_progress" ? "ANÁLISE EM ANDAMENTO" :
                   activeProject?.status === "waiting_internal" ? "AGUARDANDO INTERNO" : "RASCUNHO") :
                  (activeProject?.status || "draft").toUpperCase().replace("_", " ")
                }
              </span>
            </span>
            <span className="text-slate-400">
              {locale === "pt" ? "Prazo" : "Deadline"}: <span className="text-slate-700 font-mono font-semibold">{activeProject?.deadline}</span>
            </span>
            <span className="text-slate-400">
              {locale === "pt" ? "Responsável" : "Bid Owner"}: <span className="text-slate-700 font-semibold">{currentSessionUser.id === activeProject?.owner_user_id ? (locale === "pt" ? "Você" : "You") : (users.find((u: any) => u.id === activeProject?.owner_user_id)?.name || (locale === "pt" ? "Desconhecido" : "Unknown"))}</span>
            </span>
          </span>
        </div>
      )}

      {/* 3. MAIN WORKSPACE */}
      <main className="flex-1 flex overflow-hidden">

        {/* SIDEBAR: PROJECT SPECIFICATIONS & METADATA - only makes sense on the Workspace tab
            itself (upload/analyze/BOM/matrix editing); Proposals/Templates/Approval Center all
            still use the context sub-header's project dropdown, but don't need this cadastro/
            analysis sidebar alongside them. */}
        {activeTab === "workspace" && (
          <aside className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col p-4 gap-4 shrink-0 overflow-y-auto">

          {/* Quick Creator */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold font-mono">{t("bidsManager")}</h3>
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] px-2 py-1 rounded font-bold transition-all shadow-sm"
            >
              <Plus size={12} /> {t("newBid")}
            </button>
          </div>

          {/* Project Context Summary */}
          <section className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide font-mono">{t("clientDetails")}</span>
              <span className="text-[10px] text-slate-500 font-mono">ID: {activeProject?.id}</span>
            </div>
            <p className="text-sm font-bold text-slate-800 leading-none">{activeProject?.customer_name}</p>
            <p className="text-xs text-slate-500">{locale === "pt" ? "Ref da Oportunidade" : "Opportunity Ref"}: <span className="font-mono bg-slate-50 px-1 rounded border border-slate-100">{activeProject?.opportunity_name}</span></p>

            <div className="mt-2 pt-2 border-t border-slate-100">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide font-mono">{t("aiOrientationMode")}</span>
              <div className="mt-1 p-2 bg-slate-50 border border-slate-100 rounded text-xs">
                <span className="font-bold block text-slate-700 text-[11px]">{activeProject?.ai_orientation_mode ? (AI_ORIENTATION_MODE_LABEL[activeProject.ai_orientation_mode] || activeProject.ai_orientation_mode) : ""}</span>
                <p className="text-slate-600 italic mt-0.5 text-[11px] leading-relaxed">"{activeProject?.ai_orientation_text}"</p>
              </div>
            </div>
          </section>

          {/* Upload Documents Panel */}
          <section className="flex-1 flex flex-col min-h-[180px] bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 flex justify-between items-center font-mono">
              <span>{t("specifications")} ({docsCount})</span>
              <span className="text-emerald-600 text-xs font-semibold">{t("tenderDocs")}</span>
            </h3>

             {/* File Input */}
             <div className="relative border-2 border-dashed border-slate-200 hover:border-emerald-500 rounded p-3 mb-2 text-center transition-all">
               <input
                 type="file"
                 multiple
                 onChange={handleFileChange}
                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                 title={locale === "pt" ? "Arraste arquivos ou clique para selecionar" : "Drag files or click to select"}
               />
               <FileSpreadsheet className="mx-auto text-slate-400 mb-1" size={20} />
               <p className="text-[11px] font-bold text-slate-700">
                 {locale === "pt" ? "Arraste ou Selecione Arquivo" : "Drag & Drop or Browse"}
               </p>
               <p className="text-[9px] text-slate-400 mt-0.5 leading-none">
                 PDF, DOCX, XLSX, CSV, TXT...
               </p>
             </div>

             {/* Quick Sample Upload */}
             <button
               onClick={handleUploadSampleDocument}
               className="text-[10px] text-emerald-600 hover:text-emerald-700 font-bold mb-3 hover:underline text-center cursor-pointer block leading-none"
             >
               ✨ {locale === "pt" ? "Enviar Documento de Exemplo" : "Upload Sample Document"}
             </button>

{/* Document list */}
             <div className="space-y-1.5 overflow-y-auto max-h-[160px] pr-1">
               {documents.length === 0 ? (
                 <div className="text-center py-4 text-xs text-slate-400 italic">{t("noDocs")}</div>
               ) : (
                 documents.map(doc => {
                   const tag = getDocTag(doc.original_filename);
                   return (
                     <div key={doc.id} className="p-2 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 flex gap-2 items-start justify-between group transition-all">
                       <div className="flex gap-2 items-start overflow-hidden">
                         <div className={`w-10 h-8 shrink-0 flex items-center justify-center font-mono text-[9px] font-bold rounded ${tag.style}`}>
                           {tag.label}
                         </div>
                         <div className="overflow-hidden leading-tight">
                           <p className="text-xs font-semibold truncate text-slate-800" title={doc.original_filename}>
                             {doc.original_filename}
                           </p>
                           <button
                             onClick={() => setShowDocumentTypeModal(doc)}
                             className="text-[9px] bg-slate-200 text-slate-600 px-1 rounded hover:bg-emerald-50 hover:text-emerald-700 font-mono font-bold uppercase transition-all mt-0.5 block"
                           >
                             {doc.manual_document_type || doc.detected_document_type} ✏️
                           </button>
                         </div>
                       </div>
                       <button
                         onClick={() => handleDeleteDocument(doc.id)}
                         className="text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                       >
                         <Trash2 size={12} />
                       </button>
                     </div>
                   );
                 })
               )}
             </div>
          </section>

          {/* Core action trigger */}
          <section className="mt-auto pt-2 border-t border-slate-200">
            <button
              onClick={handleRunAnalysis}
              disabled={isProjectAnalyzing || documents.length === 0}
              className={`relative w-full py-2.5 rounded font-bold text-sm tracking-wide shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer overflow-hidden ${
                isProjectAnalyzing ? "bg-slate-700 text-slate-300" :
                documents.length === 0 ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white font-mono"
              }`}
            >
              {isProjectAnalyzing && (
                <span
                  className="absolute inset-y-0 left-0 bg-emerald-600/40 transition-all duration-500"
                  style={{ width: `${typeof projectAnalysisTask?.progress_pct === "number" ? projectAnalysisTask.progress_pct : 8}%` }}
                />
              )}
              <span className="relative flex items-center justify-center gap-2">
                <RefreshCw size={15} className={isProjectAnalyzing ? "animate-spin" : ""} />
                {isProjectAnalyzing
                  ? `${t("compiling").toUpperCase()}${typeof projectAnalysisTask?.progress_pct === "number" ? ` (${projectAnalysisTask.progress_pct}%)` : ""}`
                  : t("runAi").toUpperCase()}
              </span>
            </button>
            <p className="text-[9px] text-slate-400 text-center mt-1.5 leading-tight font-mono">
              {tx("Powered by", "Executado por")} {PROVIDER_DISPLAY_NAME[effectiveTaskProvider("document_analysis", platformSettings?.document_analysis_provider)] || effectiveTaskProvider("document_analysis", platformSettings?.document_analysis_provider)}
              {effectiveTaskModel("document_analysis", platformSettings?.document_analysis_model) ? ` (${effectiveTaskModel("document_analysis", platformSettings?.document_analysis_model)})` : ""}
            </p>
          </section>
        </aside>
        )}

        {/* WORKSPACE MAIN VIEW AREA */}
        <section className="flex-1 flex flex-col min-w-0 bg-white">

          {/* TAB 0: HOME / DASHBOARD TAB */}
          {activeTab === "home" && (
            <Home
              locale={locale}
              tx={tx}
              projects={projects}
              setSelectedProjectId={setSelectedProjectId}
              setActiveTab={setActiveTab}
              setShowNewProjectModal={setShowNewProjectModal}
              pocModuleEnabled={hasModule("poc") && hasAnyPermission(["poc:read", "poc:manage"])}
            />
          )}

          {/* TAB 1: WORKSPACE TAB */}
          {activeTab === "workspace" && (
            <Workspace
              locale={locale}
              tx={tx}
              t={t}
              hasPermission={hasPermission}
              activeTasks={activeTasks}
              selectedProjectId={selectedProjectId}
              projectName={activeProject?.name || ""}
              documents={documents}
              setDocuments={setDocuments}
              analysisResult={analysisResult}
              setAnalysisResult={setAnalysisResult}
              displayAnalysisResult={displayAnalysisResult}
              analysisError={analysisError}
              docsCount={docsCount}
              reqsCount={reqsCount}
              risksCount={risksCount}
              oppsCount={oppsCount}
              proposalTemplates={proposalTemplates}
              fetchGlobalConfigs={fetchGlobalConfigs}
              fetchProjectDetails={fetchProjectDetails}
              setActiveTab={setActiveTab}
              setActiveAdminSection={setActiveAdminSection}
              canAccessAdminSection={canAccessAdminSection}
              handleDeleteDocument={handleDeleteDocument}
              getDocTag={getDocTag}
              selectedTemplateIdByType={selectedTemplateIdByType}
              setSelectedTemplateIdByType={setSelectedTemplateIdByType}
              chatHistory={chatHistory}
              setChatHistory={setChatHistory}
              waitForTask={waitForTask}
              currentUserName={currentSessionUser.name || "Usuário"}
            />
          )}

          {/* TAB: ALL PROJECTS LIST (list/edit/delete - the sub-header dropdown above only ever
              lets you switch which single project you're working on, there was no page listing
              every project with edit/delete actions) */}
          {activeTab === "projectsList" && (
            <div className="p-6 overflow-y-auto">
              <ProjectsList
                locale={locale}
                projects={projects}
                hasPermission={hasPermission}
                onOpenProject={(projectId) => { setSelectedProjectId(projectId); setActiveTab("workspace"); }}
                onProjectsChanged={fetchProjects}
              />
            </div>
          )}

          {/* TAB 2: PROPOSALS TAB */}
          {activeTab === "proposals" && (
            <Proposals
              locale={locale}
              hasPermission={hasPermission}
              proposals={proposals}
              selectedProjectId={selectedProjectId}
              activeTasks={activeTasks}
              waitForTask={waitForTask}
              fetchGlobalConfigs={fetchGlobalConfigs}
              fetchProjectDetails={fetchProjectDetails}
              handleReleaseProposal={handleReleaseProposal}
            />
          )}

          {/* TAB 4: APPROVAL CENTER */}
          {activeTab === "approval" && (
            <Approval
              locale={locale}
              tx={tx}
              hasPermission={hasPermission}
              currentSessionUser={currentSessionUser}
              proposals={proposals}
              approvalWorkflows={approvalWorkflows}
              approvalDecisions={approvalDecisions}
              users={users}
              roles={roles}
              selectedProjectId={selectedProjectId}
              fetchGlobalConfigs={fetchGlobalConfigs}
              fetchProjectDetails={fetchProjectDetails}
              handleReleaseProposal={handleReleaseProposal}
            />
          )}

          {/* TAB: KNOWLEDGE BASE - tenant-wide, not scoped to a single project, so it lives
              outside the project sub-header/sidebar entirely (see the exclusions above). */}
          {activeTab === "knowledgeBase" && (
            <KnowledgeBase
              hasPermission={hasPermission}
              activeTasks={activeTasks}
              waitForTask={waitForTask}
            />
          )}

          {/* TAB: GESTÃO DE POC - add-on module (Fase 6), gated above by hasModule("poc") +
              hasAnyPermission before the nav button even renders; the API independently re-checks
              both on every request (requirePermission + requireModule). */}
          {activeTab === "pocManagement" && hasModule("poc") && hasAnyPermission(["poc:read", "poc:manage"]) && (
            <PocManagement
              hasPermission={hasPermission}
              projects={projects}
              activeTasks={activeTasks}
              waitForTask={waitForTask}
            />
          )}

          {/* Módulo de Precificação (add-on) - Fase 2: cadastro de tabela de preços. Precificação
              de BOM/projeto e "chegar no budget" chegam nas próximas fases do plano. */}
          {activeTab === "pricing" && hasModule("pricing") && hasAnyPermission(["pricing:read", "pricing:manage"]) && (
            <PricingModule waitForTask={waitForTask} tasksById={tasks} />
          )}

          {/* TAB 5: ADMIN CONSOLE */}
          {activeTab === "admin" && canAccessAdminConsole() && (
            <AdminConsole
              locale={locale}
              tx={tx}
              currentSessionUser={currentSessionUser}
              hasPermission={hasPermission}
              canAccessAdminSection={canAccessAdminSection}
              activeAdminSection={activeAdminSection}
              setActiveAdminSection={setActiveAdminSection}
              fetchGlobalConfigs={fetchGlobalConfigs}
              documents={documents}
              proposals={proposals}
              auditLogs={auditLogs}
              users={users}
              setUsers={setUsers}
              roles={roles}
              platformSettings={platformSettings}
              setPlatformSettings={setPlatformSettings}
              brandingSettings={brandingSettings}
              setBrandingSettings={setBrandingSettings}
              promptTemplates={promptTemplates}
              aiProviderConfigs={aiProviderConfigs}
              proposalTemplates={proposalTemplates}
              approvalWorkflows={approvalWorkflows}
              setApprovalWorkflows={setApprovalWorkflows}
              integrations={integrations}
              setIntegrations={setIntegrations}
              setShowAuditModal={setShowAuditModal}
              setShowDebugConsole={setShowDebugConsole}
              brandLogoDataUrl={brandLogoDataUrl}
              setBrandLogoDataUrl={setBrandLogoDataUrl}
              brandPrimaryColor={brandPrimaryColor}
              setBrandPrimaryColor={setBrandPrimaryColor}
              brandAccentColor={brandAccentColor}
              setBrandAccentColor={setBrandAccentColor}
            />
          )}


        </section>
      </main>

      <SystemMessageBanner locale={locale} hasPermission={hasPermission} />

      {/* 4. DIAGNOSTIC SYSTEM FOOTER */}
      <footer className="h-8 bg-slate-900 border-t border-slate-800 px-3 lg:px-6 flex items-center justify-between gap-4 text-[10px] font-mono text-slate-400 shrink-0 shadow-lg overflow-x-auto whitespace-nowrap">
        <div className="flex gap-6 items-center">
          <span>{tx("Session", "Sessão")}: <span className="text-emerald-400">{currentSessionUser.name || "-"}</span> <span className="text-slate-500">({currentSessionUser.role || "-"})</span></span>
          <span>{tx("Database", "Banco de Dados")}: <span className="text-emerald-400">PostgreSQL</span></span>
          <span>{tx("Workspace Storage", "Armazenamento do Workspace")}: <span className="text-emerald-400 uppercase">
            {platformSettings?.storage_mode === "s3"
              ? `S3: ${platformSettings?.s3_bucket || "not configured"}`
              : platformSettings?.storage_mode === "gcs"
                ? `GCS: ${platformSettings?.gcs_bucket || "not configured"}`
                : `LOCAL: ${platformSettings?.local_storage_path || "./uploads"}`}
          </span></span>
          <span className="flex items-center gap-1.5 border-l border-slate-700 pl-6">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            LLM Análise: <span className="text-emerald-400 font-bold uppercase">{PROVIDER_DISPLAY_NAME[effectiveTaskProvider("document_analysis", platformSettings?.document_analysis_provider)] || effectiveTaskProvider("document_analysis", platformSettings?.document_analysis_provider)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            LLM Propostas: <span className="text-emerald-400 font-bold uppercase">{PROVIDER_DISPLAY_NAME[effectiveTaskProvider("proposal_generation", platformSettings?.proposal_generation_provider)] || effectiveTaskProvider("proposal_generation", platformSettings?.proposal_generation_provider)}</span>
          </span>
          {(() => {
            // Single fixed-width slot for ALL active job types (was two separate shrink-0
            // w-[220px] blocks, one per task type, added independently over time - with 2+ types
            // running at once their combined width exceeded the footer and forced a horizontal
            // scrollbar on the whole page, confirmed against a real production report. Generic
            // over task type now (not a hardcoded .find() per type) so a future new AI task type
            // (e.g. the Fase 5 proposal-opinion tasks) never needs this file touched again to stay
            // bounded - only the newest/first active task's detail is shown, any others collapse
            // into a "+N" badge with the rest listed in its title tooltip.
            if (activeTasks.length === 0) return null;
            const footerTaskLabel = (type: string) => {
              switch (type) {
                case "document_analysis": return "Análise";
                case "poc_test_generation": return "Caderno de Testes";
                case "poc_schedule_generation": return "Cronograma";
                case "proposal_generation": return "Proposta";
                case "project_intake_analysis": return "Triagem";
                case "knowledge_base_analysis": return "Base de Conhecimento";
                case "pricing_catalog_extraction": return "Extração de Cotação";
                default: return type;
              }
            };
            // "Enviar Arquivos" cria uma BackgroundTask por arquivo (pra progresso granular por
            // documento dentro do popup de upload) - mas listar cada uma separadamente aqui
            // poluiria o rodapé com N entradas quase idênticas. Colapsa em uma única entrada
            // sintética "Analisando N cotações..." quando há mais de uma ativa ao mesmo tempo; com
            // só uma, mostra ela normalmente (mesmo padrão de qualquer outro tipo de tarefa).
            const pricingExtractionTasks = activeTasks.filter((t) => t.type === "pricing_catalog_extraction");
            const otherTasks = activeTasks.filter((t) => t.type !== "pricing_catalog_extraction");
            const displayTasks =
              pricingExtractionTasks.length > 1
                ? [
                    {
                      ...pricingExtractionTasks[0],
                      id: "pricing-catalog-extraction-aggregate",
                      current_step: `Analisando ${pricingExtractionTasks.length} cotações de fornecedor...`,
                      progress_pct: Math.round(
                        pricingExtractionTasks.reduce((sum, t) => sum + (typeof t.progress_pct === "number" ? t.progress_pct : 10), 0) /
                          pricingExtractionTasks.length
                      ),
                    },
                    ...otherTasks,
                  ]
                : activeTasks;
            const primary = displayTasks[0];
            const extra = displayTasks.slice(1);
            return (
              <span className="flex items-center gap-2 border-l border-slate-700 pl-6 w-[260px] shrink-0">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
                <span className="flex-1 min-w-0 overflow-hidden">
                  <span className="inline-block whitespace-nowrap animate-footer-task-ticker">
                    {footerTaskLabel(primary.type)}: {primary.current_step}
                    {typeof primary.progress_pct === "number" && ` (${primary.progress_pct}%)`}
                  </span>
                </span>
                <span className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden shrink-0">
                  <span
                    className="block h-full bg-amber-400 transition-all duration-500"
                    style={{ width: `${typeof primary.progress_pct === "number" ? primary.progress_pct : 5}%` }}
                  />
                </span>
                {extra.length > 0 && (
                  <span
                    className="shrink-0 text-amber-300 font-bold"
                    title={extra.map((t) => `${footerTaskLabel(t.type)}: ${t.current_step}`).join(", ")}
                  >
                    +{extra.length}
                  </span>
                )}
              </span>
            );
          })()}
        </div>
        <div className="flex gap-4">
          <a
            href="/manuals/manual-usuario.html"
            target="_blank"
            rel="noopener"
            className="text-slate-300 hover:text-emerald-400 hover:underline cursor-pointer transition-colors"
          >
            Manual do Usuário
          </a>
          {hasPermission("admin:audit") && (
            <button
              onClick={() => setShowAuditModal(true)}
              className="text-slate-300 hover:text-emerald-400 hover:underline cursor-pointer transition-colors"
            >
              Audit Logs ({auditLogs.length})
            </button>
          )}
          {hasAnyPermission(["admin:debug", "admin:diagnostics"]) && (
            <button
              onClick={() => setShowDebugConsole(true)}
              className="text-slate-300 hover:text-emerald-400 hover:underline cursor-pointer font-bold transition-colors"
            >
              Debug Console
            </button>
          )}
        </div>
      </footer>

      {showNewProjectModal && (
        <NewProjectWizard
          locale={locale}
          onClose={() => setShowNewProjectModal(false)}
          onCreated={handleProjectCreated}
          waitForTask={waitForTask}
        />
      )}

      {showDocumentTypeModal && (
        <ClassifyDocumentModal
          document={showDocumentTypeModal}
          tx={tx}
          onClose={() => setShowDocumentTypeModal(null)}
          onReclassify={handleReclassifyDoc}
        />
      )}

      {showAuditModal && (
        <AuditLogsModal
          auditLogs={auditLogs}
          tx={tx}
          onClose={() => setShowAuditModal(false)}
          onExportCSV={handleExportCSV}
        />
      )}

      {showDebugConsole && (
        <DebugConsoleModal
          debugLogs={debugLogs}
          locale={locale}
          tx={tx}
          hasPermission={hasPermission}
          onClose={() => setShowDebugConsole(false)}
          onExportDiagnostics={handleExportDiagnosticsPackage}
        />
      )}

    </div>
  );
}
