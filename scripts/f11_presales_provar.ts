const BASE = process.env.BASE || "http://127.0.0.1:3299/api";
const EMAIL = "prova-f11@local.invalid";
const SENHA = process.env.PROVA_PASSWORD!;
const TENANT = "tenant_default";

let passou = 0;
let falhou = 0;
const linhas: string[] = [];
function checar(rotulo: string, condicao: boolean, detalhe: string) {
  if (condicao) { passou++; linhas.push(`  OK    ${rotulo} — ${detalhe}`); }
  else { falhou++; linhas.push(`  FALHA ${rotulo} — ${detalhe}`); }
}

async function chamar(metodo: string, caminho: string, token: string, body?: unknown) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "x-tenant-id": TENANT, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await r.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { json = { _raw: texto.slice(0, 300) }; }
  return { status: r.status, json };
}

async function main() {
  // 1) Login real - básico, sem par com CMCRM e sem add-on ia_kb algum: a régua do §3 que
  // atravessa a frente desde a F5 (auto-serviço não pode quebrar).
  const login = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });
  const loginJson: any = await login.json();
  checar("login básico funciona (sem par, sem add-on)", login.status === 200 && Boolean(loginJson.token), `status=${login.status} body=${JSON.stringify(loginJson).slice(0, 200)}`);
  const token = loginJson.token;

  // 2) Controle: um módulo que AINDA é toggle real (pricing) continua fechado para quem não o
  // tem - prova que "o portão caiu" foi só o do ia_kb, não todo portão.
  const pricing = await chamar("GET", "/pricing/health", token);
  checar("pricing continua bloqueado (403) para instalação sem o módulo", pricing.status === 403, `status=${pricing.status} body=${JSON.stringify(pricing.json).slice(0, 200)}`);

  // 3) Auto-serviço básico: uma leitura comum (projetos) continua funcionando.
  const projetos = await chamar("GET", "/projects", token);
  checar("auto-serviço básico (listar projetos) continua funcionando", projetos.status === 200, `status=${projetos.status}`);

  // 4) A IA gerenciada funciona sem add-on - rota leve que dispara generateTextWithProvider
  // (spec_copilot) de verdade, através do túnel até o Fleet Manager real da branch.
  const sugestao = await chamar("POST", "/knowledge-base/suggest", token, {
    category: "engineering_note",
    field_label: "Prova F11",
    old_value: "valor antigo de prova",
    new_value: "valor novo de prova - responda apenas confirmando",
    item_context: "prova de ponta a ponta da F11 - IA gerenciada sem add-on",
    project_id: "p1",
    project_name: "Projeto de prova F11",
  });
  checar(
    "IA gerenciada funciona sem add-on (rota real, IA de verdade via túnel até o Fleet Manager)",
    sugestao.status === 200,
    `status=${sugestao.status} body=${JSON.stringify(sugestao.json).slice(0, 300)}`
  );

  // 5) Item 05: o relatório por usuário reflete a chamada acima, com o usuário desta prova.
  const custo = await chamar("GET", "/settings/ai-cost-summary", token);
  checar("relatório por usuário responde 200", custo.status === 200, `status=${custo.status}`);
  const porUsuario = custo.json?.spend_by_user || [];
  const cobertura = custo.json?.ownership_coverage;
  checar(
    "usuário da prova aparece no relatório por usuário",
    porUsuario.some((r: any) => r.user_name === "Prova F11" && r.call_count >= 1),
    `spend_by_user=${JSON.stringify(porUsuario)}`
  );
  checar(
    "cobertura de dono é coerente (com_dono <= total, >0 chamadas com dono)",
    Boolean(cobertura) && cobertura.calls_with_owner >= 1 && cobertura.calls_with_owner <= cobertura.total_calls,
    `ownership_coverage=${JSON.stringify(cobertura)}`
  );

  console.log(linhas.join("\n"));
  console.log(`\n${passou} OK, ${falhou} FALHA de ${passou + falhou} conferências`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
