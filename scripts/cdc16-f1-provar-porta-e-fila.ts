/**
 * CDC 16 — Fase 1. A prova, por HTTP real contra um PreSales de verdade.
 *
 * Nada aqui é mock: sobe-se o `server.ts` do produto (Express, helmet, Zod,
 * Prisma, Postgres, Redis) e este script fala com ele pela rede, como o CMCRM e
 * como um navegador falariam. O que ele NÃO faz é fingir um CMSaaS: a
 * verificação da chave do par sai daqui e vai ao CMSaaS real configurado na
 * instalação - é por isso que a seção C só roda com uma chave de par de verdade
 * em PAIR_KEY.
 *
 *   BASE_URL=http://127.0.0.1:3010 npx tsx scripts/cdc16-f1-provar-porta-e-fila.ts
 *
 * A chave do par, quando existir, entra por variável de ambiente e não é
 * impressa em lugar nenhum.
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3010";
const PORTA_MAQUINA = `${BASE}/api/external/crm/v1`;
const CHAVE_DO_PAR = (process.env.PAIR_KEY || "").trim();

let passaram = 0;
let falharam = 0;
const falhas: string[] = [];

function conferir(descricao: string, condicao: boolean, detalhe?: unknown) {
  if (condicao) {
    passaram += 1;
    console.log(`  ok   ${descricao}`);
  } else {
    falharam += 1;
    falhas.push(descricao);
    console.log(`  FALHOU ${descricao}${detalhe !== undefined ? ` -> ${JSON.stringify(detalhe)}` : ""}`);
  }
}

function secao(titulo: string) {
  console.log(`\n== ${titulo}`);
}

interface Resposta {
  status: number;
  contentType: string;
  corpo: any;
  texto: string;
}

async function chamar(url: string, init: RequestInit = {}): Promise<Resposta> {
  const res = await fetch(url, init);
  const texto = await res.text();
  let corpo: any = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = null;
  }
  return { status: res.status, contentType: res.headers.get("content-type") || "", corpo, texto };
}

const comChave = (chave: string, extra: Record<string, string> = {}) => ({ "X-Pair-Key": chave, ...extra });

async function secaoA() {
  secao("A — a porta de máquina existe e recusa quem não tem par");

  const semChave = await chamar(`${PORTA_MAQUINA}/pair/verify`);
  conferir("GET /pair/verify sem X-Pair-Key devolve 401", semChave.status === 401, semChave.status);
  // O 401 precisa vir em JSON: este servidor responde 200 com o HTML da SPA para
  // caminho desconhecido, então "status" sozinho nunca prova que uma rota existe.
  conferir("...e o 401 é application/json, não o HTML da SPA", semChave.contentType.includes("application/json"), semChave.contentType);
  conferir("...com o erro nomeado pair_key_required", semChave.corpo?.error === "pair_key_required", semChave.corpo);

  // Duas rotas de controle, porque "401" e "404" sozinhos não provam nada neste
  // servidor: ele responde 200 com o HTML da SPA para qualquer caminho que não
  // seja /api/.
  const controleApi = await chamar(`${BASE}/api/rota-que-nao-existe-${Date.now()}`);
  conferir("controle: rota /api inexistente cai no 404 JSON da API", controleApi.status === 404 && controleApi.contentType.includes("application/json"), {
    status: controleApi.status,
    contentType: controleApi.contentType,
  });
  const controleSpa = await chamar(`${BASE}/caminho-que-nao-e-api-${Date.now()}`);
  conferir("controle: caminho fora de /api devolve o HTML da SPA (200)", controleSpa.status === 200 && controleSpa.contentType.includes("text/html"), {
    status: controleSpa.status,
    contentType: controleSpa.contentType,
  });

  // Caminho desconhecido DENTRO da porta de máquina responde 401, e não 404: a
  // chave é conferida antes de a rota ser resolvida. É deliberado - quem não tem
  // par não deveria conseguir mapear, por tentativa e erro, quais caminhos
  // existem do outro lado.
  const desconhecida = await chamar(`${PORTA_MAQUINA}/rota-que-nao-existe-${Date.now()}`);
  conferir("caminho desconhecido na porta de máquina responde 401 antes de resolver a rota", desconhecida.status === 401, desconhecida.status);

  const inventada = await chamar(`${PORTA_MAQUINA}/pair/verify`, { headers: comChave(`chave-inventada-${Date.now()}`) });
  conferir("chave inventada devolve 401", inventada.status === 401, inventada.status);
  // invalid_pair_key só é produzido DEPOIS de o CMSaaS real responder 401. Se o
  // CMSaaS não tivesse sido consultado, o erro seria outro
  // (installation_not_managed) ou 502 (pairing_authority_unreachable).
  conferir(
    "...e o erro é invalid_pair_key, que só existe depois de o CMSaaS real ter respondido",
    inventada.corpo?.error === "invalid_pair_key",
    inventada.corpo
  );

  const postSemChave = await chamar(`${PORTA_MAQUINA}/demands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "chave-idem-de-teste-1" },
    body: JSON.stringify({ demand_ref: "x" }),
  });
  conferir("POST /demands sem chave do par devolve 401 (a chave é conferida antes do corpo)", postSemChave.status === 401, postSemChave.status);

  const uploadSemChave = await chamar(`${PORTA_MAQUINA}/demands/qualquer/documents/qualquer/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.from("conteudo"),
  });
  conferir("PUT de conteúdo sem chave do par devolve 401", uploadSemChave.status === 401, uploadSemChave.status);

}

async function login(email: string, senha: string) {
  const r = await chamar(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  return r;
}

async function secaoB() {
  secao("B — a fila humana: listar, assumir, virar Projeto e devolver");

  const semSessao = await chamar(`${BASE}/api/demands`);
  conferir("GET /api/demands sem sessão devolve 401 (a fila continua atrás de sessão humana)", semSessao.status === 401, semSessao.status);

  const senha = process.env.PROVA_PASSWORD || "";
  const entrada = await login("prova-cdc16-f1@local.invalid", senha);
  conferir("login do usuário de pré-vendas responde 200", entrada.status === 200, { status: entrada.status, corpo: entrada.corpo?.message });
  const token = entrada.corpo?.token || entrada.corpo?.session_token || entrada.corpo?.data?.token;
  conferir("...e devolve um token de sessão", Boolean(token));
  if (!token) return;

  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const resumo = await chamar(`${BASE}/api/demands/summary`, { headers: auth });
  conferir("GET /api/demands/summary responde 200", resumo.status === 200, resumo.status);
  conferir("...e conta as 2 demandas semeadas na fila", (resumo.corpo?.queued ?? 0) >= 2, resumo.corpo);

  const filtroInventado = await chamar(`${BASE}/api/demands?status=nao-existe-esse-estado`, { headers: auth });
  conferir(
    "um status inventado na query não vira 500: volta ao filtro padrão",
    filtroInventado.status === 200 && Array.isArray(filtroInventado.corpo),
    filtroInventado.status
  );

  const fila = await chamar(`${BASE}/api/demands?status=queued`, { headers: auth });
  conferir("GET /api/demands?status=queued responde 200", fila.status === 200, fila.status);
  const lista: any[] = Array.isArray(fila.corpo) ? fila.corpo : [];
  const alvo = lista.find((d) => d.demand_ref === "cdc16f1-fila-1");
  conferir("...e a demanda semeada aparece na fila", Boolean(alvo));
  if (!alvo) return;

  conferir("a demanda está na fila SEM DONO e SEM projeto", alvo.assigned_user_id === null && alvo.project_id === null, {
    assigned_user_id: alvo.assigned_user_id,
    project_id: alvo.project_id,
  });
  conferir("o par cruzado vem marcado para a tela poder avisar", alvo.cross_environment === true, alvo.cross_environment);
  conferir("o documento declarado aparece com o binário já recebido", alvo.documents?.[0]?.has_content === true, alvo.documents?.[0]);
  conferir("...e com o texto que o CRM já extraiu", alvo.documents?.[0]?.has_extracted_text === true, alvo.documents?.[0]);

  const assumida = await chamar(`${BASE}/api/demands/${alvo.id}/assume`, { method: "POST", headers: auth, body: "{}" });
  conferir("POST /assume responde 200", assumida.status === 200, { status: assumida.status, corpo: assumida.corpo });
  const projectId = assumida.corpo?.project_id;
  conferir("...e devolve o id do Projeto criado", Boolean(projectId), assumida.corpo);
  conferir("...com o documento materializado", assumida.corpo?.documents_materialized === 1, assumida.corpo);
  conferir("...e a demanda passa a assigned", assumida.corpo?.demand?.status === "assigned", assumida.corpo?.demand?.status);
  if (!projectId) return;

  const projeto = await chamar(`${BASE}/api/projects/${projectId}`, { headers: auth });
  conferir("o Projeto existe e é legível pela rota normal do produto", projeto.status === 200, projeto.status);
  conferir("...e nasceu COM DONO, que é quem assumiu", Boolean(projeto.corpo?.owner_user_id), projeto.corpo?.owner_user_id);
  conferir("...com o nome vindo da ficha", projeto.corpo?.name === "Videomonitoramento urbano - Pregão 12/2026", projeto.corpo?.name);
  conferir(
    "...e com o cliente e a oportunidade do CRM como REFERÊNCIA (D31)",
    projeto.corpo?.crm_company_id === "cmp_prefeitura_teste" && projeto.corpo?.crm_opportunity_id === "opp_pregao_12_2026",
    { crm_company_id: projeto.corpo?.crm_company_id, crm_opportunity_id: projeto.corpo?.crm_opportunity_id }
  );

  const documentos = await chamar(`${BASE}/api/projects/${projectId}/documents`, { headers: auth });
  conferir("o documento pendurou no Projeto", documentos.status === 200 && Array.isArray(documentos.corpo) && documentos.corpo.length === 1, {
    status: documentos.status,
    quantos: Array.isArray(documentos.corpo) ? documentos.corpo.length : null,
  });
  const documentoId = Array.isArray(documentos.corpo) ? documentos.corpo[0]?.id : null;

  if (documentoId) {
    const conteudo = await chamar(`${BASE}/api/documents/${documentoId}/content`, { headers: auth });
    conferir("o arquivo materializado é baixável de verdade", conteudo.status === 200, conteudo.status);
    conferir(
      "...e o texto que o CRM extraiu está no documento (D36: a extração não se repete)",
      conteudo.texto.includes("PREGÃO ELETRÔNICO 12/2026") || JSON.stringify(conteudo.corpo || "").includes("PREG"),
      conteudo.texto.slice(0, 80)
    );
  }

  // D20 manda medir "até a análise". O carimbo é posto pela própria rota de
  // análise do produto, e não por uma rota da fila - então provar aqui é chamar
  // a rota real. A chamada devolve 202 e a IA roda em segundo plano: uma falha
  // lá (esta instalação de prova não tem chave de IA configurada) não muda o que
  // se quer provar, que é a transição de estado no ato de começar.
  const analise = await chamar(`${BASE}/api/projects/${projectId}/analyze`, { method: "POST", headers: auth, body: "{}" });
  conferir("a rota de análise do produto aceita o projeto que nasceu da demanda", analise.status === 202 || analise.status === 200, {
    status: analise.status,
    corpo: analise.corpo?.message,
  });
  if (analise.status === 202 || analise.status === 200) {
    const emAnalise = await chamar(`${BASE}/api/demands/${alvo.id}`, { headers: auth });
    conferir("...e a demanda passa a in_analysis", emAnalise.corpo?.status === "in_analysis", emAnalise.corpo?.status);
    conferir("...com o instante em que a análise começou (D20)", Boolean(emAnalise.corpo?.analysis_started_at), emAnalise.corpo?.analysis_started_at);
  }

  const denovo = await chamar(`${BASE}/api/demands/${alvo.id}/assume`, { method: "POST", headers: auth, body: "{}" });
  conferir("assumir de novo a mesma demanda devolve 409", denovo.status === 409, denovo.status);

  const motivoCurto = await chamar(`${BASE}/api/demands/${alvo.id}/return`, { method: "POST", headers: auth, body: JSON.stringify({ reason: "curto" }) });
  conferir("devolver sem motivo de verdade é recusado (400)", motivoCurto.status === 400, motivoCurto.status);

  const devolvida = await chamar(`${BASE}/api/demands/${alvo.id}/return`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ reason: "O edital anexado está incompleto: faltam os anexos técnicos citados no item 7." }),
  });
  conferir("devolver com motivo responde 200", devolvida.status === 200, { status: devolvida.status, corpo: devolvida.corpo });
  conferir("...e a demanda vai para returned com o motivo guardado", devolvida.corpo?.demand?.status === "returned" && String(devolvida.corpo?.demand?.returned_reason || "").includes("anexos técnicos"), devolvida.corpo?.demand?.status);

  const projetoDepois = await chamar(`${BASE}/api/projects/${projectId}`, { headers: auth });
  conferir("o Projeto criado sobrevive à devolução (pode já ter trabalho em cima)", projetoDepois.status === 200, projetoDepois.status);

  const devolvidas = await chamar(`${BASE}/api/demands?status=returned`, { headers: auth });
  conferir("a demanda devolvida aparece no filtro de devolvidas", Array.isArray(devolvidas.corpo) && devolvidas.corpo.some((d: any) => d.id === alvo.id), null);

  const segunda = lista.find((d) => d.demand_ref === "cdc16f1-fila-2");
  if (segunda) {
    const semArquivo = await chamar(`${BASE}/api/demands/${segunda.id}/assume`, { method: "POST", headers: auth, body: "{}" });
    conferir("uma demanda sem documento nenhum também pode ser assumida", semArquivo.status === 200, semArquivo.status);
    conferir("...criando o projeto e materializando zero documentos", semArquivo.corpo?.documents_materialized === 0, semArquivo.corpo?.documents_materialized);
  }
}

function envelopeDeProva(ref: string, sha: string, tamanho: number, extras: Record<string, unknown> = {}) {
  return {
    demand_ref: ref,
    sequence: 1,
    company: { crm_company_id: "cmp_porta", name: "Cliente da Porta de Máquina", tax_id: "11222333000144", cnpj_root: "11222333" },
    opportunity: {
      crm_opportunity_id: "opp_porta",
      name: "Oportunidade enviada pela porta",
      currency: "BRL",
      value: 90000,
      margin_percent: 12.5,
      probability: 40,
      risks: ["entrega em 30 dias"],
    },
    sheet: {
      title: "Pedido chegado pela porta de máquina",
      vertical: "Corporativo",
      description: "Enviado pelo CMCRM com a chave do par.",
      deadline: "2026-10-15",
      proposal_validity_date: "2026-11-15",
      ai_orientation_mode: "Vendor-neutral",
    },
    documents: [
      { document_ref: "doc_porta_1", filename: "anexo.txt", mime_type: "text/plain", size_bytes: tamanho, sha256: sha, extracted_text: "texto do anexo", crm_document_id: "crmdoc_porta_1" },
    ],
    sent_by: { crm_user_id: "crm_u_porta", name: "Vendedor via porta" },
    sent_at: new Date().toISOString(),
    ...extras,
  };
}

async function secaoC() {
  secao("C — a porta de máquina com um par REAL (chave em PAIR_KEY)");
  if (!CHAVE_DO_PAR) {
    console.log("  PULADA: PAIR_KEY não fornecida. O par entre as duas instalações ainda não existe no CMSaaS.");
    console.log("  Nada aqui é declarado provado.");
    return false;
  }

  const crypto = await import("crypto");
  const conteudo = Buffer.from(`anexo de prova ${Date.now()}`, "utf8");
  const sha = crypto.createHash("sha256").update(conteudo).digest("hex");
  const ref = `cdc16f1-porta-${Date.now()}`;
  const chaveIdem = `cdc16f1-idem-${Date.now()}`;
  const auth = comChave(CHAVE_DO_PAR, { "Content-Type": "application/json" });

  const verify = await chamar(`${PORTA_MAQUINA}/pair/verify`, { headers: comChave(CHAVE_DO_PAR) });
  conferir("GET /pair/verify com a chave do par responde 200", verify.status === 200, { status: verify.status, corpo: verify.corpo });
  conferir("...identificando ESTE lado como presales", verify.corpo?.product === "presales", verify.corpo?.product);
  conferir("...com installation_id, customer_id e environment preenchidos", Boolean(verify.corpo?.installation_id && verify.corpo?.customer_id && verify.corpo?.environment), verify.corpo);
  // Com o par criado, o modo integrado é derivado dele pelo CMSaaS e chega nesta
  // instalação dentro da licença assinada. `queue_enabled` verdadeiro é a ponta
  // de chegada dessa cadeia inteira, vista pela porta: par -> licença -> fila.
  conferir("...e a fila responde de pé (queue_enabled verdadeiro)", verify.corpo?.queue_enabled === true, verify.corpo?.queue_enabled);

  // UM envelope, montado uma vez só. Remontá-lo a cada chamada mudaria `sent_at`
  // e a repetição deixaria de ser repetição - o 409 por corpo diferente estaria
  // certo e a prova é que estaria errada. Foi exatamente o que aconteceu na
  // primeira execução da seção C: a retentativa de verdade, feita pelo CMCRM,
  // reenvia o MESMO envelope, porque `sent_at` é o instante do FATO, não o do
  // envio.
  const envelope = envelopeDeProva(ref, sha, conteudo.length);

  const semIdem = await chamar(`${PORTA_MAQUINA}/demands`, { method: "POST", headers: auth, body: JSON.stringify(envelope) });
  conferir("POST /demands sem Idempotency-Key é recusado (400)", semIdem.status === 400, semIdem.status);

  const criada = await chamar(`${PORTA_MAQUINA}/demands`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": chaveIdem },
    body: JSON.stringify(envelope),
  });
  conferir("POST /demands cria a demanda (201)", criada.status === 201, { status: criada.status, corpo: criada.corpo });
  conferir("...devolvendo o DemandState do contrato, com status queued", criada.corpo?.demand_ref === ref && criada.corpo?.status === "queued", criada.corpo);
  conferir("...e sem inventar due_at enquanto não houver SLA (F5)", criada.corpo?.due_at === undefined, criada.corpo?.due_at);

  const repetida = await chamar(`${PORTA_MAQUINA}/demands`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": chaveIdem },
    body: JSON.stringify(envelope),
  });
  conferir("repetir a MESMA chave com o MESMO corpo devolve a demanda existente", repetida.status === 200 && repetida.corpo?.demand_ref === ref, { status: repetida.status, corpo: repetida.corpo });

  const reaproveitada = await chamar(`${PORTA_MAQUINA}/demands`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": chaveIdem },
    body: JSON.stringify(envelopeDeProva(`${ref}-outro`, sha, conteudo.length)),
  });
  conferir("a mesma chave com OUTRO corpo é 409, e não uma repetição silenciosa", reaproveitada.status === 409, { status: reaproveitada.status, corpo: reaproveitada.corpo });

  const incompleta = await chamar(`${PORTA_MAQUINA}/demands`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": `${chaveIdem}-incompleta` },
    body: JSON.stringify({ ...envelopeDeProva(`${ref}-incompleta`, sha, conteudo.length), sheet: { title: "só o título" } }),
  });
  conferir("ficha incompleta é 422 com os campos que faltam", incompleta.status === 422 && Array.isArray(incompleta.corpo?.details), { status: incompleta.status, corpo: incompleta.corpo });

  const estado = await chamar(`${PORTA_MAQUINA}/demands/${ref}`, { headers: comChave(CHAVE_DO_PAR) });
  conferir("GET /demands/{ref} devolve o estado da demanda", estado.status === 200 && estado.corpo?.demand_ref === ref, { status: estado.status, corpo: estado.corpo });

  const inexistente = await chamar(`${PORTA_MAQUINA}/demands/nao-existe-${Date.now()}`, { headers: comChave(CHAVE_DO_PAR) });
  conferir("GET /demands/{ref inexistente} devolve 404", inexistente.status === 404, inexistente.status);

  const hashErrado = await chamar(`${PORTA_MAQUINA}/demands/${ref}/documents/doc_porta_1/content`, {
    method: "PUT",
    headers: comChave(CHAVE_DO_PAR, { "Content-Type": "application/octet-stream" }),
    body: Buffer.from("conteudo diferente do declarado"),
  });
  conferir("upload com sha256 divergente é 422", hashErrado.status === 422 && hashErrado.corpo?.error === "sha256_mismatch", { status: hashErrado.status, corpo: hashErrado.corpo });

  const subiu = await chamar(`${PORTA_MAQUINA}/demands/${ref}/documents/doc_porta_1/content`, {
    method: "PUT",
    headers: comChave(CHAVE_DO_PAR, { "Content-Type": "application/octet-stream" }),
    body: conteudo,
  });
  conferir("upload com o hash declarado grava (201)", subiu.status === 201 && subiu.corpo?.stored === true, { status: subiu.status, corpo: subiu.corpo });

  const denovo = await chamar(`${PORTA_MAQUINA}/demands/${ref}/documents/doc_porta_1/content`, {
    method: "PUT",
    headers: comChave(CHAVE_DO_PAR, { "Content-Type": "application/octet-stream" }),
    body: conteudo,
  });
  conferir("reenviar o MESMO conteúdo devolve 200 e não regrava (D11)", denovo.status === 200 && denovo.corpo?.stored === false, { status: denovo.status, corpo: denovo.corpo });

  // Os três caminhos da F7 EXISTEM desde 28/08/2026, e a superfície da spec
  // fechou em seis de seis. Até então esta conferência exigia 404 aqui — era a
  // única forma verificável de dizer "ainda não existe" em vez de "existe pela
  // metade". Agora ela prova o contrário, e continua sendo a mesma pergunta:
  // que a rota é RESOLVIDA, e não engolida pelo 404 genérico da API.
  //
  // O que se confere é o erro NOMEADO de cada uma sobre uma demanda que não
  // existe — 404 `demand_not_found` do PATCH e do /cancel, 422 do /purge sem
  // alvo. Um 404 do roteador não traz `error` nenhum, e é o que separa os dois.
  const refInexistenteF7 = "nao-existe-mesmo-cdc16";
  const patchF7 = await chamar(`${PORTA_MAQUINA}/demands/${refInexistenteF7}`, {
    method: "PATCH",
    headers: { ...auth, "Idempotency-Key": "f1-confere-patch-f7" },
    body: "{}",
  });
  conferir(
    "PATCH /demands/{ref} (F7) existe: 404 demand_not_found, e não o 404 do roteador",
    patchF7.status === 404 && patchF7.corpo?.error === "demand_not_found",
    `${patchF7.status} ${patchF7.corpo?.error}`
  );
  const cancelF7 = await chamar(`${PORTA_MAQUINA}/demands/${refInexistenteF7}/cancel`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ justification: "conferencia da porta, dez ou mais", approved_by: { crm_user_id: "x", name: "y" } }),
  });
  conferir(
    "POST /demands/{ref}/cancel (F7) existe: 404 demand_not_found",
    cancelF7.status === 404 && cancelF7.corpo?.error === "demand_not_found",
    `${cancelF7.status} ${cancelF7.corpo?.error}`
  );
  const purgeF7 = await chamar(`${PORTA_MAQUINA}/purge`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ reason: "retention", targets: [] }),
  });
  conferir(
    "POST /purge (F7) existe: 422 validation_error com alvo vazio",
    purgeF7.status === 422 && purgeF7.corpo?.error === "validation_error",
    `${purgeF7.status} ${purgeF7.corpo?.error}`
  );

  const naoDeclarado = await chamar(`${PORTA_MAQUINA}/demands/${ref}/documents/doc_que_nao_foi_declarado/content`, {
    method: "PUT",
    headers: comChave(CHAVE_DO_PAR, { "Content-Type": "application/octet-stream" }),
    body: conteudo,
  });
  conferir("upload de documento não declarado no envelope é 404", naoDeclarado.status === 404, naoDeclarado.status);

  return true;
}

async function main() {
  console.log(`prova da F1 contra ${BASE}`);
  const saude = await chamar(`${BASE}/api/health`);
  conferir("o PreSales está no ar e responde /api/health", saude.status === 200, saude.status);

  await secaoA();
  await secaoB();
  const rodouC = await secaoC();

  console.log(`\n${passaram + falharam} conferências: ${passaram} passaram, ${falharam} falharam.`);
  if (!rodouC) console.log("A seção C (porta com par real) NÃO foi executada - fica declarada como NÃO PROVADA.");
  if (falhas.length) {
    console.log("\nFalhas:");
    for (const f of falhas) console.log(`  - ${f}`);
  }
  process.exit(falharam === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("prova abortada:", err?.message || err);
  process.exit(2);
});
