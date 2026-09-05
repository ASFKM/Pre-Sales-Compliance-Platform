/*
 * F8 (rodada 09/2026): QUEM É APROVADOR DESIGNADO — a regra, no servidor.
 *
 * Até esta fase a regra existia num único lugar: `canReviewApprovalStage`, dentro de
 * src/components/Approval.tsx. Ela decidia se os botões Aprovar/Rejeitar apareciam, e o menu
 * "Centro de Aprovação" não decidia nada — o botão era um `setActiveTab("approval")` puro, visível
 * para todo usuário logado, inclusive quem não é aprovador de estágio nenhum.
 *
 * A regra é a MESMA de lá, letra por letra ("user" compara com o id do usuário; "role" compara com
 * o id do papel), e é isso que importa: ela foi PROMOVIDA, não reescrita. O cliente passa a
 * consumir a resposta desta função em vez de recalculá-la, e assim as duas pontas não podem
 * divergir — que é o modo como um gate de tela costuma morrer.
 *
 * Um gate só de tela não é gate: esconder o menu não impede uma chamada direta. Por isso esta
 * mesma função autoriza o dossiê (GET /proposals/:id/dossie-de-aprovacao) e a rota de decisão
 * continua com o seu 403 próprio, na posição que o script de regressão exercita.
 */

export type ApproverType = "user" | "role";

export interface EstagioParaEscopo {
  id: string;
  name?: string;
  order?: number;
  approver_type: ApproverType | string;
  approver_user_id?: string | null;
  approver_role_id?: string | null;
  mandatory?: boolean;
}

export interface WorkflowParaEscopo {
  id: string;
  name?: string;
  active?: boolean;
  stages?: EstagioParaEscopo[] | null;
}

export interface IdentidadeDoAprovador {
  userId: string;
  roleId: string;
}

export interface EstagioDesignado {
  workflow_id: string;
  workflow_name: string;
  stage_id: string;
  stage_name: string;
  order: number;
  approver_type: string;
  mandatory: boolean;
}

/**
 * A regra atômica, idêntica à `canReviewApprovalStage` do cliente.
 *
 * Um estágio com alvo NÃO CONFIGURADO (approver_type "user" sem `approver_user_id`, ou "role" sem
 * `approver_role_id`) não designa ninguém. Sem essa guarda, uma identidade com `roleId` vazio
 * casaria com um estágio de `approver_role_id` nulo por coincidência de falsy, e um usuário sem
 * papel viraria aprovador de todo estágio mal configurado do sistema.
 */
export function ehAprovadorDoEstagio(estagio: EstagioParaEscopo | null | undefined, quem: IdentidadeDoAprovador): boolean {
  if (!estagio) return false;
  if (!quem.userId || !quem.roleId) return false;

  if (estagio.approver_type === "user") {
    return Boolean(estagio.approver_user_id) && estagio.approver_user_id === quem.userId;
  }

  return Boolean(estagio.approver_role_id) && estagio.approver_role_id === quem.roleId;
}

/**
 * Todos os estágios em que esta identidade é a aprovadora designada, entre os workflows ATIVOS.
 *
 * Workflow inativo fica de fora de propósito: ele não julga proposta nenhuma, e contá-lo faria o
 * menu aparecer para quem só aprova num fluxo que ninguém usa mais.
 */
export function estagiosDesignadosPara(
  workflows: readonly WorkflowParaEscopo[],
  quem: IdentidadeDoAprovador
): EstagioDesignado[] {
  const designados: EstagioDesignado[] = [];

  for (const workflow of workflows || []) {
    if (workflow.active === false) continue;

    for (const estagio of workflow.stages || []) {
      if (!ehAprovadorDoEstagio(estagio, quem)) continue;
      designados.push({
        workflow_id: workflow.id,
        workflow_name: workflow.name || "",
        stage_id: estagio.id,
        stage_name: estagio.name || "",
        order: estagio.order ?? 0,
        approver_type: String(estagio.approver_type),
        mandatory: estagio.mandatory !== false,
      });
    }
  }

  return designados;
}

/**
 * O booleano do MENU: "sou aprovador de alguma coisa, em algum lugar".
 *
 * Ele e a lista acima saem da MESMA chamada, e não de duas rotas, porque as duas perguntas da fase
 * ("sou aprovador em geral?", para o menu, e "sou aprovador DESTE estágio?", para os botões) têm a
 * mesma resposta subjacente: o conjunto de estágios designados. Perguntar estágio a estágio faria o
 * menu custar N requisições; duas rotas separadas duplicariam a regra e deixariam as duas cópias
 * livres para divergir — que é exatamente o defeito que esta fase veio consertar.
 */
export function ehAprovadorDesignado(workflows: readonly WorkflowParaEscopo[], quem: IdentidadeDoAprovador): boolean {
  return estagiosDesignadosPara(workflows, quem).length > 0;
}

/** É aprovador de ALGUM estágio do workflow DESTA proposta — o gate do dossiê. */
export function podeVerDossieDaProposta(
  workflows: readonly WorkflowParaEscopo[],
  workflowIdDaProposta: string | null | undefined,
  quem: IdentidadeDoAprovador
): boolean {
  if (!workflowIdDaProposta) return false;
  return estagiosDesignadosPara(workflows, quem).some((e) => e.workflow_id === workflowIdDaProposta);
}
