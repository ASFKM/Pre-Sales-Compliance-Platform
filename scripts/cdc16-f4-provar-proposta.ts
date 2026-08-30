/**
 * CDC 16 — Fase 4. Prova por execução real, ETAPA 2: a PROPOSTA saindo daqui.
 *
 * Roda no host do PreSales, contra a instalação PUBLICADA, e fala com o CMCRM vivo pela rede.
 *
 * O que ela exercita é o produto, e não uma cópia dele: a demanda é assumida pela ROTA, a proposta
 * é gerada pela ROTA de geração (que escreve DOCX e PDF de verdade), submetida, aprovada e
 * liberada — cada uma pela rota que o usuário usa, com login real. Os ganchos desta fase vivem nos
 * handlers, depois da transação; chamar as funções de domínio direto pularia exatamente o trecho
 * que a F4 acrescentou. A F3 pagou esse erro e ele está registrado.
 *
 *   DEMANDA=<ref> CODIGO_DO_CATALOGO=<code> PROVA_PASSWORD=<senha> npx tsx scripts/cdc16-f4-provar-proposta.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { randomId } from "../src/idGenerator";
import { lerChaveDoCrm, resolverDestino } from "../server/utils/crmPort";
import { drenarFila } from "../server/utils/crmOutbox";

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const EMAIL = "prova-cdc16-f4@local.invalid";
// O segundo usuário dedicado: quem APROVA, com o papel que a etapa do fluxo exige.
const PREFIXO_APROVADOR = "prova-cdc16-f4-aprovador-";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) {
    passou++;
    linhas.push(`  OK   ${rotulo} — ${detalhe}`);
  } else {
    falhou++;
    linhas.push(`  FALHA ${rotulo} — ${detalhe}`);
  }
}

/**
 * Espera a fila resolver uma saída — `pendente` só quer dizer "ainda não tentou".
 *
 * `statusEsperado` existe porque a primeira versão desta prova esperava "a última mensagem de
 * proposta" e a encontrava ainda em `draft`: o gancho enfileira DEPOIS da resposta da rota, e a
 * prova chegava antes. Esperar pela mensagem que descreve o fato certo é a diferença entre uma
 * prova que mede e uma que corre.
 */
async function esperarSaida(
  demandId: string,
  kind: string,
  statusEsperado?: string,
  tentativas = 40,
) {
  for (let i = 0; i < tentativas; i++) {
    const linhasDaFila = await prisma.demandOutboundEvent.findMany({
      where: { demandId, kind },
      orderBy: { createdAt: "desc" },
    });
    const alvo = statusEsperado
      ? linhasDaFila.find((l) => (l.payload as any)?.status === statusEsperado)
      : linhasDaFila[0];
    if (alvo && alvo.status !== "pendente") return alvo;
    if (i % 4 === 3) await drenarFila(TENANT).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
  }
  const todas = await prisma.demandOutboundEvent.findMany({
    where: { demandId, kind },
    orderBy: { createdAt: "desc" },
  });
  return statusEsperado
    ? (todas.find((l) => (l.payload as any)?.status === statusEsperado) ?? todas[0] ?? null)
    : (todas[0] ?? null);
}

async function main() {
  const ref = process.env.DEMANDA;
  const codigoDoCatalogo = process.env.CODIGO_DO_CATALOGO;
  const senha = process.env.PROVA_PASSWORD;
  if (!ref) throw new Error("DEMANDA é obrigatória (sai da etapa 1)");
  if (!codigoDoCatalogo) throw new Error("CODIGO_DO_CATALOGO é obrigatório (sai da etapa 1)");
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova percorre as rotas com login real");
  linhas.push(`(base=${BASE}, demanda=${ref.slice(0, 46)}…, código=${codigoDoCatalogo})`);

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    // ───────────────────────────── 1. o par, e o destino conferido
    linhas.push("== 1. O par e o endereço de retorno, conferidos contra o CRM vivo ==");
    const chave = await lerChaveDoCrm(TENANT);
    checar("a chave do par está guardada", !!chave, `hint=${chave?.keyHint ?? "-"}`);
    const destino = await resolverDestino(TENANT);
    checar(
      "o /pair/verify do CRM confirma o endereço de retorno",
      destino.ok,
      destino.ok ? `base=${destino.base}` : `motivo=${destino.motivo}`,
    );

    // ───────────────────────────── 2. um usuário DEDICADO, com e-mail que nunca resolve
    const papel = await prisma.role.findFirst({ where: { tenantId: TENANT } });
    if (!papel) throw new Error("nenhum papel no tenant");
    const existente = await prisma.user.findFirst({ where: { email: EMAIL } });
    const usuario =
      existente ??
      (await prisma.user.create({
        data: {
          id: randomId("usr"),
          tenantId: TENANT,
          name: "Pre-vendas da prova F4",
          email: EMAIL,
          roleId: papel.id,
          status: "ACTIVE",
        },
      }));
    if (existente) {
      await prisma.user.update({
        where: { id: usuario.id },
        data: { status: "ACTIVE"},
      });
    }

    const entrada = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: senha }),
    });
    const corpoEntrada: any = await entrada.json().catch(() => ({}));
    const token = corpoEntrada?.token || corpoEntrada?.session_token || corpoEntrada?.data?.token;
    checar("login real do usuário de pré-vendas", entrada.status === 200 && !!token, `status=${entrada.status}`);
    if (!token) return;
    const comSessao = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // ───────────────────────────── 3. assumir a demanda pela rota
    linhas.push("== 2. Assumir a demanda pela rota vira projeto ==");
    const demanda = await prisma.demand.findFirst({ where: { demandRef: ref } });
    checar("a demanda da etapa 1 chegou pela porta", !!demanda, `ref=${ref.slice(0, 46)}…`);
    if (!demanda) return;

    const respAssumir = await fetch(`${BASE}/api/demands/${demanda.id}/assume`, {
      method: "POST",
      headers: comSessao,
    });
    const corpoAssumir: any = await respAssumir.json().catch(() => ({}));
    // 409 é o estado legítimo de uma REEXECUÇÃO: a demanda já foi assumida. O projeto vem da
    // própria demanda, e a prova segue do ponto em que estava — recusar aqui obrigaria a apagar o
    // cenário a cada tentativa, e é justamente numa reexecução que se descobre o que não é
    // idempotente.
    const projectId: string | undefined =
      corpoAssumir?.project_id ??
      (respAssumir.status === 409
        ? (await prisma.demand.findUnique({ where: { id: demanda.id } }))?.projectId ?? undefined
        : undefined);
    checar(
      "assumir pela rota dá projeto com dono (200), ou 409 se já assumida",
      (respAssumir.status === 200 || respAssumir.status === 409) && !!projectId,
      `status=${respAssumir.status} projeto=${projectId}`,
    );
    if (!projectId) return;

    // ───────────────────────────── 4. a precificação, que é de onde sai o CÓDIGO do item
    //
    // A folha é o objeto real do produto (módulo Precificação). Ela existe aqui porque é dela que
    // `montarItensDe` tira o código com que o item vai casar do outro lado (D23) — a tabela de
    // preço da proposta não tem campo de código, e nunca teve.
    linhas.push("== 3. A folha de precificação, de onde sai o código que faz o item casar ==");
    const folha = await prisma.projectPricingSheet.create({
      data: {
        id: randomId("pps"),
        tenantId: TENANT,
        projectId,
        label: "Precificação da prova F4",
        status: "draft",
      },
    });
    await prisma.projectPricingLine.create({
      data: {
        id: randomId("ppl"),
        tenantId: TENANT,
        pricingSheetId: folha.id,
        bomItemId: "item-switch",
        // Este é o código que o catálogo do CRM tem. É por ele que o item casa.
        rawPartNumber: codigoDoCatalogo,
        rawDescription: "Switch 24 portas PoE",
        quantity: 20,
        finalUnitPrice: 50000,
        discountPercent: 0,
      },
    });
    await prisma.projectPricingLine.create({
      data: {
        id: randomId("ppl"),
        tenantId: TENANT,
        pricingSheetId: folha.id,
        bomItemId: "item-servico",
        rawPartNumber: "SERV-IMPL-QUE-O-CRM-NAO-TEM",
        rawDescription: "Implantação e treinamento",
        quantity: 1,
        finalUnitPrice: 250000,
        discountPercent: 0,
      },
    });
    checar("folha de precificação criada com duas linhas", true, `folha=${folha.id}`);

    // ───────────────────────────── 5. a proposta, pela rota de geração
    linhas.push("== 4. A proposta gerada pela rota real (DOCX e PDF de verdade) ==");
    // O tipo da proposta e o tipo do template TÊM de bater — a rota recusa com 400 quando não
    // batem, e "pega o primeiro template ativo" é exatamente como se erra isso.
    const template = await prisma.proposalTemplate.findFirst({
      where: { tenantId: TENANT, active: true, templateType: "commercial" },
    });
    if (!template) {
      const ativos = await prisma.proposalTemplate.findMany({
        where: { tenantId: TENANT, active: true },
        select: { name: true, templateType: true },
      });
      throw new Error(
        `nenhum template ATIVO do tipo 'commercial' no tenant (ativos: ${ativos
          .map((t) => `${t.name}:${t.templateType}`)
          .join(", ")})`,
      );
    }

    const tabela = [
      {
        item_id: "item-switch",
        product_or_service: "Switch 24 portas PoE",
        specification: "24 portas, PoE+, gerenciável",
        quantity: 20,
        unit: "un",
        unit_price: 50000,
        total_price: 1000000,
        currency: "BRL",
        is_optional: false,
        discount: 0,
      },
      {
        item_id: "item-servico",
        product_or_service: "Implantação e treinamento",
        specification: "12 unidades",
        quantity: 1,
        unit: "sv",
        unit_price: 250000,
        total_price: 250000,
        currency: "BRL",
        is_optional: false,
        discount: 0,
      },
    ];

    const geracao = await fetch(`${BASE}/api/projects/${projectId}/proposals/commercial`, {
      method: "POST",
      headers: comSessao,
      body: JSON.stringify({
        template_id: template.id,
        language: "Portuguese",
        manual_pricing_table: tabela,
        payment_terms: "30/60/90 dias",
        delivery_terms: "45 dias após o pedido",
        proposal_validity: "2026-12-31",
      }),
    });
    const corpoGeracao = await geracao.text();
    checar(
      "a rota de geração aceita o pedido",
      geracao.status === 202,
      `status=${geracao.status} corpo=${corpoGeracao.slice(0, 300)}`,
    );

    let proposta = null;
    for (let i = 0; i < 60; i++) {
      proposta = await prisma.proposal.findFirst({
        where: { projectId },
        orderBy: { generatedAt: "desc" },
      });
      if (proposta) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    checar(
      "a proposta foi gerada de verdade, com DOCX e PDF em disco",
      !!proposta?.docxFilePath && !!proposta?.pdfFilePath,
      `id=${proposta?.id} status=${proposta?.status}`,
    );
    if (!proposta) return;

    // ───────────────────────────── 6. o que viajou
    linhas.push("== 5. A proposta viajou ao CRM, com itens, valor e documento ==");
    const saida = await esperarSaida(demanda.id, "proposal", "draft");
    checar(
      "a proposta foi ENTREGUE ao CRM (201)",
      saida?.status === "enviado" && saida?.lastStatus === 201,
      `status=${saida?.status} http=${saida?.lastStatus} erro=${saida?.lastError ?? "-"}`,
    );
    const corpo = (saida?.payload ?? {}) as any;
    checar(
      "o envelope leva os DOIS itens, com o valor total certo",
      Array.isArray(corpo.items) && corpo.items.length === 2 && corpo.total_value === 1250000,
      `itens=${corpo.items?.length} total=${corpo.total_value}`,
    );
    checar(
      "o item do catálogo viajou COM o código (D23)",
      corpo.items?.[0]?.code === codigoDoCatalogo,
      `code=${corpo.items?.[0]?.code}`,
    );
    checar(
      "e o item sem correspondência viajou com o código dele, não sem código",
      corpo.items?.[1]?.code === "SERV-IMPL-QUE-O-CRM-NAO-TEM",
      `code=${corpo.items?.[1]?.code}`,
    );
    checar(
      "o rascunho viaja como `draft` — e o CRM não sobrescreve valor com rascunho",
      corpo.status === "draft",
      `status=${corpo.status}`,
    );
    checar(
      "as condições comerciais viajam separadas",
      corpo.payment_terms === "30/60/90 dias" && corpo.delivery_terms === "45 dias após o pedido",
      `pagamento=${corpo.payment_terms} entrega=${corpo.delivery_terms}`,
    );
    checar(
      "o documento foi DECLARADO com sha256 e nome",
      typeof corpo.document?.sha256 === "string" && corpo.document.sha256.length === 64,
      `documento=${corpo.document?.filename} sha=${String(corpo.document?.sha256).slice(0, 12)}…`,
    );
    checar(
      "e o link aponta para o endereço PÚBLICO desta instalação",
      typeof corpo.link === "string" && !corpo.link.includes("127.0.0.1"),
      `link=${corpo.link}`,
    );

    const saidaDoc = await esperarSaida(demanda.id, "proposal_document");
    checar(
      "o binário subiu separado, e foi aceito (201)",
      saidaDoc?.status === "enviado" && saidaDoc?.lastStatus === 201,
      `status=${saidaDoc?.status} http=${saidaDoc?.lastStatus} erro=${saidaDoc?.lastError ?? "-"}`,
    );

    // ───────────────────────────── 7. o fluxo de aprovação, e o carimbo que o CRM não reabre
    linhas.push("== 6. Submeter, aprovar e liberar — cada um pela rota, cada um viaja ==");
    const submissao = await fetch(`${BASE}/api/proposals/${proposta.id}/approval/submit`, {
      method: "POST",
      headers: comSessao,
    });
    checar("submeter para aprovação é aceito", submissao.status === 200, `status=${submissao.status}`);

    const emAprovacao = await esperarSaida(demanda.id, "proposal", "in_approval");
    checar(
      "e o CRM recebe a versão em `in_approval`",
      emAprovacao?.status === "enviado" && (emAprovacao?.payload as any)?.status === "in_approval",
      `status=${(emAprovacao?.payload as any)?.status} http=${emAprovacao?.lastStatus}`,
    );

    const fluxo = await prisma.approvalWorkflow.findFirst({
      where: { id: proposta.approvalWorkflowId },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    const obrigatorias = (fluxo?.stages ?? []).filter((e) => e.mandatory !== false);
    checar(
      "o fluxo de aprovação tem etapas obrigatórias reais",
      obrigatorias.length > 0,
      `etapas=${obrigatorias.map((e) => e.name).join(" → ") || "(nenhuma)"}`,
    );
    if (obrigatorias.length === 0) return;

    /*
     * Quem decide é o APROVADOR configurado na etapa, e não quem submeteu.
     *
     * A rota confere isso de verdade: `approver_type: role` exige o papel exato da etapa, e
     * responde 403 para qualquer outro. A primeira versão desta prova decidiu com o próprio
     * usuário de pré-vendas e levou o 403 — a autorização estava certa e a prova, errada. Aqui a
     * prova faz o que a organização faria: um segundo usuário DEDICADO, com o papel que a etapa
     * exige, e e-mail que nunca resolve.
     */
    let todasAprovadas = true;
    for (const etapa of obrigatorias) {
      /*
       * Quem decide é o APROVADOR configurado na etapa — e ele precisa ENTRAR no sistema.
       *
       * Duas versões desta prova erraram aqui, e o erro de cada uma ensina uma coisa. A primeira
       * decidiu com o próprio usuário de pré-vendas: 403, porque ele não é o aprovador. A segunda
       * mandou o papel certo nos cabeçalhos `x-user-id`/`x-role-id` e levou 403 do mesmo jeito —
       * a autorização real sai da SESSÃO, e um cabeçalho não vira credencial só por ter o nome
       * certo. É exatamente o que se quer que aconteça.
       *
       * Então a prova faz o que a organização faria: um usuário dedicado POR PAPEL exigido, com
       * e-mail que nunca resolve, entrando de verdade.
       */
      let aprovadorId = etapa.approverUserId ?? null;
      let papelDoAprovador = etapa.approverRoleId ?? null;

      if (etapa.approverType === "role" && papelDoAprovador) {
        const emailAprovador = `prova-cdc16-f4-aprovador-${papelDoAprovador}@local.invalid`;
        const jaExiste = await prisma.user.findFirst({ where: { email: emailAprovador } });
        const aprovador =
          jaExiste ??
          (await prisma.user.create({
            data: {
              id: randomId("usr"),
              tenantId: TENANT,
              name: `Aprovador da prova F4 (${papelDoAprovador})`,
              email: emailAprovador,
              roleId: papelDoAprovador,
              status: "ACTIVE",
            },
          }));
        if (jaExiste) {
          await prisma.user.update({
            where: { id: jaExiste.id },
            data: {
              roleId: papelDoAprovador,
              status: "ACTIVE",
            },
          });
        }
        aprovadorId = aprovador.id;
      } else if (etapa.approverType === "user" && aprovadorId) {
        const dono = await prisma.user.findUnique({ where: { id: aprovadorId } });
        papelDoAprovador = dono?.roleId ?? null;
      }

      const emailParaEntrar =
        etapa.approverType === "role"
          ? `prova-cdc16-f4-aprovador-${papelDoAprovador}@local.invalid`
          : (await prisma.user.findUnique({ where: { id: aprovadorId ?? "" } }))?.email;
      let sessaoDoAprovador = comSessao;
      if (emailParaEntrar && etapa.approverType === "role") {
        const entradaAprovador = await fetch(`${BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailParaEntrar, password: senha }),
        });
        const corpoAprovador: any = await entradaAprovador.json().catch(() => ({}));
        const tokenAprovador =
          corpoAprovador?.token || corpoAprovador?.session_token || corpoAprovador?.data?.token;
        if (!tokenAprovador) {
          todasAprovadas = false;
          checar(
            `o aprovador da etapa "${etapa.name}" consegue entrar`,
            false,
            `status=${entradaAprovador.status}`,
          );
          continue;
        }
        sessaoDoAprovador = {
          Authorization: `Bearer ${tokenAprovador}`,
          "Content-Type": "application/json",
        };
      }

      const decisao = await fetch(`${BASE}/api/proposals/${proposta.id}/approval/decision`, {
        method: "POST",
        headers: {
          ...sessaoDoAprovador,
          "x-user-id": aprovadorId ?? "",
          "x-role-id": papelDoAprovador ?? "",
        },
        body: JSON.stringify({
          decision: "approved",
          comments: "aprovado na prova da F4",
          stage_id: etapa.id,
        }),
      });
      const ok = decisao.status === 200;
      if (!ok) todasAprovadas = false;
      checar(
        `a etapa "${etapa.name}" é aprovada por quem ela exige, com login real`,
        ok,
        `status=${decisao.status}${ok ? "" : ` corpo=${(await decisao.text()).slice(0, 180)}`}`,
      );
    }
    if (!todasAprovadas) return;

    const aprovada = await esperarSaida(demanda.id, "proposal", "approved");
    const corpoAprovada = (aprovada?.payload ?? {}) as any;
    checar(
      "o CRM recebe a versão aprovada COM o carimbo de quem aprovou (D24)",
      corpoAprovada.status === "approved" && !!corpoAprovada.approval?.approved_by?.name,
      `status=${corpoAprovada.status} por=${corpoAprovada.approval?.approved_by?.name} em=${corpoAprovada.approval?.approved_at}`,
    );

    const liberacao = await fetch(`${BASE}/api/proposals/${proposta.id}/release`, {
      method: "POST",
      headers: comSessao,
    });
    checar("liberar a proposta é aceito", liberacao.status === 200, `status=${liberacao.status}`);

    const liberada = await esperarSaida(demanda.id, "proposal", "sent");
    checar(
      "e o CRM recebe `sent` — o estado em que o valor SOBRESCREVE o da oportunidade (D21)",
      liberada?.status === "enviado" && (liberada?.payload as any)?.status === "sent",
      `status=${(liberada?.payload as any)?.status} http=${liberada?.lastStatus} erro=${liberada?.lastError ?? "-"}`,
    );

    // ───────────────────────────── 8. a fila não repetiu o binário
    const documentos = await prisma.demandOutboundEvent.count({
      where: { demandId: demanda.id, kind: "proposal_document" },
    });
    checar(
      "o binário não foi reenfileirado a cada mudança de status — a chave dele é o HASH",
      documentos === 1,
      `mensagens de documento=${documentos}`,
    );
    const propostas = await prisma.demandOutboundEvent.count({
      where: { demandId: demanda.id, kind: "proposal" },
    });
    checar(
      "e cada mudança de status virou uma mensagem própria",
      propostas === 4,
      `mensagens de proposta=${propostas} (draft, in_approval, approved, sent)`,
    );

    const falhas = await prisma.demandOutboundEvent.count({
      where: { demandId: demanda.id, status: { in: ["falhou", "descartado"] } },
    });
    checar("nenhuma mensagem falhou ou foi descartada", falhas === 0, `falhas=${falhas}`);

    console.log(`\nprojeto=${projectId} proposta=${proposta.id} demanda=${demanda.id}`);
  });

  console.log(linhas.join("\n"));
  console.log(`\nETAPA 2: ${passou} passaram, ${falhou} falharam.`);
  await prisma.$disconnect();
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.log(linhas.join("\n"));
  console.error("FALHOU:", err?.stack || err?.message || err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
