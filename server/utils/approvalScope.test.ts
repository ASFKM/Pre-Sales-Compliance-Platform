import { describe, expect, it } from "vitest";
import {
  ehAprovadorDoEstagio,
  estagiosDesignadosPara,
  ehAprovadorDesignado,
  podeVerDossieDaProposta,
  WorkflowParaEscopo,
} from "./approvalScope";

/*
 * F8 — o gate do Centro de Aprovação.
 *
 * O defeito que estes testes travam: até esta fase a regra "sou aprovador designado?" existia SÓ no
 * cliente (canReviewApprovalStage, src/components/Approval.tsx) e o botão do menu não a consultava
 * — ele aparecia para todo usuário logado. Cada caso abaixo descreve uma decisão do servidor.
 */

// Os workflows reais do banco desta instalação, no formato em que dbStore os devolve.
const WORKFLOWS: WorkflowParaEscopo[] = [
  {
    id: "w1",
    name: "High-Value Infrastructure Approval Workflow",
    active: true,
    stages: [
      { id: "w1-s1", name: "Pre-Sales Technical Verification", order: 1, approver_type: "role", approver_role_id: "r3" },
      { id: "w1-s2", name: "Commercial & Margin Validation", order: 2, approver_type: "role", approver_role_id: "r2" },
      { id: "w1-s3", name: "Executive & Director Sign-off", order: 3, approver_type: "role", approver_role_id: "r1" },
    ],
  },
  {
    id: "w2",
    name: "Standard Smart City Bid Flow",
    active: true,
    stages: [
      { id: "w2-s1", name: "Technical Specification Verification", order: 1, approver_type: "role", approver_role_id: "r3" },
      { id: "w2-s2", name: "Commercial Approvals", order: 2, approver_type: "role", approver_role_id: "r2" },
    ],
  },
];

describe("F8 — ehAprovadorDoEstagio (a regra atômica, promovida do cliente)", () => {
  it("casa por PAPEL quando o estágio é do tipo role", () => {
    expect(ehAprovadorDoEstagio(WORKFLOWS[0].stages![1], { userId: "u2", roleId: "r2" })).toBe(true);
    expect(ehAprovadorDoEstagio(WORKFLOWS[0].stages![1], { userId: "u3", roleId: "r3" })).toBe(false);
  });

  it("casa por USUÁRIO quando o estágio é do tipo user, e ignora o papel", () => {
    const estagio = { id: "s", approver_type: "user" as const, approver_user_id: "u9", approver_role_id: "r1" };
    expect(ehAprovadorDoEstagio(estagio, { userId: "u9", roleId: "rX" })).toBe(true);
    // O papel bate, o usuário não: um estágio "user" não designa o papel inteiro.
    expect(ehAprovadorDoEstagio(estagio, { userId: "u1", roleId: "r1" })).toBe(false);
  });

  it("um estágio com alvo NÃO configurado não designa ninguém", () => {
    // Sem esta guarda, uma identidade com roleId vazio casaria por falsy com o nulo do estágio.
    expect(ehAprovadorDoEstagio({ id: "s", approver_type: "role", approver_role_id: null }, { userId: "u1", roleId: "r1" })).toBe(false);
    expect(ehAprovadorDoEstagio({ id: "s", approver_type: "user", approver_user_id: null }, { userId: "u1", roleId: "r1" })).toBe(false);
  });

  it("identidade incompleta nunca é aprovadora", () => {
    expect(ehAprovadorDoEstagio(WORKFLOWS[0].stages![0], { userId: "", roleId: "r3" })).toBe(false);
    expect(ehAprovadorDoEstagio(WORKFLOWS[0].stages![0], { userId: "u3", roleId: "" })).toBe(false);
    expect(ehAprovadorDoEstagio(null, { userId: "u3", roleId: "r3" })).toBe(false);
  });
});

describe("F8 — estagiosDesignadosPara", () => {
  it("devolve TODOS os estágios do papel, em workflows diferentes", () => {
    // r2 (Sales Manager, o papel de marcus.vance) aprova em dois estágios de dois fluxos.
    const designados = estagiosDesignadosPara(WORKFLOWS, { userId: "u2", roleId: "r2" });
    expect(designados.map((d) => d.stage_id).sort()).toEqual(["w1-s2", "w2-s2"]);
    expect(designados[0]).toMatchObject({ workflow_id: "w1", stage_name: "Commercial & Margin Validation", order: 2 });
  });

  it("ignora workflow INATIVO", () => {
    const inativos = WORKFLOWS.map((w) => ({ ...w, active: false }));
    expect(estagiosDesignadosPara(inativos, { userId: "u2", roleId: "r2" })).toEqual([]);
  });

  it("papel que não aprova nada devolve lista vazia — é este caso que esconde o menu", () => {
    expect(estagiosDesignadosPara(WORKFLOWS, { userId: "uX", roleId: "r_sem_alcada" })).toEqual([]);
    expect(ehAprovadorDesignado(WORKFLOWS, { userId: "uX", roleId: "r_sem_alcada" })).toBe(false);
  });

  it("aguenta workflow sem estágios e lista vazia", () => {
    expect(estagiosDesignadosPara([{ id: "w9", active: true, stages: null }], { userId: "u1", roleId: "r1" })).toEqual([]);
    expect(estagiosDesignadosPara([], { userId: "u1", roleId: "r1" })).toEqual([]);
  });
});

describe("F8 — podeVerDossieDaProposta (o gate do dossiê, por proposta)", () => {
  it("libera quem aprova ALGUM estágio do workflow DAQUELA proposta", () => {
    expect(podeVerDossieDaProposta(WORKFLOWS, "w1", { userId: "u2", roleId: "r2" })).toBe(true);
  });

  it("recusa quem só aprova em OUTRO workflow", () => {
    // r1 aprova em w1-s3, mas não tem estágio nenhum em w2.
    expect(podeVerDossieDaProposta(WORKFLOWS, "w2", { userId: "u1", roleId: "r1" })).toBe(false);
  });

  it("proposta sem workflow não abre dossiê para ninguém", () => {
    expect(podeVerDossieDaProposta(WORKFLOWS, null, { userId: "u1", roleId: "r1" })).toBe(false);
    expect(podeVerDossieDaProposta(WORKFLOWS, "", { userId: "u1", roleId: "r1" })).toBe(false);
  });
});
