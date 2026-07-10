interface UseApprovalCenterParams {
  locale: string;
  selectedProjectId: string;
  fetchGlobalConfigs: () => Promise<void> | void;
  fetchProjectDetails: (projectId: string) => Promise<void> | void;
  canReviewApprovalStage: (stage: any) => boolean;
}

// Handler exclusive to the Approval Center tab: recording an approve/reject decision on a stage.
export function useApprovalCenter(params: UseApprovalCenterParams) {
  const { locale, selectedProjectId, fetchGlobalConfigs, fetchProjectDetails, canReviewApprovalStage } = params;

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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível registrar a decisão." : "Could not record the decision."));
        return;
      }
      fetchProjectDetails(selectedProjectId);
      fetchGlobalConfigs();
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao registrar a decisão." : "Error recording the decision.");
    }
  };

  return { handleApprovalDecision };
}
