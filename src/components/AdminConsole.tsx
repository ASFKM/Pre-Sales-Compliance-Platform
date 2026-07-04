import { Dispatch, SetStateAction, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  AuditLog,
  BrandingSettings,
  Document,
  IntegrationConnector,
  PlatformSettings,
  Proposal,
  ProposalTemplate,
  PromptTemplate,
  Role,
} from "../types";
import { useAdminConsole } from "../hooks/useAdminConsole";

type AdminSection =
  | "overview" | "users" | "ai" | "templates" | "approval_flow"
  | "subscription" | "branding" | "integrations" | "storage" | "audit";

interface AdminConsoleProps {
  locale: "en" | "pt";
  tx: (en: string, pt: string) => string;
  currentSessionUser: { id: string; name: string; email: string; role_id: string; role: string; permissions: string[] };
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
  promptTemplates, proposalTemplates,
  approvalWorkflows, setApprovalWorkflows,
  integrations, setIntegrations,
  setShowAuditModal, setShowDebugConsole,
  brandLogoDataUrl, setBrandLogoDataUrl,
  brandPrimaryColor, setBrandPrimaryColor,
  brandAccentColor, setBrandAccentColor,
}: AdminConsoleProps) {
  // Subscription & Licensing (display only - deliberately left as a known non-functional
  // placeholder pending a future licensing phase, see project memory)
  const [licenseTier, setLicenseTier] = useState<"enterprise" | "professional" | "free">("enterprise");
  const [licenseKey, setLicenseKey] = useState("CA-ENT-778X-992K-2026");
  const [licenseExpiry] = useState("2027-12-31");
  const [licenseStatus, setLicenseStatus] = useState<"Active" | "Expired" | "Pending">("Active");
  const [inputLicenseKey, setInputLicenseKey] = useState("");
  const [licenseMessage, setLicenseMessage] = useState("");

  const [costUSD] = useState(14.28);
  const exchangeRate = 5.15; // 1 USD = 5.15 BRL (realistic exchange rate)
  const [modelProviders, setModelProviders] = useState([
    { id: "gemini", name: "Google Gemini", activeModel: "Gemini 2.5 Flash", apiKey: "••••••••••••••••••••", enabled: true, models: ["Gemini 2.5 Flash", "Gemini 2.5 Pro"] },
    { id: "openai", name: "OpenAI ChatGPT", activeModel: "GPT-4o", apiKey: "", enabled: false, models: ["GPT-4o", "GPT-3.5-Turbo", "o1-mini"] },
    { id: "anthropic", name: "Anthropic Claude", activeModel: "Claude 3.5 Sonnet", apiKey: "", enabled: false, models: ["Claude 3.5 Sonnet", "Claude 3 Opus"] },
    { id: "deepseek", name: "DeepSeek", activeModel: "DeepSeek-R1", apiKey: "", enabled: false, models: ["DeepSeek-R1", "DeepSeek-V3"] }
  ]);

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

  const [showNewUserForm, setShowNewUserForm] = useState<boolean>(false);
  const [newUserName, setNewUserName] = useState<string>("");
  const [newUserEmail, setNewUserEmail] = useState<string>("");
  const [newUserRoleId, setNewUserRoleId] = useState<string>("r3");
  const [newUserPassword, setNewUserPassword] = useState<string>("ChangeMe123!");
  const [editingUserId, setEditingUserId] = useState<string>("");
  const [editingUserPassword, setEditingUserPassword] = useState<string>("");

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
    handleUpdateProposalTemplate,
    handleDeleteProposalTemplate,
    handleUpdatePromptTemplate,
    handleValidateStorageSettings,
    handleSavePlatformSettings,
    handleSaveAiApiKey,
    handleClearAiApiKey,
  } = useAdminConsole({
    locale,
    currentUserName: currentSessionUser.name,
    roles,
    users,
    approvalWorkflows,
    fetchGlobalConfigs,
    setPlatformSettings,
    setBrandingSettings,
    setModelProviders,
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
    templateUploadFileName,
    templateUploadName,
    templateUploadDescription,
    templateUploadVersion,
    templateUploadType,
    templateUploadLanguage,
    templateUploadVariables,
    proposalTemplates,
    setTemplateUploadFileName,
    setTemplateUploadName,
    setTemplateUploadDescription,
    setTemplateUploadVersion,
    setTemplateUploadType,
    setTemplateUploadLanguage,
    setTemplateUploadVariables,
  });

  const updateApprovalWorkflowLocal = (flowId: string, updater: (flow: any) => any) => {
    setApprovalWorkflows(approvalWorkflows.map((flow) => flow.id === flowId ? updater({ ...flow, stages: [...(flow.stages || [])] }) : flow));
  };

  return (
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
  );
}
