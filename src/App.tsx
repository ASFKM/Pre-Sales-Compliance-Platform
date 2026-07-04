import React, { useState, useEffect } from "react";
import ApiClient from "./lib/api";
import Login from "./components/Login";
import {
  FileText,
  Plus,
  Trash2,
  RefreshCw,
  ShieldAlert,
  Database,
  HardDrive,
  CheckCircle2,
  Cpu,
  LogOut,
  Check,
  X,
  Save,
  Download,
  Edit3,
  MessageSquare,
  Settings,
  Users,
  Layers,
  Activity,
  FileSpreadsheet,
  FolderPlus,
  HelpCircle,
  Sparkles,
  FileCode,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
  Lock,
  Menu,
  ChevronRight,
  ListTodo,
  Folder,
  FolderOpen,
  ArrowLeft,
  FilePlus
} from "lucide-react";
import {
  Project,
  Document,
  AnalysisResult,
  Proposal,
  AuditLog,
  DebugLog,
  CriticalRequirement,
  ProjectRisk,
  ProjectOpportunity,
  BOMItem,
  PointToPointRow,
  PreliminarySchedulePhase,
  ClarificationQuestion,
  BrandingSettings,
  PromptTemplate,
  PlatformSettings,
  IntegrationConnector,
  PricingRow,
  Role,
  ApprovalWorkflow
} from "./types";

const translations = {
  en: {
    workspace: "Workspace",
    proposalsStudio: "Proposals Studio",
    tenderTemplates: "Tender Templates",
    approvalCenter: "Approval Center",
    adminConsole: "Admin Console",
    geminiOnline: "Gemini 2.5 Flash Online",
    bidsManager: "Bids Manager",
    newBid: "New Bid",
    clientDetails: "Client Details",
    aiOrientationMode: "AI Orientation Mode",
    specifications: "Specifications",
    tenderDocs: "Tender Docs",
    clickToImport: "Click to import specification",
    noDocs: "No documents uploaded yet",
    runAi: "Run AI Analysis",
    compiling: "Compiling Specifications...",
    execSummary: "Executive Compliance Summary",
    reqsGrid: "Requirements Datagrid",
    risksOpps: "Risks & Opportunities",
    bomBuilder: "Technical BOM & Compliance Builder",
    proposalStudioGen: "Proposal Studio Generator",
    language: "Language",
    parsedDocs: "Specifications Parsed",
    complianceScore: "Compliance Score",
    criticalActionItems: "Critical Action Items",
    bidsOverview: "Pre-Sales Bid Overview",
    tenderAnalysis: "Tender Analysis Report",
    complianceTitle: "Executive Compliance Dashboard",
    risksFound: "Risks Detected",
    oppsFound: "Opps Discovered",
    pricingEstimate: "BOM Valuation Estimate",
    clarificationQuestions: "Clarification Questions Log",
    suggestedFeatures: "Suggested Features & Platform Improvements",
    suggestedFeaturesDesc: "Below are premium recommended improvements and cutting-edge features proposed for the next version of the platform:",
    sug1Title: "📊 Integrated Real-time SLA compliance audits",
    sug1Desc: "Instantly cross-references draft SLA penalties against historical project execution telemetry to prevent margin bleed.",
    sug2Title: "💱 Multi-currency automated bid calculation",
    sug2Desc: "Smart financial modeling matching localized currency parameters, dynamic tax inclusions, and regional delivery risk pricing matrices.",
    sug3Title: "🎨 Customized docx brand styling engine",
    sug3Desc: "Provides dynamic corporate design schema overrides, matching color palettes and spacing automatically from client RFP uploads.",
    sug4Title: "🔒 Offline offline-first airgapped compliance model",
    sug4Desc: "Run fully airgapped models locally to comply with strict sovereign defense and public intelligence agency security standards.",
    sug5Title: "🤖 Multi-agent consensus review loop",
    sug5Desc: "Run concurrent Gemini agents representing technical, commercial, legal, and financial personas to reach unanimous pre-sales validation before human signoff.",

    // Help Tooltips
    workspaceHelp: "Workspace: Upload specifications, analyze compliance, build pricing BOM and generate proposals.",
    proposalsHelp: "Proposals Studio: Craft custom commercial and technical proposal drafts using AI-assisted templates.",
    templatesHelp: "Tender Templates: Manage boilerplate legal/technical clauses and variables for automatic document filling.",
    approvalHelp: "Approval Center: Multi-stage consensus workflow showing manager review outcomes and legal sign-off.",
    adminHelp: "Admin Console: Access user registry, system instructions, active model keys, API cost tracking & licenses.",
    bomHelp: "BOM Mechanism: Design line items list matching compliance standards with interactive margins in USD and BRL.",
    costHelp: "API Cost Manager: Monitor detailed token-consumption rates converted from USD to BRL.",
    licenseHelp: "Corporate License: Active subscription details, validated keys, limits and upgrades.",
    apiModelsHelp: "API Models Setup: Add Anthropic, OpenAI, DeepSeek, and custom API keys to run parallel analyses.",
  },
  pt: {
    workspace: "Área de Trabalho",
    proposalsStudio: "Estúdio de Propostas",
    tenderTemplates: "Modelos de Licitação",
    approvalCenter: "Centro de Aprovação",
    adminConsole: "Console do Administrador",
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
  }
};

// Reusable HelpTooltip Component (Removed as requested by the user)
function HelpTooltip({ content }: { content: string }) {
  return null;
}

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
  // Locale State (Defaults to Portuguese "pt")
  const [locale, setLocale] = useState<"en" | "pt">("pt");

  // Real authentication & session states
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [currentSessionUser, setCurrentSessionUser] = useState({
    id: "",
    name: "",
    email: "",
    role_id: "",
    role: "",
    permissions: [] as string[]
  });

  const hasPermission = (permission: string) =>
    Array.isArray(currentSessionUser.permissions) && currentSessionUser.permissions.includes(permission);

  const adminSectionPermissions: Record<string, string[]> = {
    overview: [
      "admin:users",
      "admin:roles",
      "admin:settings",
      "admin:audit",
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

  const getApprovalStageTargetLabel = (stage: any) => {
    if (!stage) return locale === "pt" ? "Não configurado" : "Not configured";

    if (stage.approver_type === "user") {
      const user = users.find((u) => u.id === stage.approver_user_id);
      return user?.name || stage.approver_user_id || (locale === "pt" ? "Usuário não configurado" : "User not configured");
    }

    const role = roles.find((r) => r.id === stage.approver_role_id);
    return role?.name || stage.approver_role_id || (locale === "pt" ? "Perfil não configurado" : "Role not configured");
  };

  const canReviewApprovalStage = (stage: any) => {
    if (!stage || !currentSessionUser.id || !currentSessionUser.role_id) return false;

    if (stage.approver_type === "user") {
      return stage.approver_user_id === currentSessionUser.id;
    }

    return stage.approver_role_id === currentSessionUser.role_id;
  };

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
      permissions: []
    });
  };

  const t = (key: string): string => {
    const dict = translations[locale] || translations["pt"];
    return (dict as any)[key] || key;
  };

  const tx = (en: string, pt: string) => locale === "pt" ? pt : en;


  // Subscription & Licensing Management States
  const [licenseTier, setLicenseTier] = useState<"enterprise" | "professional" | "free">("enterprise");
  const [licenseKey, setLicenseKey] = useState("CA-ENT-778X-992K-2026");
  const [licenseExpiry, setLicenseExpiry] = useState("2027-12-31");
  const [licenseStatus, setLicenseStatus] = useState<"Active" | "Expired" | "Pending">("Active");
  const [inputLicenseKey, setInputLicenseKey] = useState("");
  const [licenseMessage, setLicenseMessage] = useState("");

  // Cost Management Tracker (USD and BRL)
  const [costUSD, setCostUSD] = useState(14.28);
  const [inputTokens, setInputTokens] = useState(2856000);
  const [outputTokens, setOutputTokens] = useState(1000000);
  const exchangeRate = 5.15; // 1 USD = 5.15 BRL (realistic exchange rate)

  // System & AI target model configurations
  const [modelProviders, setModelProviders] = useState([
    { id: "gemini", name: "Google Gemini", activeModel: "Gemini 2.5 Flash", apiKey: "••••••••••••••••••••", enabled: true, models: ["Gemini 2.5 Flash", "Gemini 2.5 Pro"] },
    { id: "openai", name: "OpenAI ChatGPT", activeModel: "GPT-4o", apiKey: "", enabled: false, models: ["GPT-4o", "GPT-3.5-Turbo", "o1-mini"] },
    { id: "anthropic", name: "Anthropic Claude", activeModel: "Claude 3.5 Sonnet", apiKey: "", enabled: false, models: ["Claude 3.5 Sonnet", "Claude 3 Opus"] },
    { id: "deepseek", name: "DeepSeek", activeModel: "DeepSeek-R1", apiKey: "", enabled: false, models: ["DeepSeek-R1", "DeepSeek-V3"] }
  ]);

  // Navigation / Views
  const [activeTab, setActiveTab] = useState<"home" | "workspace" | "proposals" | "templates" | "approval" | "admin">("home");
  const [activeAdminSection, setActiveAdminSection] = useState<"overview" | "users" | "ai" | "templates" | "approval_flow" | "subscription" | "branding" | "integrations" | "storage" | "audit">("overview");
  const [brandLogoDataUrl, setBrandLogoDataUrl] = useState<string>(() => localStorage.getItem("ca_brand_logo") || "");
  const [brandPrimaryColor, setBrandPrimaryColor] = useState<string>(() => localStorage.getItem("ca_brand_primary_color") || "#059669");
  const [brandAccentColor, setBrandAccentColor] = useState<string>(() => localStorage.getItem("ca_brand_accent_color") || "#10b981");
  const [templateUploadFileName, setTemplateUploadFileName] = useState<string>("");
  const [templateUploadName, setTemplateUploadName] = useState<string>("");
  const [templateUploadDescription, setTemplateUploadDescription] = useState<string>("");
  const [templateUploadVersion, setTemplateUploadVersion] = useState<string>("v1.0");
  const [templateUploadType, setTemplateUploadType] = useState<"technical" | "commercial">("technical");
  const [templateUploadLanguage, setTemplateUploadLanguage] = useState<"Portuguese" | "English" | "Spanish">("Portuguese");
  const [templateUploadVariables, setTemplateUploadVariables] = useState<string>("{{project.name}}, {{customer.name}}, {{analysis.executive_summary}}, {{analysis.bom}}");
  const [newRoleName, setNewRoleName] = useState<string>("");
  const [newRoleDescription, setNewRoleDescription] = useState<string>("");
  const [newRoleModules, setNewRoleModules] = useState<string[]>(["workspace"]);
  const [customAdminRoles, setCustomAdminRoles] = useState<Array<{ id: string; name: string; description: string; modules: string[] }>>([]);
  const [showNewUserForm, setShowNewUserForm] = useState<boolean>(false);
  const [newUserName, setNewUserName] = useState<string>("");
  const [newUserEmail, setNewUserEmail] = useState<string>("");
  const [newUserRoleId, setNewUserRoleId] = useState<string>("r3");
  const [newUserPassword, setNewUserPassword] = useState<string>("ChangeMe123!");
  const [editingUserId, setEditingUserId] = useState<string>("");
  const [editingUserPassword, setEditingUserPassword] = useState<string>("");


  useEffect(() => {
    localStorage.setItem("ca_brand_logo", brandLogoDataUrl);
    localStorage.setItem("ca_brand_primary_color", brandPrimaryColor);
    localStorage.setItem("ca_brand_accent_color", brandAccentColor);
  }, [brandLogoDataUrl, brandPrimaryColor, brandAccentColor]);

  const [subTab, setSubTab] = useState<"summary" | "requirements" | "risks" | "bom" | "proposal_builder" | "explorer">("summary");

  // Core Data State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);

  // User Tasks States
  const [tasks, setTasks] = useState<{ id: string; text: string; done: boolean; dueDate?: string }[]>(() => {
    const saved = localStorage.getItem("user_tasks");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: "1", text: "Revisar inconformidades críticas do Edital 82", done: false, dueDate: "2026-07-05" },
      { id: "2", text: "Ajustar margem de lucro e precificação na planilha BOM", done: false, dueDate: "2026-07-08" },
      { id: "3", text: "Subir diagramas elétricos no explorador de arquivos", done: false, dueDate: "2026-07-06" },
      { id: "4", text: "Gerar minuta final da proposta comercial para diretoria", done: true, dueDate: "2026-06-30" }
    ];
  });
  const [newTaskText, setNewTaskText] = useState("");

  // Sync tasks to localStorage
  useEffect(() => {
    localStorage.setItem("user_tasks", JSON.stringify(tasks));
  }, [tasks]);

  // File Explorer States
  const [currentFolder, setCurrentFolder] = useState<string>(""); // "" means root/raiz
  const [projectFolders, setProjectFolders] = useState<string[]>([]);
  const [virtualFiles, setVirtualFiles] = useState<any[]>([]);
  const [docFolderMapping, setDocFolderMapping] = useState<Record<string, string>>({}); // docId -> folderName
  const [editingFileNameId, setEditingFileNameId] = useState<string | null>(null);
  const [editingFileNameValue, setEditingFileNameValue] = useState<string>("");
  const [showNewFolderInput, setShowNewFolderInput] = useState<boolean>(false);
  const [newFolderNameValue, setNewFolderNameValue] = useState<string>("");
  const [activeFileViewer, setActiveFileViewer] = useState<any | null>(null); // To view text/markdown files
  const [showMoveFileModal, setShowMoveFileModal] = useState<any | null>(null); // File to move
  const [showCreateFileModal, setShowCreateFileModal] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>("");
  const [newFileContent, setNewFileContent] = useState<string>("");

  // Load project-specific file system states
  useEffect(() => {
    if (!selectedProjectId) return;

    // Load folders
    const savedFolders = localStorage.getItem(`folders_${selectedProjectId}`);
    if (savedFolders) {
      try {
        setProjectFolders(JSON.parse(savedFolders));
      } catch (e) {
        setProjectFolders(["Especificações", "Desenhos CAD", "Planilhas Financeiras", "Propostas e Minutas"]);
      }
    } else {
      const defaults = ["Especificações", "Desenhos CAD", "Planilhas Financeiras", "Propostas e Minutas"];
      setProjectFolders(defaults);
      localStorage.setItem(`folders_${selectedProjectId}`, JSON.stringify(defaults));
    }

    // Load virtual files
    const savedVFiles = localStorage.getItem(`virtual_files_${selectedProjectId}`);
    if (savedVFiles) {
      try {
        setVirtualFiles(JSON.parse(savedVFiles));
      } catch (e) {
        setVirtualFiles([]);
      }
    } else {
      setVirtualFiles([]);
    }

    // Load doc folder mappings
    const savedMappings = localStorage.getItem(`doc_mappings_${selectedProjectId}`);
    if (savedMappings) {
      try {
        setDocFolderMapping(JSON.parse(savedMappings));
      } catch (e) {
        setDocFolderMapping({});
      }
    } else {
      setDocFolderMapping({});
    }

    // Reset current folder back to root when switching projects
    setCurrentFolder("");
  }, [selectedProjectId]);

  // Save changes to folders, virtual files, and doc mappings
  const saveFoldersToStorage = (updated: string[]) => {
    setProjectFolders(updated);
    if (selectedProjectId) {
      localStorage.setItem(`folders_${selectedProjectId}`, JSON.stringify(updated));
    }
  };

  const saveVirtualFilesToStorage = (updated: any[]) => {
    setVirtualFiles(updated);
    if (selectedProjectId) {
      localStorage.setItem(`virtual_files_${selectedProjectId}`, JSON.stringify(updated));
    }
  };

  const saveDocMappingsToStorage = (updated: Record<string, string>) => {
    setDocFolderMapping(updated);
    if (selectedProjectId) {
      localStorage.setItem(`doc_mappings_${selectedProjectId}`, JSON.stringify(updated));
    }
  };

  // File Explorer Helpers
  const getFilesForFolder = (folderName: string) => {
    // 1. Real documents from our active project
    const realDocsInFolder = documents.filter(doc => {
      const assigned = docFolderMapping[doc.id];
      if (assigned !== undefined && assigned !== null) {
        return assigned === folderName;
      }
      // If no mapping, we auto-assign based on file extension
      const ext = doc.original_filename.split('.').pop()?.toLowerCase();
      if (folderName === "Especificações" && ext === "pdf") return true;
      if (folderName === "Planilhas Financeiras" && (ext === "xlsx" || ext === "xls" || ext === "csv")) return true;
      if (folderName === "Desenhos CAD" && (ext === "dwg" || ext === "dxf" || ext === "cad")) return true;
      if (folderName === "Propostas e Minutas" && (ext === "docx" || ext === "doc")) return true;

      // If we are looking for Root (folderName === ""), and the file doesn't fit any auto-assigned folder:
      if (folderName === "") {
        const fitsAnyFolder = ["pdf", "xlsx", "xls", "csv", "dwg", "dxf", "cad", "docx", "doc"].includes(ext || "");
        return !fitsAnyFolder;
      }
      return false;
    });

    // 2. Virtual files
    const virtualInFolder = virtualFiles.filter(vf => vf.folder === folderName);

    return {
      real: realDocsInFolder,
      virtual: virtualInFolder
    };
  };

  // UI Controls & Lists
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string>("");
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [showDocumentTypeModal, setShowDocumentTypeModal] = useState<Document | null>(null);

  // Chat Assistant Input
  const [chatMessage, setChatMessage] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<{role: string, message: string}[]>([]);
  const [isChatSending, setIsChatSending] = useState<boolean>(false);

  // Admin Console States
  const [showNewConnectorForm, setShowNewConnectorForm] = useState<boolean>(false);
  const [newConnectorName, setNewConnectorName] = useState<string>("");
  const [newConnectorType, setNewConnectorType] = useState<string>("Salesforce");
  const [newConnectorUrl, setNewConnectorUrl] = useState<string>("");
  const [newConnectorToken, setNewConnectorToken] = useState<string>("");
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [storageValidateResult, setStorageValidateResult] = useState<any>(null);
  const [brandingSettings, setBrandingSettings] = useState<BrandingSettings | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [proposalTemplates, setProposalTemplates] = useState<any[]>([]);
  const [selectedTechnicalTemplateId, setSelectedTechnicalTemplateId] = useState("");
  const [selectedCommercialTemplateId, setSelectedCommercialTemplateId] = useState("");
  const [approvalWorkflows, setApprovalWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [approvalDecisions, setApprovalDecisions] = useState<any[]>([]);
  const [showNewApprovalWorkflowForm, setShowNewApprovalWorkflowForm] = useState<boolean>(false);
  const [newApprovalWorkflowName, setNewApprovalWorkflowName] = useState<string>("");
  const [newApprovalWorkflowDescription, setNewApprovalWorkflowDescription] = useState<string>("");
  const [newApprovalWorkflowAppliesTo, setNewApprovalWorkflowAppliesTo] = useState<string>("all");
  const [integrations, setIntegrations] = useState<IntegrationConnector[]>([]);
  const [systemStatus, setSystemStatus] = useState<any>(null);

  // Modals / Overlays
  const [showDebugConsole, setShowDebugConsole] = useState<boolean>(false);
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);

  // New Project Form Data
  const [newProject, setNewProject] = useState({
    name: "",
    customer_name: "",
    opportunity_name: "",
    vertical: "Infrastructure",
    description: "",
    deadline: "2026-08-30",
    proposal_validity_date: "2026-11-30",
    output_language: "English" as "English" | "Spanish" | "Portuguese",
    proposal_language: "English" as "English" | "Spanish" | "Portuguese",
    ai_orientation_mode: "Vendor-neutral" as any,
    ai_orientation_text: "",
    selected_approval_workflow_id: "w1",
    procurement_modality: "Licitação",
    procurement_subtype: "Pregão",
    custom_modality: ""
  });

  // Helper to translate project data dynamically
  const getTranslatedProject = (proj: any) => {
    if (!proj) return proj;
    if (locale === "en") return proj;
    const overrides: Record<string, any> = {
      p1: {
        name: "Modernização de ITS Rodoviário",
        description: "Modernização abrangente de rodovias, incluindo detecção inteligente de velocidade, câmeras automáticas de incidentes e redes de telemetria de fibra óptica.",
        vertical: "Infraestrutura",
        customer_name: "Autoridade de Trânsito Metropolitano (MTA)",
        ai_orientation_mode: "Neutro em relação ao fornecedor",
        ai_orientation_text: "Garantir que o hardware de ITS seja totalmente independente de fabricante, utilizando padrões abertos ONVIF Perfil T para comunicação de câmeras e compatibilidade com controladores de vários fornecedores."
      },
      p2: {
        name: "Expansão de Estacionamento Inteligente",
        description: "Integração de rede de estacionamento inteligente cobrindo 12.000 sensores de ocupação IoT no nível da rua, conexão de gateway de faturamento e aplicativos móveis de orientação.",
        vertical: "Cidades Inteligentes",
        customer_name: "Prefeitura Municipal de São Paulo"
      },
      p3: {
        name: "Fronteira Biométrica Aeroportuária",
        description: "Implementação de portões eletrônicos biométricos, motor de varredura automática de ameaças de bagagem e módulos de verificação facial seguros para autenticação de fronteira.",
        vertical: "Infraestrutura Crítica",
        customer_name: "Autoridade Aeroportuária de Guarulhos"
      }
    };
    if (overrides[proj.id]) {
      return { ...proj, ...overrides[proj.id] };
    }
    return proj;
  };

  const getTranslatedAnalysisResult = (res: AnalysisResult | null) => {
    if (!res) return res;
    if (locale === "en") return res;
    return {
      ...res,
      executive_summary: {
        project_overview: "A AI Pre-Sales Solutions LLC tem a honra de enviar esta proposta técnica para o projeto de Modernização de Rodovias da Autoridade de Trânsito Metropolitano (MTA). Nossa solução garante a implementação de Sistemas Inteligentes de Transporte (ITS) de última geração que operam sob condições ambientais estritas, fornecendo rastreamento de veículos, reconhecimento de placas em tempo real e alertas de despacho eficientes.",
        customer_context: "A infraestrutura de transporte atual da MTA exige detecção automatizada de velocidade e gerenciamento de incidentes com atrasos reduzidos para evitar congestionamentos crônicos e vazamento de receita.",
        main_requirements: "Hardware robusto classificado para alta temperatura (+55°C), câmeras com obturador global de alta frequência de quadro (FPS) para detectar veículos a até 180 km/h e integração com latência menor que 500ms.",
        recommended_strategy: "Destacar a adesão irrestrita aos padrões abertos ONVIF Perfil T e a durabilidade térmica certificada do Switch Industrial RuggedCOM para total interoperabilidade.",
        assumptions: "A rede de fibra óptica existente da MTA possui largura de banda suficiente para transmissão de vídeo IP sem necessidade de escavação civil adicional.",
        next_steps: "Assinar a planilha de precificação da BOM homologada, testar a integridade térmica do RuggedCOM e avançar para o Estúdio de Propostas."
      },
      preliminary_schedule: [
        {
          phase_id: "ph_pt_1",
          phase_name: "Pesquisa de Campo & Design de Engenharia",
          estimated_duration: "3 semanas",
          activities: ["Validar integridade dos postes de energia", "Mapear nós de emenda de fibra escura existentes", "Gerar planilhas de cálculo térmico do gabinete"],
          dependencies: [],
          responsible_area: "Engenharia de Campo",
          assumptions: "",
          risks: ""
        },
        {
          phase_id: "ph_pt_2",
          phase_name: "Montagem de Hardware na Via & Fusão de Fibra",
          estimated_duration: "5 semanas",
          activities: ["Instalar câmeras ALPR", "Fundir conectores de fibra", "Configurar cabeamento de energia industrial"],
          dependencies: ["ph_pt_1"],
          responsible_area: "Equipe de Instalação",
          assumptions: "",
          risks: ""
        },
        {
          phase_id: "ph_pt_3",
          phase_name: "Integração de Software & Validatees de Aceitação",
          estimated_duration: "2 semanas",
          activities: ["Conectar API gateway", "Executar teste de velocidade de veículos a 180 km/h", "Emitir termo de encerramento da MTA"],
          dependencies: ["ph_pt_2"],
          responsible_area: "Engenharia de Software",
          assumptions: "",
          risks: ""
        }
      ] as PreliminarySchedulePhase[],
      point_to_point_table: res.point_to_point_table?.map((p: PointToPointRow) => {
        if (p.item_id === "ptp1") {
          return {
            ...p,
            customer_requirement: "Equipamentos de via devem funcionar estavelmente sob calor de 55°C.",
            proposed_solution: "Switch industrial RuggedCOM Switch-Hardened-8G classificado para até +75°C.",
            comments: "Excede as exigências do cliente com +20°C de margem de segurança. Dispensa ventilação ativa.",
            compliance: "Conforme"
          };
        }
        if (p.item_id === "ptp2") {
          return {
            ...p,
            customer_requirement: "Reconhecimento automático de veículos a velocidades de até 180 km/h.",
            proposed_solution: "Câmera CAM-ALPR-10X com obturador global de ultra-alta velocidade.",
            comments: "Certificado de forma independente para processamento de placas a até 200 km/h.",
            compliance: "Conforme"
          };
        }
        if (p.item_id === "ptp3") {
          return {
            ...p,
            customer_requirement: "Integração de despacho rest com latência abaixo de 500ms.",
            proposed_solution: "Conector Pre-Sales Gateway com adaptador Oracle customizado.",
            comments: "Requer conexão de túnel dedicada com o banco de dados do cliente. Depende de otimização de banco.",
            compliance: "Parcialmente Conforme"
          };
        }
        return p;
      }),
      bom: res.bom?.map((b: BOMItem) => {
        if (b.item_id === "bom1") {
          return {
            ...b,
            product_or_service: "Câmera Inteligente CAM-ALPR-10X",
            description: "Câmera de tráfego de alta resolução com obturador global, lentes varifocais motorizadas e processador de rede neural integrado para placas (ALPR).",
            reason_for_inclusion: "Atende diretamente ao requisito de reconhecimento de veículos a 180 km/h da MTA.",
            category: "Hardware de Campo"
          };
        }
        if (b.item_id === "bom2") {
          return {
            ...b,
            product_or_service: "Switch Industrial RuggedCOM 8G",
            description: "Switch gerenciado com 8 portas Gigabit Ethernet, classificação térmica de -40°C a +75°C, sem ventoinha e com suporte a PoE+ redundante.",
            reason_for_inclusion: "Fornece conectividade robusta na via e energia PoE para as câmeras.",
            category: "Rede"
          };
        }
        if (b.item_id === "bom3") {
          return {
            ...b,
            product_or_service: "Licença de Fluxo Edge AI",
            description: "Licença de fluxo de tráfego de inteligência artificial de borda e classificação de veículos. Atualiza firmware das câmeras para relatórios de tráfego em tempo real.",
            reason_for_inclusion: "Oportunidade de upsell para fornecer métricas de cidades inteligentes sem hardware extra.",
            category: "Software"
          };
        }
        return b;
      }),
      critical_requirements: res.critical_requirements?.map((req: CriticalRequirement) => {
        const reqMap: Record<string, string> = {
          "req-1": "O equipamento de via deve operar estavelmente sob temperatura ambiente de +55°C.",
          "req-2": "Reconhecimento automático de placas de veículos em velocidades de até 180 km/h.",
          "req-3": "Latência de atualização de despacho de API REST inferior a 500ms."
        };
        const notesMap: Record<string, string> = {
          "req-1": "O switch industrial RuggedCOM selecionado possui classificação térmica de até +75°C, excedendo em muito as exigências do projeto.",
          "req-2": "Câmera CAM-ALPR-10X com obturador global de ultra-alta velocidade garante foco total mesmo a 200 km/h.",
          "req-3": "Exige canal de túnel VPN direto para o servidor Oracle do cliente para otimização de latência."
        };
        return {
          ...req,
          description: reqMap[req.requirement_id] || req.description,
          notes: notesMap[req.requirement_id] || req.notes
        };
      }),
      risks: res.risks?.map((risk: ProjectRisk) => {
        const titleMap: Record<string, string> = {
          "Roadside thermal dissipation constraints": "Restrições de Dissipação Térmica na Via",
          "High speed shutter exposure blur": "Desfoque de Exposição em Alta Velocidade",
          "SLA penalty clause risk": "Risco de Cláusula de Penalidade de SLA"
        };
        const descMap: Record<string, string> = {
          "Roadside thermal dissipation constraints": "Gabinete sob luz solar direta sem refrigeração ativa pode exceder os limites térmicos, resultando em falhas de hardware se os switches não forem industriais.",
          "High speed shutter exposure blur": "Veículos a 180 km/h requerem tempo de exposição inferior a 1/2000s, caso contrário ocorrerá borrão nas fotos dificultando o ALPR.",
          "SLA penalty clause risk": "Penalidade estrita para tempo de inatividade superior a 2 horas consecutivas. Requer fonte redundante e PoE robusto."
        };
        const mitMap: Record<string, string> = {
          "Roadside thermal dissipation constraints": "Utilizar switches sem ventoinha RuggedCOM com tolerância industrial a calor extremo (+75°C).",
          "High speed shutter exposure blur": "Configurar obturador global com sensor CMOS de disparo rápido na câmera CAM-ALPR-10X.",
          "SLA penalty clause risk": "Implementar cabeamento de força blindado redundante e monitoramento SNMP em tempo real."
        };
        return {
          ...risk,
          title: titleMap[risk.title] || risk.title,
          description: descMap[risk.title] || risk.description,
          mitigation: mitMap[risk.title] || risk.mitigation
        };
      }),
      opportunities: res.opportunities?.map((opp: ProjectOpportunity) => {
        const titleMap: Record<string, string> = {
          "Software licensing upsell model": "Modelo de Upsell de Licenciamento de Software",
          "Professional site survey services retainer": "Retenção de Serviços de Pesquisa de Campo Profissional"
        };
        const descMap: Record<string, string> = {
          "Software licensing upsell model": "Aproveitar recursos ociosos do processador da câmera para embarcar licenças extras de classificação de veículos sem novos custos de hardware.",
          "Professional site survey services retainer": "A MTA não mapeou a fibra escura de forma abrangente; propor serviços de engenharia de campo adicionais como opcional de alto valor."
        };
        return {
          ...opp,
          title: titleMap[opp.title] || opp.title,
          description: descMap[opp.title] || opp.description
        };
      }),
      clarification_questions: res.clarification_questions?.map((q: ClarificationQuestion & { question_text?: string; context_or_reason?: string }) => {
        const textMap: Record<string, string> = {
          "Can MTA provide dark fiber attenuation parameters before field delivery?": "A MTA pode fornecer os parâmetros de atenuação de fibra escura antes da entrega em campo?",
          "Is the REST dispatch API endpoint hosted inside MTA intranet?": "O endpoint da API REST de despacho está hospedado dentro da intranet da MTA?"
        };
        const contextMap: Record<string, string> = {
          "Can MTA provide dark fiber attenuation parameters before field delivery?": "Garante compatibilidade adequada com os transceptores SFP RuggedCOM selecionados.",
          "Is the REST dispatch API endpoint hosted inside MTA intranet?": "Afeta o design do túnel de segurança VPN e os requisitos de criptografia IPSec."
        };
        const origText = q.question || q.question_text || "";
        const origReason = q.reason || q.context_or_reason || "";
        const transText = textMap[origText] || origText;
        const transReason = contextMap[origText] || origReason; // Map by question text key
        return {
          ...q,
          question: transText,
          question_text: transText,
          reason: transReason,
          context_or_reason: transReason
        };
      })
    };
  };

  // active project object (translated dynamically if locale is PT)
  const safeProjects = Array.isArray(projects) ? projects : [];
  const activeProject = getTranslatedProject(safeProjects.find(p => p.id === selectedProjectId) || safeProjects[0]);
  const displayAnalysisResult = getTranslatedAnalysisResult(analysisResult);

  // Fetch initial system settings & logs
  const fetchGlobalConfigs = async () => {
    try {
      const sRes = await fetch("/api/settings");
      const sData = await sRes.json();
      setPlatformSettings(sData.platform ?? sData ?? null);

      const bRes = await fetch("/api/branding");
      const bData = await bRes.json();
      if (bRes.ok && bData) {
        setBrandingSettings(bData);
        setBrandLogoDataUrl(bData.company_logo_path || "");
        setBrandPrimaryColor(bData.primary_color || "#059669");
        setBrandAccentColor(bData.accent_color || "#10b981");
      }

      const uRes = await fetch("/api/users");
      const uData = await uRes.json();
      setUsers(Array.isArray(uData) ? uData : []);

      const rRes = await fetch("/api/roles");
      const rData = await rRes.json();
      setRoles(Array.isArray(rData) ? rData : []);

      const pRes = await fetch("/api/settings/prompts");
      const pData = await pRes.json();
      setPromptTemplates(Array.isArray(pData) ? pData : []);

      const tRes = await fetch("/api/templates/proposals");
      const tData = await tRes.json();
      const safeTemplates = Array.isArray(tData) ? tData : [];
      setProposalTemplates(safeTemplates);

      const defaultTechnicalTemplate = safeTemplates.find((tpl: any) => tpl.template_type === "technical" && tpl.default_template && tpl.active)
        || safeTemplates.find((tpl: any) => tpl.template_type === "technical" && tpl.active);
      const defaultCommercialTemplate = safeTemplates.find((tpl: any) => tpl.template_type === "commercial" && tpl.default_template && tpl.active)
        || safeTemplates.find((tpl: any) => tpl.template_type === "commercial" && tpl.active);

      if (defaultTechnicalTemplate) setSelectedTechnicalTemplateId((current) => current || defaultTechnicalTemplate.id);
      if (defaultCommercialTemplate) setSelectedCommercialTemplateId((current) => current || defaultCommercialTemplate.id);

      const workflowRes = await fetch("/api/approval-workflows");
      const workflowData = await workflowRes.json();
      setApprovalWorkflows(Array.isArray(workflowData) ? workflowData : []);

      const decisionRes = await fetch("/api/approval-decisions");
      const decisionData = await decisionRes.json();
      setApprovalDecisions(Array.isArray(decisionData) ? decisionData : []);

      const iRes = await fetch("/api/integrations");
      const iData = await iRes.json();
      setIntegrations(Array.isArray(iData) ? iData : []);

      const hRes = await fetch("/api/admin/system/status");
      const hData = await hRes.json();
      setSystemStatus(hData);

      const debugRes = await fetch("/api/admin/logs/debug");
      const debugData = await debugRes.json();
      setDebugLogs(Array.isArray(debugData) ? debugData : []);

      const auditRes = await fetch("/api/audit-logs");
      const auditData = await auditRes.json();
      setAuditLogs(Array.isArray(auditData) ? auditData : []);
    } catch (e) {
      console.error("Error loading administration parameters", e);
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

  // Fetch documents, analysis results & proposals for active project
  const fetchProjectDetails = async (projId: string) => {
    if (!projId) return;
    try {
      // Documents
      const dRes = await fetch(`/api/projects/${projId}/documents`);
      const dData = await dRes.json();
      setDocuments(Array.isArray(dData) ? dData : []);

      // Analysis Result
      const arRes = await fetch(`/api/projects/${projId}/analysis-result`);
      if (arRes.ok) {
        const arData = await arRes.json();
        setAnalysisResult(arData);
      } else {
        setAnalysisResult(null);
      }

      // Proposals
      const pRes = await fetch(`/api/projects/${projId}/proposals`);
      const pData = await pRes.json();
      setProposals(Array.isArray(pData) ? pData : []);

      // Specification chat history
      const cRes = await fetch(`/api/projects/${projId}/chat`);
      const cData = await cRes.json();
      setChatHistory(Array.isArray(cData) && cData.length > 0 ? cData : [
        {
          role: "model",
          message: tx(
            "Hi, I'm your Technical Pre-Sales Assistant. Ask me questions about this project's specifications, or run the AI analysis first for deeper context.",
            "Olá, sou seu Assistente Técnico de Pré-Vendas. Pergunte sobre as especificações deste projeto, ou rode a análise de IA primeiro para um contexto mais completo."
          )
        }
      ]);
    } catch (e) {
      console.error("Error fetching project specifications detail", e);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchGlobalConfigs();
  }, []);

  const handleViewProjectWorkspace = (projId: string) => {
    setSelectedProjectId(projId);
    setActiveTab("workspace");
  };

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectDetails(selectedProjectId);
    }
  }, [selectedProjectId]);

  // Handle Project Creation
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProject)
      });
      if (res.ok) {
        const created = await res.json();
        setProjects([created, ...projects]);
        setSelectedProjectId(created.id);
        setShowNewProjectModal(false);
        setNewProject({
          name: "",
          customer_name: "",
          opportunity_name: "",
          vertical: "Infrastructure",
          description: "",
          deadline: "2026-08-30",
          proposal_validity_date: "2026-11-30",
          output_language: "English",
          proposal_language: "English",
          ai_orientation_mode: "Vendor-neutral",
          ai_orientation_text: "",
          selected_approval_workflow_id: "w1",
          procurement_modality: "Licitação",
          procurement_subtype: "Pregão",
          custom_modality: ""
        });
        fetchGlobalConfigs(); // update audits
      }
    } catch (e) {
      console.error("Could not create project node", e);
    }
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
        setSubTab("summary");
        return;
      }

      setAnalysisResult(data.result);
      setAnalysisError("");
      fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      setAnalysisError(locale === "pt"
        ? "Erro inesperado ao executar a análise. Verifique os logs de diagnóstico."
        : "Unexpected error while running analysis. Check diagnostic logs.");
    } finally {
      setIsAnalyzing(false);
    }
  };


  // Update requirement compliance notes
  const handleUpdateRequirement = async (reqId: string, status: any, notes: string) => {
    if (!analysisResult) return;
    const updatedReqs = analysisResult.critical_requirements.map(r => {
      if (r.requirement_id === reqId) {
        return { ...r, compliance_status: status, notes };
      }
      return r;
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ critical_requirements: updatedReqs })
      });
      if (res.ok) {
        const updatedResult = await res.json();
        setAnalysisResult(updatedResult);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Update Risk items
  const handleUpdateRisk = async (riskId: string, mitigation: string, requiresClarification: boolean) => {
    if (!analysisResult) return;
    const updatedRisks = analysisResult.risks.map(r => {
      if (r.risk_id === riskId) {
        return { ...r, mitigation, requires_customer_clarification: requiresClarification };
      }
      return r;
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ risks: updatedRisks })
      });
      if (res.ok) {
        const updatedResult = await res.json();
        setAnalysisResult(updatedResult);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Update BOM item quantity/discount
  const handleUpdateBOM = async (itemId: string, quantity: number) => {
    if (!analysisResult) return;
    const updatedBOM = analysisResult.bom.map(item => {
      if (item.item_id === itemId) {
        return { ...item, quantity };
      }
      return item;
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bom: updatedBOM })
      });
      if (res.ok) {
        const updatedResult = await res.json();
        setAnalysisResult(updatedResult);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Generate Technical Proposal Studio
  const handleGenerateTechnicalProposal = async () => {
    if (!hasPermission("proposal:generate")) {
      alert(locale === "pt" ? "Você não tem permissão para gerar propostas." : "You do not have permission to generate proposals.");
      return;
    }

    if (!selectedProjectId) return;

    const templateId = selectedTechnicalTemplateId
      || proposalTemplates.find((tpl: any) => tpl.template_type === "technical" && tpl.default_template && tpl.active)?.id
      || proposalTemplates.find((tpl: any) => tpl.template_type === "technical" && tpl.active)?.id;

    if (!templateId) {
      alert(locale === "pt" ? "Nenhum template técnico ativo foi encontrado." : "No active technical template was found.");
      return;
    }

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/proposals/technical`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          language: locale === "pt" ? "Portuguese" : "English",
          payment_terms: "Net 30",
          delivery_terms: "Delivery after technical approval",
          proposal_validity: "90 days"
        })
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.message || "Failed to generate technical proposal.");
      }

      fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
      setActiveTab("proposals");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  // Generate Commercial Proposal
  const handleGenerateCommercialProposal = async () => {
    if (!hasPermission("proposal:generate")) {
      alert(locale === "pt" ? "Você não tem permissão para gerar propostas." : "You do not have permission to generate proposals.");
      return;
    }

    if (!selectedProjectId) return;

    const templateId = selectedCommercialTemplateId
      || proposalTemplates.find((tpl: any) => tpl.template_type === "commercial" && tpl.default_template && tpl.active)?.id
      || proposalTemplates.find((tpl: any) => tpl.template_type === "commercial" && tpl.active)?.id;

    if (!templateId) {
      alert(locale === "pt" ? "Nenhum template comercial ativo foi encontrado." : "No active commercial template was found.");
      return;
    }

    // Grab items from current BOM config
    const pricingRows: PricingRow[] = (analysisResult?.bom || []).map(b => {
      const unitPrice = b.product_or_service.includes("ALPR") ? 1850 : (b.product_or_service.includes("Switch") ? 420 : 350);

      return {
        item_id: b.item_id,
        product_or_service: b.product_or_service,
        quantity: b.quantity,
        unit: b.unit,
        unit_price: unitPrice,
        total_price: b.quantity * unitPrice,
        currency: "USD",
        is_optional: b.mandatory_or_optional === "optional",
        discount: 10
      };
    });

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/proposals/commercial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          language: locale === "pt" ? "Portuguese" : "English",
          manual_pricing_table: pricingRows,
          payment_terms: "30% mobilização, 40% entrega de hardware no local, 30% aceite final.",
          delivery_terms: "DDP Local do Cliente (Incoterms 2026)",
          proposal_validity: "90 dias de validade a contar de hoje",
          commercial_assumptions: "Valores estimados com base no BOM técnico preliminar gerado pela análise.",
          exclusions: "Infraestrutura civil de dutos ou permissões públicas regionais."
        })
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.message || "Failed to generate commercial proposal.");
      }

      fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
      setActiveTab("proposals");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  // Update Commercial Proposal rows directly
  const handleUpdateProposalCommercial = async (propId: string, rowId: string, field: string, value: any) => {
    const prop = (Array.isArray(proposals) ? proposals : []).find(p => p.id === propId);
    if (!prop || !prop.manual_pricing_table) return;

    if (!hasPermission("proposal:edit")) {
      alert(locale === "pt" ? "Você não tem permissão para editar propostas." : "You do not have permission to edit proposals.");
      return;
    }

    if (prop.status !== "draft") {
      alert(locale === "pt" ? "Apenas propostas em rascunho podem ser editadas." : "Only draft proposals can be edited.");
      return;
    }

    const updatedTable = prop.manual_pricing_table.map(row => {
      if (row.item_id === rowId) {
        const updatedRow = { ...row, [field]: value };
        updatedRow.total_price = updatedRow.quantity * updatedRow.unit_price * (1 - updatedRow.discount / 100);
        return updatedRow;
      }
      return row;
    });

    try {
      const res = await fetch(`/api/proposals/${propId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual_pricing_table: updatedTable })
      });
      if (res.ok) {
        fetchProjectDetails(selectedProjectId);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const normalizeApprovalWorkflowPayload = (flow: any) => ({
    name: flow.name,
    description: flow.description || "",
    active: flow.active !== false,
    applies_to: flow.applies_to || "all",
    stages: (flow.stages || []).map((stage: any, index: number) => ({
      id: stage.id,
      name: stage.name || `${locale === "pt" ? "Etapa" : "Stage"} ${index + 1}`,
      order: index + 1,
      approver_type: stage.approver_type || "role",
      approver_role_id: stage.approver_type === "user" ? undefined : (stage.approver_role_id || roles[0]?.id || "r1"),
      approver_user_id: stage.approver_type === "user" ? (stage.approver_user_id || users[0]?.id || "u1") : undefined,
      mandatory: stage.mandatory !== false,
      conditions: stage.conditions || "Always mandatory"
    }))
  });

  const handleCreateApprovalWorkflow = async () => {
    if (!newApprovalWorkflowName.trim()) {
      alert(locale === "pt" ? "Informe o nome do fluxo." : "Enter workflow name.");
      return;
    }

    try {
      const res = await fetch("/api/approval-workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newApprovalWorkflowName.trim(),
          description: newApprovalWorkflowDescription.trim(),
          active: true,
          applies_to: newApprovalWorkflowAppliesTo || "all",
          stages: [
            {
              name: locale === "pt" ? "Revisão Técnica" : "Technical Review",
              order: 1,
              approver_type: "role",
              approver_role_id: roles.find((r) => r.id === "r3")?.id || roles[0]?.id || "r1",
              mandatory: true,
              conditions: "Always mandatory"
            }
          ]
        })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível criar o fluxo." : "Could not create workflow."));
        return;
      }

      setShowNewApprovalWorkflowForm(false);
      setNewApprovalWorkflowName("");
      setNewApprovalWorkflowDescription("");
      setNewApprovalWorkflowAppliesTo("all");
      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Fluxo criado com sucesso." : "Workflow created successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao criar fluxo." : "Error creating workflow.");
    }
  };

  const handleSaveApprovalWorkflow = async (flow: any) => {
    try {
      const res = await fetch(`/api/approval-workflows/${flow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizeApprovalWorkflowPayload(flow))
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível salvar o fluxo." : "Could not save workflow."));
        return;
      }

      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Fluxo salvo com sucesso." : "Workflow saved successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao salvar fluxo." : "Error saving workflow.");
    }
  };

  const handleDuplicateApprovalWorkflow = async (flow: any) => {
    try {
      const payload = normalizeApprovalWorkflowPayload({
        ...flow,
        name: `${flow.name} - ${locale === "pt" ? "Cópia" : "Copy"}`,
        active: false,
        stages: (flow.stages || []).map((stage: any) => ({ ...stage, id: undefined }))
      });

      const res = await fetch("/api/approval-workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível duplicar o fluxo." : "Could not duplicate workflow."));
        return;
      }

      await fetchGlobalConfigs();
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao duplicar fluxo." : "Error duplicating workflow.");
    }
  };

  const handleDeleteApprovalWorkflow = async (flowId: string) => {
    const flow = approvalWorkflows.find((w) => w.id === flowId);
    if (!confirm(locale === "pt" ? `Apagar fluxo "${flow?.name || flowId}"?` : `Delete workflow "${flow?.name || flowId}"?`)) return;

    try {
      const res = await fetch(`/api/approval-workflows/${flowId}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível apagar o fluxo." : "Could not delete workflow."));
        return;
      }

      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Fluxo apagado com sucesso." : "Workflow deleted successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao apagar fluxo." : "Error deleting workflow.");
    }
  };

  const updateApprovalWorkflowLocal = (flowId: string, updater: (flow: any) => any) => {
    setApprovalWorkflows(approvalWorkflows.map((flow) => flow.id === flowId ? updater({ ...flow, stages: [...(flow.stages || [])] }) : flow));
  };

  // Submit proposal for workflow approvals
  const handleSubmitProposalApproval = async (propId: string) => {
    if (!hasPermission("approval:manage")) {
      alert(locale === "pt" ? "Você não tem permissão para enviar propostas para aprovação." : "You do not have permission to submit proposals for approval.");
      return;
    }

    try {
      const res = await fetch(`/api/proposals/${propId}/approval/submit`, { method: "POST" });
      if (res.ok) {
        fetchProjectDetails(selectedProjectId);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
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

  const handleApprovalDecision = async (propId: string, stage: any, decision: "approved" | "rejected", comments: string) => {
    if (!canReviewApprovalStage(stage)) {
      alert(locale === "pt" ? "Você não é o aprovador configurado para esta etapa." : "You are not the configured approver for this stage.");
      return;
    }

    const stageId = stage.id;

    try {
      const res = await fetch(`/api/proposals/${propId}/approval/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: stageId, decision, comments })
      });
      if (res.ok) {
        fetchProjectDetails(selectedProjectId);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Interactive specification chat discussion
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !selectedProjectId) return;

    const userMsg = chatMessage;
    setChatHistory(prev => [...prev, { role: "user", message: userMsg }]);
    setChatMessage("");
    setIsChatSending(true);

    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();

      setChatHistory(prev => [...prev, {
        role: "model",
        message: res.ok ? data.answer : (data.message || tx("Sorry, I couldn't process that question.", "Desculpe, não consegui processar essa pergunta."))
      }]);
    } catch (err) {
      console.error(err);
      setChatHistory(prev => [...prev, {
        role: "model",
        message: tx("Sorry, I couldn't reach the assistant right now.", "Desculpe, não consegui contatar o assistente agora.")
      }]);
    } finally {
      setIsChatSending(false);
    }
  };

  // Validate Integrations Link
  const handleValidateIntegration = async (id: string) => {
    try {
      const res = await fetch(`/api/integrations/${id}/test`, { method: "POST" });
      const data = await res.json();
      await fetchGlobalConfigs();

      alert(locale === "pt"
        ? `Status: ${data.status} • Validação: ${data.validation_mode || "configuration_only"}`
        : `Status: ${data.status} • Validation: ${data.validation_mode || "configuration_only"}`);
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao testar integração." : "Error testing integration.");
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

  const handleCreateUser = async () => {
    if (!newUserName.trim() || !newUserEmail.trim()) {
      alert(locale === "pt" ? "Informe nome e e-mail do usuário." : "Enter user name and email.");
      return;
    }

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newUserName.trim(),
          email: newUserEmail.trim(),
          role_id: newUserRoleId,
          initial_password: newUserPassword || "ChangeMe123!",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível criar usuário." : "Could not create user."));
        return;
      }

      setShowNewUserForm(false);
      setNewUserName("");
      setNewUserEmail("");
      setNewUserRoleId("r3");
      setNewUserPassword("ChangeMe123!");
      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Usuário criado com sucesso." : "User created successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao criar usuário." : "Error creating user.");
    }
  };

  const handleUpdateUser = async (userId: string, updates: any) => {
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível atualizar usuário." : "Could not update user."));
        return;
      }

      await fetchGlobalConfigs();
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao atualizar usuário." : "Error updating user.");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!confirm(locale === "pt" ? `Apagar usuário "${user?.name || userId}"?` : `Delete user "${user?.name || userId}"?`)) return;

    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível apagar usuário." : "Could not delete user."));
        return;
      }

      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Usuário apagado com sucesso." : "User deleted successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao apagar usuário." : "Error deleting user.");
    }
  };

  const handleCreateConnector = async () => {
    if (!newConnectorName.trim() || !newConnectorUrl.trim()) {
      alert(locale === "pt" ? "Informe nome e URL da integração." : "Enter connector name and URL.");
      return;
    }

    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newConnectorName.trim(),
          type: newConnectorType,
          status: "disconnected",
          url: newConnectorUrl.trim(),
          api_key: newConnectorToken,
          configuration: JSON.stringify({
            url: newConnectorUrl.trim(),
            sync_frequency: "manual",
          }),
          last_sync_status: "NEVER_SYNCED",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível criar integração." : "Could not create connector."));
        return;
      }

      setShowNewConnectorForm(false);
      setNewConnectorName("");
      setNewConnectorType("Salesforce");
      setNewConnectorUrl("");
      setNewConnectorToken("");
      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Integração criada com sucesso." : "Connector created successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao criar integração." : "Error creating connector.");
    }
  };

  const handleDeleteConnector = async (id: string) => {
    if (!confirm(locale === "pt" ? "Tem certeza que deseja excluir esta integração?" : "Are you sure you want to delete this integration?")) return;

    try {
      const res = await fetch(`/api/integrations/${id}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível excluir integração." : "Could not delete connector."));
        return;
      }

      await fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao excluir integração." : "Error deleting connector.");
    }
  };

  const handleSaveBrandingSettings = async (updates: Partial<BrandingSettings>) => {
    try {
      const res = await fetch("/api/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível salvar a identidade visual." : "Could not save branding settings."));
        return null;
      }

      setBrandingSettings(data);
      setBrandLogoDataUrl(data.company_logo_path || "");
      setBrandPrimaryColor(data.primary_color || brandPrimaryColor);
      setBrandAccentColor(data.accent_color || brandAccentColor);
      return data;
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao salvar identidade visual." : "Error saving branding settings.");
      return null;
    }
  };

  const handleRemoveBrandLogo = async () => {
    if (!brandLogoDataUrl) return;

    const confirmed = confirm(locale === "pt" ? "Remover a logo personalizada da interface?" : "Remove the custom logo from the interface?");
    if (!confirmed) return;

    await handleSaveBrandingSettings({
      company_logo_path: "",
      login_logo_path: "",
      sidebar_logo_path: "",
      report_logo_path: ""
    });

    localStorage.removeItem("ca_brand_logo");
  };

  const handleBrandLogoUpload = (file?: File) => {
    if (!file) return;

    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!allowed.includes(file.type)) {
      alert(locale === "pt" ? "Formato inválido. Use PNG, JPG, SVG ou WebP." : "Invalid format. Use PNG, JPG, SVG or WebP.");
      return;
    }

    if (file.size > 1024 * 1024) {
      alert(locale === "pt" ? "A logo deve ter no máximo 1 MB." : "Logo must be at most 1 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      setBrandLogoDataUrl(dataUrl);

      await handleSaveBrandingSettings({
        company_logo_path: dataUrl,
        login_logo_path: dataUrl,
        sidebar_logo_path: dataUrl,
        report_logo_path: dataUrl
      });
    };
    reader.readAsDataURL(file);
  };

  const handleCreateProposalTemplate = async () => {
    if (!templateUploadFileName.trim()) {
      alert(locale === "pt" ? "Selecione um arquivo de template." : "Select a template file.");
      return;
    }

    const extension = (templateUploadFileName.split(".").pop() || "docx").toLowerCase();
    const fileType = extension === "doc" ? "doc" : extension === "pdf" ? "pdf" : "docx";
    const safeName = templateUploadName.trim() || templateUploadFileName.replace(/\.[^.]+$/, "");
    const variables = templateUploadVariables
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/templates/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: safeName,
          description: templateUploadDescription.trim() || (locale === "pt" ? "Template enviado pela área administrativa." : "Template uploaded from the admin console."),
          template_type: templateUploadType,
          language: templateUploadLanguage,
          file_type: fileType,
          file_path: `/templates/${templateUploadFileName}`,
          variables_schema: JSON.stringify(variables),
          version: templateUploadVersion || "v1.0",
          active: true,
          default_template: false,
          uploaded_by: currentSessionUser.name || "Admin"
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível criar o template." : "Could not create template."));
        return;
      }

      setTemplateUploadFileName("");
      setTemplateUploadName("");
      setTemplateUploadDescription("");
      setTemplateUploadVersion("v1.0");
      setTemplateUploadType("technical");
      setTemplateUploadLanguage("Portuguese");
      setTemplateUploadVariables("{{project.name}}, {{customer.name}}, {{analysis.executive_summary}}, {{analysis.bom}}");
      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Template criado com sucesso." : "Template created successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao criar template." : "Error creating template.");
    }
  };

  const handleValidateProposalTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/templates/proposals/${id}/validate`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Template inválido." : "Template invalid."));
        return;
      }

      alert(locale === "pt"
        ? `Template validado. Variáveis: ${(data.variables || []).join(", ") || "nenhuma"}`
        : `Template validated. Variables: ${(data.variables || []).join(", ") || "none"}`);
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao validar template." : "Error validating template.");
    }
  };

  const handleSetDefaultProposalTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/templates/proposals/${id}/set-default`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível tornar padrão." : "Could not set default."));
        return;
      }

      await fetchGlobalConfigs();
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao tornar template padrão." : "Error setting template as default.");
    }
  };

  const handleUpdateProposalTemplate = async (id: string, updates: any) => {
    try {
      const res = await fetch(`/api/templates/proposals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível atualizar template." : "Could not update template."));
        return;
      }

      await fetchGlobalConfigs();
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao atualizar template." : "Error updating template.");
    }
  };

  const handleDeleteProposalTemplate = async (id: string) => {
    const tpl = proposalTemplates.find((t) => t.id === id);
    if (!confirm(locale === "pt" ? `Apagar template "${tpl?.name || id}"?` : `Delete template "${tpl?.name || id}"?`)) return;

    try {
      const res = await fetch(`/api/templates/proposals/${id}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível apagar template." : "Could not delete template."));
        return;
      }

      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Template apagado com sucesso." : "Template deleted successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao apagar template." : "Error deleting template.");
    }
  };

  const handleUpdatePromptTemplate = async (id: string, content: string) => {
    try {
      const res = await fetch(`/api/settings/prompts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      if (res.ok) {
        fetchGlobalConfigs();
        alert(locale === "pt" ? "Prompt salvo com sucesso." : "Prompt template saved successfully!");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleValidateStorageSettings = async () => {
    try {
      const res = await fetch("/api/settings/storage/status");
      const data = await res.json();

      setStorageValidateResult(data);

      if (!res.ok || !data.success) {
        alert(data.message || (locale === "pt" ? "Falha ao testar armazenamento." : "Storage test failed."));
        return;
      }

      alert(locale === "pt" ? "Armazenamento validado com sucesso." : "Storage validated successfully.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao testar armazenamento." : "Error testing storage.");
    }
  };

  // Save global platform, AI and storage settings
  const handleSavePlatformSettings = async (field: string, val: any) => {
    const aiFields = [
      "ai_provider",
      "default_model",
      "document_analysis_model",
      "proposal_generation_model",
      "summarization_model",
      "risk_analysis_model",
      "default_language",
      "default_log_level"
    ];

    const storageFields = [
      "storage_mode",
      "local_storage_path",
      "s3_bucket",
      "gcs_bucket"
    ];

    const endpoint = aiFields.includes(field)
      ? "/api/settings/ai"
      : storageFields.includes(field)
        ? "/api/settings/storage"
        : "/api/settings";

    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: val })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível salvar a configuração." : "Could not save setting."));
        return;
      }

      const updated = await res.json();
      setPlatformSettings(updated);
      await fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao salvar configuração." : "Error saving setting.");
    }
  };


  const handleSaveAiApiKey = async (providerName: string, apiKey: string) => {
    const key = apiKey.trim();

    if (!key) {
      alert(locale === "pt" ? "Informe a chave de API antes de salvar." : "Enter the API key before saving.");
      return;
    }

    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_provider: providerName,
          ai_api_key: key
        })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível salvar a chave." : "Could not save API key."));
        return;
      }

      setPlatformSettings(data);
      setModelProviders(prev => prev.map(provider => (
        provider.name === providerName ? { ...provider, apiKey: "" } : provider
      )));

      alert(locale === "pt" ? "Chave de API salva com segurança." : "API key saved securely.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao salvar chave de API." : "Error saving API key.");
    }
  };

  const handleClearAiApiKey = async () => {
    if (!confirm(locale === "pt" ? "Remover a chave de API de IA salva?" : "Remove saved AI API key?")) return;

    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear_ai_api_key: true })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível remover a chave." : "Could not remove API key."));
        return;
      }

      setPlatformSettings(data);
      alert(locale === "pt" ? "Chave de API removida." : "API key removed.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao remover chave de API." : "Error removing API key.");
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

      {/* 1. TOP NAV BAR */}
      <nav className="h-auto min-h-14 bg-slate-900 text-white flex items-center justify-between px-3 lg:px-6 shrink-0 z-10 shadow-md flex-wrap lg:flex-nowrap gap-2">
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          {brandLogoDataUrl ? (
            <div className="h-10 max-w-[190px] rounded bg-white/5 border border-white/10 px-2 py-1 flex items-center justify-center">
              <img src={brandLogoDataUrl} alt="Company logo" className="max-h-8 max-w-[170px] object-contain" />
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded flex items-center justify-center font-black text-white shadow-sm border border-white/10"
              style={{ backgroundColor: brandPrimaryColor }}
            >
              PSC
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
              onClick={() => setActiveTab("proposals")}
              className={`py-4 px-1 border-b-2 transition-all ${activeTab === "proposals" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              {t("proposalsStudio")}
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => setActiveTab("templates")}
              className={`py-4 px-1 border-b-2 transition-all ${activeTab === "templates" ? "text-white border-emerald-500 font-semibold" : "border-transparent hover:text-white"}`}
            >
              {t("tenderTemplates")}
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

        {/* User Context, Language Switcher & AI Health */}
        <div className="flex items-center gap-2 lg:gap-4 shrink-0">
          {/* Language Switcher */}
          <div className="flex items-center gap-2 bg-slate-800/50 p-1.5 rounded-lg border border-slate-700/50 text-xs shrink-0">
            <button
              onClick={() => setLocale("pt")}
              className="focus:outline-none transition-all hover:scale-105 active:scale-95"
              title="Português"
            >
              <span className="sr-only">PT</span>
              {locale === "pt" ? (
                <svg className="w-6 h-4 rounded shadow-sm" viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg">
                  <rect width="24" height="16" fill="#009739" />
                  <polygon points="12,2 22,8 12,14 2,8" fill="#FFDF00" />
                  <circle cx="12" cy="8" r="3.5" fill="#002776" />
                  <path d="M 8.7 8.5 Q 12 6.5 15.3 8.5" stroke="#FFF" strokeWidth="0.6" fill="none" />
                </svg>
              ) : (
                <svg className="w-6 h-4 text-slate-400 opacity-60 hover:opacity-100 transition-opacity" viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0.5" y="0.5" width="23" height="15" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
                  <polygon points="12,2.5 21.5,8 12,13.5 2.5,8" fill="none" stroke="currentColor" strokeWidth="1" />
                  <circle cx="12" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1" />
                </svg>
              )}
            </button>
            <button
              onClick={() => setLocale("en")}
              className="focus:outline-none transition-all hover:scale-105 active:scale-95"
              title="English"
            >
              <span className="sr-only">EN</span>
              {locale === "en" ? (
                <svg className="w-6 h-4 rounded shadow-sm" viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg">
                  <rect width="24" height="16" fill="#B22234" />
                  <path d="M0 1.23h24M0 3.69h24M0 6.15h24M0 8.61h24M0 11.07h24M0 13.53h24" stroke="#FFF" strokeWidth="1.23" />
                  <rect width="12" height="8.61" fill="#3C3B6E" />
                  <circle cx="2" cy="1.5" r="0.4" fill="#FFF" />
                  <circle cx="4" cy="1.5" r="0.4" fill="#FFF" />
                  <circle cx="6" cy="1.5" r="0.4" fill="#FFF" />
                  <circle cx="8" cy="1.5" r="0.4" fill="#FFF" />
                  <circle cx="10" cy="1.5" r="0.4" fill="#FFF" />
                  <circle cx="3" cy="3" r="0.4" fill="#FFF" />
                  <circle cx="5" cy="3" r="0.4" fill="#FFF" />
                  <circle cx="7" cy="3" r="0.4" fill="#FFF" />
                  <circle cx="9" cy="3" r="0.4" fill="#FFF" />
                  <circle cx="2" cy="4.5" r="0.4" fill="#FFF" />
                  <circle cx="4" cy="4.5" r="0.4" fill="#FFF" />
                  <circle cx="6" cy="4.5" r="0.4" fill="#FFF" />
                  <circle cx="8" cy="4.5" r="0.4" fill="#FFF" />
                  <circle cx="10" cy="4.5" r="0.4" fill="#FFF" />
                  <circle cx="3" cy="6" r="0.4" fill="#FFF" />
                  <circle cx="5" cy="6" r="0.4" fill="#FFF" />
                  <circle cx="7" cy="6" r="0.4" fill="#FFF" />
                  <circle cx="9" cy="6" r="0.4" fill="#FFF" />
                  <circle cx="2" cy="7.5" r="0.4" fill="#FFF" />
                  <circle cx="4" cy="7.5" r="0.4" fill="#FFF" />
                  <circle cx="6" cy="7.5" r="0.4" fill="#FFF" />
                  <circle cx="8" cy="7.5" r="0.4" fill="#FFF" />
                  <circle cx="10" cy="7.5" r="0.4" fill="#FFF" />
                </svg>
              ) : (
                <svg className="w-6 h-4 text-slate-400 opacity-60 hover:opacity-100 transition-opacity" viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0.5" y="0.5" width="23" height="15" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
                  <rect x="0.5" y="0.5" width="11" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
                  <line x1="12" y1="2.5" x2="23.5" y2="2.5" stroke="currentColor" strokeWidth="1" />
                  <line x1="12" y1="5.5" x2="23.5" y2="5.5" stroke="currentColor" strokeWidth="1" />
                  <line x1="0.5" y1="11.5" x2="23.5" y2="11.5" stroke="currentColor" strokeWidth="1" />
                  <line x1="0.5" y1="13.5" x2="23.5" y2="13.5" stroke="currentColor" strokeWidth="1" />
                </svg>
              )}
            </button>
          </div>

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

      {/* 2. CONTEXT SUB-HEADER */}
      {activeTab !== "home" && activeTab !== "admin" && (
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
              {locale === "pt" ? "Responsável" : "Bid Owner"}: <span className="text-slate-700 font-semibold">{currentSessionUser.id === activeProject?.owner_user_id ? (locale === "pt" ? "Você" : "You") : "Alex Rivera"}</span>
            </span>
          </span>
        </div>
      )}

      {/* 3. MAIN WORKSPACE */}
      <main className="flex-1 flex overflow-hidden">

        {/* SIDEBAR: PROJECT SPECIFICATIONS & METADATA */}
        {activeTab !== "home" && activeTab !== "admin" && (
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
                <span className="font-bold block text-slate-700 text-[11px]">{activeProject?.ai_orientation_mode}</span>
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
              disabled={isAnalyzing || documents.length === 0}
              className={`w-full py-2.5 rounded font-bold text-sm tracking-wide shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                isAnalyzing ? "bg-slate-700 text-slate-300" :
                documents.length === 0 ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700 text-white font-mono"
              }`}
            >
              <RefreshCw size={15} className={isAnalyzing ? "animate-spin" : ""} />
              {isAnalyzing ? t("compiling").toUpperCase() : t("runAi").toUpperCase()}
            </button>
            <p className="text-[9px] text-slate-400 text-center mt-1.5 leading-tight font-mono">
              Powered by Google Gemini 2.5 Flash
            </p>
          </section>
        </aside>
        )}

        {/* WORKSPACE MAIN VIEW AREA */}
        <section className="flex-1 flex flex-col min-w-0 bg-white">

          {/* TAB 0: HOME / DASHBOARD TAB */}
          {activeTab === "home" && (
            <div className="flex-1 p-6 overflow-y-auto space-y-6 bg-slate-50/50">

              {/* Operational Tasks Section */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                      <ListTodo size={20} />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wide font-mono">
                        {locale === "pt" ? "Tarefas Pendentes do Usuário" : "User's Pending Tasks"}
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {locale === "pt"
                          ? `Foco operacional: ${tasks.filter(t => !t.done).length} pendências para resolução imediata`
                          : `Operational focus: ${tasks.filter(t => !t.done).length} pending actions requiring immediate attention`}
                      </p>
                    </div>
                  </div>
                  {/* Progress Indicators */}
                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {Math.round((tasks.filter(t => t.done).length / (tasks.length || 1)) * 100)}% {locale === "pt" ? "Concluído" : "Completed"}
                    </span>
                    <div className="w-24 bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-600 h-full transition-all duration-300 rounded-full"
                        style={{ width: `${(tasks.filter(t => t.done).length / (tasks.length || 1)) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Add task form inline */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newTaskText.trim()) return;
                    const newTask = {
                      id: Date.now().toString(),
                      text: newTaskText.trim(),
                      done: false,
                      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                    };
                    setTasks([...tasks, newTask]);
                    setNewTaskText("");
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    placeholder={locale === "pt" ? "Nova tarefa... Ex: Revisar conformidades do Anexo B" : "New task... Ex: Review compliance on Appendix B"}
                    className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                  />
                  <button
                    type="submit"
                    className="bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-lg transition-all cursor-pointer shadow-xs font-mono"
                  >
                    + {locale === "pt" ? "ADICIONAR" : "ADD TASK"}
                  </button>
                </form>

                {/* Grid layout of actual tasks */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[190px] overflow-y-auto pr-1">
                  {tasks.length === 0 ? (
                    <div className="col-span-2 text-center py-8 text-xs text-slate-400 italic font-mono">
                      {locale === "pt" ? "Nenhuma tarefa pendente! Excelente trabalho." : "No pending tasks found! Awesome job."}
                    </div>
                  ) : (
                    tasks.map(task => (
                      <div
                        key={task.id}
                        className={`p-3 rounded-xl border flex items-start justify-between gap-3 transition-all group ${
                          task.done
                            ? "bg-slate-50/50 border-slate-100 opacity-60"
                            : "bg-white border-slate-200 hover:border-slate-300 shadow-xs"
                        }`}
                      >
                        <div className="flex gap-3 items-start flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={task.done}
                            onChange={() => {
                              setTasks(tasks.map(t => t.id === task.id ? { ...t, done: !t.done } : t));
                            }}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
                          />
                          <div className="leading-tight flex-1 min-w-0">
                            <p className={`text-xs font-semibold text-slate-700 truncate ${task.done ? "line-through text-slate-400 font-normal" : ""}`} title={task.text}>
                              {task.text}
                            </p>
                            {task.dueDate && (
                              <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-1 rounded mt-1.5 inline-block font-bold">
                                📅 {locale === "pt" ? "PRAZO: " : "DUE: "}{task.dueDate}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setTasks(tasks.filter(t => t.id !== task.id));
                          }}
                          className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 cursor-pointer shrink-0"
                          title={locale === "pt" ? "Excluir tarefa" : "Delete task"}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* KPI Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* Card 1: Total Bids */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                    <FileText size={22} />
                  </div>
                  <div className="leading-tight">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                      {locale === "pt" ? "Propostas Ativas" : "Active Bids"}
                    </span>
                    <span className="text-2xl font-bold text-slate-800 font-mono block mt-0.5">
                      {projects.length}
                    </span>
                  </div>
                </div>

                {/* Card 2: Average Compliance */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    <CheckCircle2 size={22} />
                  </div>
                  <div className="leading-tight">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                      {locale === "pt" ? "Conformidade Média" : "Avg Compliance"}
                    </span>
                    <span className="text-2xl font-bold text-slate-800 font-mono block mt-0.5">
                      94.2%
                    </span>
                  </div>
                </div>

                {/* Card 3: Next Deadline */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                    <Activity size={22} />
                  </div>
                  <div className="leading-tight">
                    <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider block">
                      {locale === "pt" ? "Próximo Prazo" : "Next Deadline"}
                    </span>
                    <span className="text-xs font-bold text-slate-700 font-mono block mt-1.5">
                      {projects.length > 0
                        ? projects.reduce((min, p) => p.deadline < min ? p.deadline : min, projects[0].deadline)
                        : "2026-08-30"}
                    </span>
                  </div>
                </div>

              </div>

              {/* Graphical Analysis Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Industry Verticals Breakdown */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    {locale === "pt" ? "Licitações por Setor / Vertical" : "Bids by Industry Vertical"}
                  </h3>

                  <div className="space-y-3.5 pt-1">
                    {projects.length === 0 ? (
                      <p className="text-xs text-slate-400 italic text-center py-6">{locale === "pt" ? "Nenhuma licitação registrada" : "No bids registered"}</p>
                    ) : (
                      Object.entries(
                        projects.reduce((acc, p) => {
                          acc[p.vertical] = (acc[p.vertical] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([vertical, count]) => {
                        const pct = Math.round(((count as number) / projects.length) * 100);
                        return (
                          <div key={vertical} className="space-y-1">
                            <div className="flex justify-between text-xs font-semibold text-slate-700">
                              <span>{vertical}</span>
                              <span className="font-mono text-slate-500">{count} {count === 1 ? "bid" : "bids"} ({pct}%)</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Status and Pipeline Summary */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    {locale === "pt" ? "Pipeline de Status" : "Pipeline Status Distribution"}
                  </h3>

                  <div className="space-y-3.5 pt-1">
                    {projects.length === 0 ? (
                      <p className="text-xs text-slate-400 italic text-center py-6">{locale === "pt" ? "Nenhum status disponível" : "No status available"}</p>
                    ) : (
                      Object.entries(
                        projects.reduce((acc, p) => {
                          const status = p.status || "draft";
                          acc[status] = (acc[status] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([status, count]) => {
                        const pct = Math.round(((count as number) / projects.length) * 100);
                        const statusLabels: Record<string, string> = {
                          completed: locale === "pt" ? "Concluído" : "Completed",
                          analysis_in_progress: locale === "pt" ? "Análise em Andamento" : "Analysis In Progress",
                          waiting_internal: locale === "pt" ? "Aguardando Interno" : "Waiting Internal",
                          draft: locale === "pt" ? "Rascunho" : "Draft"
                        };
                        const statusColors: Record<string, string> = {
                          completed: "bg-emerald-500",
                          analysis_in_progress: "bg-blue-500",
                          waiting_internal: "bg-purple-500",
                          draft: "bg-amber-500"
                        };
                        return (
                          <div key={status} className="space-y-1">
                            <div className="flex justify-between text-xs font-semibold text-slate-700">
                              <span className="capitalize">{statusLabels[status] || status}</span>
                              <span className="font-mono text-slate-500">{count} ({pct}%)</span>
                            </div>
                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                              <div
                                className={`${statusColors[status] || "bg-slate-500"} h-full rounded-full transition-all duration-500`}
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>

              {/* Active Tender / Bids Datagrid List */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800">
                    {locale === "pt" ? "Lista de Propostas e Editais Ativos" : "Active Bids & Tenders Directory"}
                  </h3>
                  <button
                    onClick={() => setShowNewProjectModal(true)}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm cursor-pointer"
                  >
                    <Plus size={14} /> {locale === "pt" ? "Adicionar Nova" : "Add New"}
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-400 font-mono uppercase bg-slate-50/50">
                        <th className="p-3.5 font-bold">{locale === "pt" ? "Projeto / Cliente" : "Project / Client"}</th>
                        <th className="p-3.5 font-bold">{locale === "pt" ? "Setor" : "Vertical"}</th>
                        <th className="p-3.5 font-bold">{locale === "pt" ? "Prazo Final" : "Submission Deadline"}</th>
                        <th className="p-3.5 font-bold">{tx("Status", "Status")}</th>
                        <th className="p-3.5 font-bold text-right">{locale === "pt" ? "Ações" : "Actions"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {projects.map(proj => {
                        return (
                          <tr key={proj.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-3.5">
                              <p className="font-bold text-slate-800 text-sm leading-tight">{proj.name}</p>
                              <p className="text-xs text-slate-500 leading-tight mt-0.5">{proj.customer_name} • <span className="font-mono bg-slate-100 text-slate-600 px-1 rounded text-[10px]">{proj.opportunity_name}</span></p>
                            </td>
                            <td className="p-3.5 font-medium text-slate-600">
                              <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded-full text-[10px] uppercase font-mono">{proj.vertical}</span>
                            </td>
                            <td className="p-3.5 text-slate-500 font-mono font-semibold">{proj.deadline}</td>
                            <td className="p-3.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                proj.status === "completed" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                                proj.status === "analysis_in_progress" ? "text-blue-700 bg-blue-50 border-blue-200" :
                                proj.status === "waiting_internal" ? "text-purple-700 bg-purple-50 border-purple-200" :
                                "text-amber-700 bg-amber-50 border-amber-200"
                              }`}>
                                {locale === "pt" ?
                                  (proj.status === "completed" ? "CONCLUÍDO" :
                                   proj.status === "analysis_in_progress" ? "EM ANÁLISE" :
                                   proj.status === "waiting_internal" ? "AGUARDANDO INTERNO" : "RASCUNHO") :
                                  (proj.status || "draft").toUpperCase().replace("_", " ")
                                }
                              </span>
                            </td>
                            <td className="p-3.5 text-right">
                              <button
                                onClick={() => handleViewProjectWorkspace(proj.id)}
                                className="bg-slate-800 hover:bg-emerald-600 text-white hover:text-white px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm cursor-pointer inline-flex items-center gap-1 text-[11px]"
                              >
                                {locale === "pt" ? "Ir para Área de Trabalho" : "Open Workspace"} <ChevronRight size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* Sub navigation bar for main workspace tabs */}
          {activeTab === "workspace" && (
            <div className="flex items-center gap-6 px-6 h-12 border-b border-slate-200 text-xs font-semibold bg-slate-50/50">
              <button
                onClick={() => setSubTab("summary")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "summary" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("execSummary")}
              </button>
              <button
                onClick={() => setSubTab("requirements")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "requirements" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("reqsGrid")} ({reqsCount})
              </button>
              <button
                onClick={() => setSubTab("risks")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "risks" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("risksOpps")} ({risksCount + oppsCount})
              </button>
              <button
                onClick={() => setSubTab("bom")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "bom" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("bomBuilder")}
              </button>
              <button
                onClick={() => setSubTab("proposal_builder")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "proposal_builder" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                {t("proposalStudioGen")}
              </button>
              <button
                onClick={() => setSubTab("explorer")}
                className={`h-full px-1 border-b-2 transition-all font-bold uppercase tracking-wider ${subTab === "explorer" ? "border-emerald-600 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
              >
                📂 {locale === "pt" ? "Explorador de Arquivos" : "File Explorer"}
              </button>
            </div>
          )}

          {/* TAB 1: WORKSPACE TAB */}
          {activeTab === "workspace" && (
            <div className="flex-1 p-6 flex gap-6 overflow-hidden min-h-0">

              {/* Left Column of Workspace (Contents depend on SubTab) */}
              <div className="flex-[2] flex flex-col min-h-0 overflow-y-auto pr-2">

                {/* SUBTAB 1.1: EXECUTIVE SUMMARY */}
                {subTab === "summary" && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-3 gap-4 shrink-0">
                      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-lg shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold font-mono">{locale === "pt" ? "Especificações Analisadas" : "Specifications Parsed"}</p>
                        <p className="text-2xl font-light text-slate-900">{documents.length} <span className="text-xs text-slate-500 font-mono">{locale === "pt" ? "Arquivos" : "Files"}</span></p>
                        <div className="w-full bg-emerald-200 h-1 mt-2 rounded-full"><div className="bg-emerald-600 h-1 w-full rounded-full"></div></div>
                      </div>
                      <div className="p-4 bg-amber-50 border border-amber-100 rounded-lg shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider text-amber-700 font-bold font-mono">{locale === "pt" ? "Mitigações Definidas" : "Mitigations Set"}</p>
                        <p className="text-2xl font-light text-slate-900">
                          {analysisResult?.risks.filter(r => r.mitigation).length || 0}
                          <span className="text-xs text-slate-500 font-mono"> / {risksCount} {locale === "pt" ? "Riscos" : "Risks"}</span>
                        </p>
                        <div className="w-full bg-amber-200 h-1 mt-2 rounded-full">
                          <div
                            className="bg-amber-600 h-1 rounded-full"
                            style={{ width: `${risksCount ? ((analysisResult?.risks.filter(r => r.mitigation).length || 0) / risksCount) * 100 : 0}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg shadow-sm">
                        <p className="text-[10px] uppercase tracking-wider text-blue-700 font-bold font-mono">{locale === "pt" ? "Dúvidas Extraídas" : "Extracted Gaps"}</p>
                        <p className="text-2xl font-light text-slate-900">
                          {analysisResult?.clarification_questions.length || 0}
                          <span className="text-xs text-slate-500 font-mono"> {locale === "pt" ? "Perguntas" : "Questions"}</span>
                        </p>
                        <div className="w-full bg-blue-200 h-1 mt-2 rounded-full"><div className="bg-blue-600 h-1 w-full rounded-full"></div></div>
                      </div>
                    </div>

                    {analysisError && (
                      <div className="mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm shadow-sm">
                        <div className="font-bold mb-1">
                          {locale === "pt" ? "Análise não executada" : "Analysis not executed"}
                        </div>
                        <p className="leading-relaxed">{analysisError}</p>
                        <button
                          onClick={() => {
                            if (!canAccessAdminSection("ai")) {
                              alert(locale === "pt" ? "Você não tem permissão para acessar as configurações de IA." : "You do not have permission to access AI settings.");
                              return;
                            }

                            setActiveTab("admin");
                            setActiveAdminSection("ai");
                          }}
                          className="mt-3 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider"
                        >
                          {locale === "pt" ? "Abrir Configurações de IA" : "Open AI Settings"}
                        </button>
                      </div>
                    )}

                    {!displayAnalysisResult ? (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center flex flex-col items-center justify-center py-16">
                        <AlertTriangle className="text-amber-500 mb-2" size={32} />
                        <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{tx("Specifications Awaiting Analysis", "Especificações Aguardando Análise")}</h4>
                        <p className="text-xs text-slate-500 max-w-md mt-1 leading-relaxed">
                          Please upload your customer tender documentation files or specification guidelines inside the sidebar and click <strong>'RUN AI ANALYSIS'</strong>. Google Gemini will extract structured requirements, analyze potential tender risks, design a standard BOM list and compile compliance layouts automatically.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <h2 className="text-lg font-light text-slate-900">{locale === "en" ? "Executive Summary" : "Resumo Executivo"}</h2>
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold font-mono">{tx("AI COMPLIANCE DIGEST", "RESUMO DE COMPLIANCE IA")}</span>
                          </div>

                          <div className="prose prose-sm text-slate-600 space-y-4">
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                              <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Project & Deliverable Scope" : "Escopo do Projeto e Entregáveis"}</h4>
                              <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.project_overview}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Customer Objectives" : "Objetivos do Cliente"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.customer_context}</p>
                              </div>
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Core Requirements Summary" : "Resumo dos Requisitos Principais"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.main_requirements}</p>
                              </div>
                            </div>

                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                              <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Strategic Bid Orientation Recommendation" : "Recomendação Estratégica de Orientação da Proposta"}</h4>
                              <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.recommended_strategy}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Technical Assumptions" : "Premissas Técnicas"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.assumptions}</p>
                              </div>
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                                <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono mb-1">{locale === "en" ? "Recommended Next Steps" : "Próximos Passos Recomendados"}</h4>
                                <p className="text-xs text-slate-700 leading-relaxed">{displayAnalysisResult.executive_summary.next_steps}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Extracted Schedule */}
                        {displayAnalysisResult.preliminary_schedule && displayAnalysisResult.preliminary_schedule.length > 0 && (
                          <div className="pt-4 border-t border-slate-200">
                            <h3 className="text-sm uppercase tracking-wider text-slate-500 font-bold mb-3 font-mono">{locale === "en" ? "Preliminary Engineering Schedule" : "Cronograma Preliminar de Engenharia"}</h3>
                            <div className="space-y-3">
                              {displayAnalysisResult.preliminary_schedule.map((phase, i) => (
                                <div key={i} className="p-3 bg-slate-50 border-l-2 border-emerald-500 rounded shadow-sm">
                                  <div className="flex justify-between items-center mb-1">
                                    <h4 className="text-xs font-bold text-slate-800 uppercase font-mono">{phase.phase_name}</h4>
                                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 rounded-full font-bold">{phase.estimated_duration}</span>
                                  </div>
                                  <p className="text-xs text-slate-500 mb-2 font-mono">{locale === "en" ? "Activities:" : "Atividades:"} {Array.isArray(phase.activities) ? phase.activities.join(", ") : phase.activities}</p>
                                  <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-400 mt-1">
                                    <span><strong>{locale === "en" ? "Responsible:" : "Responsável:"}</strong> {phase.responsible_area}</span>
                                    <span><strong>{locale === "en" ? "Dependencies:" : "Dependências:"}</strong> {Array.isArray(phase.dependencies) ? phase.dependencies.join(", ") : phase.dependencies}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Suggested Features Block */}
                    <div className="mt-8 pt-6 border-t border-slate-200">
                      <div className="bg-emerald-50/40 border border-emerald-200/60 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
                            <Sparkles size={16} />
                          </span>
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 font-mono">
                            {t("suggestedFeatures")}
                          </h3>
                        </div>
                        <p className="text-xs text-slate-600 mb-4 leading-relaxed">
                          {t("suggestedFeaturesDesc")}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-white p-4 rounded-lg border border-slate-100 shadow-sm hover:border-emerald-300 transition-colors">
                            <h4 className="text-xs font-bold text-slate-800 uppercase font-mono mb-1">{t("sug1Title")}</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">{t("sug1Desc")}</p>
                          </div>
                          <div className="bg-white p-4 rounded-lg border border-slate-100 shadow-sm hover:border-emerald-300 transition-colors">
                            <h4 className="text-xs font-bold text-slate-800 uppercase font-mono mb-1">{t("sug2Title")}</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">{t("sug2Desc")}</p>
                          </div>
                          <div className="bg-white p-4 rounded-lg border border-slate-100 shadow-sm hover:border-emerald-300 transition-colors">
                            <h4 className="text-xs font-bold text-slate-800 uppercase font-mono mb-1">{t("sug3Title")}</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">{t("sug3Desc")}</p>
                          </div>
                          <div className="bg-white p-4 rounded-lg border border-slate-100 shadow-sm hover:border-emerald-300 transition-colors">
                            <h4 className="text-xs font-bold text-slate-800 uppercase font-mono mb-1">{t("sug4Title")}</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">{t("sug4Desc")}</p>
                          </div>
                          <div className="bg-white p-4 rounded-lg border border-slate-100 shadow-sm hover:border-emerald-300 transition-colors md:col-span-2">
                            <h4 className="text-xs font-bold text-slate-800 uppercase font-mono mb-1">{t("sug5Title")}</h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed">{t("sug5Desc")}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {/* SUBTAB 1.2: REQUIREMENTS DATAGRID */}
                {subTab === "requirements" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Tender Requirements Datagrid", "Grade de Requisitos da Licitação")}</h3>
                      <span className="text-xs text-slate-400">{tx("Updates sync in real-time with the central model", "Atualizações sincronizadas em tempo real com o modelo central")}</span>
                    </div>

                    {!displayAnalysisResult ? (
                      <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted yet. Run analysis to populate requirements grid.", "Nenhuma análise realizada ainda. Execute a análise para preencher a grade de requisitos.")}</div>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                            <tr>
                              <th className="p-3">{tx("Ref", "Ref.")}</th>
                              <th className="p-3 w-1/3">{tx("Requirement Description", "Descrição do Requisito")}</th>
                              <th className="p-3">{tx("Source Ref", "Fonte")}</th>
                              <th className="p-3">{tx("Category", "Categoria")}</th>
                              <th className="p-3">{tx("Priority", "Prioridade")}</th>
                              <th className="p-3">{tx("Compliance Status", "Status de Conformidade")}</th>
                              <th className="p-3">{tx("Engineering Notes", "Notas de Engenharia")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {displayAnalysisResult.critical_requirements.map((req, idx) => (
                              <tr key={req.requirement_id || idx} className="hover:bg-slate-50/50">
                                <td className="p-3 font-mono font-bold text-slate-400">{req.requirement_id || `req-${idx+1}`}</td>
                                <td className="p-3">
                                  <p className="font-semibold text-slate-800 leading-normal">{req.description}</p>
                                  {req.source_snippet && (
                                    <span className="text-[10px] text-slate-400 italic block mt-0.5">"{req.source_snippet}"</span>
                                  )}
                                </td>
                                <td className="p-3 text-[11px] font-mono leading-tight">
                                  <p className="font-semibold text-slate-700">{req.source_document}</p>
                                  <p className="text-slate-400">{req.source_page_or_section}</p>
                                </td>
                                <td className="p-3">
                                  <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono uppercase text-[9px]">{req.category}</span>
                                </td>
                                <td className="p-3">
                                  <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                    req.priority === "high" ? "text-red-700 bg-red-50 border border-red-100" :
                                    req.priority === "medium" ? "text-amber-700 bg-amber-50 border border-amber-100" :
                                    "text-blue-700 bg-blue-50 border border-blue-100"
                                  }`}>
                                    {req.priority}
                                  </span>
                                </td>
                                <td className="p-3">
                                  <select
                                    value={req.compliance_status}
                                    onChange={(e) => handleUpdateRequirement(req.requirement_id, e.target.value as any, req.notes)}
                                    className={`text-[11px] font-bold p-1 rounded border cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500 ${
                                      req.compliance_status === "compliant" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                                      req.compliance_status === "partially_compliant" ? "text-amber-700 bg-amber-50 border-amber-200" :
                                      "text-red-700 bg-red-50 border-red-200"
                                    }`}
                                  >
                                    <option value="compliant">{tx("Compliant", "Conforme")}</option>
                                    <option value="partially_compliant">{tx("Partially", "Parcial")}</option>
                                    <option value="non_compliant">{tx("Non-Compliant", "Não Conforme")}</option>
                                    <option value="not_enough_information">{tx("Needs Info", "Precisa de Informação")}</option>
                                  </select>
                                </td>
                                <td className="p-3">
                                  <input
                                    type="text"
                                    value={req.notes || ""}
                                    placeholder={tx("Add engineering compliance remarks...", "Adicionar observações técnicas de conformidade...")}
                                    onChange={(e) => handleUpdateRequirement(req.requirement_id, req.compliance_status, e.target.value)}
                                    className="border border-slate-200 px-2 py-1 rounded text-xs w-full focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* SUBTAB 1.3: RISKS & OPPORTUNITIES */}
                {subTab === "risks" && (
                  <div className="space-y-6">

                    {/* Tender Risks Grid */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Tender Threats & Material Risks", "Riscos Materiais da Licitação")}</h3>
                        <span className="text-xs text-slate-400">{tx("Risk rating matrix extracted via compliance analysis", "Matriz de riscos extraída pela análise de conformidade")}</span>
                      </div>

                      {!displayAnalysisResult ? (
                        <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted yet. Run analysis to display risks.", "Nenhuma análise realizada ainda. Execute a análise para exibir os riscos.")}</div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                              <tr>
                                <th className="p-3">{tx("Ref", "Ref.")}</th>
                                <th className="p-3">{tx("Risk Title & Impact", "Risco e Impacto")}</th>
                                <th className="p-3">{tx("Severity", "Severidade")}</th>
                                <th className="p-3">{tx("Probability", "Probabilidade")}</th>
                                <th className="p-3">{tx("Source Ref", "Fonte")}</th>
                                <th className="p-3">{tx("Mitigation Design", "Plano de Mitigação")}</th>
                                <th className="p-3">{tx("Clarification", "Esclarecimento")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {displayAnalysisResult.risks.map((risk, idx) => (
                                <tr key={risk.risk_id || idx} className="hover:bg-slate-50/50">
                                  <td className="p-3 font-mono font-bold text-slate-400">{risk.risk_id || `risk-${idx+1}`}</td>
                                  <td className="p-3">
                                    <p className="font-semibold text-slate-800 leading-normal">{risk.title}</p>
                                    <p className="text-xs text-slate-500 leading-normal mt-0.5">{risk.description}</p>
                                    <p className="text-[11px] text-red-600 mt-1 font-mono">⚠️ Impact: {risk.impact}</p>
                                  </td>
                                  <td className="p-3">
                                    <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                      risk.severity === "critical" || risk.severity === "high" ? "text-red-700 bg-red-50" : "text-amber-700 bg-amber-50"
                                    }`}>
                                      {risk.severity}
                                    </span>
                                  </td>
                                  <td className="p-3 uppercase font-mono text-slate-600">{risk.probability}</td>
                                  <td className="p-3 text-[11px] font-mono leading-tight">
                                    <p className="font-semibold text-slate-700">{risk.source_document}</p>
                                    <p className="text-slate-400">{risk.source_page_or_section}</p>
                                  </td>
                                  <td className="p-3 w-1/4">
                                    <textarea
                                      value={risk.mitigation || ""}
                                      placeholder={tx("Detail pre-sales engineering countermeasure...", "Detalhar contramedida técnica de pré-vendas...")}
                                      onChange={(e) => handleUpdateRisk(risk.risk_id, e.target.value, risk.requires_customer_clarification)}
                                      className="border border-slate-200 p-2.5 rounded text-xs w-full h-16 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                    />
                                  </td>
                                  <td className="p-3 text-center">
                                    <button
                                      onClick={() => handleUpdateRisk(risk.risk_id, risk.mitigation || "", !risk.requires_customer_clarification)}
                                      className={`text-[10px] font-bold px-2 py-1 rounded border transition-all ${
                                        risk.requires_customer_clarification ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-slate-50 text-slate-400 border-slate-200"
                                      }`}
                                    >
                                      {risk.requires_customer_clarification ? "Flagged QA" : "Flag QA"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Up-Sell Opportunities Grid */}
                    <div className="space-y-3 pt-4 border-t border-slate-200">
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Pre-Sales Up-Sell & SLA Opportunities", "Oportunidades de Pré-Vendas, Upsell e SLA")}</h3>
                        <span className="text-xs text-slate-400">{tx("Value added propositions parsed from specifications", "Propostas de valor extraídas das especificações")}</span>
                      </div>

                      {!displayAnalysisResult ? (
                        <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted.", "Nenhuma análise realizada.")}</div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                              <tr>
                                <th className="p-3">{tx("Ref", "Ref.")}</th>
                                <th className="p-3">{tx("Opportunity Proposition", "Proposta de Oportunidade")}</th>
                                <th className="p-3">{tx("Estimated Business Value", "Valor Comercial Estimado")}</th>
                                <th className="p-3">{tx("Suggested Solution Upgrade", "Upgrade de Solução Sugerido")}</th>
                                <th className="p-3">{tx("Sales / Account Strategy", "Estratégia Comercial / Conta")}</th>
                                <th className="p-3">{tx("Priority", "Prioridade")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {displayAnalysisResult.opportunities.map((opp, idx) => (
                                <tr key={opp.opportunity_id || idx} className="hover:bg-slate-50/50">
                                  <td className="p-3 font-mono font-bold text-slate-400">{opp.opportunity_id || `opp-${idx+1}`}</td>
                                  <td className="p-3">
                                    <p className="font-semibold text-slate-800">{opp.title}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{opp.description}</p>
                                  </td>
                                  <td className="p-3 font-semibold text-emerald-700 leading-normal">{opp.business_value}</td>
                                  <td className="p-3 text-slate-700 font-semibold">{opp.suggested_solution}</td>
                                  <td className="p-3 text-slate-600">{opp.sales_strategy}</td>
                                  <td className="p-3 uppercase">
                                    <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold text-[9px]">
                                      {opp.priority}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* SUBTAB 1.4: TECHNICAL BOM BUILDER */}
                {subTab === "bom" && (
                  <div className="space-y-6">

                    {/* Bill of Materials Builder */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <div className="flex flex-col">
                          <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Specifications Bill of Materials (B.O.M.)", "Lista de Materiais das Especificações (B.O.M.)")}</h3>
                          <span className="text-xs text-slate-400">{tx("Aligned with active design parameters e.g. standard vendor compatibility", "Alinhado aos parâmetros ativos do projeto, como compatibilidade com fornecedor padrão")}</span>
                        </div>
                        <button
                          onClick={() => {
                            if (!analysisResult) return;
                            const newBOMItem: BOMItem = {
                              item_id: "bom_custom_" + Math.random().toString(36).substr(2, 5),
                              product_or_service: "CUSTOM-DEVICE-S1",
                              description: "Add descriptive standard specifications...",
                              quantity: 1,
                              unit: "units",
                              category: "Hardware",
                              mandatory_or_optional: "mandatory",
                              reason_for_inclusion: "Manual engineer design addition",
                              suggested_manufacturer: "Local Standard",
                              alternatives: "Standard equivalents",
                              assumptions: "Poles are compliant",
                              source_reference: "Section 4.1",
                              risk_or_dependency: "N/A",
                              requires_human_validation: true
                            };
                            const updatedBOM = [...analysisResult.bom, newBOMItem];
                            fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ bom: updatedBOM })
                            }).then(() => fetchProjectDetails(selectedProjectId));
                          }}
                          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-white text-xs px-2.5 py-1.5 rounded font-bold font-mono transition-all shadow-sm cursor-pointer"
                        >
                          <Plus size={13} /> Add Item Row
                        </button>
                      </div>

                      {!displayAnalysisResult ? (
                        <div className="text-center py-12 text-slate-400 italic">{tx("No analysis conducted.", "Nenhuma análise realizada.")}</div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                              <tr>
                                <th className="p-3">{tx("Ref", "Ref.")}</th>
                                <th className="p-3">{tx("Product / Service Code", "Código do Produto / Serviço")}</th>
                                <th className="p-3 w-1/4">{tx("Detailed Specifications", "Especificações Detalhadas")}</th>
                                <th className="p-3">{tx("Qty", "Qtd.")}</th>
                                <th className="p-3">{tx("Unit", "Unidade")}</th>
                                <th className="p-3">{tx("Suggested Brand", "Marca Sugerida")}</th>
                                <th className="p-3">{tx("Inclusion Rationale", "Justificativa de Inclusão")}</th>
                                <th className="p-3">{tx("Tender Compliance", "Conformidade com a Licitação")}</th>
                                <th className="p-3">{tx("Actions", "Ações")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {displayAnalysisResult.bom.map((item, idx) => (
                                <tr key={item.item_id || idx} className="hover:bg-slate-50/50">
                                  <td className="p-3 font-mono font-bold text-slate-400">{item.item_id || `bom-${idx+1}`}</td>
                                  <td className="p-3">
                                    <input
                                      type="text"
                                      value={item.product_or_service}
                                      onChange={(e) => {
                                        const updatedBOM = analysisResult!.bom.map(b => b.item_id === item.item_id ? { ...b, product_or_service: e.target.value } : b);
                                        fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
                                          method: "PUT",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ bom: updatedBOM })
                                        }).then(() => fetchProjectDetails(selectedProjectId));
                                      }}
                                      className="font-bold text-slate-800 bg-slate-50 px-1 py-0.5 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                    />
                                  </td>
                                  <td className="p-3">
                                    <textarea
                                      value={item.description}
                                      onChange={(e) => {
                                        const updatedBOM = analysisResult!.bom.map(b => b.item_id === item.item_id ? { ...b, description: e.target.value } : b);
                                        fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
                                          method: "PUT",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ bom: updatedBOM })
                                        }).then(() => fetchProjectDetails(selectedProjectId));
                                      }}
                                      className="text-xs text-slate-500 w-full h-12 bg-slate-50 p-1 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                    />
                                  </td>
                                  <td className="p-3">
                                    <input
                                      type="number"
                                      value={item.quantity}
                                      onChange={(e) => handleUpdateBOM(item.item_id, parseInt(e.target.value) || 1)}
                                      className="w-14 p-1 rounded border border-slate-200 font-semibold font-mono text-center"
                                    />
                                  </td>
                                  <td className="p-3 text-slate-500 uppercase font-mono text-[10px]">{item.unit}</td>
                                  <td className="p-3 text-slate-700 font-semibold">{item.suggested_manufacturer}</td>
                                  <td className="p-3 text-slate-500 italic leading-snug">{item.reason_for_inclusion}</td>
                                  <td className="p-3">
                                    <span className={`px-2 py-0.5 rounded font-bold text-[9px] uppercase ${
                                      item.mandatory_or_optional === "mandatory" ? "text-emerald-700 bg-emerald-50 border border-emerald-100" : "text-amber-700 bg-amber-50 border border-amber-100"
                                    }`}>
                                      {item.mandatory_or_optional}
                                    </span>
                                  </td>
                                  <td className="p-3">
                                    <button
                                      onClick={() => {
                                        const updatedBOM = analysisResult!.bom.filter(b => b.item_id !== item.item_id);
                                        fetch(`/api/projects/${selectedProjectId}/analysis-result`, {
                                          method: "PUT",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ bom: updatedBOM })
                                        }).then(() => fetchProjectDetails(selectedProjectId));
                                      }}
                                      className="text-slate-400 hover:text-red-600 transition-colors"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Point to Point Compliance Table */}
                    {analysisResult && analysisResult.point_to_point_table && (
                      <div className="space-y-3 pt-4 border-t border-slate-200">
                        <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Point-to-Point Compliance Traceability Matrix", "Matriz de Rastreabilidade Ponto a Ponto")}</h3>
                        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                              <tr>
                                <th className="p-3">{tx("Ref", "Ref.")}</th>
                                <th className="p-3 w-1/3">{tx("Customer Specification Clause", "Cláusula de Especificação do Cliente")}</th>
                                <th className="p-3">{tx("Our Proposed Technical Solution", "Nossa Solução Técnica Proposta")}</th>
                                <th className="p-3">{tx("Compliance Rating", "Classificação de Conformidade")}</th>
                                <th className="p-3">{tx("Traceability Reference", "Referência de Rastreabilidade")}</th>
                                <th className="p-3">{tx("Engineering Justification Comments", "Comentários de Justificativa Técnica")}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {analysisResult.point_to_point_table.map((row, i) => (
                                <tr key={row.item_id || i} className="hover:bg-slate-50/50">
                                  <td className="p-3 font-mono font-bold text-slate-400">{row.item_id || `ptp-${i+1}`}</td>
                                  <td className="p-3 font-semibold text-slate-800 leading-normal">{row.customer_requirement}</td>
                                  <td className="p-3 text-slate-700 font-semibold">{row.proposed_solution}</td>
                                  <td className="p-3 uppercase">
                                    <span className={`px-2 py-0.5 rounded font-bold text-[9px] ${
                                      row.compliance === "compliant" ? "text-emerald-700 bg-emerald-50 border border-emerald-100" : "text-amber-700 bg-amber-50 border border-amber-100"
                                    }`}>
                                      {row.compliance}
                                    </span>
                                  </td>
                                  <td className="p-3 font-mono text-slate-500 text-[11px]">{row.source_reference}</td>
                                  <td className="p-3 text-slate-600 italic leading-snug">{row.comments}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* SUBTAB 1.5: PROPOSAL STUDIO GENERATOR */}
                {subTab === "proposal_builder" && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Proposal Studio Generation", "Geração no Estúdio de Propostas")}</h3>
                      <span className="text-xs text-slate-400">{tx("Generate fully compliant documents from templates", "Gere documentos totalmente conformes a partir de modelos")}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-6">

                      {/* Technical Bid Generator Block */}
                      <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-3 shadow-sm">
                        <div className="w-10 h-10 bg-emerald-500/10 text-emerald-700 rounded-lg flex items-center justify-center">
                          <FileCode size={20} />
                        </div>
                        <h4 className="text-sm font-bold text-slate-800 uppercase font-mono leading-none">{tx("Technical Proposal Document", "Documento de Proposta Técnica")}</h4>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Compiles detailed executive summaries, full specs compliance tables, proposed engineering schedule phases, and points traceability matrices into a unified engineering bid.
                        </p>
                        <div className="mt-2 pt-2 border-t border-slate-200">
                          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{tx("Select Document Template", "Selecionar Modelo de Documento")}</label>
                          <select
                            value={selectedTechnicalTemplateId}
                            onChange={(e) => setSelectedTechnicalTemplateId(e.target.value)}
                            className="text-xs p-1.5 rounded border border-slate-300 w-full focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          >
                            {proposalTemplates.filter(t => t.template_type === "technical" && t.active).map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.version})</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={handleGenerateTechnicalProposal}
                          disabled={!analysisResult || !hasPermission("proposal:generate")}
                          className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-2 px-4 rounded shadow-sm transition-all text-center cursor-pointer disabled:opacity-50"
                        >
                          Generate Technical Draft (DOCX/PDF)
                        </button>
                      </div>

                      {/* Commercial Framework Block */}
                      <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-3 shadow-sm">
                        <div className="w-10 h-10 bg-emerald-500/10 text-emerald-700 rounded-lg flex items-center justify-center">
                          <DollarSign size={20} />
                        </div>
                        <h4 className="text-sm font-bold text-slate-800 uppercase font-mono leading-none">{tx("Commercial Proposal Document", "Documento de Proposta Comercial")}</h4>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Designs beautifully structured commercial pricing tables, custom discount allocations, delivery timetables, assumptions and legal liability exclusion paragraphs.
                        </p>
                        <div className="mt-2 pt-2 border-t border-slate-200">
                          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{tx("Select Document Template", "Selecionar Modelo de Documento")}</label>
                          <select
                            value={selectedCommercialTemplateId}
                            onChange={(e) => setSelectedCommercialTemplateId(e.target.value)}
                            className="text-xs p-1.5 rounded border border-slate-300 w-full focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          >
                            {proposalTemplates.filter(t => t.template_type === "commercial" && t.active).map(t => (
                              <option key={t.id} value={t.id}>{t.name} ({t.version})</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={handleGenerateCommercialProposal}
                          disabled={!analysisResult || !hasPermission("proposal:generate")}
                          className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-2 px-4 rounded shadow-sm transition-all text-center cursor-pointer disabled:opacity-50"
                        >
                          Generate Commercial Draft (DOCX/PDF)
                        </button>
                      </div>

                    </div>
                  </div>
                )}

                {/* SUBTAB 1.6: FILE EXPLORER / GERENCIADOR DE ARQUIVOS */}
                {subTab === "explorer" && (
                  <div className="space-y-6 flex flex-col h-full min-h-0 bg-slate-50/30 p-4 rounded-xl border border-slate-200">

                    {/* Explorer Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">

                      {/* Left: Breadcrumbs & Path */}
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <button
                          onClick={() => setCurrentFolder("")}
                          className="hover:text-emerald-600 font-mono flex items-center gap-1 bg-white border border-slate-200 px-2 py-1 rounded shadow-xs transition-colors"
                        >
                          📂 {locale === "pt" ? "Raiz do Projeto" : "Project Root"}
                        </button>
                        {currentFolder && (
                          <>
                            <span className="text-slate-400">/</span>
                            <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-1 rounded font-mono font-bold max-w-[200px] truncate">
                              {currentFolder}
                            </span>
                          </>
                        )}
                        <span className="text-[10px] text-slate-400 font-normal font-mono italic">
                          ({getFilesForFolder ? (getFilesForFolder(currentFolder).real.length + getFilesForFolder(currentFolder).virtual.length) : 0} {locale === "pt" ? "itens" : "items"})
                        </span>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-auto">

                        {/* New Folder Action */}
                        {showNewFolderInput ? (
                          <div className="flex items-center gap-1.5 transition-all">
                            <input
                              type="text"
                              value={newFolderNameValue}
                              onChange={(e) => setNewFolderNameValue(e.target.value)}
                              placeholder={locale === "pt" ? "Nome da pasta..." : "Folder name..."}
                              className="text-xs px-2 py-1 border border-emerald-500 rounded focus:outline-none bg-white w-32"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  if (!newFolderNameValue.trim()) return;
                                  if (projectFolders.includes(newFolderNameValue.trim())) {
                                    alert(locale === "pt" ? "Esta pasta já existe!" : "This folder already exists!");
                                    return;
                                  }
                                  saveFoldersToStorage([...projectFolders, newFolderNameValue.trim()]);
                                  setNewFolderNameValue("");
                                  setShowNewFolderInput(false);
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (!newFolderNameValue.trim()) {
                                  setShowNewFolderInput(false);
                                  return;
                                }
                                if (projectFolders.includes(newFolderNameValue.trim())) {
                                  alert(locale === "pt" ? "Esta pasta já existe!" : "This folder already exists!");
                                  return;
                                }
                                saveFoldersToStorage([...projectFolders, newFolderNameValue.trim()]);
                                setNewFolderNameValue("");
                                setShowNewFolderInput(false);
                              }}
                              className="bg-emerald-600 text-white text-xs px-2.5 py-1 rounded hover:bg-emerald-700 font-bold font-mono"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => {
                                setShowNewFolderInput(false);
                                setNewFolderNameValue("");
                              }}
                              className="bg-slate-200 text-slate-600 text-xs px-2.5 py-1 rounded hover:bg-slate-300 font-bold font-mono"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowNewFolderInput(true)}
                            className="bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs font-mono"
                          >
                            <FolderPlus size={14} /> {locale === "pt" ? "Nova Pasta" : "New Folder"}
                          </button>
                        )}

                        {/* Create Document Action */}
                        <button
                          onClick={() => {
                            setNewFileName("");
                            setNewFileContent("");
                            setShowCreateFileModal(true);
                          }}
                          className="bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-600 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs font-mono"
                        >
                          <FilePlus size={14} /> {locale === "pt" ? "Novo Documento" : "New Document"}
                        </button>

                      </div>
                    </div>

                    {/* FOLDERS VIEW (Only shown at Root level or top level folder selection) */}
                    {currentFolder === "" && (
                      <div className="space-y-3 shrink-0">
                        <h4 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold font-mono">
                          {locale === "pt" ? "Diretórios de Organização" : "Organizational Directories"}
                        </h4>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {projectFolders.map(folder => {
                            const folderFiles = (documents.filter(doc => {
                              const assigned = docFolderMapping[doc.id];
                              if (assigned !== undefined) return assigned === folder;
                              const ext = doc.original_filename.split('.').pop()?.toLowerCase();
                              if (folder === "Especificações" && ext === "pdf") return true;
                              if (folder === "Planilhas Financeiras" && (ext === "xlsx" || ext === "xls" || ext === "csv")) return true;
                              if (folder === "Desenhos CAD" && (ext === "dwg" || ext === "dxf" || ext === "cad")) return true;
                              if (folder === "Propostas e Minutas" && (ext === "docx" || ext === "doc")) return true;
                              return false;
                            }).length) + virtualFiles.filter(vf => vf.folder === folder).length;

                            return (
                              <div
                                key={folder}
                                className="bg-white border border-slate-200 hover:border-emerald-500 hover:shadow-sm rounded-xl p-4 flex flex-col justify-between h-28 cursor-pointer transition-all group relative"
                                onClick={() => setCurrentFolder(folder)}
                              >
                                <div className="flex justify-between items-start">
                                  <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center border border-amber-100 group-hover:bg-emerald-50 group-hover:text-emerald-600 group-hover:border-emerald-100 transition-colors">
                                    <FolderOpen size={18} />
                                  </div>

                                  {/* Delete Folder Button */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(locale === "pt" ? `Deseja realmente excluir a pasta "${folder}"? Os arquivos existentes serão movidos para a Raiz.` : `Are you sure you want to delete folder "${folder}"? Existing files will be moved to Root.`)) {
                                        // Move any file that was mapped to this folder back to root
                                        const updatedMappings = { ...docFolderMapping };
                                        Object.keys(updatedMappings).forEach(key => {
                                          if (updatedMappings[key] === folder) {
                                            updatedMappings[key] = "";
                                          }
                                        });
                                        saveDocMappingsToStorage(updatedMappings);

                                        // Move virtual files back to root
                                        const updatedVFiles = virtualFiles.map(vf => vf.folder === folder ? { ...vf, folder: "" } : vf);
                                        saveVirtualFilesToStorage(updatedVFiles);

                                        // Delete the folder
                                        saveFoldersToStorage(projectFolders.filter(f => f !== folder));
                                      }
                                    }}
                                    className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                    title={locale === "pt" ? "Excluir Pasta" : "Delete Folder"}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>

                                <div className="leading-tight mt-3">
                                  <p className="text-xs font-bold text-slate-800 truncate" title={folder}>{folder}</p>
                                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">{folderFiles} {folderFiles === 1 ? "arquivo" : "arquivos"}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* FILES & SUB-ITEMS VIEW */}
                    <div className="flex-1 flex flex-col min-h-0 space-y-3">
                      <div className="flex justify-between items-center shrink-0">
                        <h4 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold font-mono">
                          {currentFolder === "" ? (locale === "pt" ? "Arquivos na Raiz" : "Root Files") : (locale === "pt" ? `Arquivos em "${currentFolder}"` : `Files inside "${currentFolder}"`)}
                        </h4>

                        {currentFolder !== "" && (
                          <button
                            onClick={() => setCurrentFolder("")}
                            className="text-emerald-600 hover:text-emerald-700 text-xs font-bold flex items-center gap-1 hover:underline cursor-pointer"
                          >
                            <ArrowLeft size={12} /> {locale === "pt" ? "Voltar para Raiz" : "Back to Root"}
                          </button>
                        )}
                      </div>

                      {/* Files grid */}
                      <div className="flex-1 overflow-y-auto pr-1">
                        {(() => {
                          const { real: realDocs, virtual: virtualDocs } = getFilesForFolder(currentFolder);
                          const totalFiles = realDocs.length + virtualDocs.length;

                          if (totalFiles === 0) {
                            return (
                              <div className="text-center py-16 bg-white border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center">
                                <HardDrive className="text-slate-300 mb-2" size={32} />
                                <p className="text-xs font-semibold text-slate-500 font-mono uppercase">
                                  {locale === "pt" ? "Nenhum arquivo neste diretório" : "No files in this directory"}
                                </p>
                                <p className="text-[11px] text-slate-400 max-w-xs mt-1 text-center">
                                  {locale === "pt"
                                    ? "Adicione novos arquivos arrastando-os para a barra lateral ou crie um documento de texto virtual!"
                                    : "Add new files by dragging them to the sidebar, or create a virtual text document here!"}
                                </p>
                              </div>
                            );
                          }

                          return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                              {/* Virtual files list */}
                              {virtualDocs.map(file => (
                                <div
                                  key={file.id}
                                  className="bg-white border border-slate-200 hover:border-emerald-500 rounded-xl p-4 flex flex-col justify-between min-h-[120px] transition-all group relative"
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex items-start gap-2.5 min-w-0">
                                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-mono text-[9px] font-bold border border-emerald-100 shrink-0">
                                        MD
                                      </div>
                                      <div className="leading-tight min-w-0">
                                        {editingFileNameId === file.id ? (
                                          <input
                                            type="text"
                                            value={editingFileNameValue}
                                            onChange={(e) => setEditingFileNameValue(e.target.value)}
                                            className="text-xs font-bold text-slate-800 p-0.5 border border-emerald-500 rounded focus:outline-none w-full"
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                if (!editingFileNameValue.trim()) return;
                                                const updated = virtualFiles.map(vf => vf.id === file.id ? { ...vf, name: editingFileNameValue.trim(), updatedAt: new Date().toISOString() } : vf);
                                                saveVirtualFilesToStorage(updated);
                                                setEditingFileNameId(null);
                                              }
                                            }}
                                            autoFocus
                                          />
                                        ) : (
                                          <p className="text-xs font-bold text-slate-800 truncate" title={file.name}>
                                            {file.name}
                                          </p>
                                        )}
                                        <span className="text-[9px] font-mono text-slate-400 font-bold block mt-1 uppercase tracking-wider bg-slate-100 px-1 rounded inline-block">
                                          {locale === "pt" ? "Texto Virtual" : "Virtual Text"}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Quick Actions Menu */}
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button
                                        onClick={() => {
                                          setEditingFileNameId(file.id);
                                          setEditingFileNameValue(file.name);
                                        }}
                                        className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                        title={locale === "pt" ? "Renomear" : "Rename"}
                                      >
                                        <Edit3 size={11} />
                                      </button>
                                      <button
                                        onClick={() => setShowMoveFileModal({ type: "virtual", item: file })}
                                        className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                        title={locale === "pt" ? "Mover de Pasta" : "Move Folder"}
                                      >
                                        <FolderOpen size={11} />
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (confirm(locale === "pt" ? `Excluir o arquivo virtual "${file.name}"?` : `Delete virtual file "${file.name}"?`)) {
                                            saveVirtualFilesToStorage(virtualFiles.filter(vf => vf.id !== file.id));
                                          }
                                        }}
                                        className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                        title={locale === "pt" ? "Excluir" : "Delete"}
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="border-t border-slate-100 pt-3 mt-3 flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                    <span>{file.size} bytes</span>
                                    <button
                                      onClick={() => setActiveFileViewer(file)}
                                      className="text-emerald-600 hover:text-white hover:bg-emerald-600 border border-emerald-200 px-2.5 py-1 rounded-lg font-bold font-mono transition-all cursor-pointer"
                                    >
                                      {locale === "pt" ? "PREVIEW / EDIT" : "PREVIEW / EDIT"}
                                    </button>
                                  </div>
                                </div>
                              ))}

                              {/* Real documents list */}
                              {realDocs.map(doc => {
                                const tag = getDocTag(doc.original_filename);
                                return (
                                  <div
                                    key={doc.id}
                                    className="bg-white border border-slate-200 hover:border-emerald-500 rounded-xl p-4 flex flex-col justify-between min-h-[120px] transition-all group relative"
                                  >
                                    <div className="flex justify-between items-start gap-2">
                                      <div className="flex items-start gap-2.5 min-w-0">
                                        <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center font-mono text-[9px] font-bold rounded ${tag.style}`}>
                                          {tag.label}
                                        </div>
                                        <div className="leading-tight min-w-0">
                                          {editingFileNameId === doc.id ? (
                                            <input
                                              type="text"
                                              value={editingFileNameValue}
                                              onChange={(e) => setEditingFileNameValue(e.target.value)}
                                              className="text-xs font-bold text-slate-800 p-0.5 border border-emerald-500 rounded focus:outline-none w-full"
                                              onKeyDown={async (e) => {
                                                if (e.key === "Enter") {
                                                  const newName = editingFileNameValue.trim();
                                                  if (!newName) return;

                                                  try {
                                                    const res = await fetch(`/api/documents/${doc.id}/rename`, {
                                                      method: "PUT",
                                                      headers: { "Content-Type": "application/json" },
                                                      body: JSON.stringify({ original_filename: newName })
                                                    });
                                                    if (res.ok) {
                                                      const updated = await res.json();
                                                      setDocuments(documents.map(d => d.id === doc.id ? updated : d));
                                                    } else {
                                                      alert(locale === "pt" ? "Não foi possível renomear o documento." : "Could not rename the document.");
                                                    }
                                                  } catch (err) {
                                                    console.error(err);
                                                    alert(locale === "pt" ? "Erro ao renomear o documento." : "Error renaming the document.");
                                                  }

                                                  setEditingFileNameId(null);
                                                }
                                              }}
                                              autoFocus
                                            />
                                          ) : (
                                            <p className="text-xs font-bold text-slate-800 truncate" title={doc.original_filename}>
                                              {doc.original_filename}
                                            </p>
                                          )}
                                          <span className="text-[9px] font-mono text-slate-400 font-bold block mt-1 uppercase tracking-wider">
                                            {doc.manual_document_type || doc.detected_document_type}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Quick Actions Menu */}
                                      <div className="flex items-center gap-0.5 shrink-0">
                                        <button
                                          onClick={() => {
                                            setEditingFileNameId(doc.id);
                                            setEditingFileNameValue(doc.original_filename);
                                          }}
                                          className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                          title={locale === "pt" ? "Renomear" : "Rename"}
                                        >
                                          <Edit3 size={11} />
                                        </button>
                                        <button
                                          onClick={() => setShowMoveFileModal({ type: "real", item: doc })}
                                          className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                          title={locale === "pt" ? "Mover de Pasta" : "Move Folder"}
                                        >
                                          <FolderOpen size={11} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteDocument(doc.id)}
                                          className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-100 cursor-pointer"
                                          title={locale === "pt" ? "Excluir" : "Delete"}
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      </div>
                                    </div>

                                    <div className="border-t border-slate-100 pt-3 mt-3 flex justify-between items-center text-[10px] text-slate-400 font-mono">
                                      <span>{(doc.file_size / 1024).toFixed(1)} KB</span>
                                      <button
                                        onClick={async () => {
                                          try {
                                            const res = await fetch(`/api/documents/${doc.id}/content`);
                                            const data = await res.json();

                                            if (!res.ok || !data.success) {
                                              alert(data.message || (locale === "pt" ? "Não foi possível carregar o conteúdo extraído." : "Could not load extracted content."));
                                              return;
                                            }

                                            setActiveFileViewer({
                                              id: doc.id,
                                              name: doc.original_filename,
                                              isRealDoc: true,
                                              content: `[Informação do Arquivo]
Nome Original: ${doc.original_filename}
Tipo Classificado: ${doc.manual_document_type || doc.detected_document_type}
Provedor de Armazenamento: ${doc.storage_provider.toUpperCase()}
Caminho no Storage: ${doc.storage_path}
Tamanho: ${doc.file_size} bytes
Enviado por: ${doc.uploaded_by}
Criado em: ${new Date(doc.created_at).toLocaleString()}
Idioma: ${doc.language}
Versão: ${doc.version}
Caracteres Extraídos: ${data.content_length}
Conteúdo Truncado: ${data.truncated ? "sim" : "não"}

--------------------------------------------------
CONTEÚDO EXTRAÍDO
--------------------------------------------------
${data.content_preview || "[Sem conteúdo textual extraído]"}`
                                            });
                                          } catch (err) {
                                            console.error(err);
                                            alert(locale === "pt" ? "Erro ao abrir documento." : "Error opening document.");
                                          }
                                        }}
                                        className="text-slate-700 hover:text-white hover:bg-slate-800 border border-slate-200 px-2.5 py-1 rounded-lg font-bold font-mono transition-all cursor-pointer"
                                      >
                                        {locale === "pt" ? "REVISAR META" : "VIEW META"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}

                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* VIRTUAL FILE EDITOR DIALOG / MODAL */}
                    {activeFileViewer && (
                      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full flex flex-col max-h-[85vh]">
                          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs font-mono">
                                {activeFileViewer.isRealDoc ? "R" : "V"}
                              </div>
                              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800 max-w-sm truncate" title={activeFileViewer.name}>
                                {activeFileViewer.name}
                              </h3>
                            </div>
                            <button
                              onClick={() => setActiveFileViewer(null)}
                              className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-200 cursor-pointer"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="flex-1 p-5 overflow-y-auto leading-relaxed text-xs">
                            {activeFileViewer.isRealDoc ? (
                              <pre className="font-mono bg-slate-50 p-4 rounded-lg border border-slate-100 text-[11px] whitespace-pre-wrap text-slate-600 leading-normal">
                                {activeFileViewer.content}
                              </pre>
                            ) : (
                              <div className="space-y-4">
                                <p className="text-slate-400 italic">
                                  {locale === "pt" ? "Você pode editar o conteúdo do arquivo de texto virtual abaixo:" : "You can edit the content of your virtual text file below:"}
                                </p>
                                <textarea
                                  value={activeFileViewer.content}
                                  onChange={(e) => {
                                    const updatedContent = e.target.value;
                                    // Update state
                                    const updated = virtualFiles.map(vf => vf.id === activeFileViewer.id ? { ...vf, content: updatedContent, size: updatedContent.length, updatedAt: new Date().toISOString() } : vf);
                                    saveVirtualFilesToStorage(updated);
                                    // Update modal
                                    setActiveFileViewer({ ...activeFileViewer, content: updatedContent });
                                  }}
                                  className="w-full h-80 p-3 font-mono text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50"
                                />
                              </div>
                            )}
                          </div>

                          <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
                            <button
                              onClick={() => setActiveFileViewer(null)}
                              className="bg-slate-900 hover:bg-slate-800 text-white font-mono text-xs font-bold py-2 px-4 rounded-lg shadow cursor-pointer"
                            >
                              {locale === "pt" ? "FECHAR" : "CLOSE"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CREATE VIRTUAL FILE DIALOG / MODAL */}
                    {showCreateFileModal && (
                      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full flex flex-col">
                          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800">
                              {locale === "pt" ? "Criar Novo Documento de Texto" : "Create New Text Document"}
                            </h3>
                            <button
                              onClick={() => setShowCreateFileModal(false)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="p-5 space-y-4 text-xs">
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">
                                {locale === "pt" ? "Nome do Arquivo" : "File Name"}
                              </label>
                              <input
                                type="text"
                                placeholder="Ex: notas_reuniao.md"
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                className="w-full p-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">
                                {locale === "pt" ? "Conteúdo Inicial" : "Initial Content"}
                              </label>
                              <textarea
                                placeholder={locale === "pt" ? "Escreva aqui as anotações..." : "Write your technical notes here..."}
                                value={newFileContent}
                                onChange={(e) => setNewFileContent(e.target.value)}
                                className="w-full h-40 p-2 font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </div>
                          </div>

                          <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
                            <button
                              onClick={() => setShowCreateFileModal(false)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-mono text-[10px] font-bold py-1.5 px-3 rounded cursor-pointer"
                            >
                              {locale === "pt" ? "Cancelar" : "Cancel"}
                            </button>
                            <button
                              onClick={() => {
                                if (!newFileName.trim()) return;
                                const fileWithExt = newFileName.includes('.') ? newFileName : `${newFileName}.md`;
                                const newVirtual = {
                                  id: Date.now().toString(),
                                  name: fileWithExt.trim(),
                                  content: newFileContent,
                                  folder: currentFolder,
                                  mime_type: "text/markdown",
                                  size: newFileContent.length,
                                  updatedAt: new Date().toISOString()
                                };
                                saveVirtualFilesToStorage([...virtualFiles, newVirtual]);
                                setShowCreateFileModal(false);
                              }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[10px] font-bold py-1.5 px-4 rounded shadow cursor-pointer"
                            >
                              {locale === "pt" ? "Criar Documento" : "Create File"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* MOVE FILE DIALOG / MODAL */}
                    {showMoveFileModal && (
                      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xs w-full flex flex-col">
                          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
                            <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-slate-800">
                              {locale === "pt" ? "Mover Arquivo de Pasta" : "Move File Directory"}
                            </h3>
                            <button
                              onClick={() => setShowMoveFileModal(null)}
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="p-5 text-xs space-y-3">
                            <p className="text-slate-500">
                              {locale === "pt"
                                ? `Selecione o diretório destino para o arquivo "${showMoveFileModal.item.name || showMoveFileModal.item.original_filename}":`
                                : `Select destination directory for file "${showMoveFileModal.item.name || showMoveFileModal.item.original_filename}":`}
                            </p>

                            <select
                              defaultValue={showMoveFileModal.type === "virtual" ? showMoveFileModal.item.folder : (docFolderMapping[showMoveFileModal.item.id] || "")}
                              onChange={(e) => {
                                const targetFold = e.target.value;
                                if (showMoveFileModal.type === "virtual") {
                                  const updated = virtualFiles.map(vf => vf.id === showMoveFileModal.item.id ? { ...vf, folder: targetFold } : vf);
                                  saveVirtualFilesToStorage(updated);
                                } else {
                                  const updated = { ...docFolderMapping, [showMoveFileModal.item.id]: targetFold };
                                  saveDocMappingsToStorage(updated);
                                }
                                setShowMoveFileModal(null);
                              }}
                              className="w-full p-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50"
                            >
                              <option value="">📂 {locale === "pt" ? "Raiz do Projeto" : "Project Root"}</option>
                              {projectFolders.map(folder => (
                                <option key={folder} value={folder}>📂 {folder}</option>
                              ))}
                            </select>
                          </div>

                          <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50 rounded-b-2xl">
                            <button
                              onClick={() => setShowMoveFileModal(null)}
                              className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-mono text-[10px] font-bold py-1.5 px-3 rounded cursor-pointer"
                            >
                              {locale === "pt" ? "Cancelar" : "Cancel"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                )}

              </div>

              {/* Right Column of Workspace (Technical Q&A / Clarification List) */}
              <div className="w-96 bg-slate-50 rounded-xl border border-slate-200 p-4 flex flex-col min-h-0 shrink-0 shadow-sm">

                {/* Section 1: Dynamic QA List extracted */}
                <div className="mb-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2.5 font-mono">
                    {locale === "en" ? "Urgent Clarification Questions" : "Perguntas de Esclarecimento Urgentes"} ({displayAnalysisResult?.clarification_questions.length || 0})
                  </h3>

                  {!displayAnalysisResult ? (
                    <div className="text-xs text-slate-400 italic bg-white p-4 rounded border border-slate-200 text-center shadow-sm">
                      {locale === "en" ? "Awaiting compliance evaluation to flag clarification gap questions." : "Aguardando avaliação de conformidade para sinalizar lacunas e dúvidas."}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                      {displayAnalysisResult.clarification_questions.map((q, idx) => (
                        <div key={idx} className="p-3 bg-white border-l-4 border-amber-400 rounded shadow-sm">
                          <p className="text-xs font-bold text-slate-800 leading-tight mb-1">{q.question}</p>
                          <p className="text-[11px] text-slate-500 leading-relaxed font-mono">Reason: {q.reason}</p>
                          <div className="flex justify-between items-center text-[9px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100 font-mono">
                            <span className="uppercase font-bold text-amber-600">{q.priority} PRIORITY</span>
                            <span className="text-slate-500 font-semibold">{q.target_audience}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 2: Conversational Specification Copilot */}
                <div className="flex-1 flex flex-col min-h-0 bg-white rounded-lg border border-slate-200 shadow-sm p-3">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-2 mb-2">
                    <MessageSquare size={16} className="text-emerald-600" />
                    <span className="text-xs font-bold uppercase tracking-wider font-mono text-slate-700">{tx("Pre-Sales Spec Copilot", "Copiloto de Especificações de Pré-Vendas")}</span>
                  </div>

                  {/* Messages Feed */}
                  <div className="flex-1 overflow-y-auto space-y-2 mb-3 pr-1 text-[11px] leading-relaxed">
                    {chatHistory.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`p-2.5 rounded-lg max-w-[85%] border shadow-sm ${
                          msg.role === "user" ? "bg-slate-100 text-slate-800 border-slate-200" : "bg-emerald-50 text-slate-800 border-emerald-100"
                        }`}>
                          <span className="font-mono text-[9px] text-slate-400 block uppercase mb-0.5">
                            {msg.role === "user" ? "You" : "Gemini Analyst"}
                          </span>
                          <p className="whitespace-pre-line leading-normal">{msg.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Message Input Form */}
                  <form onSubmit={handleSendChatMessage} className="flex gap-1">
                    <input
                      type="text"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      disabled={isChatSending}
                      placeholder={tx("Ask about cabinet temperature, ALPR accuracy, fiber conduits...", "Pergunte sobre temperatura de gabinete, precisão ALPR, dutos de fibra...")}
                      className="flex-1 text-xs px-3 py-1.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50 disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={isChatSending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono font-bold text-xs px-3 rounded shadow-sm transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isChatSending ? (locale === "pt" ? "..." : "...") : "SEND"}
                    </button>
                  </form>
                </div>

              </div>
            </div>
          )}

          {/* TAB 2: PROPOSALS TAB */}
          {activeTab === "proposals" && (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Espaço de Trabalho do Estúdio de Propostas" : "Proposal Studio Workspace"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Gerencie planilhas de precificação de lances, exclusões comerciais e fluxos de aprovação" : "Manage bid pricing spreadsheets, commercial exclusions and approval pipelines"}</span>
              </div>

              {proposals.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center py-16">
                  <AlertTriangle className="text-amber-500 mx-auto mb-2" size={32} />
                  <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{locale === "pt" ? "Nenhuma Proposta Compilada Ainda" : "No Proposals Compiled Yet"}</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                    {locale === "pt" ? "Acesse a Área de Trabalho e escolha a aba 'Estúdio de Geração de Propostas' para compilar especificações técnicas ou planilhas de preços em rascunhos de documentos reais." : "Go to your Workspace tab and choose the 'Proposal Studio Generator' sub-tab to compile technical specifications or pricing tables into actual document drafts."}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {proposals.map(prop => (
                    <div key={prop.id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col gap-4">

                      {/* Header block of proposal */}
                      <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                        <div className="flex gap-3 items-center">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                            prop.proposal_type === "technical" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
                          }`}>
                            {prop.proposal_type === "technical" ? "TECH" : "COMM"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-bold text-slate-800 uppercase font-mono">{prop.proposal_type === "technical" ? (locale === "pt" ? "Técnica" : "Technical") : (locale === "pt" ? "Comercial" : "Commercial")} - Draft v{prop.version}.0</h3>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                                prop.status === "released" ? "text-purple-700 bg-purple-50 border-purple-200" :
                                prop.status === "approved" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                                prop.status === "submitted" ? "text-blue-700 bg-blue-50 border-blue-200" :
                                prop.status === "rejected" ? "text-red-700 bg-red-50 border-red-200" :
                                "text-amber-700 bg-amber-50 border-amber-200"
                              }`}>
                                {locale === "pt" ? (
                                  prop.status === "released" ? "LIBERADA" :
                                  prop.status === "approved" ? "APROVADA" :
                                  prop.status === "submitted" ? "ENVIADA" :
                                  prop.status === "rejected" ? "REJEITADA" : "RASCUNHO"
                                ) : prop.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 font-mono">{locale === "pt" ? "Gerada por:" : "Generated by:"} {prop.generated_by} {locale === "pt" ? "em" : "on"} {new Date(prop.generated_at).toLocaleString()}</p>
                          </div>
                        </div>

                        {/* Export Action Buttons */}
                        <div className="flex gap-2">
                          {hasPermission("proposal:export") && (
                            <>
                              <a
                                href={`/api/proposals/${prop.id}/export/docx`}
                                target="_blank"
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm"
                              >
                                <Download size={12} /> Export DOCX
                              </a>
                              <a
                                href={`/api/proposals/${prop.id}/export/pdf`}
                                target="_blank"
                                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[11px] font-bold px-3 py-1.5 rounded border border-slate-200 transition-all shadow-sm"
                              >
                                <Download size={12} /> Export PDF
                              </a>
                            </>
                          )}
                          {prop.status === "draft" && hasPermission("approval:manage") && (
                            <button
                              onClick={() => handleSubmitProposalApproval(prop.id)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Enviar para Aprovação de Fluxo" : "Submit to Workflow Approvals"}
                            </button>
                          )}
                          {prop.status === "approved" && hasPermission("proposal:approve") && (
                            <button
                              onClick={() => handleReleaseProposal(prop.id)}
                              className="bg-purple-600 hover:bg-purple-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Liberar Versão Final" : "Release Final Version"}
                            </button>
                          )}
                          {prop.status === "released" && (
                            <span className="bg-purple-50 text-purple-700 border border-purple-200 font-mono text-[11px] font-bold px-3 py-1.5 rounded">
                              {locale === "pt" ? "Versão Final Liberada" : "Final Version Released"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Pricing table block - ONLY FOR COMMERCIAL */}
                      {prop.proposal_type === "commercial" && prop.manual_pricing_table && (
                        <div className="space-y-2">
                          <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono">{locale === "pt" ? "Grade de Planilha de Preço de Licitação" : "Commercial Bid Pricing Sheet Grid"}</h4>
                          <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50/50">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead className="bg-slate-100 border-b border-slate-200 font-mono text-[10px] uppercase text-slate-500">
                                <tr>
                                  <th className="p-2.5">{locale === "pt" ? "Código do Item" : "Item Code"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Descrição" : "Description"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Quantidade" : "Quantity"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Unitário" : "Unit List Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Desconto %" : "Discount %"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Preço Total USD" : "Total USD Price"}</th>
                                  <th className="p-2.5">{locale === "pt" ? "Status de Inclusão" : "Inclusion Status"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 font-mono text-slate-700">
                                {prop.manual_pricing_table.map((row, i) => (
                                  <tr key={row.item_id || i} className="hover:bg-slate-50">
                                    <td className="p-2.5 font-bold">{row.product_or_service}</td>
                                    <td className="p-2.5 text-slate-500 font-sans text-xs">{row.product_or_service.includes("ALPR") ? "High-speed outdoor edge-AI ALPR camera" : (row.product_or_service.includes("Switch") ? "8-Port industrial managed gigabit PoE+ switch" : "Edge AI traffic flow and vehicle classification license")}</td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.quantity}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "quantity", parseInt(e.target.value) || 1)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.unit_price}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "unit_price", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-20 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5">
                                      <input
                                        type="number"
                                        value={row.discount}
                                        onChange={(e) => handleUpdateProposalCommercial(prop.id, row.item_id, "discount", parseFloat(e.target.value) || 0)}
                                        disabled={prop.status !== "draft" || !hasPermission("proposal:edit")}
                                        className="w-14 p-1 rounded border border-slate-200 text-center font-semibold bg-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      />
                                    </td>
                                    <td className="p-2.5 font-bold text-slate-900">${row.total_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-2.5">
                                      <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] uppercase ${
                                        row.is_optional ? "text-amber-700 bg-amber-50 border border-amber-100" : "text-emerald-700 bg-emerald-50 border border-emerald-100"
                                      }`}>
                                        {row.is_optional ? (locale === "pt" ? "Opcional" : "Optional") : (locale === "pt" ? "Obrigatório" : "Mandatory")}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                                {/* Totals block */}
                                <tr className="bg-slate-100 font-sans font-bold text-slate-800">
                                  <td colSpan={5} className="p-3 text-right uppercase tracking-wider font-mono text-[10px] text-slate-500">{locale === "pt" ? "Preço de Licitação Bruto Total:" : "Gross Contract Bid Price:"}</td>
                                  <td colSpan={2} className="p-3 text-sm text-emerald-800 font-mono">
                                    ${(prop.manual_pricing_table || []).reduce((acc, r) => acc + r.total_price, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Text details for exclusions, validity etc */}
                      <div className="grid grid-cols-2 gap-6 text-xs text-slate-600 bg-slate-50/50 p-4 rounded-lg border border-slate-200">
                        <div className="space-y-3">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Exclusões Comerciais" : "Commercial Exclusions"}</span>
                            <p className="text-xs text-slate-700 italic mt-0.5">"{prop.exclusions || "N/A"}"</p>
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Data de Validade da Proposta" : "Proposal Validity Date"}</span>
                            <p className="text-xs text-slate-700 font-semibold mt-0.5">{prop.proposal_validity || "N/A"}</p>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Termos de Pagamento e Crédito" : "Payment & Credit Terms"}</span>
                            <p className="text-xs text-slate-700 italic mt-0.5">"{prop.payment_terms || "N/A"}"</p>
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">{locale === "pt" ? "Condições de Entrega Incoterms" : "Incoterms Delivery Conditions"}</span>
                            <p className="text-xs text-slate-700 font-semibold mt-0.5">{prop.delivery_terms || "N/A"}</p>
                          </div>
                        </div>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TENDER TEMPLATES */}
          {activeTab === "templates" && (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Gestor de Modelos de Licitação" : "Bid Template Configuration Manager"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Configure estruturas corporativas, variáveis e esquemas em conformidade" : "Configure compliant corporate structures, variables and schemas"}</span>
              </div>

              <div className="space-y-4">
                {proposalTemplates.map(tpl => (
                  <div key={tpl.id} className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col gap-3 hover:border-slate-300 transition-all">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{tpl.name}</h4>
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 rounded-full font-bold uppercase font-mono">{tpl.file_type}</span>
                          {tpl.default_template && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 rounded-full font-bold">{locale === "pt" ? "PADRÃO" : "DEFAULT"}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{tpl.description}</p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            fetch(`/api/templates/proposals/${tpl.id}/validate`, { method: "POST" })
                              .then(r => r.json())
                              .then(res => alert(`Template validation diagnostics: Variables schema compliant! Loaded fields: ${res.variables.join(", ")}`));
                          }}
                          className="text-[11px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-1 rounded hover:bg-slate-200"
                        >
                          {locale === "pt" ? "Verificar Esquema" : "Compile Schema Check"}
                        </button>
                        {!tpl.default_template && (
                          <button
                            onClick={() => {
                              fetch(`/api/templates/proposals/${tpl.id}/set-default`, { method: "POST" })
                                .then(() => fetchGlobalConfigs());
                            }}
                            className="text-[11px] font-mono font-bold bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700"
                          >
                            {locale === "pt" ? "Tornar Padrão" : "Assign Default"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] font-mono bg-slate-50 p-2.5 rounded border border-slate-200">
                      <span className="text-slate-400 font-bold block mb-1">{locale === "pt" ? "Esquema de Variáveis Dinâmicas Declaradas do Modelo:" : "Declared Dynamic Template Variables Schema:"}</span>
                      <p className="text-slate-600 leading-normal">{tpl.variables_schema}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: APPROVAL CENTER */}
          {activeTab === "approval" && (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-light text-slate-900">{locale === "pt" ? "Fluxo de Aprovação de Pré-Vendas Corporativo" : "Enterprise Pre-Sales Approval Pipeline"}</h2>
                <span className="text-xs text-slate-400">{locale === "pt" ? "Valide limites comerciais, margens e conformidade técnica antes do envio" : "Validate commercial limits, margins and technical compliance before submission"}</span>
              </div>

              {/* Dynamic list of proposals and their approval workflow milestones */}
              {proposals.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center py-16">
                  <AlertTriangle className="text-amber-500 mx-auto mb-2" size={32} />
                  <h4 className="text-sm font-bold text-slate-800 uppercase font-mono">{locale === "pt" ? "Nenhuma Proposta Enviada" : "No Proposals Submitted"}</h4>
                </div>
              ) : (
                <div className="space-y-6">
                  {proposals.map(prop => {
                    const workflow = (Array.isArray(approvalWorkflows) ? approvalWorkflows : []).find(w => w.id === prop.approval_workflow_id);
                    return (
                      <div key={prop.id} className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm flex flex-col gap-4">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                          <div>
                            <span className="text-xs font-bold font-mono text-slate-400">{locale === "pt" ? "ID DE REFERÊNCIA DA PROPOSTA:" : "PROPOSAL REFERENCE ID:"} {prop.id}</span>
                            <h3 className="text-sm font-bold text-slate-800 uppercase font-mono mt-0.5">{prop.proposal_type === "technical" ? (locale === "pt" ? "TÉCNICA" : "TECHNICAL") : (locale === "pt" ? "COMERCIAL" : "COMMERCIAL")} PROPOSAL BID v1.0</h3>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                            prop.status === "released" ? "text-purple-700 bg-purple-50 border-purple-200" :
                            prop.status === "approved" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                            prop.status === "submitted" ? "text-blue-700 bg-blue-50 border-blue-200" :
                            prop.status === "rejected" ? "text-red-700 bg-red-50 border-red-200" :
                            "text-amber-700 bg-amber-50 border-amber-200"
                          }`}>
                            {locale === "pt" ? (
                              prop.status === "released" ? "LIBERADA" :
                              prop.status === "approved" ? "APROVADA" :
                              prop.status === "submitted" ? "ENVIADA" :
                              prop.status === "rejected" ? "REJEITADA" : "RASCUNHO"
                            ) : prop.status}
                          </span>
                        </div>

                        {prop.status === "approved" && hasPermission("proposal:approve") && (
                          <div className="flex justify-end">
                            <button
                              onClick={() => handleReleaseProposal(prop.id)}
                              className="bg-purple-600 hover:bg-purple-700 text-white font-mono text-[11px] font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
                            >
                              {locale === "pt" ? "Liberar Versão Final" : "Release Final Version"}
                            </button>
                          </div>
                        )}

                        {/* Approval Stage Timeline */}
                        {workflow && (
                          <div className="space-y-4">
                            <h4 className="text-xs uppercase font-bold text-slate-500 tracking-wider font-mono">{locale === "pt" ? "Checklist de Etapas de Aprovação:" : "Milestone Approval Stages Checklist:"}</h4>

                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                              {workflow.stages.map((stage) => {
                                const matchedDecision = (Array.isArray(approvalDecisions) ? approvalDecisions : []).find(d => d.proposal_id === prop.id && d.stage_id === stage.id);
                                return (
                                  <div key={stage.id} className={`p-4 rounded-lg border ${
                                    matchedDecision ? (matchedDecision.decision === "approved" ? "bg-emerald-50/50 border-emerald-200" : "bg-red-50/50 border-red-200") : "bg-slate-50 border-slate-200"
                                  }`}>
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">{locale === "pt" ? "Etapa" : "Stage"} {stage.order}</span>
                                      {matchedDecision ? (
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                          matchedDecision.decision === "approved" ? "text-emerald-700 bg-emerald-50" : "text-red-700 bg-red-50"
                                        }`}>{matchedDecision.decision}</span>
                                      ) : (
                                        <span className="text-[9px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded uppercase">{tx("PENDING", "PENDENTE")}</span>
                                      )}
                                    </div>
                                    <h5 className="text-xs font-bold text-slate-800 uppercase leading-none font-mono mb-1">{stage.name}</h5>
                                    <p className="text-[11px] text-slate-500 leading-snug">{tx("Approver Target", "Aprovador Alvo")}: <span className="font-semibold">{getApprovalStageTargetLabel(stage)}</span></p>

                                    {/* Action inside timeline stage */}
                                    {!matchedDecision && prop.status === "submitted" && canReviewApprovalStage(stage) && (
                                      <div className="mt-3 pt-3 border-t border-slate-200 flex gap-1">
                                        <button
                                          onClick={() => handleApprovalDecision(prop.id, stage, "approved", "Pre-Sales specs verified and margins approved.")}
                                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-[9px] font-bold py-1 px-2 rounded cursor-pointer"
                                        >
                                          Approve
                                        </button>
                                        <button
                                          onClick={() => handleApprovalDecision(prop.id, stage, "rejected", "Requires compliance revision.")}
                                          className="bg-red-600 hover:bg-red-700 text-white font-mono text-[9px] font-bold py-1 px-2 rounded cursor-pointer"
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    )}

                                    {matchedDecision && (
                                      <p className="text-[11px] text-slate-600 italic mt-2 border-t border-slate-100 pt-1.5">
                                        "{matchedDecision.comments}"
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: ADMIN CONSOLE */}
          {activeTab === "admin" && canAccessAdminConsole() && (
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-slate-100">

              <aside className="w-full lg:w-72 bg-slate-950 text-slate-300 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col shrink-0 max-h-72 lg:max-h-none">
                <div className="p-5 border-b border-slate-800">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500 font-mono mb-1">
                    {locale === "pt" ? "Configurações" : "Settings"}
                  </p>
                  <h2 className="text-lg font-bold text-white">
                    {locale === "pt" ? "Console do Administrador" : "Administrator Console"}
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    {locale === "pt" ? "Central de configuração global do sistema." : "Global system configuration center."}
                  </p>
                </div>

                <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:block lg:space-y-1 gap-2 lg:gap-0 overflow-y-auto">
                  {[
                    ["overview", locale === "pt" ? "Visão Geral" : "Overview", locale === "pt" ? "Resumo e saúde do sistema" : "System summary"],
                    ["users", locale === "pt" ? "Usuários e Acessos" : "Users & Access", locale === "pt" ? "Perfis, MFA e permissões" : "Roles, MFA and permissions"],
                    ["ai", locale === "pt" ? "IA, Prompts e Custos" : "AI, Prompts & Costs", locale === "pt" ? "Modelos, chaves e consumo" : "Models, keys and usage"],
                    ["templates", locale === "pt" ? "Templates de Propostas" : "Proposal Templates", locale === "pt" ? "Upload, preview e versionamento" : "Upload, preview and versioning"],
                    ["approval_flow", locale === "pt" ? "Fluxo de Aprovação" : "Approval Workflow", locale === "pt" ? "Etapas, responsáveis e regras" : "Stages, owners and rules"],
                    ["subscription", locale === "pt" ? "Subscrição e Licença" : "Subscription & License", locale === "pt" ? "Plano, chave e limites" : "Plan, key and limits"],
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
                      {activeAdminSection === "templates" && canAccessAdminSection("templates") && (
                  <div className="w-full grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Enviar Template" : "Upload Template"}
                      </h3>

                      <div className="p-4 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 text-center space-y-3">
                        <input
                          type="file"
                          accept=".doc,.docx,.pdf"
                          onChange={(e) => {
                            const fileName = e.target.files?.[0]?.name || "";
                            setTemplateUploadFileName(fileName);
                            if (fileName && !templateUploadName) {
                              setTemplateUploadName(fileName.replace(/\.[^.]+$/, ""));
                            }
                          }}
                          className="text-xs w-full"
                        />
                        <p className="text-[11px] text-slate-500">
                          {locale === "pt" ? "Formatos: DOCX, DOC ou PDF. Recomendado: DOCX com variáveis {{cliente}}, {{escopo}}, {{bom}}, {{preco}}." : "Formats: DOCX, DOC or PDF."}
                        </p>
                      </div>

                      <div className="space-y-3 text-xs">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Nome do Template" : "Template Name"}</label>
                          <input
                            value={templateUploadName}
                            onChange={(e) => setTemplateUploadName(e.target.value)}
                            placeholder={locale === "pt" ? "Ex.: Proposta Técnica ITS" : "E.g. ITS Technical Proposal"}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Descrição" : "Description"}</label>
                          <textarea
                            value={templateUploadDescription}
                            onChange={(e) => setTemplateUploadDescription(e.target.value)}
                            rows={3}
                            placeholder={locale === "pt" ? "Descrição curta do uso do template" : "Short description of template usage"}
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Tipo" : "Type"}</label>
                          <select value={templateUploadType} onChange={(e) => setTemplateUploadType(e.target.value as any)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded">
                            <option value="technical">{locale === "pt" ? "Técnico" : "Technical"}</option>
                            <option value="commercial">{locale === "pt" ? "Comercial" : "Commercial"}</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Idioma" : "Language"}</label>
                          <select value={templateUploadLanguage} onChange={(e) => setTemplateUploadLanguage(e.target.value as any)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded">
                            <option value="Portuguese">Português</option>
                            <option value="English">English</option>
                            <option value="Spanish">Español</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Versão" : "Version"}</label>
                          <input value={templateUploadVersion} onChange={(e) => setTemplateUploadVersion(e.target.value)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded font-mono" />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Variáveis declaradas" : "Declared Variables"}</label>
                        <textarea
                          value={templateUploadVariables}
                          onChange={(e) => setTemplateUploadVariables(e.target.value)}
                          rows={3}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-xs font-mono"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">
                          {locale === "pt" ? "Separe as variáveis por vírgula." : "Separate variables with commas."}
                        </p>
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

                      <button
                        onClick={handleCreateProposalTemplate}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded py-2 text-xs font-bold"
                      >
                        {locale === "pt" ? "Salvar Template Versionado" : "Save Versioned Template"}
                      </button>
                    </div>

                    <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider font-mono text-slate-800">
                        {locale === "pt" ? "Biblioteca e Versionamento" : "Library and Versioning"}
                      </h3>

                      <div className="space-y-3">
                        {proposalTemplates.map(tpl => (
                          <div key={tpl.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-xs font-bold text-slate-800 uppercase font-mono">{tpl.name}</h4>
                                  <span className="text-[10px] bg-white border border-slate-200 px-1.5 rounded-full font-bold uppercase">{tpl.file_type}</span>
                                  {tpl.default_template && (
                                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 rounded-full font-bold">{locale === "pt" ? "PADRÃO" : "DEFAULT"}</span>
                                  )}
                                  {!tpl.active && (
                                    <span className="text-[10px] bg-red-50 text-red-700 border border-red-100 px-1.5 rounded-full font-bold">{locale === "pt" ? "INATIVO" : "INACTIVE"}</span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1">{tpl.description}</p>
                                <p className="text-[10px] text-slate-400 font-mono mt-2">
                                  {locale === "pt" ? "Tipo" : "Type"}: {tpl.template_type} • {locale === "pt" ? "Versão" : "Version"}: {tpl.version} • {locale === "pt" ? "Idioma" : "Language"}: {tpl.language}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono truncate mt-1">{tpl.file_path}</p>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <button onClick={() => handleValidateProposalTemplate(tpl.id)} className="px-2 py-1 rounded bg-white border text-[10px] font-bold">
                                  {locale === "pt" ? "Validar" : "Validate"}
                                </button>
                                {!tpl.default_template && (
                                  <button onClick={() => handleSetDefaultProposalTemplate(tpl.id)} className="px-2 py-1 rounded bg-emerald-600 text-white text-[10px] font-bold">
                                    {locale === "pt" ? "Tornar Padrão" : "Set Default"}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleUpdateProposalTemplate(tpl.id, { active: !tpl.active })}
                                  className="px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-bold"
                                >
                                  {tpl.active ? (locale === "pt" ? "Inativar" : "Deactivate") : (locale === "pt" ? "Ativar" : "Activate")}
                                </button>
                                <button
                                  onClick={() => handleDeleteProposalTemplate(tpl.id)}
                                  className="px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-600 hover:text-white text-[10px] font-bold"
                                >
                                  {locale === "pt" ? "Apagar" : "Delete"}
                                </button>
                              </div>
                            </div>

                            <pre className="mt-3 p-3 bg-white border border-slate-200 rounded text-[10px] text-slate-500 overflow-x-auto">{tpl.variables_schema}</pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeAdminSection === "approval_flow" && canAccessAdminSection("approval_flow") && (locale === "pt" ? "Fluxo de Aprovação de Propostas" : "Proposal Approval Workflow")}
                      {activeAdminSection === "subscription" && canAccessAdminSection("subscription") && (locale === "pt" ? "Subscrição e Licença" : "Subscription & License")}
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
                        [locale === "pt" ? "IAs Ativas" : "Active AIs", modelProviders.filter(p => p.enabled).length, locale === "pt" ? "provedores" : "providers"],
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
                          {modelProviders.map(prov => (
                            <div key={prov.id} className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                              <div className="flex justify-between items-center gap-2">
                                <span className="font-semibold text-slate-700 text-xs truncate">{prov.name}</span>
                                <span className={`text-[9px] font-bold ${prov.enabled ? "text-emerald-600" : "text-slate-400"}`}>
                                  {prov.enabled ? (locale === "pt" ? "Ativo" : "Active") : (locale === "pt" ? "Inativo" : "Inactive")}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 font-mono mt-1 truncate">{prov.activeModel}</p>
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
                            <p className="font-bold text-slate-800 mt-1">{licenseTier} / {licenseStatus}</p>
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
                        {["workspace", "proposals", "templates", "approval", "admin", "integrations", "branding", "audit"].map(mod => (
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

                          const modulePermissionMap: Record<string, string[]> = {
                            workspace: ["project:create", "project:read", "project:update", "document:upload", "document:read", "document:delete", "analysis:run", "analysis:read", "analysis:edit"],
                            proposals: ["proposal:generate", "proposal:read", "proposal:approve"],
                            templates: ["template:manage"],
                            approval: ["approval:manage"],
                            admin: ["admin:users", "admin:roles", "admin:settings"],
                            integrations: ["integrations:manage"],
                            branding: ["branding:manage"],
                            audit: ["admin:audit", "admin:debug", "admin:diagnostics"],
                          };

                          const permissions = Array.from(new Set(newRoleModules.flatMap((mod) => modulePermissionMap[mod] || [])));

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
                                          await handleUpdateUser(u.id, { password: editingUserPassword });
                                          setEditingUserId("");
                                          setEditingUserPassword("");
                                          alert(locale === "pt" ? "Senha atualizada." : "Password updated.");
                                        }}
                                        className="bg-emerald-600 text-white px-2 py-1 rounded text-[10px] font-bold"
                                      >
                                        OK
                                      </button>
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
                      <div className="space-y-4 text-xs">
                        <div className={`p-3 rounded-lg border ${platformSettings?.ai_api_key_configured ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[10px] uppercase font-bold tracking-wider font-mono">
                                {locale === "pt" ? "Chave da API Gemini" : "Gemini API Key"}
                              </p>
                              <p className="text-[11px] mt-1 font-semibold">
                                {platformSettings?.ai_api_key_configured
                                  ? `${locale === "pt" ? "Configurada" : "Configured"}: ${platformSettings?.ai_api_key_masked || "********"}`
                                  : (locale === "pt" ? "Não configurada" : "Not configured")}
                              </p>
                            </div>
                            {platformSettings?.ai_api_key_configured && (
                              <button
                                onClick={handleClearAiApiKey}
                                className="bg-white/70 hover:bg-white border border-current px-2 py-1 rounded text-[10px] font-bold font-mono"
                              >
                                {locale === "pt" ? "Remover" : "Remove"}
                              </button>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">
                            {locale === "pt" ? "Provedor NLP de IA Padrão" : "Default NLP AI Provider"}
                          </label>
                          <select
                            value={platformSettings?.ai_provider || modelProviders.find(p => p.enabled)?.name || modelProviders[0]?.name || ""}
                            onChange={(e) => handleSavePlatformSettings("ai_provider", e.target.value)}
                            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs font-semibold text-slate-700"
                          >
                            {modelProviders.map(prov => (
                              <option key={prov.id} value={prov.name}>{prov.name}{prov.enabled ? "" : " (inativo)"}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">
                            {locale === "pt" ? "Modelo de Classificação de Documentos" : "Standard Document Classification Model"}
                          </label>
                          <select
                            value={platformSettings?.document_analysis_model || modelProviders.find(p => p.name === platformSettings?.ai_provider)?.activeModel || "Gemini 2.5 Flash"}
                            onChange={(e) => handleSavePlatformSettings("document_analysis_model", e.target.value)}
                            className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-xs font-semibold text-slate-700"
                          >
                            {(modelProviders.find(p => p.name === platformSettings?.ai_provider)?.models || modelProviders.flatMap(p => p.models)).map(model => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="space-y-3 pt-3 border-t border-slate-100">
                        {modelProviders.map((prov, pIdx) => (
                          <div key={prov.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50 space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 text-xs">
                                <input
                                  type="checkbox"
                                  checked={prov.enabled}
                                  onChange={(e) => {
                                    const updated = [...modelProviders];
                                    updated[pIdx].enabled = e.target.checked;
                                    setModelProviders(updated);
                                  }}
                                  className="rounded text-emerald-600 focus:ring-emerald-500"
                                />
                                {prov.name}
                              </label>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold ${prov.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-500"}`}>
                                {prov.enabled ? (locale === "pt" ? "Ativo" : "Active") : (locale === "pt" ? "Inativo" : "Inactive")}
                              </span>
                            </div>
                            {prov.enabled && (
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <input
                                  type="text"
                                  value={prov.activeModel}
                                  onChange={(e) => {
                                    const updated = [...modelProviders];
                                    updated[pIdx].activeModel = e.target.value;
                                    setModelProviders(updated);
                                  }}
                                  className="w-full p-1.5 text-[11px] font-mono bg-white border border-slate-200 rounded"
                                />
                                <div className="flex gap-1">
                                  <input
                                    type="password"
                                    placeholder={platformSettings?.ai_api_key_configured ? (platformSettings.ai_api_key_masked || "••••••••") : "Cole a API key"}
                                    value={prov.apiKey}
                                    onChange={(e) => {
                                      const updated = [...modelProviders];
                                      updated[pIdx].apiKey = e.target.value;
                                      setModelProviders(updated);
                                    }}
                                    className="w-full p-1.5 text-[11px] font-mono bg-white border border-slate-200 rounded"
                                  />
                                  <button
                                    onClick={() => handleSaveAiApiKey(prov.name, prov.apiKey)}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 rounded text-[10px] font-bold font-mono"
                                  >
                                    {locale === "pt" ? "Salvar" : "Save"}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

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
                      <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
                        {promptTemplates.map(prm => (
                          <div key={prm.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                            <div className="flex justify-between items-center">
                              <div>
                                <h4 className="text-xs font-bold text-slate-800 uppercase font-mono">{prm.name} ({prm.version})</h4>
                                <span className="text-[10px] text-slate-400 uppercase font-mono">{tx("Language Target", "Idioma Alvo")}: {prm.language}</span>
                              </div>
                              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold uppercase font-mono">{tx("ACTIVE INSTRUCTION", "INSTRUÇÃO ATIVA")}</span>
                            </div>
                            <textarea
                              defaultValue={prm.content}
                              id={`textarea-prm-${prm.id}`}
                              className="w-full h-24 p-3 rounded font-mono text-xs bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none leading-normal text-slate-700"
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={() => {
                                  const val = (document.getElementById(`textarea-prm-${prm.id}`) as HTMLTextAreaElement)?.value;
                                  handleUpdatePromptTemplate(prm.id, val);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-3 rounded shadow-sm transition-all cursor-pointer"
                              >
                                {locale === "pt" ? "Salvar Instruções" : "Save Instructions Override"}
                              </button>
                            </div>
                          </div>
                        ))}
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
                      <div className="p-4 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 text-center space-y-3">
                        <input
                          type="file"
                          accept=".doc,.docx,.pdf,.html,.md"
                          onChange={(e) => setTemplateUploadFileName(e.target.files?.[0]?.name || "")}
                          className="text-xs w-full"
                        />
                        <p className="text-[11px] text-slate-500">
                          {locale === "pt" ? "Formatos: DOCX, DOC, PDF, HTML ou MD. Recomendado: DOCX com variáveis {{cliente}}, {{escopo}}, {{bom}}, {{preco}}." : "Formats: DOCX, DOC, PDF, HTML or MD."}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-slate-400 font-mono block mb-1">{locale === "pt" ? "Tipo" : "Type"}</label>
                          <select value={templateUploadType} onChange={(e) => setTemplateUploadType(e.target.value as any)} className="w-full p-2 bg-slate-50 border border-slate-200 rounded">
                            <option value="technical">{locale === "pt" ? "Técnico" : "Technical"}</option>
                            <option value="commercial">{locale === "pt" ? "Comercial" : "Commercial"}</option>
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
                      <button className="w-full bg-slate-900 text-white rounded py-2 text-xs font-bold">
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
                                <h4 className="text-xs font-bold text-slate-800 uppercase font-mono">{tpl.name}</h4>
                                <p className="text-[11px] text-slate-500 mt-1">{tpl.description}</p>
                                <p className="text-[10px] text-slate-400 font-mono mt-2">
                                  {locale === "pt" ? "Tipo" : "Type"}: {tpl.template_type} • {locale === "pt" ? "Versão" : "Version"}: {tpl.version} • {locale === "pt" ? "Idioma" : "Language"}: {tpl.language}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <button className="px-2 py-1 rounded bg-white border text-[10px] font-bold">{locale === "pt" ? "Visualizar" : "Preview"}</button>
                                <button className="px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-bold">{locale === "pt" ? "Ativar" : "Set Active"}</button>
                              </div>
                            </div>
                            <pre className="mt-3 p-3 bg-white border border-slate-200 rounded text-[10px] text-slate-500 overflow-x-auto">{JSON.stringify(tpl.variables_schema || {}, null, 2)}</pre>
                          </div>
                        ))}
                      </div>
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
                      {locale === "pt" ? "Gestão de Subscrição e Licença" : "Subscription & Licensing Manager"}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                        <span className="text-[10px] text-slate-400 font-mono block uppercase">{locale === "pt" ? "Plano Atual" : "License Plan"}</span>
                        <span className="text-sm font-extrabold text-emerald-600 capitalize font-mono block mt-1">{licenseTier} Edition</span>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                        <span className="text-[10px] text-slate-400 font-mono block uppercase">{locale === "pt" ? "Status da Assinatura" : "Subscription Status"}</span>
                        <span className="text-sm font-extrabold text-emerald-600 font-mono mt-1 block">{licenseStatus}</span>
                      </div>
                    </div>
                    <input type="text" disabled value={licenseKey} className="w-full p-2 rounded bg-slate-100 font-mono text-slate-600 border border-slate-200 cursor-not-allowed text-xs" />
                    <div className="flex gap-2">
                      <input type="text" placeholder="XXXX-XXXX-XXXX-XXXX" value={inputLicenseKey} onChange={(e) => setInputLicenseKey(e.target.value)} className="flex-1 p-2 bg-white border border-slate-200 rounded text-xs font-mono" />
                      <button
                        onClick={() => {
                          if (!inputLicenseKey.trim()) {
                            setLicenseMessage(locale === "pt" ? "Insira uma chave válida." : "Insert a valid key.");
                            return;
                          }
                          if (inputLicenseKey.includes("PRO")) {
                            setLicenseTier("professional");
                            setLicenseKey(inputLicenseKey);
                            setLicenseStatus("Active");
                            setLicenseMessage(locale === "pt" ? "Licença Professional Ativada!" : "Professional License Activated!");
                          } else if (inputLicenseKey.includes("ENT")) {
                            setLicenseTier("enterprise");
                            setLicenseKey(inputLicenseKey);
                            setLicenseStatus("Active");
                            setLicenseMessage(locale === "pt" ? "Licença Enterprise Ativada!" : "Enterprise License Activated!");
                          } else {
                            setLicenseMessage(locale === "pt" ? "Código de licença inválido ou expirado." : "Invalid or expired license code.");
                          }
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold px-4 rounded"
                      >
                        {locale === "pt" ? "Ativar" : "Activate"}
                      </button>
                    </div>
                    {licenseMessage && <p className="text-xs font-semibold text-emerald-700 font-mono">{licenseMessage}</p>}
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
                          <button onClick={handleRemoveBrandLogo} className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded disabled:opacity-40 disabled:cursor-not-allowed" disabled={!brandLogoDataUrl}>
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
                            <option value="Custom">{tx("Custom / Other", "Customizado / Outros")}</option>
                          </select>
                          <input type="text" placeholder="https://api.system.com/v1" value={newConnectorUrl} onChange={(e) => setNewConnectorUrl(e.target.value)} className="col-span-2 w-full p-2 bg-white border border-slate-200 rounded font-mono" />
                          <input type="password" placeholder="bearer token ou api key" value={newConnectorToken} onChange={(e) => setNewConnectorToken(e.target.value)} className="col-span-2 w-full p-2 bg-white border border-slate-200 rounded font-mono" />
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
          )}

        </section>
      </main>

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
            LLM: <span className="text-emerald-400 font-bold uppercase">{platformSettings?.ai_provider || "Gemini"}</span>
          </span>
        </div>
        <div className="flex gap-4">
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

      {/* ================= MODAL: CREATE PROJECT ================= */}
      {showNewProjectModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 w-[550px] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-bold uppercase font-mono tracking-wider">{locale === "pt" ? "Inicializar Proposta de Pré-Vendas" : "Initialize Pre-Sales Bid"}</h3>
              <button onClick={() => setShowNewProjectModal(false)} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
            </div>

            <form onSubmit={handleCreateProject} className="p-6 overflow-y-auto space-y-4 text-xs text-slate-700 flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Título do Projeto de Proposta" : "Bid Project Title"}</label>
                  <input
                    type="text" required
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder={locale === "pt" ? "ex: Modernização de Rodovias ITS" : "e.g. Highway ITS Modernization"}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Cliente" : "Customer / Client"}</label>
                  <input
                    type="text" required
                    value={newProject.customer_name}
                    onChange={(e) => setNewProject({ ...newProject, customer_name: e.target.value })}
                    placeholder={locale === "pt" ? "ex: Concessionária de Rodovias" : "e.g. Metropolitan Transit Authority"}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Código da Oportunidade" : "Opportunity Code"}</label>
                  <input
                    type="text" required
                    value={newProject.opportunity_name}
                    onChange={(e) => setNewProject({ ...newProject, opportunity_name: e.target.value })}
                    placeholder="e.g. ITS-MTA-2026"
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none animate-pulse"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Vertical do Setor" : "Industry Vertical"}</label>
                  <select
                    value={newProject.vertical}
                    onChange={(e) => setNewProject({ ...newProject, vertical: e.target.value })}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="Infrastructure">{locale === "pt" ? "Infraestrutura" : "Infrastructure"}</option>
                    <option value="Critical Infrastructure">{locale === "pt" ? "Infraestrutura Crítica" : "Critical Infrastructure"}</option>
                    <option value="Smart Cities">{locale === "pt" ? "Cidades Inteligentes" : "Smart Cities"}</option>
                    <option value="Retail">{locale === "pt" ? "Varejo" : "Retail"}</option>
                    <option value="Finance">{locale === "pt" ? "Finanças" : "Finance"}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Descrição do Escopo do Edital" : "Tender Scope Description"}</label>
                <textarea
                  value={newProject.description} required
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder={locale === "pt" ? "Detalhe o escopo de entregáveis de alto nível..." : "Detail high level deliverables scope..."}
                  className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none h-20"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Prazo Final de Envio" : "Tender Submission Deadline"}</label>
                  <input
                    type="date" required
                    value={newProject.deadline}
                    onChange={(e) => setNewProject({ ...newProject, deadline: e.target.value })}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Idioma de Saída de Conformidade da IA" : "AI Output Compliance Language"}</label>
                  <select
                    value={newProject.output_language}
                    onChange={(e) => setNewProject({ ...newProject, output_language: e.target.value as any })}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="English">{locale === "pt" ? "Inglês" : "English"}</option>
                    <option value="Spanish">{locale === "pt" ? "Espanhol" : "Spanish"}</option>
                    <option value="Portuguese">{locale === "pt" ? "Português" : "Portuguese"}</option>
                  </select>
                </div>
              </div>

              {/* Procurement Modality (Modalidade de Contratação) */}
              <div className="border-t border-slate-200 pt-3 space-y-2">
                <div className="flex items-center gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block">
                    {locale === "pt" ? "Modalidade de Contratação" : "Procurement Modality"}
                  </label>
                  <HelpTooltip content={locale === "pt" ? "Selecione o tipo de concorrência ou leilão aplicável à licitação para orientar a IA nas regras de compliance." : "Select the contract procurement type or auction mode to guide the AI compliance checks."} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <select
                      value={newProject.procurement_modality}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewProject({
                          ...newProject,
                          procurement_modality: val,
                          procurement_subtype: val === "Leilão" ? "Leilão Inglês" : (val === "Licitação" ? "Pregão" : ""),
                        });
                      }}
                      className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                    >
                      <option value="Licitação">{locale === "pt" ? "Licitação" : "Bidding / Tender"}</option>
                      <option value="Leilão">{locale === "pt" ? "Leilão" : "Auction"}</option>
                      <option value="Outra modalidade">{locale === "pt" ? "Outra Modalidade" : "Other Modality"}</option>
                    </select>
                  </div>

                  <div>
                    {newProject.procurement_modality === "Leilão" && (
                      <select
                        value={newProject.procurement_subtype}
                        onChange={(e) => setNewProject({ ...newProject, procurement_subtype: e.target.value })}
                        className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                      >
                        <option value="Leilão Inglês">{locale === "pt" ? "Leilão Inglês" : "English Auction"}</option>
                        <option value="Leilão Holandês">{locale === "pt" ? "Leilão Holandês" : "Dutch Auction"}</option>
                        <option value="Leilão Japonês">{locale === "pt" ? "Leilão Japonês" : "Japanese Auction"}</option>
                        <option value="Primeiro Preço">{locale === "pt" ? "Primeiro Preço" : "First Price"}</option>
                        <option value="Vickrey (Segundo Preço)">{locale === "pt" ? "Vickrey (Segundo Preço)" : "Vickrey (Second Price)"}</option>
                        <option value="Reverso">{locale === "pt" ? "Reverso" : "Reverse"}</option>
                      </select>
                    )}

                    {newProject.procurement_modality === "Licitação" && (
                      <select
                        value={newProject.procurement_subtype}
                        onChange={(e) => setNewProject({ ...newProject, procurement_subtype: e.target.value })}
                        className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                      >
                        <option value="Pregão">Pregão</option>
                        <option value="Concorrência">Concorrência</option>
                        <option value="Concurso">Concurso</option>
                        <option value="Leilão">Leilão</option>
                        <option value="Diálogo Competitivo">Diálogo Competitivo</option>
                        <option value="Tomada de Preço">Tomada de Preço</option>
                      </select>
                    )}

                    {newProject.procurement_modality === "Outra modalidade" && (
                      <input
                        type="text" required
                        value={newProject.custom_modality}
                        onChange={(e) => setNewProject({ ...newProject, custom_modality: e.target.value })}
                        placeholder={locale === "pt" ? "Especifique a modalidade..." : "Specify custom modality..."}
                        className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono block mb-1">{locale === "pt" ? "Regras de Orientação de Design da IA" : "AI Design Orientation Rules"}</label>
                <div className="space-y-2">
                  <select
                    value={newProject.ai_orientation_mode}
                    onChange={(e) => setNewProject({ ...newProject, ai_orientation_mode: e.target.value as any })}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-bold text-slate-800"
                  >
                    <option value="Vendor-neutral">{locale === "pt" ? "Fabricante Neutro (foco em estrita conformidade)" : "Vendor-neutral (strict compliance focus)"}</option>
                    <option value="Preferred manufacturer">{locale === "pt" ? "Fabricante Preferencial (marcas recomendadas)" : "Preferred manufacturer (recommended brands)"}</option>
                    <option value="Mandatory manufacturer">{locale === "pt" ? "Fabricante Obrigatório (especificações críticas de contrato)" : "Mandatory manufacturer (contract-critical specs)"}</option>
                    <option value="Existing customer standard">{locale === "pt" ? "Padrão de Cliente Existente" : "Existing customer standard"}</option>
                    <option value="Free AI recommendation">{locale === "pt" ? "Recomendação Livre da IA" : "Free AI recommendation"}</option>
                  </select>
                  <input
                    type="text" required
                    value={newProject.ai_orientation_text}
                    onChange={(e) => setNewProject({ ...newProject, ai_orientation_text: e.target.value })}
                    placeholder={locale === "pt" ? "Especifique regras de marcas, ex: Recomendar leitores faciais homologados..." : "Specify brand rules e.g., Recommend certified facial readers..."}
                    className="w-full p-2 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowNewProjectModal(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 font-mono text-xs cursor-pointer text-slate-500"
                >
                  {locale === "pt" ? "Cancelar" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-4 rounded shadow transition-all cursor-pointer"
                >
                  {locale === "pt" ? "Confirmar Configuração de Especificações" : "Confirm Specifications Setup"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: CLASSIFY DOCUMENT ================= */}
      {showDocumentTypeModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 w-[400px] overflow-hidden shadow-2xl">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase font-mono tracking-wider">{tx("Override Classification", "Sobrescrever Classificação")}</h3>
              <button onClick={() => setShowDocumentTypeModal(null)} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4 text-xs text-slate-700">
              <p className="font-semibold">{tx("Modify manual document category metadata for", "Modificar manualmente a categoria do documento para")} <span className="font-mono bg-slate-100 px-1 rounded">{showDocumentTypeModal.original_filename}</span>:</p>

              <div className="space-y-2">
                <button
                  onClick={() => handleReclassifyDoc(showDocumentTypeModal.id, "Public tender / edital")}
                  className="w-full p-2.5 text-left bg-slate-50 border border-slate-200 hover:border-emerald-500 rounded font-bold hover:bg-slate-100 block cursor-pointer text-xs"
                >
                  📜 Public tender / edital
                </button>
                <button
                  onClick={() => handleReclassifyDoc(showDocumentTypeModal.id, "Technical specification")}
                  className="w-full p-2.5 text-left bg-slate-50 border border-slate-200 hover:border-emerald-500 rounded font-bold hover:bg-slate-100 block cursor-pointer text-xs"
                >
                  🔧 Technical specification
                </button>
                <button
                  onClick={() => handleReclassifyDoc(showDocumentTypeModal.id, "Customer requirements")}
                  className="w-full p-2.5 text-left bg-slate-50 border border-slate-200 hover:border-emerald-500 rounded font-bold hover:bg-slate-100 block cursor-pointer text-xs"
                >
                  📝 Customer requirements
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: AUDIT LOGS OVERLAY ================= */}
      {showAuditModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 w-[800px] h-[600px] overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-emerald-500" />
                <h3 className="text-sm font-bold uppercase font-mono tracking-wider">{tx("Enterprise Compliance Audit Log Ledger", "Livro de Auditoria de Compliance Empresarial")}</h3>
              </div>
              <button onClick={() => setShowAuditModal(false)} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
            </div>

            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shrink-0">
              <span className="text-xs text-slate-500 font-mono">{tx("Filter: All Pre-Sales Operations Logs", "Filtro: Todos os Logs de Operações de Pré-Vendas")}</span>
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold px-3 py-1.5 rounded shadow-sm transition-all cursor-pointer"
              >
                <Download size={13} /> Export Ledger (CSV)
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px] leading-relaxed bg-slate-950 text-slate-300">
              {auditLogs.map(log => (
                <div key={log.id} className="p-2 border-b border-slate-800 flex justify-between items-start">
                  <div>
                    <span className="text-emerald-400 font-bold block">[{new Date(log.created_at).toISOString()}] {log.action}</span>
                    <p className="text-slate-400 mt-0.5">Executor: {log.user_id} | Entity: {log.entity_type} ({log.entity_id})</p>
                    {log.metadata && (
                      <span className="text-slate-500 text-[10px] block">Metadata: {log.metadata}</span>
                    )}
                  </div>
                  <span className="text-slate-500 text-[10px]">IP: {log.ip_address}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: DEBUG CONSOLE OVERLAY ================= */}
      {showDebugConsole && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-slate-200 w-[850px] h-[650px] overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-slate-950 text-white p-4 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-emerald-500" />
                <h3 className="text-sm font-bold uppercase font-mono tracking-wider">
                  {locale === "pt" ? "Logs de Rastreamento da Orquestração de IA" : "Pre-Sales AI Orchestration Trace logs"}
                </h3>
              </div>
              <button onClick={() => setShowDebugConsole(false)} className="text-slate-400 hover:text-white cursor-pointer"><X size={16} /></button>
            </div>

            <>
                <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center shrink-0">
                  <div className="flex gap-4 text-xs font-mono text-slate-400">
                    <span>{tx("Debug Records", "Registros de Debug")}: <span className="text-emerald-400 font-bold">{debugLogs.length}</span></span>
                    <span>{tx("Diagnostics", "Diagnóstico")}: <span className="text-emerald-400 font-bold">{tx("Sanitized", "Sanitizado")}</span></span>
                  </div>
                  <button
                    onClick={() => {
                      if (currentSessionUser.role !== "Administrator") {
                        alert(locale === "pt" ? "Acesso negado pela API administrativa. Verifique as permissões do usuário." : "Access denied by the administrative API. Check the current user's permissions.");
                        return;
                      }
                      handleExportDiagnosticsPackage();
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold py-1.5 px-3 rounded shadow-sm transition-all cursor-pointer"
                  >
                    {locale === "pt" ? "Baixar Pacote de Diagnóstico" : "Download Diagnostic Package"}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px] leading-relaxed bg-slate-950 text-slate-400">
                  {debugLogs.map(dbg => (
                    <div key={dbg.id} className="p-2.5 bg-slate-900/50 rounded border border-slate-850 hover:bg-slate-900 transition-colors">
                      <div className="flex justify-between items-start mb-1">
                        <span className={`font-bold uppercase tracking-wider text-[10px] px-1.5 rounded ${
                          dbg.log_level === "ERROR" ? "bg-red-500/20 text-red-400" : (dbg.log_level === "WARN" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400")
                        }`}>{dbg.log_level}</span>
                        <span className="text-slate-500 text-[10px]">{dbg.timestamp}</span>
                      </div>
                      <p className="text-slate-200 font-semibold">{dbg.operation} - {dbg.message}</p>
                      <div className="grid grid-cols-4 gap-2 text-[10px] text-slate-500 mt-1">
                        <span><strong>{tx("Module", "Módulo")}:</strong> {dbg.module_name}</span>
                        <span><strong>{tx("Service", "Serviço")}:</strong> {dbg.service_name}</span>
                        <span><strong>{tx("Latency", "Latência")}:</strong> {dbg.duration_ms}ms</span>
                        <span><strong>{tx("Status", "Status")}:</strong> {dbg.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
            </>
          </div>
        </div>
      )}

    </div>
  );
}
