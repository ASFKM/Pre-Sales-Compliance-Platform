import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * F6 (01/09/2026) — `GET /api/auth/brand`, a rota que a tela de entrada consulta para escrever
 * "Licensed to <cliente>".
 *
 * Estes casos exercitam a ROTA REAL registrada em `server/routes/auth.ts` — o handler é retirado
 * da pilha do próprio router, e não reescrito aqui —, com a resolução da marca substituída. A
 * regra de resolução em si (qual tenant, e quando não responder nada) tem os próprios casos em
 * `server/utils/marcaDaInstalacao.test.ts`.
 *
 * O que precisa estar provado aqui, e é o requisito mais duro da fase: a rota é PÚBLICA (nenhum
 * middleware antes do handler), não vaza nada além de nome e logo, e responde 200 com marca
 * ausente em vez de erro quando não há o que mostrar — inclusive se a resolução explodir.
 */

const estado = vi.hoisted(() => ({
  resposta: { licenciado_para: null as string | null, logo_base64: null as string | null },
  explodir: false,
}));

vi.mock("../utils/marcaDaInstalacao", () => ({
  MARCA_AUSENTE: { licenciado_para: null, logo_base64: null },
  resolverMarcaDaInstalacao: async () => {
    if (estado.explodir) throw new Error("falha inesperada na resolução da marca");
    return estado.resposta;
  },
}));

import authRouter from "./auth";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

function camadaDaRota() {
  const camada = (authRouter as any).stack.find(
    (c: any) => c.route?.path === "/brand" && c.route?.methods?.get
  );
  if (!camada) throw new Error("GET /brand não está registrado no router de auth");
  return camada;
}

async function chamarRota(): Promise<{ status: number; corpo: any; cabecalhos: Record<string, string>; next: any[] }> {
  const camada = camadaDaRota();
  const manipuladores: any[] = camada.route.stack.map((l: any) => l.handle);
  const cabecalhos: Record<string, string> = {};
  const chamadasDoNext: any[] = [];
  let status = 200;
  let corpo: any = undefined;
  const res: any = {
    status(c: number) {
      status = c;
      return res;
    },
    set(chave: string, valor: string) {
      cabecalhos[chave] = valor;
      return res;
    },
    json(payload: any) {
      corpo = payload;
      return res;
    },
  };
  await manipuladores[0]({ query: {}, headers: {} } as any, res, (e: any) => chamadasDoNext.push(e));
  return { status, corpo, cabecalhos, next: chamadasDoNext };
}

beforeEach(() => {
  estado.resposta = { licenciado_para: null, logo_base64: null };
  estado.explodir = false;
});

describe("GET /api/auth/brand — desenho da rota", () => {
  it("está registrada e é PÚBLICA: um único handler, nenhum requireAuth antes dele", () => {
    expect(camadaDaRota().route.stack.length).toBe(1);
  });
});

describe("GET /api/auth/brand — COM marca", () => {
  it("devolve nome e logo, e nada além disso", async () => {
    estado.resposta = { licenciado_para: "Cliente Alfa Ltda", logo_base64: LOGO };
    const { status, corpo, next } = await chamarRota();

    expect(status).toBe(200);
    expect(corpo).toEqual({ success: true, licenciado_para: "Cliente Alfa Ltda", logo_base64: LOGO });
    expect(next).toEqual([]);
  });

  it("não vaza campo algum da licença além de nome e logo (rota sem sessão)", async () => {
    estado.resposta = { licenciado_para: "Cliente Alfa Ltda", logo_base64: LOGO };
    const { corpo } = await chamarRota();
    expect(Object.keys(corpo).sort()).toEqual(["licenciado_para", "logo_base64", "success"]);
    const serializado = JSON.stringify(corpo);
    for (const proibido of [
      "installation_id",
      "modules",
      "plan_name",
      "contract_start_date",
      "contract_end_date",
      "block_mode",
      "last_verified_at",
      "connected",
    ]) {
      expect(serializado).not.toContain(proibido);
    }
  });
});

describe("GET /api/auth/brand — SEM marca (a tela monta igual)", () => {
  it("responde 200 com o shape explícito de ausência, não 404 nem erro", async () => {
    const { status, corpo, next } = await chamarRota();
    expect(status).toBe(200);
    expect(corpo).toEqual({ success: true, licenciado_para: null, logo_base64: null });
    expect(next).toEqual([]);
  });

  it("resolução que lança vira marca ausente, e NUNCA next(err) — um 500 aqui pintaria erro na tela de login", async () => {
    estado.explodir = true;
    const { status, corpo, next } = await chamarRota();
    expect(status).toBe(200);
    expect(corpo).toEqual({ success: true, licenciado_para: null, logo_base64: null });
    expect(next).toEqual([]);
  });
});
