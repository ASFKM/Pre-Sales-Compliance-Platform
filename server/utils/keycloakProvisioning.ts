/**
 * Cadastro do usuário administrador no Keycloak, para o wizard de instalação.
 *
 * Desde a Fase 13 a senha não vive mais neste produto: as colunas `password_hash`, `mfa_*` e
 * `must_change_password` saíram de `users`, e o login resolve identidade pelo token do Keycloak
 * (`verificarTokenDoKeycloak` -> `emailDoToken` -> `getUserByEmail`). Uma instalação nova precisa
 * das DUAS pontas — a conta no Keycloak, que guarda a senha, e o usuário local com papel de
 * administrador, que é quem o token vira dentro do produto. Só uma das duas não dá acesso: com a
 * conta local sozinha o login não acontece, e com a conta do Keycloak sozinha o token é aceito e
 * o produto não encontra o usuário.
 *
 * O wizard criava só a local, e ainda IMPRIMIA ao final uma senha que não era gravada em lugar
 * nenhum — quem instalasse tentaria entrar com ela e não conseguiria, sem nada explicando por quê.
 *
 * A senha não está neste arquivo nem em nenhum outro do repositório: ela é digitada no wizard.
 * Uma senha padrão em código seria a mesma em toda instalação, ficaria visível para quem tem
 * acesso ao repositório e seria barrada pelo gitleaks do CI.
 */

export interface CredenciaisDeAdminDoKeycloak {
  baseUrl: string;
  realm: string;
  adminUser: string;
  adminPassword: string;
  /** O realm onde a conta administrativa do próprio Keycloak vive. Quase sempre `master`. */
  adminRealm?: string;
}

export class ErroDeProvisionamento extends Error {
  constructor(message: string, readonly causa?: unknown) {
    super(message);
    this.name = "ErroDeProvisionamento";
  }
}

async function obterTokenDeAdmin(c: CredenciaisDeAdminDoKeycloak): Promise<string> {
  const realmAdmin = c.adminRealm ?? "master";
  const url = `${c.baseUrl.replace(/\/+$/, "")}/realms/${encodeURIComponent(realmAdmin)}/protocol/openid-connect/token`;
  const corpo = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: c.adminUser,
    password: c.adminPassword,
  });
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo,
  });
  if (!resposta.ok) {
    throw new ErroDeProvisionamento(
      `Não foi possível autenticar no Keycloak como "${c.adminUser}" (HTTP ${resposta.status}). ` +
        `Confira o endereço, o usuário e a senha do administrador do Keycloak.`
    );
  }
  const json = (await resposta.json()) as { access_token?: string };
  if (!json.access_token) throw new ErroDeProvisionamento("O Keycloak autenticou mas não devolveu access_token.");
  return json.access_token;
}

async function procurarUsuario(c: CredenciaisDeAdminDoKeycloak, token: string, email: string): Promise<string | null> {
  const url = `${c.baseUrl.replace(/\/+$/, "")}/admin/realms/${encodeURIComponent(c.realm)}/users?email=${encodeURIComponent(email)}&exact=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new ErroDeProvisionamento(`Falha ao consultar usuários do realm "${c.realm}" (HTTP ${r.status}).`);
  const lista = (await r.json()) as { id: string }[];
  return lista.length > 0 ? lista[0].id : null;
}

export interface ResultadoDoProvisionamento {
  /** `criado` quando a conta não existia; `ja_existia` quando o e-mail já estava no realm. */
  situacao: "criado" | "ja_existia";
  /**
   * Falso quando a conta já existia e o realm recusou a troca por política de histórico — o que
   * significa "a senha continua sendo a que já era", e não "ficou sem senha". Ver o comentário
   * longo em `garantirAdministradorNoKeycloak`.
   */
  senhaDefinida: boolean;
}

/**
 * Garante a conta do administrador no realm e define a senha informada.
 *
 * Idempotente de propósito: uma conta que já existe NÃO é recriada nem tem os dados sobrescritos —
 * só a senha é redefinida. Rodar o wizard duas vezes é um acidente comum, e a segunda execução não
 * pode apagar o que a primeira configurou.
 *
 * A senha é definida como PERMANENTE (`temporary: false`), sem `UPDATE_PASSWORD` armado: a decisão
 * do dono foi que o administrador entra direto, sem tela de troca no caminho.
 */
export async function garantirAdministradorNoKeycloak(
  c: CredenciaisDeAdminDoKeycloak,
  admin: { email: string; nome: string; senha: string }
): Promise<ResultadoDoProvisionamento> {
  const token = await obterTokenDeAdmin(c);
  const base = `${c.baseUrl.replace(/\/+$/, "")}/admin/realms/${encodeURIComponent(c.realm)}`;

  let id = await procurarUsuario(c, token, admin.email);
  let situacao: ResultadoDoProvisionamento["situacao"] = "ja_existia";

  if (!id) {
    const [primeiro, ...resto] = admin.nome.trim().split(/\s+/);
    const criacao = await fetch(`${base}/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: admin.email,
        email: admin.email,
        firstName: primeiro || admin.email,
        lastName: resto.join(" "),
        enabled: true,
        // `emailVerified` verdadeiro porque não há servidor de e-mail garantido numa instalação
        // nova: deixar falso trancaria o administrador para fora esperando uma mensagem que
        // ninguém enviaria.
        emailVerified: true,
      }),
    });
    if (!criacao.ok && criacao.status !== 409) {
      throw new ErroDeProvisionamento(`Falha ao criar a conta "${admin.email}" no realm (HTTP ${criacao.status}).`);
    }
    id = await procurarUsuario(c, token, admin.email);
    if (!id) throw new ErroDeProvisionamento("A conta foi criada mas não foi encontrada em seguida no realm.");
    situacao = "criado";
  }

  const senha = await fetch(`${base}/users/${id}/reset-password`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "password", value: admin.senha, temporary: false }),
  });

  if (!senha.ok) {
    /**
     * O 400 aqui quase sempre é a POLÍTICA DE HISTÓRICO do realm, não uma senha fraca. O realm
     * `cloudmountain` proíbe reusar as últimas 5 senhas, então redefinir uma conta EXISTENTE para
     * a senha que ela já tem é recusado — que é exatamente o que acontece ao rodar o wizard uma
     * segunda vez com os mesmos dados. Medido em 31/08/2026: a primeira execução passa, a segunda
     * devolve 400.
     *
     * Quando a conta já existia, isso não é falha do provisionamento: o objetivo — "existe uma
     * conta com esta senha, e o administrador entra" — já está satisfeito. Tratar como erro faria
     * o wizard gritar sobre um estado correto e mandar quem instala procurar um problema que não
     * existe. `senhaDefinida: false` diz a verdade: nada foi trocado nesta execução.
     *
     * Numa conta recém-CRIADA o mesmo 400 é falha de verdade — a conta nasceu sem senha utilizável
     * e ninguém entra. Aí a exceção continua.
     */
    const detalhe = await senha.text().catch(() => "");
    const pareceHistorico = senha.status === 400 && /password|histor|invalid/i.test(detalhe);

    if (situacao === "ja_existia" && pareceHistorico) {
      return { situacao, senhaDefinida: false };
    }

    throw new ErroDeProvisionamento(
      `A conta ${situacao === "criado" ? "foi criada" : "existe"} no realm, mas a senha não pôde ser ` +
        `definida (HTTP ${senha.status}). A política do realm exige 12 caracteres e proíbe reusar as ` +
        `últimas 5 senhas — se esta conta já usou esta senha antes, escolha outra.`
    );
  }

  return { situacao, senhaDefinida: true };
}
