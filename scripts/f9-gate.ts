/*
 * F9 — o GATE do assistente. Ele e o MESMO do dossie, e isso precisa ser provado contra o banco,
 * nao deduzido do codigo: a conta `prova-f8-sem-alcada` tem um papel que nao aprova estagio nenhum
 * e nao tem `proposal:approve`, e a proposta `prop_prova_f8_403` existe exatamente porque a
 * visibilidade do Prisma esconderia qualquer outra ANTES do gate, devolvendo 404 no lugar do 403.
 */
import fs from "fs";

const BASE = "http://127.0.0.1:3000/api";
const PROP_403 = process.env.F9_PROP_403 || "prop_prova_f8_403";
const PROP_OK = "prop_ca71b0cee40d92e2";

const senhaMarcus = fs.readFileSync("reset-marcus-pw.mjs", "utf8").match(/NEW_PASSWORD\s*=\s*["'`]([^"'`]+)/)![1];
const senhaSemAlcada = fs.readFileSync("/home/sakae/.f9-senha-prova", "utf8").trim();

async function login(email: string, password: string): Promise<string> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d: any = await r.json();
  if (!d.token) throw new Error(`${email}: ${r.status} ${JSON.stringify(d)}`);
  return d.token;
}

const tokenMarcus = await login("marcus.vance@enterprise.com", senhaMarcus);
const tokenSemAlcada = await login("prova-f8-sem-alcada@local.invalid", senhaSemAlcada);

const api = async (token: string, path: string, init: RequestInit = {}) => {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};

let falhas = 0;
const ok = (cond: boolean, rotulo: string, detalhe: string) => {
  if (!cond) falhas++;
  console.log(`  ${cond ? "OK  " : "FALHA"} ${rotulo} — ${detalhe}`);
};

console.log("\n== GATE DO ASSISTENTE DO APROVADOR ==");

const g403 = await api(tokenSemAlcada, `/proposals/${PROP_403}/assistente-do-aprovador`);
ok(g403.status === 403, "GET recusa quem nao e aprovador nem designado", `status=${g403.status}`);

const p403 = await api(tokenSemAlcada, `/proposals/${PROP_403}/assistente-do-aprovador`, { method: "POST", body: "{}" });
ok(p403.status === 403, "POST recusa quem nao e aprovador nem designado", `status=${p403.status}`);

const gOk = await api(tokenMarcus, `/proposals/${PROP_OK}/assistente-do-aprovador`);
ok(gOk.status === 200, "GET aceita o aprovador designado", `status=${gOk.status}`);

const g404 = await api(tokenMarcus, `/proposals/prop_que_nao_existe/assistente-do-aprovador`);
ok(g404.status === 404, "proposta inexistente responde 404", `status=${g404.status}`);

// O gate recusa ANTES de qualquer chamada de IA: um 403 nao pode custar dinheiro.
ok(p403.body?.briefing === undefined, "o 403 nao devolve conteudo nenhum", `corpo=${JSON.stringify(p403.body).slice(0, 90)}`);

console.log(falhas === 0 ? "\nTODAS AS PROVAS DE GATE PASSARAM" : `\n${falhas} PROVA(S) DE GATE FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
