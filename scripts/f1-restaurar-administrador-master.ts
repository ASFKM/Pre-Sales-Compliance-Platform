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
import { hashPassword, TAMANHO_MINIMO_DE_SENHA } from "../server/utils/security";

const EMAIL_PADRAO = "alvaro.sakae@gmail.com";

function gerarSenhaForte(): string {
  // 20 caracteres, sem os que se confundem entre si (O/0, I/l/1) — a senha é lida da tela e
  // digitada à mão pelo menos uma vez.
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return Array.from(crypto.randomBytes(20))
    .map((b) => alfabeto[b % alfabeto.length])
    .join("");
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = (argumento("email") ?? EMAIL_PADRAO).toLowerCase().trim();
  const informada = argumento("senha");

  if (informada && informada.length < TAMANHO_MINIMO_DE_SENHA) {
    console.error(`A senha precisa ter pelo menos ${TAMANHO_MINIMO_DE_SENHA} caracteres.`);
    process.exit(1);
  }

  const senha = informada ?? gerarSenhaForte();

  // Busca SEM recorte de tenant, do mesmo jeito que a rota de login faz: `users.email` é único no
  // banco inteiro, e o tenant só é conhecido depois de encontrar a pessoa.
  const usuario = await prisma.user.findUnique({
    where: { email },
    select: { id: true, tenantId: true, name: true, roleId: true },
  });

  if (!usuario) {
    console.error(`Nenhum usuário com o e-mail ${email}. Nada foi alterado.`);
    process.exit(1);
  }

  const papel = await prisma.role.findUnique({
    where: { id: usuario.roleId },
    select: { name: true },
  });

  // O UPDATE precisa acontecer DENTRO do contexto de tenant: a RLS deste banco é forçada, e um
  // update sem o tenant definido afeta zero linhas e devolve sucesso — falha silenciosa.
  await runWithTenant({ tenantId: usuario.tenantId }, async () => {
    await prisma.user.update({
      where: { id: usuario.id },
      data: {
        passwordHash: hashPassword(senha),
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
