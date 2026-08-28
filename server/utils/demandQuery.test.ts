import { describe, it, expect } from "vitest";
import {
  ORDENS,
  ORDEM_PADRAO,
  ORDEM_SLA,
  LIMITE_MAXIMO,
  LIMITE_PADRAO,
  filtrosDeColuna,
  lerConsultaDaFila,
  ordenarPorPrazoDoSla,
} from "./demandQuery";

// CDC 16 — Fase 9. A régua de leitura da query da fila.
//
// Cada caso aqui afirma OS DOIS LADOS da regra que testa. Um teste que só
// afirma o caminho feliz de um filtro passa igual num servidor que ignora o
// filtro por completo — foi assim que uma fase inteira desta frente quase
// fechou sem provar o que entregava.

const EU = "usr_eu";

describe("ordem", () => {
  it("aceita as colunas que existem e recusa o resto caindo no padrão", () => {
    for (const chave of Object.keys(ORDENS)) {
      expect(lerConsultaDaFila({ sort: chave }, EU).sort).toBe(chave);
    }
    // `sla_due` é ordem válida e NÃO está em ORDENS, porque não é coluna.
    expect(lerConsultaDaFila({ sort: ORDEM_SLA }, EU).sort).toBe(ORDEM_SLA);
    // O outro lado: ordem inventada não vira erro nem lista vazia.
    for (const lixo of ["preco", "", "  ", "drop table", "__proto__"]) {
      expect(lerConsultaDaFila({ sort: lixo }, EU).sort).toBe(ORDEM_PADRAO);
    }
  });

  it("ordena crescente por padrão e decrescente só quando pedido", () => {
    expect(lerConsultaDaFila({}, EU).dir).toBe("asc");
    expect(lerConsultaDaFila({ dir: "DESC" }, EU).dir).toBe("desc");
    expect(lerConsultaDaFila({ dir: "descendente" }, EU).dir).toBe("asc");
  });

  it("o padrão continua sendo o da F1: prazo do edital, depois chegada", () => {
    expect(ORDENS[ORDEM_PADRAO]("asc")).toEqual([{ deadline: "asc" }, { queuedAt: "asc" }, { id: "asc" }]);
  });

  it("TODA ordem termina em `id`, senão a paginação repete linha", () => {
    // Achado pela prova por execução real: ordenando por título numa fila com
    // títulos repetidos, a página 1 e a página 2 vieram com um id em comum —
    // duas linhas empatadas saem em ordem arbitrária a cada consulta. Só
    // aparece com paginação, e até a F8 a rota devolvia tudo de uma vez.
    for (const chave of Object.keys(ORDENS)) {
      for (const dir of ["asc", "desc"] as const) {
        expect(ORDENS[chave](dir).at(-1)).toEqual({ id: "asc" });
      }
    }
  });

  it("valor decrescente joga os nulos para o fim, e não para o topo", () => {
    // Sem isto a fila "por maior valor" abriria com as demandas sem valor.
    expect(ORDENS.value("desc")[0]).toEqual({ value: { sort: "desc", nulls: "last" } });
    expect(ORDENS.value("asc")[0]).toEqual({ value: { sort: "asc", nulls: "last" } });
  });
});

describe("paginação", () => {
  it("usa o padrão quando não pedem nada e respeita o teto quando pedem demais", () => {
    expect(lerConsultaDaFila({}, EU)).toMatchObject({ limit: LIMITE_PADRAO, offset: 0 });
    expect(lerConsultaDaFila({ limit: "5" }, EU).limit).toBe(5);
    expect(lerConsultaDaFila({ limit: "100000" }, EU).limit).toBe(LIMITE_MAXIMO);
    // Os dois lados do descarte: valor inválido e valor sem sentido caem no
    // padrão em vez de produzirem `take: NaN`, que o Prisma recusaria em runtime.
    expect(lerConsultaDaFila({ limit: "abacaxi" }, EU).limit).toBe(LIMITE_PADRAO);
    expect(lerConsultaDaFila({ limit: "0" }, EU).limit).toBe(LIMITE_PADRAO);
    expect(lerConsultaDaFila({ limit: "-3" }, EU).limit).toBe(LIMITE_PADRAO);
    expect(lerConsultaDaFila({ limit: "7.9" }, EU).limit).toBe(7);
  });

  it("o deslocamento nunca é negativo", () => {
    expect(lerConsultaDaFila({ offset: "10" }, EU).offset).toBe(10);
    expect(lerConsultaDaFila({ offset: "-10" }, EU).offset).toBe(0);
    expect(lerConsultaDaFila({ offset: "meia dúzia" }, EU).offset).toBe(0);
  });
});

describe("filtro por coluna", () => {
  it("sem parâmetro nenhum não recorta nada", () => {
    // O outro lado de todo teste de filtro: a ausência tem de produzir um
    // `where` VAZIO. Um filtro que sempre recorta esconderia a fila inteira.
    expect(filtrosDeColuna({}, EU)).toEqual({});
  });

  it("vertical aceita uma e várias, e ignora a lista vazia", () => {
    expect(filtrosDeColuna({ vertical: "Saúde" }, EU)).toEqual({ vertical: { in: ["Saúde"] } });
    expect(filtrosDeColuna({ vertical: "Saúde, Educação" }, EU)).toEqual({
      vertical: { in: ["Saúde", "Educação"] },
    });
    expect(filtrosDeColuna({ vertical: " , , " }, EU)).toEqual({});
  });

  it("valor mínimo e máximo funcionam sozinhos e juntos", () => {
    expect(filtrosDeColuna({ min_value: "1000" }, EU)).toEqual({ value: { gte: 1000 } });
    expect(filtrosDeColuna({ max_value: "5000" }, EU)).toEqual({ value: { lte: 5000 } });
    expect(filtrosDeColuna({ min_value: "1000", max_value: "5000" }, EU)).toEqual({
      value: { gte: 1000, lte: 5000 },
    });
    // Texto onde se espera número não vira `gte: NaN`, que recortaria tudo.
    expect(filtrosDeColuna({ min_value: "caro" }, EU)).toEqual({});
  });

  it("a busca livre cobre título, oportunidade e a referência da demanda", () => {
    const w = filtrosDeColuna({ q: "hospital" }, EU);
    expect(w.OR).toHaveLength(3);
    for (const clausula of w.OR) {
      expect(Object.values(clausula)[0]).toMatchObject({ contains: "hospital", mode: "insensitive" });
    }
  });

  it("`me` vira o id de quem chamou, `none` vira a fila sem dono, e um id passa direto", () => {
    expect(filtrosDeColuna({ assigned_user_id: "me" }, EU)).toEqual({ assignedUserId: EU });
    expect(filtrosDeColuna({ assigned_user_id: "none" }, EU)).toEqual({ assignedUserId: null });
    expect(filtrosDeColuna({ assigned_user_id: "usr_outra" }, EU)).toEqual({ assignedUserId: "usr_outra" });
  });

  it("recortes diferentes se somam em vez de se substituírem", () => {
    const w = filtrosDeColuna({ vertical: "Saúde", min_value: "10", assigned_user_id: "me" }, EU);
    expect(w).toEqual({ vertical: { in: ["Saúde"] }, value: { gte: 10 }, assignedUserId: EU });
  });
});

describe("ordem por prazo do SLA", () => {
  const SLA = { enabled: true, assumeHours: 8, analysisHours: 24, proposalHours: 120, assignmentPolicy: "auto_servico" };
  const base = new Date("2026-08-28T12:00:00.000Z").getTime();
  const naFila = (id: string, minutosAtras: number, deadline: string) => ({
    id,
    status: "queued",
    queuedAt: new Date(base - minutosAtras * 60_000),
    assignedAt: null,
    analysisStartedAt: null,
    deadline: new Date(deadline),
  });

  it("crescente põe o prazo mais próximo primeiro, e decrescente inverte", () => {
    // Na etapa "assume" o prazo é queuedAt + 8h: quem entrou há mais tempo
    // vence antes.
    const linhas = [naFila("b", 60, "2026-12-01"), naFila("a", 300, "2026-12-01"), naFila("c", 5, "2026-12-01")];
    expect(ordenarPorPrazoDoSla(linhas as any, SLA as any, "asc")).toEqual(["a", "b", "c"]);
    expect(ordenarPorPrazoDoSla(linhas as any, SLA as any, "desc")).toEqual(["c", "b", "a"]);
  });

  it("sem prazo do SLA a linha vai para o FIM nas duas direções", () => {
    // O caso real: demanda em estado terminal não deve etapa nenhuma. Jogá-la
    // ao topo em `desc` faria a ordenação parecer quebrada.
    const terminal = {
      id: "z",
      status: "completed",
      queuedAt: new Date(base - 600_000),
      assignedAt: null,
      analysisStartedAt: null,
      deadline: new Date("2026-12-01"),
    };
    const linhas = [terminal, naFila("a", 300, "2026-12-01"), naFila("c", 5, "2026-12-01")];
    expect(ordenarPorPrazoDoSla(linhas as any, SLA as any, "asc").at(-1)).toBe("z");
    expect(ordenarPorPrazoDoSla(linhas as any, SLA as any, "desc").at(-1)).toBe("z");
  });

  it("empate no prazo do SLA desempata por id, nas duas direções", () => {
    // Mesmo defeito da ordenação de banco, no ramo que não passa pelo banco.
    const iguais = ["c", "a", "b"].map((id) => ({
      id,
      status: "queued",
      queuedAt: new Date(base - 60_000),
      assignedAt: null,
      analysisStartedAt: null,
      deadline: new Date("2026-12-01"),
    }));
    expect(ordenarPorPrazoDoSla(iguais as any, SLA as any, "asc")).toEqual(["a", "b", "c"]);
    expect(ordenarPorPrazoDoSla(iguais as any, SLA as any, "desc")).toEqual(["a", "b", "c"]);
  });

  it("instalação SEM SLA cai no prazo do edital em vez de sair embaralhada", () => {
    // `due_at` é nulo em todas as linhas; o desempate é o `deadline`, e é o que
    // impede a página de mudar de conteúdo a cada recarga.
    const linhas = [
      naFila("tarde", 10, "2026-12-01"),
      naFila("cedo", 10, "2026-09-01"),
      naFila("meio", 10, "2026-10-01"),
    ];
    expect(ordenarPorPrazoDoSla(linhas as any, null, "asc")).toEqual(["cedo", "meio", "tarde"]);
    expect(ordenarPorPrazoDoSla(linhas as any, null, "desc")).toEqual(["cedo", "meio", "tarde"]);
  });
});
