// F1 (31/08/2026) — devolve uma senha utilizável ao administrador master.
//
// A migration destrutiva `20260830051000_f13_credencial_vai_para_o_keycloak` fez DROP COLUMN em
// `password_hash`, `mfa_enabled`, `mfa_totp_secret` e `must_change_password`. Os dados foram
// destruídos e não há cópia: nenhum dos 28 usuários tem senha depois que
// `20260831200000_f1_credencial_volta_para_o_presales` recria as colunas vazias.
//
// A decisão do dono é recriar SÓ o administrador master agora; os outros 27 ficam para depois.
// Por isso este script não varre a tabela: ele recebe um e-mail (o master, por padrão) e age
// sobre essa conta e só sobre ela.
//
// Uso:
//   npx tsx scripts/f1-restaurar-administrador-master.ts                  (gera e imprime a senha)
//   npx tsx scripts/f1-restaurar-administrador-master.ts --senha "..."    (usa a informada)
//   npx tsx scripts/f1-restaurar-administrador-master.ts --email outro@x  (outra conta)
//
// A senha é impressa uma vez, na saída padrão. Ela não fica em log nem no repositório: uma senha
// fixa em código seria a mesma em toda instalação e seria barrada pelo gitleaks do CI.
import "dotenv/config";
import crypto from "crypto";
import { prisma } from "../src/prisma";
import { runWithTenant } from "../src/tenantContext";
import { hashPassword } from "../server/utils/security";
import { PoliticaDeSenha, violacoesDaPolitica, mensagemDeViolacao } from "../server/utils/politicaDeSenha";
import { lerPolitica, registrarSenhaNoHistorico } from "../server/utils/politicaDeSenhaRepo";

const EMAIL_PADRAO = "alvaro.sakae@gmail.com";

/**
 * F3 (01/09/2026) — a senha sorteada tem de CABER NA POLÍTICA DO TENANT, e não apenas ser longa.
 *
 * O sorteio anterior tirava 20 caracteres de um alfabeto misto: longo, mas sem garantir um único
 * dígito ou símbolo. Num tenant que exige número, a senha entregue ao master podia ser uma senha
 * que a própria rota de troca recusaria — a conta entraria e travaria na primeira troca.
 *
 * Aqui a senha é montada POR CLASSE (uma de cada, o resto do alfabeto inteiro) e embaralhada com
 * `randomInt` — não `Math.random`, não `sort` com comparador aleatório, que enviesa a permutação.
 * Continua sem os caracteres que se confundem lidos na tela (O/0, I/l/1), porque ela é digitada à
 * mão pelo menos uma vez. No fim ainda passa por `violacoesDaPolitica`: construir certo e
 * conferir depois custa nada e fecha a porta para um erro de alfabeto passar despercebido.
 */
const MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const MINUSCULAS = "abcdefghijkmnopqrstuvwxyz";
const NUMEROS = "23456789";
const ESPECIAIS = "!@#$%";

function sortearDe(alfabeto: string): string {
  return alfabeto[crypto.randomInt(alfabeto.length)];
}

function gerarSenhaForte(politica: PoliticaDeSenha): string {
  const comprimento = Math.max(20, politica.comprimento_minimo);
  const caracteres = [sortearDe(MAIUSCULAS), sortearDe(MINUSCULAS), sortearDe(NUMEROS), sortearDe(ESPECIAIS)];
  const alfabeto = MAIUSCULAS + MINUSCULAS + NUMEROS + ESPECIAIS;
  while (caracteres.length < comprimento) caracteres.push(sortearDe(alfabeto));

  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }

  const senha = caracteres.join("");
  const violacoes = violacoesDaPolitica(senha, politica);
  if (violacoes.length > 0) {
    throw new Error(`A senha sorteada não cumpriu a política vigente. ${mensagemDeViolacao(violacoes)}`);
  }
  return senha;
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = (argumento("email") ?? EMAIL_PADRAO).toLowerCase().trim();
  const informada = argumento("senha");

  // Busca SEM recorte de tenant, do mesmo jeito que a rota de login faz: `users.email` é único no
  // banco inteiro, e o tenant só é conhecido depois de encontrar a pessoa.
  //
  // F3: a busca subiu para ANTES do sorteio da senha, porque a política é por tenant — não dá
  // para sortear uma senha que caiba na política sem antes saber de que instalação é a conta.
  const usuario = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tenantId: true, name: true, roleId: true },
  });

  if (!usuario) {
    console.error(`Nenhum usuário com o e-mail ${email}. Nada foi alterado.`);
    process.exit(1);
  }

  const politica = await lerPolitica(usuario.tenantId);

  if (informada) {
    const violacoes = violacoesDaPolitica(informada, politica);
    if (violacoes.length > 0) {
      console.error(mensagemDeViolacao(violacoes));
      process.exit(1);
    }
  }

  const senha = informada ?? gerarSenhaForte(politica);

  const papel = await prisma.role.findUnique({
    where: { id: usuario.roleId },
    select: { name: true },
  });

  const novoHash = hashPassword(senha);

  // O UPDATE precisa acontecer DENTRO do contexto de tenant: a RLS deste banco é forçada, e um
  // update sem o tenant definido afeta zero linhas e devolve sucesso — falha silenciosa.
  await runWithTenant({ tenantId: usuario.tenantId }, async () => {
    await prisma.user.update({
      where: { id: usuario.id },
      data: {
        passwordHash: novoHash,
        // F3 — zera o relógio da validade. Sem isto, num tenant com validade configurada a senha
        // recém-entregue já chegaria vencida (`password_changed_at` nulo conta como vencida).
        passwordChangedAt: new Date(),
        // O segredo TOTP foi destruído junto com o hash. Religar o segundo fator sem o segredo
        // trancaria a conta para fora: a tela pediria um código que ninguém consegue gerar.
        mfaEnabled: false,
        mfaTotpSecret: null,
        // Quem digitou a própria senha não precisa trocá-la na cara da entrada. Passe
        // `--forcar-troca` para exercitar a tela de troca obrigatória.
        mustChangePassword: process.argv.includes("--forcar-troca"),
        status: "ACTIVE",
      },
    });
  });

  await registrarSenhaNoHistorico(usuario.tenantId, usuario.id, novoHash);

  console.log("");
  console.log("Administrador master restaurado.");
  console.log(`  E-mail: ${email}`);
  console.log(`  Nome:   ${usuario.name}`);
  console.log(`  Papel:  ${papel?.name ?? usuario.roleId}`);
  console.log(`  Senha:  ${senha}`);
  console.log("");
  console.log("Segundo fator desligado (o segredo TOTP foi destruído em 30/08 e não volta).");
  console.log("Os outros 27 usuários continuam sem senha e não conseguem entrar — por decisão do dono.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
