/*
 * F9 — provas 5 e 6.
 *   5. A VERSAO SEGUINTE da mesma cadeia nao herda o resultado: oferece rodada nova.
 *   6. Mudar a TRATATIVA de um apontamento marca o resultado guardado como desatualizado -
 *      sem apaga-lo e sem gastar IA.
 */
import fs from "fs";
import { execFileSync } from "child_process";

const BASE = "http://127.0.0.1:3000/api";
const V2 = "prop_ca71b0cee40d92e2";
const V3 = "prop_f3fea98ece26bd20";

const senha = fs.readFileSync("reset-marcus-pw.mjs", "utf8").match(/NEW_PASSWORD\s*=\s*["'`]([^"'`]+)/)![1];
const r0 = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "marcus.vance@enterprise.com", password: senha }),
});
const token = ((await r0.json()) as any).token;

const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};
const linha = (t: string) => console.log(`\n${"=".repeat(90)}\n${t}\n${"=".repeat(90)}`);

linha("PROVA 5 — a v3 da MESMA cadeia nao herda o resultado da v2");
const gv3 = await api(`/proposals/${V3}/assistente-do-aprovador`);
console.log(`v3 (${V3}) GET -> briefing:`, gv3.body.briefing === null ? "null (rodada nova disponivel)" : "HERDOU (errado)");
const gv2 = await api(`/proposals/${V2}/assistente-do-aprovador`);
console.log(`v2 (${V2}) GET -> briefing:`, gv2.body.briefing ? `presente, ${gv2.body.briefing.pontos.length} pontos` : "null");
console.log("as duas versoes sao linhas independentes:", gv3.body.briefing === null && gv2.body.briefing !== null);

linha("PROVA 6 — mudar a TRATATIVA de um apontamento marca o guardado como desatualizado");
const psql = (sql: string) =>
  execFileSync("docker", ["exec", "commercial-assistant-ai-postgres-1", "psql", "-U", "app_user", "-d", "commercial_assistant", "-t", "-A", "-c", sql], { encoding: "utf8" }).trim();
const antes = await api(`/proposals/${V2}/assistente-do-aprovador`);
console.log("antes da mudanca -> desatualizado:", antes.body.desatualizado);

const alvoId = psql(`SELECT f.id FROM proposal_opinion_findings f JOIN proposal_ai_opinion_items o ON o.id=f.opinion_id JOIN proposal_opinion_runs r ON r.id=o.run_id WHERE r.proposal_id='${V2}' ORDER BY f.ordinal LIMIT 1`);
const notaOriginal = psql(`SELECT coalesce(resolution_note,'') FROM proposal_opinion_findings WHERE id='${alvoId}'`);
console.log("apontamento alterado:", alvoId, "| nota anterior:", JSON.stringify(notaOriginal));
psql(`UPDATE proposal_opinion_findings SET resolution_note='${notaOriginal.replace(/'/g, "''")} [prova F9: justificativa alterada]' WHERE id='${alvoId}'`);

const depois = await api(`/proposals/${V2}/assistente-do-aprovador`);
console.log("depois da mudanca -> desatualizado:", depois.body.desatualizado);
console.log("resultado guardado CONTINUA servido (nao foi apagado):", depois.body.briefing !== null, "| pontos:", depois.body.briefing?.pontos?.length);
console.log("mesmo id, nada regravado:", depois.body.briefing?.id === antes.body.briefing?.id);

// Devolve o apontamento ao estado original: a prova nao pode deixar o banco sujo.
psql(`UPDATE proposal_opinion_findings SET resolution_note='${notaOriginal.replace(/'/g, "''")}' WHERE id='${alvoId}'`);
const restaurado = await api(`/proposals/${V2}/assistente-do-aprovador`);
console.log("apos restaurar a justificativa -> desatualizado:", restaurado.body.desatualizado, "(volta a casar: a impressao e do CONTEUDO)");
