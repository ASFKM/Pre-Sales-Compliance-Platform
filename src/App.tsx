import React, { useState, useEffect } from "react";
import ApiClient from "./lib/api";
import Login from "./components/Login";
import AdminConsole from "./components/AdminConsole";
import Workspace from "./components/Workspace";
import CreateProjectModal from "./components/modals/CreateProjectModal";
import ClassifyDocumentModal from "./components/modals/ClassifyDocumentModal";
import AuditLogsModal from "./components/modals/AuditLogsModal";
import DebugConsoleModal from "./components/modals/DebugConsoleModal";
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


  // Navigation / Views
  const [activeTab, setActiveTab] = useState<"home" | "workspace" | "proposals" | "templates" | "approval" | "admin">("home");
  const [activeAdminSection, setActiveAdminSection] = useState<"overview" | "users" | "ai" | "templates" | "approval_flow" | "subscription" | "branding" | "integrations" | "storage" | "audit">("overview");

  // Shared with fetchGlobalConfigs (auto-selects defaults) and Workspace's proposal builder
  const [selectedTechnicalTemplateId, setSelectedTechnicalTemplateId] = useState("");
  const [selectedCommercialTemplateId, setSelectedCommercialTemplateId] = useState("");
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

  // UI Controls & Lists
  const [isLoading, setIsLoading] = useState<boolean>(false);
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
  const [brandingSettings, setBrandingSettings] = useState<BrandingSettings | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [proposalTemplates, setProposalTemplates] = useState<any[]>([]);
  const [approvalWorkflows, setApprovalWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [approvalDecisions, setApprovalDecisions] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConnector[]>([]);
  const [systemStatus, setSystemStatus] = useState<any>(null);

  // Modals / Overlays
  const [showDebugConsole, setShowDebugConsole] = useState<boolean>(false);
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);

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
      // executive_summary and preliminary_schedule are AI-generated free text specific to each
      // project - there's no safe per-project key to translate them by (unlike the fields below,
      // which only ever substitute when the English text matches this fixed demo project exactly,
      // and otherwise fall back to the original untouched). Leaving them out of this override
      // lets them pass through unchanged via the `...res` spread above, in English, rather than
      // silently replacing a real project's content with this demo project's hardcoded text.
      point_to_point_table: res.point_to_point_table?.map((p: PointToPointRow): PointToPointRow => {
        if (p.item_id === "ptp1") {
          return {
            ...p,
            customer_requirement: "Equipamentos de via devem funcionar estavelmente sob calor de 55°C.",
            proposed_solution: "Switch industrial RuggedCOM Switch-Hardened-8G classificado para até +75°C.",
            comments: "Excede as exigências do cliente com +20°C de margem de segurança. Dispensa ventilação ativa.",
            compliance: "compliant"
          };
        }
        if (p.item_id === "ptp2") {
          return {
            ...p,
            customer_requirement: "Reconhecimento automático de veículos a velocidades de até 180 km/h.",
            proposed_solution: "Câmera CAM-ALPR-10X com obturador global de ultra-alta velocidade.",
            comments: "Certificado de forma independente para processamento de placas a até 200 km/h.",
            compliance: "compliant"
          };
        }
        if (p.item_id === "ptp3") {
          return {
            ...p,
            customer_requirement: "Integração de despacho rest com latência abaixo de 500ms.",
            proposed_solution: "Conector Pre-Sales Gateway com adaptador Oracle customizado.",
            comments: "Requer conexão de túnel dedicada com o banco de dados do cliente. Depende de otimização de banco.",
            compliance: "partially_compliant"
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
            <Workspace
              locale={locale}
              tx={tx}
              t={t}
              hasPermission={hasPermission}
              selectedProjectId={selectedProjectId}
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
              selectedTechnicalTemplateId={selectedTechnicalTemplateId}
              setSelectedTechnicalTemplateId={setSelectedTechnicalTemplateId}
              selectedCommercialTemplateId={selectedCommercialTemplateId}
              setSelectedCommercialTemplateId={setSelectedCommercialTemplateId}
              chatHistory={chatHistory}
              setChatHistory={setChatHistory}
            />
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

      {showNewProjectModal && (
        <CreateProjectModal
          locale={locale}
          onClose={() => setShowNewProjectModal(false)}
          onCreated={handleProjectCreated}
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
          currentUserRole={currentSessionUser.role}
          onClose={() => setShowDebugConsole(false)}
          onExportDiagnostics={handleExportDiagnosticsPackage}
        />
      )}

    </div>
  );
}
