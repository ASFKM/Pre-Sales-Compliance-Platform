/* F8 — emite os tokens de prova SEM que nenhuma senha saia deste host. */
import fs from "fs";
const src = fs.readFileSync("reset-marcus-pw.mjs", "utf8");
const senha = src.match(/NEW_PASSWORD\s*=\s*["'`]([^"'`]+)/)[1];
const login = async (email, password) => {
  const r = await fetch("http://127.0.0.1:3000/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!d.token) throw new Error(`${email}: ${r.status} ${JSON.stringify(d)}`);
  return d.token;
};
console.log(JSON.stringify({
  marcus: await login("marcus.vance@enterprise.com", senha),
  sem_alcada: await login("prova-f8-sem-alcada@local.invalid", process.env.F8_SENHA),
}));
