interface UseProposalsParams {
  locale: string;
  hasPermission: (perm: string) => boolean;
  proposals: any[];
  selectedProjectId: string;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
}

// Handlers exclusive to the Proposal Studio tab (editing a draft's manual pricing table,
// submitting a proposal into the approval workflow).
export function useProposals(params: UseProposalsParams) {
  const { locale, hasPermission, proposals, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails } = params;

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

    const updatedTable = prop.manual_pricing_table.map((row: any) => {
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível salvar a alteração de preço." : "Could not save the pricing change."));
        return;
      }
      fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao salvar a alteração de preço." : "Error saving the pricing change.");
    }
  };

  // Generic structured-field save for the Proposal Studio editor (PARTE A) - replaces the old
  // free-text `editable_content` PUT, which always discarded a real uploaded template's letterhead
  // on save (see server/routes/proposals.ts's PUT /proposals/:id comment). `patch` only ever
  // carries the fields the proposal's own type allows (src/lib/proposalEditableFields.ts) - the
  // server independently re-validates that and rejects anything else with a 400.
  const handleUpdateProposalFields = async (propId: string, patch: Record<string, any>) => {
    if (!hasPermission("proposal:edit")) {
      alert(locale === "pt" ? "Você não tem permissão para editar propostas." : "You do not have permission to edit proposals.");
      return false;
    }

    try {
      const res = await fetch(`/api/proposals/${propId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível salvar as alterações." : "Could not save changes."));
        return false;
      }
      await fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
      return true;
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao salvar as alterações." : "Error saving changes.");
      return false;
    }
  };

  const handleSubmitProposalApproval = async (propId: string) => {
    if (!hasPermission("approval:manage")) {
      alert(locale === "pt" ? "Você não tem permissão para enviar propostas para aprovação." : "You do not have permission to submit proposals for approval.");
      return;
    }

    try {
      const res = await fetch(`/api/proposals/${propId}/approval/submit`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível enviar a proposta para aprovação." : "Could not submit the proposal for approval."));
        return;
      }
      fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao enviar a proposta para aprovação." : "Error submitting the proposal for approval.");
    }
  };

  return { handleUpdateProposalCommercial, handleUpdateProposalFields, handleSubmitProposalApproval };
}
