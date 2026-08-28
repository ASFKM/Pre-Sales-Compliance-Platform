/**
 * CDC 16 — Fase 10. A prova da INSTALAÇÃO NO AR, e não do log da publicação.
 *
 * Roda contra a porta 3000 do `home-comercial-01`, que é o PreSales Demo publicado. Tudo é lido
 * pelas ROTAS, com login real; o que uma publicação precisa provar é que o programa NOVO está
 * respondendo, e "o deploy disse OK" não prova isso — a F9 registrou a régua: o pacote servido
 * pela página tem de conferir com o do disco, que é o que separa "publicado" de "construído".
 *
 * A conta desta prova é DEDICADA, com e-mail em `.invalid` (marco forte manda e-mail, e esta casa
 * já mandou teste para pessoa real uma vez), tem só leitura de demanda — de propósito, para
 * exercitar o lado RESTRITIVO da régua do desempenho em produção — e é REMOVIDA no fim: uma
 * instalação viva não fica com resíduo de prova. Nada é criado, alterado ou apagado nas 37
 * demandas reais do Demo: esta prova só lê.
 *
 *   PROVA_PASSWORD=… npx tsx scripts/cdc16-f10-provar-no-ar.ts
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { hashPassword } from "../server/utils/security";
import { randomId } from "../src/idGenerator";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const TENANT = process.env.PROVA_TENANT || "tenant_default";
const EMAIL = "f10-no-ar@exemplo.invalid";
const NOME = "prova-cdc16-f10-no-ar";

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

let headers: Record<string, string> = {};

async function rota(caminho: string) {
  const r = await fetch(`${BASE}${caminho}`, { headers });
  const texto = await r.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { status: r.status, tipo: r.headers.get("content-type") || "", corpo: json, texto };
}

async function main() {
  const senha = process.env.PROVA_PASSWORD;
  if (!senha) throw new Error("PROVA_PASSWORD ausente — a prova entra pela rota de login real");

  await runWithTenant({ tenantId: TENANT, canSeeAllProjects: true }, async () => {
    linhas.push(`(instalação no ar: ${BASE}, tenant ${TENANT})`);

    // ── a conta dedicada ─────────────────────────────────────────────────────
    const papel = await prisma.role.create({
      data: {
        id: randomId("role"),
        tenantId: TENANT,
        name: `${NOME}-papel`,
        description: "Papel temporário da prova da publicação da CDC16 F10",
        // SEM `demand:manage`: é o lado restritivo da régua do desempenho, e é
        // ele que a publicação precisa mostrar funcionando em produção.
        permissions: ["demand:read", "project:read"],
      },
    });
    const usuario = await prisma.user.create({
      data: {
        id: randomId("usr"),
        tenantId: TENANT,
        name: NOME,
        email: EMAIL,
        passwordHash: hashPassword(senha),
        roleId: papel.id,
        status: "ACTIVE",
      },
    });

    try {
      const login = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: senha }),
      });
      const corpoLogin: any = await login.json().catch(() => ({}));
      const token = corpoLogin?.token || corpoLogin?.session_token || corpoLogin?.data?.token;
      checar("login real na instalação no ar", login.status === 200 && !!token, `status=${login.status}`);
      if (!token) throw new Error("sem sessão não há prova pelas rotas");
      headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      // ── 1. o envelope, sobre as demandas REAIS do Demo ─────────────────────
      linhas.push("\n[1] o envelope e a página de cinco, sobre as demandas reais");
      const p1 = await rota("/api/demands?status=queued,assigned,in_analysis,returned&limit=5&offset=0&sort=deadline");
      checar("o envelope responde com os campos da F9",
        p1.status === 200 && Array.isArray(p1.corpo?.items) && typeof p1.corpo?.total === "number" &&
          typeof p1.corpo?.limit === "number" && typeof p1.corpo?.sort === "string",
        `status=${p1.status} total=${p1.corpo?.total} limit=${p1.corpo?.limit}`);
      checar("a página de cinco é respeitada, e o total é do recorte",
        p1.corpo.items.length <= 5 && p1.corpo.total >= p1.corpo.items.length,
        `${p1.corpo.items.length} linhas de ${p1.corpo.total}`);

      const p2 = await rota("/api/demands?status=queued,assigned,in_analysis,returned&limit=5&offset=5&sort=deadline");
      const ids1 = p1.corpo.items.map((d: any) => d.id);
      const ids2 = p2.corpo.items.map((d: any) => d.id);
      checar("a segunda página não repete a primeira — desempate único, em produção",
        ids2.every((i: string) => !ids1.includes(i)), `p1=${ids1.length} p2=${ids2.length}`);

      // ── 2. os contadores, que são o que esta fase entregou ─────────────────
      linhas.push("\n[2] os contadores vêm do recorte, e chegaram ao ar");
      checar("`counts` viaja no envelope — é o campo novo desta fase",
        !!p1.corpo.counts && typeof p1.corpo.counts.return_pending === "number" &&
          typeof p1.corpo.counts.my_pending_updates === "number" &&
          typeof p1.corpo.counts.my_cancellations === "number",
        JSON.stringify(p1.corpo.counts));
      const umaLinha = await rota("/api/demands?status=queued,assigned,in_analysis,returned&limit=1");
      checar("e ele NÃO encolhe com a página: uma linha, e o total intacto",
        umaLinha.corpo.items.length === 1 && umaLinha.corpo.total === p1.corpo.total &&
          JSON.stringify(umaLinha.corpo.counts) === JSON.stringify(p1.corpo.counts),
        `1 linha de ${umaLinha.corpo.total}, counts=${JSON.stringify(umaLinha.corpo.counts)}`);
      const semDono = await rota("/api/demands?status=queued,assigned,in_analysis,returned&assigned_user_id=none&limit=1");
      checar("no recorte SEM DONO os avisos de quem assumiu são zero — o `AND` desta fase, em produção",
        semDono.corpo.counts?.my_pending_updates === 0 && semDono.corpo.counts?.my_cancellations === 0,
        `counts=${JSON.stringify(semDono.corpo.counts)}`);

      // ── 3. os dois recortes que os cards pedem ─────────────────────────────
      linhas.push("\n[3] os dois cards, pelo mesmo endpoint");
      const novas = await rota("/api/demands?status=queued&assigned_user_id=none&limit=5");
      const minhas = await rota("/api/demands?status=assigned,in_analysis,returned&assigned_user_id=me&limit=5");
      checar("o card das novas responde", novas.status === 200, `status=${novas.status} total=${novas.corpo?.total}`);
      checar("o card das minhas responde, e vem vazio para uma conta que não assumiu nada",
        minhas.status === 200 && minhas.corpo.total === 0,
        `status=${minhas.status} total=${minhas.corpo?.total}`);
      checar("as novas não têm dono — o recorte é o que a tela pede",
        novas.corpo.items.every((d: any) => !d.assigned_user_id),
        `${novas.corpo.items.length} linhas, nenhuma com dono`);

      // ── 4. a ordenação e os recortes que ganharam tela ─────────────────────
      linhas.push("\n[4] ordenação e recortes, pelas quatro colunas do card");
      for (const ordem of ["title", "value", "deadline", "sla_due"]) {
        const r = await rota(`/api/demands?status=queued&assigned_user_id=none&limit=5&sort=${ordem}&dir=desc`);
        checar(`ordem por ${ordem}`, r.status === 200 && r.corpo.sort === ordem && r.corpo.dir === "desc",
          `status=${r.status} sort=${r.corpo?.sort} dir=${r.corpo?.dir}`);
      }
      const proto = await rota("/api/demands?limit=5&sort=__proto__");
      checar("`sort=__proto__` responde 200 no padrão, e não 500 — em produção",
        proto.status === 200 && proto.corpo.sort === "deadline", `status=${proto.status} sort=${proto.corpo?.sort}`);
      const faixa = await rota("/api/demands?status=queued&limit=5&min_value=1&max_value=999999999");
      const busca = await rota("/api/demands?status=queued&limit=5&q=a");
      const cliente = await rota("/api/demands?status=queued&limit=5&company=a");
      checar("os recortes que ganharam controle de tela respondem",
        faixa.status === 200 && busca.status === 200 && cliente.status === 200,
        `faixa=${faixa.status} busca=${busca.status} cliente=${cliente.status}`);

      // ── 5. o card de tarefas saiu, e saiu como ROTA ────────────────────────
      linhas.push("\n[5] a rota de tarefas morreu na instalação no ar");
      const tarefas = await rota("/api/user-tasks");
      const controle = await rota("/api/rota-que-nunca-existiu-f10");
      checar("GET /api/user-tasks não responde 200", tarefas.status !== 200, `status=${tarefas.status}`);
      checar("e responde como ROTA, não como o HTML da página",
        !tarefas.tipo.includes("text/html"), `content-type=${tarefas.tipo}`);
      checar("a rota de controle inventada responde igual — é o que faz a comparação valer",
        controle.status === tarefas.status && controle.tipo === tarefas.tipo,
        `controle status=${controle.status} tipo=${controle.tipo}`);
      const tabela: any[] = await prisma.$queryRawUnsafe("select to_regclass('public.tasks') is null as sumiu");
      checar("a tabela `tasks` não existe mais no banco de produção", tabela[0]?.sumiu === true,
        `to_regclass is null = ${tabela[0]?.sumiu}`);

      // ── 6. a régua do desempenho, no lado restritivo ───────────────────────
      linhas.push("\n[6] o gráfico da Início lê o desempenho com a régua certa");
      const desempenho = await rota("/api/demands/performance");
      checar("o desempenho responde com `scope` no corpo",
        desempenho.status === 200 && !!desempenho.corpo.scope, `scope=${desempenho.corpo?.scope}`);
      checar("e vem `self` para uma conta sem `demand:manage` — o lado restritivo, em produção",
        desempenho.corpo.scope === "self", `scope=${desempenho.corpo?.scope}`);
      checar("a média da EQUIPE continua chegando (D20: agregado não é recorte de gente)",
        !!desempenho.corpo.team && typeof desempenho.corpo.team.total === "number",
        `team.total=${desempenho.corpo.team?.total}`);

      // ── 7. sem sessão, nada ────────────────────────────────────────────────
      const semSessao = await fetch(`${BASE}/api/demands?limit=1`);
      checar("a rota recusa quem não entrou", semSessao.status === 401, `status=${semSessao.status}`);

      // ── 8. o que separa "publicado" de "construído" ────────────────────────
      linhas.push("\n[8] o pacote servido confere com o do disco");
      const pagina = await fetch(`${BASE}/`);
      const html = await pagina.text();
      const servido = (html.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1];
      const fs = await import("fs");
      const noDisco = fs
        .readdirSync("/home/sakae/projects/commercial-assistant-ai/dist/assets")
        .filter((f) => /^index-.*\.js$/.test(f));
      checar("a página serve o pacote que está no disco",
        !!servido && noDisco.includes(servido), `servido=${servido} disco=[${noDisco.join(",")}]`);
      checar("e não é o pacote da fase anterior", servido !== "index-WQbTIl3d.js",
        `anterior=index-WQbTIl3d.js servido=${servido}`);
    } finally {
      // A instalação viva não fica com resíduo da prova.
      await prisma.user.deleteMany({ where: { email: EMAIL } });
      await prisma.role.deleteMany({ where: { name: `${NOME}-papel` } });
      const sobrou = await prisma.user.count({ where: { email: EMAIL } });
      checar("a conta da prova foi removida do Demo", sobrou === 0, `${sobrou} conta(s) restante(s)`);
    }
  });
}

main()
  .then(async () => {
    console.log(linhas.join("\n"));
    console.log(`\n== ${passou} conferências OK, ${falhou} falhas`);
    await prisma.$disconnect();
    process.exit(falhou > 0 ? 1 : 0);
  })
  .catch(async (e) => {
    console.log(linhas.join("\n"));
    console.error("\nERRO:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
