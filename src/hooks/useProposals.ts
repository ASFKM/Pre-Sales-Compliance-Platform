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
      if (res.ok) {
        fetchProjectDetails(selectedProjectId);
        fetchGlobalConfigs();
      }
    } catch (e) {
      console.error(e);
    }
  };

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

  return { handleUpdateProposalCommercial, handleSubmitProposalApproval };
}
