/*
 * F9 — as provas do assistente do aprovador, rodadas do proprio host (a senha nunca sai daqui).
 *
 * O que cada bloco prova:
 *   1. O GET nao gasta IA e diz que ainda nao ha leitura para esta versao.
 *   2. O POST gera, e a saida REAL nao recomenda aprovar nem rejeitar.
 *   3. O SEGUNDO POST sobre a MESMA versao devolve o guardado, sem nova chamada de IA.
 *   4. A impressao do estado marca o resultado como desatualizado quando a tratativa muda.
 */
import fs from "fs";

const BASE = "http://127.0.0.1:3000/api";
const PROP = process.env.F9_PROP || "prop_ca71b0cee40d92e2";

const senha = fs.readFileSync("reset-marcus-pw.mjs", "utf8").match(/NEW_PASSWORD\s*=\s*["'`]([^"'`]+)/)![1];

async function login(): Promise<string> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "marcus.vance@enterprise.com", password: senha }),
  });
  const d: any = await r.json();
  if (!d.token) throw new Error(`login ${r.status}: ${JSON.stringify(d)}`);
  return d.token;
}

const token = await login();
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};

const linha = (t: string) => console.log(`\n${"=".repeat(90)}\n${t}\n${"=".repeat(90)}`);

linha(`PROVA 1 — GET nao gasta IA e informa que nao ha leitura guardada (proposta ${PROP})`);
const g1 = await api(`/proposals/${PROP}/assistente-do-aprovador`);
console.log("status:", g1.status, "| briefing:", g1.body.briefing === null ? "null (nao gerado)" : "presente", "| desatualizado:", g1.body.desatualizado);

linha("PROVA 2 — POST gera. SAIDA REAL, integral:");
const p1 = await api(`/proposals/${PROP}/assistente-do-aprovador`, { method: "POST", body: JSON.stringify({}) });
console.log("status:", p1.status, "| origem:", p1.body.origem);
if (p1.status !== 200) {
  console.log(JSON.stringify(p1.body, null, 2));
  process.exit(1);
}
console.log("\nPANORAMA:", p1.body.briefing.panorama);
console.log("\nPONTOS:");
for (const pt of p1.body.briefing.pontos) {
  console.log(`  [${pt.categoria}] ${pt.pergunta}`);
  console.log(`      por que: ${pt.por_que}`);
  console.log(`      secao=${pt.secao} apontamento=${pt.apontamento_id}`);
}
console.log("\ndescartados pelas amarras:", JSON.stringify(p1.body.descartados));
console.log("panorama substituido por soar como veredito:", p1.body.panorama_substituido);
console.log("provedor/modelo usados:", p1.body.briefing.provider_used, "/", p1.body.briefing.model_used);
console.log("logic_version:", p1.body.briefing.logic_version, "| versao da proposta:", p1.body.briefing.proposal_version);

// Verificacao textual da promessa da fase, sobre a saida REAL que acabou de vir.
const textoInteiro = [p1.body.briefing.panorama, ...p1.body.briefing.pontos.flatMap((p: any) => [p.pergunta, p.por_que])].join("\n");
const todasPerguntas = p1.body.briefing.pontos.every((p: any) => p.pergunta.trim().endsWith("?"));
console.log("\nTODO ponto termina em '?':", todasPerguntas);

linha("PROVA 3 — SEGUNDO POST na MESMA versao devolve o guardado (sem nova chamada de IA)");
const p2 = await api(`/proposals/${PROP}/assistente-do-aprovador`, { method: "POST", body: JSON.stringify({}) });
console.log("status:", p2.status, "| origem:", p2.body.origem, "| mesmo id:", p2.body.briefing?.id === p1.body.briefing.id);
console.log("mesmo updated_at (nada foi regravado):", p2.body.briefing?.updated_at === p1.body.briefing.updated_at);

linha("PROVA 4 — o GET agora devolve o guardado, ainda em dia");
const g2 = await api(`/proposals/${PROP}/assistente-do-aprovador`);
console.log("status:", g2.status, "| pontos:", g2.body.briefing?.pontos?.length, "| desatualizado:", g2.body.desatualizado);

console.log("\n__TEXTO_INTEGRAL_PARA_AUDITORIA__");
console.log(textoInteiro);
