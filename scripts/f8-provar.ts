/*
 * F8 — prova ponta a ponta contra o servidor real. Não é teste unitário: é execução.
 * Roda no host do PreSales: `npx tsx scripts/f8-provar.ts`
 */
import fs from "fs";
import { randomUUID } from "crypto";

const BASE = "http://127.0.0.1:3000/api";
const PROP = process.env.F8_PROP || "prop_1ee919e8629692cf"; // v1, submitted, workflow w1
const STAGE = "w1-s2";                      // Commercial & Margin Validation -> papel r2
const MARCUS = "marcus.vance@enterprise.com";

const senhaMarcus = (() => {
  const src = fs.readFileSync("reset-marcus-pw.mjs", "utf8");
  const m = src.match(/NEW_PASSWORD\s*=\s*["'`]([^"'`]+)["'`]/);
  if (!m) throw new Error("NEW_PASSWORD não encontrada em reset-marcus-pw.mjs");
  return m[1];
})();

let falhas = 0;
function ok(nome: string, cond: boolean, detalhe = "") {
  console.log(`${cond ? "  OK  " : "FALHA "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!cond) falhas++;
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data: any = await res.json();
  if (!res.ok || !data.token) throw new Error(`login ${email} falhou: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.token;
}

const api = (token: string) => async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as any };
};

(async () => {
  console.log("\n══ 1. ESCOPO DE APROVAÇÃO — conta DESIGNADA ══");
  const tokenMarcus = await login(MARCUS, senhaMarcus);
  const m = api(tokenMarcus);
  const escopo = await m("/me/approval-scope");
  ok("GET /me/approval-scope responde 200", escopo.status === 200);
  ok("marcus.vance é aprovador designado", escopo.body.is_approver === true, `is_approver=${escopo.body.is_approver}`);
  ok("o estágio w1-s2 está no escopo dele", (escopo.body.stage_ids || []).includes(STAGE), `stage_ids=${JSON.stringify(escopo.body.stage_ids)}`);

  console.log("\n══ 2. ESCOPO — conta SEM ALÇADA (papel que não aprova nada) ══");
  // O papel e a conta são criados por scripts/f8-preparar-conta.ts. Eles precisam existir porque
  // TODOS os quatro papéis desta instalação são aprovadores designados em algum estágio ativo:
  // sem um papel novo, o lado NEGATIVO do gate não teria como ser provado.
  const emailSemAlcada = "prova-f8-sem-alcada@local.invalid";
  const senhaSemAlcada = process.env.F8_SENHA!;
  const tokenSemAlcada = await login(emailSemAlcada, senhaSemAlcada);
  const s = api(tokenSemAlcada);
  const escopoSemAlcada = await s("/me/approval-scope");
  ok("conta sem alçada NÃO é aprovadora", escopoSemAlcada.body.is_approver === false, `is_approver=${escopoSemAlcada.body.is_approver}`);
  ok("escopo dela vem vazio", (escopoSemAlcada.body.stage_ids || []).length === 0);

  console.log("\n══ 3. O GATE NÃO É SÓ DE TELA: a ROTA recusa ══");
  /*
   * Duas negativas diferentes, e as duas são o gate funcionando:
   *
   *  (a) Sobre uma proposta que ela NÃO ENXERGA, a conta sem alçada recebe 404. Isso vem de uma
   *      camada anterior à desta fase: src/prisma.ts já recorta `Proposal` por visibilidade e uma
   *      das quatro condições é "sou aprovador designado no workflow desta proposta". É a negativa
   *      mais forte - não vaza nem a existência da proposta.
   *
   *  (b) Sobre uma proposta que ela ENXERGA por outro caminho (é a DONA do projeto) mas cujo
   *      workflow não a designa, ela recebe 403 - e este é o gate que a F8 acrescentou. Sem ele,
   *      o dono de um projeto qualquer leria o dossiê inteiro de uma proposta que não lhe cabe
   *      julgar. `scripts/f8-preparar-403.ts` monta esse cenário.
   */
  const dossieInvisivel = await s(`/proposals/${PROP}/dossie-de-aprovacao`);
  ok("(a) proposta que ela não enxerga: 404, nem a existência vaza", dossieInvisivel.status === 404, `status=${dossieInvisivel.status}`);

  const PROP_VISIVEL = "prop_prova_f8_403";
  const dossieNegado = await s(`/proposals/${PROP_VISIVEL}/dossie-de-aprovacao`);
  ok("(b) proposta que ela enxerga mas não aprova: 403 do gate novo", dossieNegado.status === 403, `status=${dossieNegado.status}`);
  ok("    com a mensagem do gate", String(dossieNegado.body?.message || "").includes("not a designated approver"), dossieNegado.body?.message);
  const decisaoNegada = await s(`/proposals/${PROP_VISIVEL}/approval/decision`, {
    method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "approved", comments: "" }),
  });
  ok("    e a decisão continua 403, na posição de sempre", decisaoNegada.status === 403, `status=${decisaoNegada.status}`);

  console.log("\n══ 4. DOSSIÊ, para quem PODE ══");
  const dossie = await m(`/proposals/${PROP}/dossie-de-aprovacao`);
  ok("dossiê responde 200 para o aprovador designado", dossie.status === 200, `status=${dossie.status}`);
  ok("aba documento: a proposta tem docx", dossie.body?.proposal?.has_docx === true);
  ok("aba verificações: conferência determinística presente", typeof dossie.body?.verificacoes?.total === "number", `total=${dossie.body?.verificacoes?.total} bloqueantes=${dossie.body?.verificacoes?.bloqueantes}`);
  ok("aba versões: cadeia de versões presente", Array.isArray(dossie.body?.versoes?.cadeia) && dossie.body.versoes.cadeia.length > 0, `versoes=${dossie.body?.versoes?.cadeia?.length}`);
  ok("seções apontáveis vieram para a rejeição estruturada", Array.isArray(dossie.body?.secoes) && dossie.body.secoes.length > 0, `secoes=${dossie.body?.secoes?.length}`);
  const secoes = dossie.body.secoes as { target_kind: string; target_key: string; texto_atual: string | null }[];
  console.log(`        seções disponíveis: ${secoes.map((x) => x.target_key).join(", ")}`);

  console.log("\n══ 5. O CONTRATO ANTIGO SOBREVIVEU ══");
  const semMotivo = await m(`/proposals/${PROP}/approval/decision`, {
    method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "rejected", comments: "   " }),
  });
  ok("rejeição sem motivo continua 400", semMotivo.status === 400, `status=${semMotivo.status}`);
  ok("com a mensagem de REJECTION_REASON_REQUIRED_MESSAGE", String(semMotivo.body?.message || "").includes("rejection requires a reason"), semMotivo.body?.message);

  console.log("\n══ 6. APROVAÇÃO NÃO LEVA RESSALVA ══");
  const aprovacaoComItens = await m(`/proposals/${PROP}/approval/decision`, {
    method: "POST",
    body: JSON.stringify({ stage_id: STAGE, decision: "approved", comments: "ok", items: [{ target_kind: "geral", comment: "mas revejam a margem" }] }),
  });
  ok("aprovação com itens é recusada com 400", aprovacaoComItens.status === 400, `status=${aprovacaoComItens.status}`);
  console.log(`        mensagem: ${aprovacaoComItens.body?.message}`);

  console.log("\n══ 7. ITEM DE SEÇÃO SEM COMENTÁRIO É RECUSADO ══");
  const itemVazio = await m(`/proposals/${PROP}/approval/decision`, {
    method: "POST",
    body: JSON.stringify({ stage_id: STAGE, decision: "rejected", comments: "volta", items: [{ target_kind: "geral", comment: "  " }] }),
  });
  ok("item sem comentário é 400", itemVazio.status === 400, `status=${itemVazio.status} — ${itemVazio.body?.message}`);

  console.log("\n══ 8. REJEIÇÃO ESTRUTURADA APONTANDO DUAS SEÇÕES ══");
  const duas = secoes.slice(0, 2);
  ok("há pelo menos duas seções apontáveis", duas.length === 2, `secoes=${secoes.length}`);
  const rejeicao = await m(`/proposals/${PROP}/approval/decision`, {
    method: "POST",
    body: JSON.stringify({
      stage_id: STAGE,
      decision: "rejected",
      comments: "Volta para ajuste comercial: prazo e condição de pagamento fora da alçada.",
      items: [
        { target_kind: duas[0].target_kind, target_key: duas[0].target_key, comment: "Prova F8 item 1: esta seção precisa do prazo de implantação explícito.", section_snapshot: duas[0].texto_atual },
        { target_kind: duas[1].target_kind, target_key: duas[1].target_key, comment: "Prova F8 item 2: condição de pagamento fora da alçada aprovada pela diretoria.", section_snapshot: duas[1].texto_atual },
      ],
    }),
  });
  ok("rejeição com dois itens é aceita", rejeicao.status === 200, `status=${rejeicao.status} ${rejeicao.body?.message || ""}`);
  ok("a proposta ficou rejected", rejeicao.body?.proposal?.status === "rejected", `status=${rejeicao.body?.proposal?.status}`);
  ok("o servidor devolveu os dois itens", (rejeicao.body?.rejection_items || []).length === 2);

  console.log("\n══ 9. REABERTURA: os itens do aprovador viram apontamentos da v2 ══");
  const reabertura = await m(`/proposals/${PROP}/reopen`, { method: "POST" });
  ok("reabertura responde 201", reabertura.status === 201, `status=${reabertura.status} ${reabertura.body?.message || ""}`);
  const v2 = reabertura.body?.proposal_id;
  ok("a v2 nasceu com os 2 apontamentos do aprovador", reabertura.body?.approver_findings === 2, `approver_findings=${reabertura.body?.approver_findings}`);
  console.log(`        v2 = ${v2} (v${reabertura.body?.version})`);

  const painel = await m(`/proposals/${v2}/opinion-panel`);
  const rodada = painel.body?.rodada_do_aprovador;
  ok("o painel da v2 traz a rodada do aprovador", Boolean(rodada), `rodada=${rodada?.id}`);
  ok("com 2 apontamentos, os dois abertos", rodada?.total === 2 && rodada?.abertos === 2, `total=${rodada?.total} abertos=${rodada?.abertos}`);
  ok("a rodada de IA da v2 continua vazia (a v2 nasce sem parecer de IA)", painel.body?.run === null);
  const alvos = (rodada?.findings || []).map((f: any) => f.target_key);
  ok("as duas seções apontadas chegaram como alvo", alvos.includes(duas[0].target_key) && alvos.includes(duas[1].target_key), `alvos=${JSON.stringify(alvos)}`);
  ok("todos críticos e de origem 'aprovador'", (rodada?.findings || []).every((f: any) => f.severity === "critical" && f.origem === "aprovador"));

  console.log("\n══ 10. O CICLO DA F6 VALE PARA ELES ══");
  const finding = rodada.findings[0];
  const semJustificativa = await m(`/proposals/${v2}/apontamentos/${finding.id}`, {
    method: "PATCH", body: JSON.stringify({ status: "aceito_com_risco" }),
  });
  ok("'aceito com risco' SEM justificativa é 400", semJustificativa.status === 400, `status=${semJustificativa.status}`);
  console.log(`        mensagem: ${semJustificativa.body?.message}`);
  const comJustificativa = await m(`/proposals/${v2}/apontamentos/${finding.id}`, {
    method: "PATCH", body: JSON.stringify({ status: "aceito_com_risco", justificativa: "Prova F8: diretoria autorizou seguir com este prazo." }),
  });
  ok("'aceito com risco' COM justificativa é aceito", comJustificativa.status === 200, `status=${comJustificativa.status}`);

  console.log("\n══ 11. O GATE DE ENVIO DA F7 VÊ OS ITENS DO APROVADOR ══");
  const envio = await m(`/proposals/${v2}/approval/submit`, { method: "POST" });
  ok("submeter a v2 com item do aprovador aberto é 409", envio.status === 409, `status=${envio.status}`);
  ok("a mensagem nomeia o apontamento que está barrando", String(envio.body?.message || "").includes("Prova F8 item"), String(envio.body?.message || "").slice(0, 160));

  console.log("\n══ 12. OS NÚMEROS DA F7 NÃO FORAM CONTAMINADOS ══");
  const comparacao = await m(`/proposals/${v2}/comparacao-de-rodadas`);
  ok("a comparação da v2 ignora a rodada do aprovador", comparacao.body?.comparacao === null, `comparacao=${JSON.stringify(comparacao.body?.comparacao)} motivo=${comparacao.body?.motivo}`);
  ok("e diz o motivo certo (sem rodada de IA para comparar)", comparacao.body?.motivo === "sem_rodadas", `motivo=${comparacao.body?.motivo}`);

  console.log("\n══ 13. A ORDEM DE RESPOSTAS DA ROTA DE DECISÃO ══");
  /*
   * A ordem 404 -> 400 status -> 400 decisão -> 400 motivo -> 403 aprovador -> 409 duplicada é
   * contrato, exercitado por scripts/regression-approval-rbac.sh. Aquele script NÃO roda neste
   * host: ele usa a senha de seed do modo demo, e esta instalação está em
   * APP_RUNTIME_MODE=production, que a recusa (o próprio comentário no topo do script registra
   * isso). Ele é do CI, e o CI é a F9. Então a ordem é exercitada aqui, com contas reais, para que
   * a F8 não a dê como certa: a validação de itens que esta fase inseriu cai ENTRE o 400 do motivo
   * e o 403 do aprovador, e nenhuma das posições existentes pode ter se movido.
   */
  const inexistente = await m("/proposals/prop_nao_existe_f8/approval/decision", {
    method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "approved", comments: "" }),
  });
  ok("1º) proposta inexistente -> 404", inexistente.status === 404, `status=${inexistente.status}`);

  // A v2 recém-criada está em `draft`: serve para o 400 de status errado.
  const statusErrado = await m(`/proposals/${v2}/approval/decision`, {
    method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "approved", comments: "" }),
  });
  ok("2º) status errado -> 400", statusErrado.status === 400 && String(statusErrado.body?.message).includes("submitted proposals"), `status=${statusErrado.status}`);

  // Daqui em diante é preciso uma proposta EM `submitted`. As demais da instalação servem.
  // Uma proposta em `submitted` do mesmo workflow, informada por env para a prova ser repetível.
  const outraId = process.env.F8_PROP_ORDEM || "prop_0e1c5a385d9230b0";
  const outraResp = await m(`/proposals/${outraId}/dossie-de-aprovacao`);
  const outra = outraResp.status === 200 && outraResp.body?.proposal?.status === "submitted" ? { id: outraId } : null;
  if (!outra) {
    ok("há outra proposta submitted para exercitar o resto da ordem", false, "nenhuma encontrada");
  } else {
    const decisaoInvalida = await m(`/proposals/${outra.id}/approval/decision`, {
      method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "talvez", comments: "x" }),
    });
    ok("3º) decisão inválida -> 400", decisaoInvalida.status === 400 && String(decisaoInvalida.body?.message).includes("approved or rejected"), `status=${decisaoInvalida.status}`);

    const semMotivo2 = await m(`/proposals/${outra.id}/approval/decision`, {
      method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "rejected", comments: "" }),
    });
    ok("4º) motivo ausente -> 400", semMotivo2.status === 400 && String(semMotivo2.body?.message).includes("rejection requires a reason"), `status=${semMotivo2.status}`);

    const itensInvalidos = await m(`/proposals/${outra.id}/approval/decision`, {
      method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "rejected", comments: "motivo", items: "não é lista" }),
    });
    ok("4.5º) itens inválidos -> 400 (posição NOVA, entre o motivo e o aprovador)", itensInvalidos.status === 400, `status=${itensInvalidos.status}`);

    const aprovadorErrado = await m(`/proposals/${outra.id}/approval/decision`, {
      method: "POST", body: JSON.stringify({ stage_id: "w1-s1", decision: "approved", comments: "x" }),
    });
    ok("5º) aprovador errado -> 403", aprovadorErrado.status === 403, `status=${aprovadorErrado.status}`);

    const primeira = await m(`/proposals/${outra.id}/approval/decision`, {
      method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "approved", comments: "Prova F8: ordem de respostas." }),
    });
    const duplicada = await m(`/proposals/${outra.id}/approval/decision`, {
      method: "POST", body: JSON.stringify({ stage_id: STAGE, decision: "approved", comments: "Prova F8: repetida." }),
    });
    ok("6º) decisão duplicada -> 409", primeira.status === 200 && duplicada.status === 409, `1a=${primeira.status} 2a=${duplicada.status}`);
    console.log(`        proposta usada na ordem: ${outra.id}`);
  }

  console.log("\n══ 14. O DOCUMENTO DA ABA 'DOCUMENTO', PROVADO PELO ZIP ══");
  /*
   * A pré-visualização carrega em STREAMING: capturar a tela cedo devolve um preview truncado que
   * parece prova de falha (armadilha medida na F6). Para provar CONTEÚDO o caminho é outro - baixar
   * o .docx pela mesma rota que a aba usa e ler word/document.xml de dentro do zip.
   */
  const docx = await fetch(`${BASE}/proposals/${PROP}/export/docx`, { headers: { Authorization: `Bearer ${tokenMarcus}` } });
  ok("GET /export/docx responde 200", docx.status === 200, `status=${docx.status}`);
  const buffer = Buffer.from(await docx.arrayBuffer());
  ok("o corpo é um .docx de verdade (assinatura PK do zip)", buffer.subarray(0, 2).toString() === "PK", `bytes=${buffer.length}`);
  const caminhoDocx = `/tmp/f8-dossie-${PROP}.docx`;
  fs.writeFileSync(caminhoDocx, buffer);
  const { execSync } = await import("child_process");
  const partes = execSync(`unzip -Z1 ${caminhoDocx}`).toString().trim().split("\n");
  ok("o zip traz word/document.xml", partes.includes("word/document.xml"), `${partes.length} partes`);
  const xml = execSync(`unzip -p ${caminhoDocx} word/document.xml`).toString();
  const texto = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  ok("word/document.xml tem texto de verdade", texto.length > 500, `${texto.length} caracteres`);
  console.log(`        primeiros 180 caracteres: ${texto.slice(0, 180)}`);
  console.log(`        arquivo: ${caminhoDocx} (${buffer.length} bytes, ${partes.length} partes)`);

  console.log(`\n${falhas === 0 ? "TODAS AS PROVAS PASSARAM" : `${falhas} PROVA(S) FALHARAM`}`);
  console.log(`dados de prova: v1=${PROP} v2=${v2} conta_sem_alcada=${emailSemAlcada}`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((err) => { console.error("ERRO:", err); process.exit(2); });
