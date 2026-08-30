import { useCallback, useEffect, useState } from "react";
import { BrandingSettings, PlatformSettings, ProposalTemplate, Role } from "../types";
import type { TemplateVariableEntry } from "../../server/utils/templateVariableCatalog";

interface UseAdminConsoleParams {
  locale: string;
  currentUserName: string;
  roles: Role[];
  users: any[];
  approvalWorkflows: any[];
  fetchGlobalConfigs: () => Promise<void> | void;
  setPlatformSettings: (settings: PlatformSettings) => void;
  setBrandingSettings: (settings: BrandingSettings) => void;
  setStorageValidateResult: (result: any) => void;
  setBrandLogoDataUrl: (url: string) => void;
  brandPrimaryColor: string;
  brandAccentColor: string;
  setBrandPrimaryColor: (color: string) => void;
  setBrandAccentColor: (color: string) => void;
  // New Approval Workflow form (owned locally by AdminConsole)
  newApprovalWorkflowName: string;
  newApprovalWorkflowDescription: string;
  newApprovalWorkflowAppliesTo: string;
  setShowNewApprovalWorkflowForm: (show: boolean) => void;
  setNewApprovalWorkflowName: (v: string) => void;
  setNewApprovalWorkflowDescription: (v: string) => void;
  setNewApprovalWorkflowAppliesTo: (v: string) => void;
  // New User form (owned locally by AdminConsole)
  newUserName: string;
  newUserEmail: string;
  newUserRoleId: string;
  newUserPassword: string;
  setShowNewUserForm: (show: boolean) => void;
  setNewUserName: (v: string) => void;
  setNewUserEmail: (v: string) => void;
  setNewUserRoleId: (v: string) => void;
  setNewUserPassword: (v: string) => void;
  // New Connector form (owned locally by AdminConsole)
  newConnectorName: string;
  newConnectorType: string;
  newConnectorUrl: string;
  newConnectorToken: string;
  setShowNewConnectorForm: (show: boolean) => void;
  setNewConnectorName: (v: string) => void;
  setNewConnectorType: (v: string) => void;
  setNewConnectorUrl: (v: string) => void;
  setNewConnectorToken: (v: string) => void;
  // Template upload form (owned locally by AdminConsole)
  templateUploadFile: File | null;
  templateUploadFileName: string;
  templateUploadName: string;
  templateUploadDescription: string;
  templateUploadVersion: string;
  templateUploadType: ProposalTemplate["template_type"];
  templateUploadLanguage: "Portuguese" | "English" | "Spanish";
  proposalTemplates: any[];
  setTemplateUploadFile: (v: File | null) => void;
  setTemplateUploadFileName: (v: string) => void;
  setTemplateUploadName: (v: string) => void;
  setTemplateUploadDescription: (v: string) => void;
  setTemplateUploadVersion: (v: string) => void;
  setTemplateUploadType: (v: ProposalTemplate["template_type"]) => void;
  setTemplateUploadLanguage: (v: "Portuguese" | "English" | "Spanish") => void;
}

// All handlers exclusive to the Admin Console (users, roles, AI/prompts, templates,
// approval workflow definitions, branding, integrations, storage/platform settings).
export function useAdminConsole(params: UseAdminConsoleParams) {
  const {
    locale, currentUserName, roles, users, approvalWorkflows, fetchGlobalConfigs,
    setPlatformSettings, setBrandingSettings, setStorageValidateResult,
    setBrandLogoDataUrl, brandPrimaryColor, brandAccentColor, setBrandPrimaryColor, setBrandAccentColor,
    newApprovalWorkflowName, newApprovalWorkflowDescription, newApprovalWorkflowAppliesTo,
    setShowNewApprovalWorkflowForm, setNewApprovalWorkflowName, setNewApprovalWorkflowDescription, setNewApprovalWorkflowAppliesTo,
    newUserName, newUserEmail, newUserRoleId, newUserPassword,
    setShowNewUserForm, setNewUserName, setNewUserEmail, setNewUserRoleId, setNewUserPassword,
    newConnectorName, newConnectorType, newConnectorUrl, newConnectorToken,
    setShowNewConnectorForm, setNewConnectorName, setNewConnectorType, setNewConnectorUrl, setNewConnectorToken,
    templateUploadFile, templateUploadFileName, templateUploadName, templateUploadDescription, templateUploadVersion,
    templateUploadType, templateUploadLanguage, proposalTemplates,
    setTemplateUploadFile, setTemplateUploadFileName, setTemplateUploadName, setTemplateUploadDescription, setTemplateUploadVersion,
    setTemplateUploadType, setTemplateUploadLanguage,
  } = params;

  // Canonical variable glossary (name + human-readable description) shown next to the upload
  // form - fetched once and reused for every template, since it doesn't depend on which template
  // is selected (every template can use every variable buildTemplateVariables() computes).
  const [proposalVariableCatalog, setProposalVariableCatalog] = useState<TemplateVariableEntry[]>([]);

  const fetchProposalVariableCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/templates/proposals/variables");
      const data = await res.json();
      if (res.ok) setProposalVariableCatalog(data.variables || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchProposalVariableCatalog();
  }, [fetchProposalVariableCatalog]);

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

  const handleRemoveBrandLogo = async (brandLogoDataUrl: string) => {
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
    if (!templateUploadFile) {
      alert(locale === "pt" ? "Selecione um arquivo de template." : "Select a template file.");
      return;
    }

    const safeName = templateUploadName.trim() || templateUploadFileName.replace(/\.[^.]+$/, "");

    const formData = new FormData();
    formData.append("file", templateUploadFile);
    formData.append("name", safeName);
    formData.append("description", templateUploadDescription.trim() || (locale === "pt" ? "Template enviado pela área administrativa." : "Template uploaded from the admin console."));
    formData.append("template_type", templateUploadType);
    formData.append("language", templateUploadLanguage);
    formData.append("version", templateUploadVersion || "v1.0");
    formData.append("active", "true");
    formData.append("default_template", "false");
    formData.append("uploaded_by", currentUserName || "Admin");

    try {
      const res = await fetch("/api/templates/proposals", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível criar o template." : "Could not create template."));
        return;
      }

      setTemplateUploadFile(null);
      setTemplateUploadFileName("");
      setTemplateUploadName("");
      setTemplateUploadDescription("");
      setTemplateUploadVersion("v1.0");
      setTemplateUploadType("technical");
      setTemplateUploadLanguage("Portuguese");
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

      const unknown: string[] = data.unknown_variables || [];
      const unknownWarning = unknown.length > 0
        ? (locale === "pt"
            ? `\n\nATENÇÃO: ${unknown.length} variável(is) não reconhecida(s) - vão aparecer em branco no documento gerado: ${unknown.join(", ")}`
            : `\n\nWARNING: ${unknown.length} unrecognized variable(s) - they will render blank in the generated document: ${unknown.join(", ")}`)
        : "";

      alert((locale === "pt"
        ? `Template validado. Variáveis: ${(data.variables || []).join(", ") || "nenhuma"}`
        : `Template validated. Variables: ${(data.variables || []).join(", ") || "none"}`) + unknownWarning);
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível salvar o prompt." : "Could not save the prompt."));
        return;
      }
      await fetchGlobalConfigs();
      alert(locale === "pt" ? "Prompt salvo com sucesso." : "Prompt template saved successfully!");
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao salvar prompt." : "Error saving prompt.");
    }
  };

  // Real versioning: this creates a new row (never auto-activated - see the route/dbStore comment)
  // instead of mutating the existing version's content in place.
  const handleCreatePromptVersion = async (params: { name: string; type: string; content: string; language: string; version: string }) => {
    try {
      const res = await fetch("/api/settings/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível criar a nova versão." : "Could not create the new version."));
        return null;
      }
      const created = await res.json();
      await fetchGlobalConfigs();
      return created;
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao criar nova versão do prompt." : "Error creating new prompt version.");
      return null;
    }
  };

  const handleActivatePromptVersion = async (id: string) => {
    try {
      const res = await fetch(`/api/settings/prompts/${id}/activate`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || (locale === "pt" ? "Não foi possível ativar esta versão." : "Could not activate this version."));
        return;
      }
      await fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao ativar versão do prompt." : "Error activating prompt version.");
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

  const handleSavePlatformSettings = async (field: string, val: any) => {
    const aiFields = [
      "ai_provider",
      "default_model",
      "document_analysis_model",
      "proposal_generation_model",
      "document_analysis_provider",
      "critical_extraction_model",
      "critical_extraction_provider",
      "web_grounding_model",
      "web_grounding_provider",
      "proposal_generation_provider",
      "spec_copilot_model",
      "spec_copilot_provider",
      "document_classification_model",
      "document_classification_provider",
      "poc_test_generation_model",
      "poc_test_generation_provider",
      "poc_schedule_generation_model",
      "poc_schedule_generation_provider",
      "poc_final_report_generation_model",
      "poc_final_report_generation_provider",
      "proposal_opinion_panel_model",
      "proposal_opinion_panel_provider",
      "monthly_cost_cap_usd",
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

  const AI_KEY_FIELD: Record<"gemini" | "openai" | "anthropic", string> = {
    gemini: "ai_api_key",
    openai: "openai_api_key",
    anthropic: "anthropic_api_key",
  };

  const handleSaveAiApiKey = async (provider: "gemini" | "openai" | "anthropic", apiKey: string) => {
    const key = apiKey.trim();

    if (!key) {
      alert(locale === "pt" ? "Informe a chave de API antes de salvar." : "Enter the API key before saving.");
      return;
    }

    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [AI_KEY_FIELD[provider]]: key })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível salvar a chave." : "Could not save API key."));
        return;
      }

      setPlatformSettings(data);
      alert(locale === "pt" ? "Chave de API salva com segurança." : "API key saved securely.");
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao salvar chave de API." : "Error saving API key.");
    }
  };

  const handleClearAiApiKey = async (provider: "gemini" | "openai" | "anthropic") => {
    if (!confirm(locale === "pt" ? "Remover a chave de API salva?" : "Remove saved API key?")) return;

    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [`clear_${AI_KEY_FIELD[provider]}`]: true })
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

  // Custom, user-added AI providers (any OpenAI-compatible endpoint - Grok/xAI, DeepSeek,
  // Mistral AI, etc.) on top of the 3 built-in ones.
  const handleAddAiProvider = async (params: { provider_key: string; display_name: string; base_url: string; api_key: string; default_model: string; supports_vision: boolean; supports_web_search: boolean }) => {
    try {
      const res = await fetch("/api/settings/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível adicionar o provedor." : "Could not add the provider."));
        return null;
      }
      await fetchGlobalConfigs();
      return data;
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao adicionar provedor de IA." : "Error adding AI provider.");
      return null;
    }
  };

  const handleDeleteAiProvider = async (id: string) => {
    if (!confirm(locale === "pt" ? "Remover este provedor de IA? Tarefas configuradas para ele passarão a usar Gemini como alternativa." : "Remove this AI provider? Tasks configured to use it will fall back to Gemini.")) return;

    try {
      const res = await fetch(`/api/settings/ai-providers/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.message || (locale === "pt" ? "Não foi possível remover o provedor." : "Could not remove the provider."));
        return;
      }
      await fetchGlobalConfigs();
    } catch (err) {
      console.error(err);
      alert(locale === "pt" ? "Erro ao remover provedor de IA." : "Error removing AI provider.");
    }
  };

  return {
    proposalVariableCatalog,
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
    handleCreatePromptVersion,
    handleActivatePromptVersion,
    handleValidateStorageSettings,
    handleSavePlatformSettings,
    handleSaveAiApiKey,
    handleClearAiApiKey,
    handleAddAiProvider,
    handleDeleteAiProvider,
  };
}
