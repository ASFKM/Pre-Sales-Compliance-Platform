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

  // PreSales F8: a assinatura (propId, stage, decision, comments) é a mesma de sempre - o que mudou
  // é que `comments` agora vem do que o aprovador DIGITOU na tela, e não mais de uma frase fixa no
  // código de Approval.tsx. Passou a devolver `true`/`false` para que quem chama saiba se pode
  // limpar a caixa de texto: numa recusa do servidor (rejeição sem motivo dá 400, ver
  // server/utils/approvalDecision.ts) apagar o rascunho do aprovador seria perder o texto dele.
  const handleApprovalDecision = async (
    propId: string,
    stage: any,
    decision: "approved" | "rejected",
    comments: string,
    // F8: os itens da rejeição estruturada. Ausentes numa aprovação, e ausentes numa rejeição feita
    // só com texto livre - os dois casos continuam válidos.
    items?: { target_kind: string; target_key: string; comment: string; section_snapshot: string | null }[]
  ): Promise<boolean> => {
    if (!canReviewApprovalStage(stage)) {
      alert(locale === "pt" ? "Você não é o aprovador configurado para esta etapa." : "You are not the configured approver for this stage.");
      return false;
    }

    const stageId = stage.id;

    try {
      const res = await fetch(`/api/proposals/${propId}/approval/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage_id: stageId,
          decision,
          comments,
          // `undefined` não vira campo no JSON: um cliente que não mande itens continua produzindo
          // exatamente o corpo de antes desta fase.
          items: items && items.length > 0 ? items : undefined,
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || (locale === "pt" ? "Não foi possível registrar a decisão." : "Could not record the decision."));
        return false;
      }
      await fetchProjectDetails(selectedProjectId);
      await fetchGlobalConfigs();
      return true;
    } catch (e) {
      console.error(e);
      alert(locale === "pt" ? "Erro ao registrar a decisão." : "Error recording the decision.");
      return false;
    }
  };

  return { handleApprovalDecision };
}
