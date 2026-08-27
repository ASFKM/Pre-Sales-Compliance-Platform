import "dotenv/config";
import { prisma } from "../src/prisma";
import { hashPassword } from "../server/utils/security";
import { randomId } from "../src/idGenerator";
import { drenarFila } from "../server/utils/crmOutbox";

// CDC 16 — Fase 5. O que as duas metades da ETAPA 2 compartilham.
//
// Arquivo próprio, e não um `import` de um script para o outro: importar um
// script que tem `main()` no topo faria a segunda metade RODAR a primeira ao
// carregá-la — e a primeira apaga a configuração para conferir o estado inicial.

const TENANT = process.env.PROVA_TENANT || "tenant_default";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";

export interface Sessao {
  nome: string;
  userId: string;
  headers: Record<string, string>;
}

export async function papelDaProva(nome: string, permissoes: string[]) {
  const existente = await prisma.role.findFirst({ where: { name: nome } });
  if (existente) {
    return prisma.role.update({ where: { id: existente.id }, data: { permissions: permissoes } });
  }
  return prisma.role.create({
    data: {
      id: randomId("role"),
      tenantId: TENANT,
      name: nome,
      description: "Papel da prova CDC16 F5",
      permissions: permissoes,
    },
  });
}

/**
 * Usuário DEDICADO com e-mail em `.invalid`, e login REAL pela rota.
 *
 * O domínio nunca resolve de propósito: `returned` é marco forte e marco forte manda e-mail, e a
 * F3 já entregou e-mail de teste na caixa de uma pessoa de verdade uma vez.
 */
export async function entrarComo(
  nome: string,
  email: string,
  roleId: string,
  senha: string,
  registrar: (rotulo: string, ok: boolean, detalhe: string) => void,
): Promise<Sessao | null> {
  const existente = await prisma.user.findFirst({ where: { email } });
  const usuario =
    existente ??
    (await prisma.user.create({
      data: {
        id: randomId("usr"),
        tenantId: TENANT,
        name: nome,
        email,
        passwordHash: hashPassword(senha),
        roleId,
        status: "ACTIVE",
      },
    }));
  await prisma.user.update({
    where: { id: usuario.id },
    data: { passwordHash: hashPassword(senha), roleId, status: "ACTIVE", mustChangePassword: false, name: nome },
  });

  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  const corpo: any = await r.json().catch(() => ({}));
  const token = corpo?.token || corpo?.session_token || corpo?.data?.token;
  registrar(`login real de ${nome}`, r.status === 200 && !!token, `status=${r.status}`);
  if (!token) return null;
  return {
    nome,
    userId: usuario.id,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
}

export async function chamarRota(sessao: Sessao, metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: sessao.headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: r.status, corpo: json };
}

export async function esperarSaidaDe(demandId: string, event: string, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    const linha = await prisma.demandOutboundEvent.findFirst({
      where: { demandId, event },
      orderBy: { createdAt: "desc" },
    });
    if (linha && linha.status !== "pendente") return linha;
    if (i % 4 === 3) await drenarFila(TENANT).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
  }
  return prisma.demandOutboundEvent.findFirst({ where: { demandId, event }, orderBy: { createdAt: "desc" } });
}

export const PAPEIS_DA_PROVA = {
  // O administrador da prova NÃO tem `demand:assume`, e é de propósito: é ele
  // que serve de destinatário INELEGÍVEL na conferência de direcionamento. Com
  // a permissão, aquele caminho de erro nunca seria exercitado — e foi assim
  // que ele passou despercebido na primeira execução.
  admin: ["admin:settings", "demand:read", "project:read", "project:read_all"],
  equipe: ["demand:read", "demand:assume", "project:create", "project:read", "project:update"],
  gerente: ["demand:read", "demand:assume", "demand:manage", "project:read", "project:read_all"],
};

