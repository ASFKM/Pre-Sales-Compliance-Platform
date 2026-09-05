/*
 * F9 — cria um alvo RICO para a prova de tela do assistente do aprovador.
 *
 * A prova de backend roda sobre uma v2 real (prop_ca71b0cee40d92e2), mas ela esta `rejected` e por
 * isso nao aparece no Centro de Aprovacao — e a prova de TELA precisa de uma proposta que o
 * aprovador realmente veja la, ou seja `submitted`.
 *
 * O alvo nasce com exatamente o material que o assistente existe para ler:
 *   - um apontamento marcado como RESOLVIDO com uma justificativa que responde DE LADO (fala de
 *     prazo quando o apontamento falava de responsabilidade pela operacao);
 *   - um apontamento ACEITO COM RISCO, com justificativa generica;
 *   - uma EDICAO DE SECAO minuscula, para o percentual de mudanca medido ficar perto de zero.
 *
 * Nada aqui e fabricacao de evidencia: e um cenario de teste explicitamente nomeado como prova
 * ("Prova PreSales F9"), do mesmo tipo que a F8 criou, e o que se prova com ele e o comportamento
 * do codigo — nao a qualidade de uma proposta real.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import crypto from "node:crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const rid = (p: string) => `${p}_${crypto.randomBytes(8).toString("hex")}`;

const modelo = await prisma.proposal.findUniqueOrThrow({ where: { id: "prop_07fcad053d9188e7" } });
const { id: _id, generatedAt: _g, ...campos } = modelo as any;

const id = `prop_f9prova_${crypto.randomBytes(6).toString("hex")}`;
const tenantId = modelo.tenantId;

const TEXTO_ANTERIOR =
  "A CloudMountain entrega o ambiente configurado e realiza a passagem de conhecimento para a equipe do cliente ao final da implantacao.";
const TEXTO_NOVO =
  "A CloudMountain entrega o ambiente configurado e realiza a passagem de conhecimento para a equipe do cliente ao fim da implantacao.";

await prisma.proposal.create({
  data: {
    ...campos,
    id,
    proposalGroupId: id,
    previousVersionId: null,
    latestOpinionRunId: null,
    status: "submitted",
    version: 1,
    templateFieldValues: { ...(modelo.templateFieldValues as any), proximos_passos: TEXTO_NOVO },
  },
});

const runId = rid("por");
await prisma.proposalOpinionRun.create({
  data: {
    id: runId,
    tenantId,
    proposalId: id,
    status: "completed",
    origem: "ia",
    requestedByUserId: "u2",
    logicVersion: 3,
    completedAt: new Date(),
  },
});
await prisma.proposal.update({ where: { id }, data: { latestOpinionRunId: runId } });

const opinionId = rid("pao");
await prisma.proposalAiOpinionItem.create({
  data: {
    id: opinionId,
    tenantId,
    runId,
    perspective: "technical",
    status: "completed",
    severity: "critical",
    summary: "Responsabilidade pela operacao e validade da proposta.",
    content: "Parecer tecnico da rodada de prova da F9.",
    providerUsed: "gemini",
    modelUsed: "gemini-3.5-flash",
  },
});

const f1 = rid("pof");
const f2 = rid("pof");
await prisma.proposalOpinionFinding.createMany({
  data: [
    {
      id: f1,
      tenantId,
      opinionId,
      ordinal: 1,
      title: "A proposta nao diz quem opera o ambiente depois da entrega",
      detail:
        "A secao de proximos passos descreve a passagem de conhecimento, mas nao nomeia o responsavel pela operacao e pelo suporte de primeiro nivel depois da implantacao.",
      severity: "critical",
      targetKind: "template_field",
      targetKey: "proximos_passos",
      status: "resolvido",
      origem: "ia",
      // A tratativa que RESPONDE DE LADO: o apontamento fala de responsabilidade pela operacao, e
      // a justificativa fala de prazo acordado em reuniao. E este par que o assistente deve ver.
      resolutionNote: "O prazo de entrega foi validado com o cliente em reuniao no dia 02/09 e esta acordado.",
      resolvedAt: new Date(),
    },
    {
      id: f2,
      tenantId,
      opinionId,
      ordinal: 2,
      title: "Validade da proposta muito longa para o tipo de fornecimento",
      detail:
        "A validade se estende por mais de seis meses num fornecimento com componentes de hardware importados, cujo custo varia no periodo.",
      severity: "critical",
      targetKind: "proposal_field",
      targetKey: "proposal_validity",
      status: "aceito_com_risco",
      origem: "ia",
      resolutionNote: "O cliente esta ciente.",
      resolvedAt: new Date(),
    },
  ],
});

// A EDICAO MINUSCULA: uma palavra trocada numa secao que o apontamento critico apontava.
await prisma.proposalSectionEdit.create({
  data: {
    id: rid("pse"),
    tenantId,
    proposalId: id,
    findingId: f1,
    targetKind: "template_field",
    targetKey: "proximos_passos",
    previousValue: TEXTO_ANTERIOR,
    newValue: TEXTO_NOVO,
    origin: "manual",
    authorUserId: "u2",
  },
});

console.log(JSON.stringify({ alvo: id, apontamentos: [f1, f2] }));
await prisma.$disconnect();
