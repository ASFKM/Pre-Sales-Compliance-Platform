/**
 * CDC 16 — Fase 6. Prova por execução real, ETAPA 2: o CAMINHO SECUNDÁRIO saindo daqui.
 *
 * Roda no host do PreSales, contra um servidor de prova em banco dedicado, e fala com o CMCRM
 * VIVO pela rede — sem mock em lugar nenhum.
 *
 * O que ela exercita é o PRODUTO, pelas ROTAS, com login real: o pré-vendas cria o projeto, o
 * passo do CRM procura a empresa, vincula à oportunidade que já existia num caso e cria empresa e
 * oportunidade no outro, e as colunas de referência do projeto (D31) ficam preenchidas. A demanda
 * ESPELHO nasce dos dois lados, e é por ela que o retorno da F3/F4/F5 passa a ter para onde
 * chegar num projeto que nasceu AQUI.
 *
 * Também prova o que não pode mudar: sem par, o intake não ganha passo nenhum (D12).
 *
 *   PROVA_PASSWORD=… ORG_DO_CRM=… npx tsx scripts/cdc16-f6-provar-caminho-secundario.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { randomId } from "../src/idGenerator";
import { lerChaveDoCrm } from "../server/utils/crmPort";
import { estadoDoCrm } from "../server/utils/crmDirectory";
import { acharCnpjNoTexto } from "../server/utils/cnpj";
import { PAPEIS_DA_PROVA, chamarRota, entrarComo, esperarSaidaDe, papelDaProva } from "./cdc16-f5-comum";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const PREFIXO = "prova-cdc16-f6-";
/** O CNPJ que a ETAPA 1 cadastrou no CRM, com dígito verificador de verdade. */
const CNPJ_QUE_EXISTE = process.env.CNPJ_MATRIZ || "04252011000110";
const CNPJ_QUE_NAO_EXISTE = "27865757000102";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    passou++;
    linhas.push(`  OK    ${rotulo} — ${detalhe}`);
  } else {
    falhou++;
    linhas.push(`  FALHA ${rotulo} — ${detalhe}`);
  }
}

async function criarProjetoPelaRota(sessao: Awaited<ReturnType<typeof entrarComo>>, nome: string) {
  const r = await chamarRota(sessao!, "POST", "/api/projects", {
    name: nome,
    customer_name: "Prefeitura de Exemplo",
    opportunity_name: nome,
    vertical: "Segurança Pública",
    description: "Edital subido direto pelo pré-vendas, sem demanda do CRM.",
    status: "draft",
    deadline: "2026-12-31",
    proposal_validity_date: "2027-01-31",
    output_language: "Portuguese",
    proposal_language: "Portuguese",
    ai_orientation_mode: "Vendor-neutral",
    ai_orientation_text: "",
  });
  return r;
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real");
  const orgDoCrm = process.env.ORG_DO_CRM;
  if (!orgDoCrm) throw new Error("ORG_DO_CRM ausente — é a organização que a ETAPA 1 usou");
  linhas.push(`(base=${BASE}, tenant=${TENANT}, org=${orgDoCrm})`);

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    /*
     * Cenário limpo do PRÓPRIO script, e por prefixo. Sem isto a prova não é reexecutável: a
     * organização escolhida fica guardada no par (é um fato da instalação, e é para ficar), e a
     * primeira conferência — a de que NADA é adotado sozinho quando há mais de uma elegível —
     * mentiria a partir da segunda execução. Os projetos e demandas da rodada anterior saem
     * junto, pelo mesmo motivo que a F5 escreveu: uma conferência que herda estado não confere.
     */
    await prisma.demandOutboundEvent.deleteMany({
      where: { demand: { demandRef: { startsWith: "presales-" } } },
    });
    await prisma.demand.deleteMany({ where: { source: "presales" } });
    await prisma.project.deleteMany({ where: { name: { startsWith: PREFIXO } } });
    await prisma.crmPairKey.updateMany({ where: { tenantId: TENANT }, data: { crmOrganizationId: null } });

    const chaveDoPar = await lerChaveDoCrm(TENANT);
    checar("a chave do par está guardada deste lado (F3)", !!chaveDoPar, `hint=${chaveDoPar?.keyHint ?? "-"}`);
    if (!chaveDoPar) return;

    const papel = await papelDaProva("Prova F6 — pré-vendas", [
      ...PAPEIS_DA_PROVA.equipe,
      "project:create",
      "project:update",
    ]);
    const marina = await entrarComo(
      "Marina da prova F6",
      `${PREFIXO}marina@local.invalid`,
      papel.id,
      senha,
      checar,
    );
    if (!marina) return;

    // ═══════════════════════════ 1. o CNPJ que a extração passa a caçar (ADR 0001 §2.9)
    linhas.push("== 1. O CNPJ sai do edital, e não da IA ==");
    const trechoDeEdital = `
      PREFEITURA MUNICIPAL DE EXEMPLO
      Processo administrativo nº 12.345.678/9012-34
      Órgão contratante inscrito no CNPJ ${CNPJ_QUE_EXISTE}
      PREGÃO ELETRÔNICO Nº 1/2026
    `;
    const achado = acharCnpjNoTexto(trechoDeEdital);
    checar(
      "a extração acha o CNPJ do órgão e IGNORA o número de processo de 14 dígitos",
      achado === CNPJ_QUE_EXISTE,
      `achado=${achado}`,
    );

    // ═══════════════════════════ 2. o estado do par visto pela tela
    linhas.push("== 2. GET /api/crm/status ==");
    const status = await chamarRota(marina, "GET", "/api/crm/status");
    checar(
      "a tela sabe que há par e quantas organizações do CRM já o exerceram",
      status.status === 200 && status.corpo?.ativo === true && Array.isArray(status.corpo?.organizations),
      `ativo=${status.corpo?.ativo} n=${status.corpo?.organizations?.length}`,
    );
    checar(
      "a organização da ETAPA 1 está entre elas",
      (status.corpo?.organizations ?? []).some((o: any) => o.id === orgDoCrm),
      `org=${orgDoCrm}`,
    );

    // Com mais de uma elegível, nada é escolhido sozinho — quem escolhe é uma pessoa, uma vez.
    if ((status.corpo?.organizations?.length ?? 0) > 1) {
      checar(
        "com mais de uma elegível, nenhuma é adotada sozinha",
        status.corpo?.organizationId === null,
        `escolhida=${JSON.stringify(status.corpo?.organizationId)}`,
      );
      const escolhaRuim = await chamarRota(marina, "PUT", "/api/crm/organization", {
        organization_id: "00000000-0000-0000-0000-000000000000",
      });
      checar(
        "uma organização que não está na lista é recusada AQUI, com mensagem, e não com 403 lá",
        escolhaRuim.status === 400,
        `status=${escolhaRuim.status} msg=${escolhaRuim.corpo?.message}`,
      );
      const escolha = await chamarRota(marina, "PUT", "/api/crm/organization", {
        organization_id: orgDoCrm,
      });
      checar("a escolha é guardada no PAR, não no projeto", escolha.status === 200, `status=${escolha.status}`);
      const guardada = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
      checar(
        "e ela fica no banco, para não ser pedida a cada edital",
        guardada?.crmOrganizationId === orgDoCrm,
        `guardada=${guardada?.crmOrganizationId}`,
      );
    }

    // ═══════════════════════════ 3. a busca
    linhas.push("== 3. A busca no CRM, pela rota ==");
    const curta = await chamarRota(marina, "GET", "/api/crm/companies/search?name=SA");
    checar("nome curto demais é recusado com a mensagem do CRM, e não com um erro genérico",
      curta.status === 400 && String(curta.corpo?.message ?? "").includes("3 caracteres"),
      `status=${curta.status} msg=${curta.corpo?.message}`);

    const porCnpj = await chamarRota(marina, "GET", `/api/crm/companies/search?tax_id=${CNPJ_QUE_EXISTE}`);
    const candidata = porCnpj.corpo?.candidates?.[0];
    checar(
      "o CNPJ do edital acha a empresa que já existe no CRM",
      porCnpj.status === 200 && porCnpj.corpo?.match_kind === "exact_tax_id" && !!candidata,
      `match=${porCnpj.corpo?.match_kind} n=${porCnpj.corpo?.candidates?.length}`,
    );
    checar(
      "e traz a oportunidade ABERTA dela — é isso que evita abrir a segunda",
      (candidata?.open_opportunities ?? []).length > 0,
      `abertas=${JSON.stringify(candidata?.open_opportunities?.map((o: any) => o.name))}`,
    );

    const semNada = await chamarRota(marina, "GET", `/api/crm/companies/search?tax_id=${CNPJ_QUE_NAO_EXISTE}`);
    checar("um CNPJ que não existe lá devolve lista vazia, e não erro",
      semNada.status === 200 && (semNada.corpo?.candidates ?? []).length === 0,
      `status=${semNada.status} n=${semNada.corpo?.candidates?.length}`);

    // ═══════════════════════════ 4. vincular à oportunidade que já existia
    linhas.push("== 4. Vincular, em vez de criar outra ==");
    const nomeA = `${PREFIXO}vinculo-${Date.now()}`;
    const projA = await criarProjetoPelaRota(marina, nomeA);
    checar("o projeto nasce pelo intake, sem referência nenhuma ao CRM (modo de hoje)",
      projA.status === 201 && !projA.corpo?.crm_company_id && !projA.corpo?.crm_opportunity_id,
      `status=${projA.status} company=${projA.corpo?.crm_company_id}`);

    const oportunidadeExistente = candidata.open_opportunities[0];
    const vinculo = await chamarRota(marina, "POST", `/api/crm/projects/${projA.corpo.id}/link`, {
      crm_company_id: candidata.crm_company_id,
      crm_opportunity_id: oportunidadeExistente.crm_opportunity_id,
    });
    checar("o vínculo a uma oportunidade existente responde 201",
      vinculo.status === 201, `status=${vinculo.status} msg=${vinculo.corpo?.message}`);
    checar("e NÃO cria demanda espelho — não há oportunidade nova para endereçar",
      vinculo.corpo?.demand_ref === null, `ref=${JSON.stringify(vinculo.corpo?.demand_ref)}`);

    const projALido = await chamarRota(marina, "GET", `/api/projects/${projA.corpo.id}`);
    checar(
      "as duas colunas de referência do projeto ficam preenchidas, e VISÍVEIS pela API (D31)",
      projALido.corpo?.crm_company_id === candidata.crm_company_id &&
        projALido.corpo?.crm_opportunity_id === oportunidadeExistente.crm_opportunity_id,
      `company=${projALido.corpo?.crm_company_id} opp=${projALido.corpo?.crm_opportunity_id}`,
    );

    const jaVinculado = await chamarRota(marina, "POST", `/api/crm/projects/${projA.corpo.id}/link`, {
      crm_company_id: candidata.crm_company_id,
      crm_opportunity_id: oportunidadeExistente.crm_opportunity_id,
    });
    checar("vincular de novo é 409 — o projeto já tem oportunidade",
      jaVinculado.status === 409, `status=${jaVinculado.status}`);

    // ═══════════════════════════ 5. criar empresa e oportunidade
    linhas.push("== 5. Criar a empresa que não existia, e a oportunidade ==");
    const nomeB = `${PREFIXO}criacao-${Date.now()}`;
    const projB = await criarProjetoPelaRota(marina, nomeB);
    const criacao = await chamarRota(marina, "POST", `/api/crm/projects/${projB.corpo.id}/link`, {
      company: {
        name: `${PREFIXO}Prefeitura ${Date.now()}`,
        tax_id: CNPJ_QUE_NAO_EXISTE,
        sector: "Administração Pública",
      },
      opportunity_name: nomeB,
      value: 480000,
      expected_close_date: "2026-12-15",
    });
    checar("empresa e oportunidade criadas no CRM em uma chamada",
      criacao.status === 201 && !!criacao.corpo?.crm_company_id && !!criacao.corpo?.crm_opportunity_id,
      `status=${criacao.status} msg=${criacao.corpo?.message}`);
    checar(
      "a empresa nova não tem dono lá, então a oportunidade nasceu SEM DONO e a tela sabe disso (D13)",
      criacao.corpo?.unassigned === true,
      `unassigned=${criacao.corpo?.unassigned}`,
    );
    checar("a demanda ESPELHO ganhou referência", !!criacao.corpo?.demand_ref,
      `ref=${criacao.corpo?.demand_ref}`);

    const espelho = await prisma.demand.findFirst({ where: { demandRef: criacao.corpo.demand_ref } });
    checar(
      "e ela existe DESTE lado, assinada como nascida aqui, já assumida e ligada ao projeto",
      espelho?.source === "presales" &&
        espelho?.status === "assigned" &&
        espelho?.projectId === projB.corpo.id &&
        espelho?.sentByCrmUserId === null &&
        espelho?.sentByName === null,
      `source=${espelho?.source} status=${espelho?.status} projeto=${espelho?.projectId} remetente=${espelho?.sentByName}`,
    );
    checar(
      "o dono da demanda espelho é o dono do PROJETO — ninguém precisa assumi-la",
      espelho?.assignedUserId === marina.userId,
      `dono=${espelho?.assignedUserId}`,
    );

    // Uma segunda pessoa subindo o MESMO edital: a chave do vínculo é derivada do projeto, e o
    // dedup por CNPJ do outro lado impede a segunda empresa.
    const nomeC = `${PREFIXO}dedup-${Date.now()}`;
    const projC = await criarProjetoPelaRota(marina, nomeC);
    const segundaVez = await chamarRota(marina, "POST", `/api/crm/projects/${projC.corpo.id}/link`, {
      company: {
        name: `${PREFIXO}Prefeitura escrita de outro jeito`,
        tax_id: CNPJ_QUE_NAO_EXISTE,
      },
      opportunity_name: nomeC,
    });
    checar(
      "outra pessoa, mesmo CNPJ: NÃO nasce a segunda empresa no CRM",
      segundaVez.status === 201 &&
        segundaVez.corpo?.crm_company_id === criacao.corpo.crm_company_id &&
        segundaVez.corpo?.company_deduplicated === true,
      `empresa=${segundaVez.corpo?.crm_company_id} dedup=${segundaVez.corpo?.company_deduplicated}`,
    );
    checar(
      "mas a oportunidade é OUTRA — dois editais do mesmo cliente são dois negócios (D26)",
      segundaVez.corpo?.crm_opportunity_id !== criacao.corpo.crm_opportunity_id,
      `a=${criacao.corpo?.crm_opportunity_id} b=${segundaVez.corpo?.crm_opportunity_id}`,
    );

    // ═══════════════════════════ 6. o retorno passa a existir para um projeto nascido aqui
    linhas.push("== 6. O retorno, pelo endereço que a espelho criou ==");
    /*
     * O ato real escolhido é CONCLUIR O PROJETO, e não disparar a análise: o gancho de conclusão
     * (`dbStore.updateProject` → `concluirDemandaDoProjeto`) é o mesmo da F3 e é determinístico,
     * enquanto a rota de análise dispara IA de verdade em segundo plano — custo e espera que não
     * tornariam esta conferência mais verdadeira. O que se prova aqui é que o gancho ENCONTRA a
     * demanda espelho, que é o ponto: até esta fase ele só encontrava demandas vindas do CRM.
     */
    const conclusao = await chamarRota(marina, "PUT", `/api/projects/${projB.corpo.id}`, {
      ...projB.corpo,
      status: "completed",
    });
    checar(
      "concluir o projeto pela rota fecha a demanda espelho junto",
      conclusao.status === 200,
      `status=${conclusao.status} msg=${conclusao.corpo?.message}`,
    );
    const depois = await prisma.demand.findFirst({ where: { demandRef: criacao.corpo.demand_ref } });
    checar(
      "a demanda espelho foi para `completed` com o carimbo do fato (D20)",
      depois?.status === "completed" && !!depois?.completedAt,
      `status=${depois?.status} carimbo=${depois?.completedAt?.toISOString()}`,
    );
    const naFila = await prisma.demandOutboundEvent.findMany({
      where: { demandId: espelho!.id },
      orderBy: { createdAt: "asc" },
    });
    checar(
      "e o marco entrou na fila de saída — o projeto nascido AQUI passa a contar ao CRM",
      naFila.some((e) => e.event === "completed"),
      `eventos=${naFila.map((e) => e.event).join(",")}`,
    );
    const entregue = await esperarSaidaDe(espelho!.id, "completed");
    checar(
      "e chegou ao CRM VIVO pela rede, pelo endereço que a espelho criou",
      entregue?.status === "enviado",
      `estado=${entregue?.status} erro=${entregue?.lastError ?? "-"}`,
    );

    // ═══════════════════════════ 7. o modo standalone não muda
    linhas.push("== 7. Sem par, o intake é exatamente o que era (D12) ==");
    const guardada = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
    await prisma.crmPairKey.delete({ where: { tenantId: TENANT } });
    try {
      const semPar = await estadoDoCrm(TENANT);
      checar(
        "sem chave do par, o passo do CRM não existe — e o motivo é dito",
        semPar.ativo === false,
        `ativo=${semPar.ativo} motivo=${(semPar as any).motivo}`,
      );
      const statusSemPar = await chamarRota(marina, "GET", "/api/crm/status");
      checar(
        "a tela recebe `ativo: false` e não oferece passo nenhum",
        statusSemPar.status === 200 && statusSemPar.corpo?.ativo === false,
        `ativo=${statusSemPar.corpo?.ativo}`,
      );
      const nomeD = `${PREFIXO}standalone-${Date.now()}`;
      const projD = await criarProjetoPelaRota(marina, nomeD);
      checar(
        "e o projeto continua nascendo normalmente, sem referência ao CRM",
        projD.status === 201 && !projD.corpo?.crm_opportunity_id,
        `status=${projD.status}`,
      );
      const buscaSemPar = await chamarRota(marina, "GET", "/api/crm/companies/search?name=qualquer");
      checar(
        "e a busca recusa com o motivo, em vez de estourar",
        buscaSemPar.status === 502 || buscaSemPar.status === 400,
        `status=${buscaSemPar.status} msg=${buscaSemPar.corpo?.message}`,
      );
    } finally {
      // Devolvida SEMPRE: sem isto, uma falha no meio deixaria a instalação de prova sem par.
      if (guardada) {
        await prisma.crmPairKey.create({ data: { ...guardada } });
      }
    }
    const devolvida = await prisma.crmPairKey.findUnique({ where: { tenantId: TENANT } });
    checar("a chave do par foi devolvida ao fim da prova", !!devolvida, `hint=${devolvida?.keyHint}`);
  });
}

main()
  .then(async () => {
    console.log(linhas.join("\n"));
    console.log(`\n== F6 etapa 2: ${passou} OK, ${falhou} FALHA ==`);
    await prisma.$disconnect();
    process.exit(falhou === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.log(linhas.join("\n"));
    console.error("\nERRO:", err);
    await prisma.$disconnect();
    process.exit(2);
  });
