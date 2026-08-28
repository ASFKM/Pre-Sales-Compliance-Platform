import { calcularDueAt, type ConfiguracaoDeSla } from "./demandSla";

// ─── F9: ordenação parametrizada, filtro por coluna e paginação ─────────────
//
// A ordem da fila deixou de ser fixa. É a resposta D do dono na F8 — "as duas
// coisas", ordenar E filtrar pelo título da coluna —, e a API vem antes da tela
// porque é a Início da F10 que vai consumi-la.
//
// Duas coisas ficam DITAS aqui para que ninguém as leia como revogação de
// decisão:
//
//  - o PADRÃO continua sendo prazo do edital, depois chegada. Quem não escolhe
//    ordem nenhuma recebe exatamente a fila que a F1 entregou, e o comentário
//    que explicava aquela escolha continua ali embaixo, no `ORDENS.deadline`;
//  - ordenar por VALOR é decisão consciente do dono, registrada no §8 item 33
//    do plano. A D40 recusou o valor como medida de CARGA e continua valendo
//    palavra por palavra: ela governa quem o PRODUTO escolhe na distribuição
//    automática, não o que a PESSOA olha quando trabalha a fila.
// TODA ordem termina em `id`, e isso não é enfeite: sem um desempate ÚNICO o
// Postgres pode devolver duas linhas empatadas em ordem diferente a cada
// consulta, e duas páginas seguidas passam a repetir uma linha e a pular outra.
// Encontrado pela prova desta fase — a página 1 e a página 2 vieram com um id em
// comum, ordenando por título numa fila com títulos repetidos. Só aparece com
// paginação; até a F8 a rota devolvia tudo de uma vez e o empate era invisível.
const COM_DESEMPATE = (ordens: any[]) => [...ordens, { id: "asc" }];

export const ORDENS: Record<string, (dir: "asc" | "desc") => any[]> = {
  // Prazo primeiro: numa fila de auto-serviço, a ordem em que as coisas
  // aparecem é a política de atribuição de fato. É o padrão, e é por isso.
  deadline: (dir) => COM_DESEMPATE([{ deadline: dir }, { queuedAt: "asc" }]),
  // `value` é anulável e o desempate importa: sem `nulls: "last"` o Postgres
  // joga os nulos para o topo em ordem decrescente, e a fila ordenada "por
  // maior valor" abriria com as demandas que não têm valor nenhum.
  value: (dir) => COM_DESEMPATE([{ value: { sort: dir, nulls: "last" } }, { deadline: "asc" }]),
  vertical: (dir) => COM_DESEMPATE([{ vertical: dir }, { deadline: "asc" }]),
  title: (dir) => COM_DESEMPATE([{ title: dir }]),
  company: (dir) => COM_DESEMPATE([{ companyName: dir }, { deadline: "asc" }]),
  queued_at: (dir) => COM_DESEMPATE([{ queuedAt: dir }]),
  status: (dir) => COM_DESEMPATE([{ status: dir }, { deadline: "asc" }]),
};

// `sla_due` NÃO está no mapa acima, e a ausência é a explicação: o prazo do SLA
// não é coluna. Ele é calculado (`calcularDueAt`) sobre uma base que muda com a
// etapa devida — `queued_at` mais as horas para assumir, `assigned_at` mais as
// horas para analisar —, então não existe `orderBy` de banco que o produza.
// Ordenar por ele é feito em duas passadas, e a primeira delas carrega só as
// colunas do cálculo: o `include` pesado (documentos, pessoas, atualizações
// pendentes) fica para a PÁGINA, não para a fila inteira.
export const ORDEM_SLA = "sla_due";
export const ORDEM_PADRAO = "deadline";
export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;

export function textoDaQuery(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export function listaDaQuery(valor: unknown): string[] {
  return textoDaQuery(valor)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function numeroDaQuery(valor: unknown): number | null {
  const bruto = textoDaQuery(valor);
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O recorte por COLUNA (resposta D). Convive com o filtro por estado, que já
 * existia — e não o substitui: são perguntas diferentes ("o que está na fila" e
 * "o que é da vertical X").
 *
 * Nada aqui alarga o que a fila mostra: a D15 continua valendo, a fila é única
 * e visível para toda a equipe, e `assigned_user_id` é um RECORTE que quem
 * chama pede, não uma regra de visibilidade que o servidor impõe.
 */
export function filtrosDeColuna(query: any, usuarioAtual: string): any {
  const where: any = {};

  const verticais = listaDaQuery(query.vertical);
  if (verticais.length > 0) where.vertical = { in: verticais };

  const empresa = textoDaQuery(query.company);
  if (empresa) where.companyName = { contains: empresa, mode: "insensitive" };

  const busca = textoDaQuery(query.q);
  if (busca) {
    where.OR = [
      { title: { contains: busca, mode: "insensitive" } },
      { opportunityName: { contains: busca, mode: "insensitive" } },
      { demandRef: { contains: busca, mode: "insensitive" } },
    ];
  }

  const minimo = numeroDaQuery(query.min_value);
  const maximo = numeroDaQuery(query.max_value);
  if (minimo !== null || maximo !== null) {
    where.value = {};
    if (minimo !== null) where.value.gte = minimo;
    if (maximo !== null) where.value.lte = maximo;
  }

  // `me` existe para a F10: o card "Minhas demandas" é o mesmo endpoint com um
  // recorte a mais, e resolver o apelido aqui evita que a tela precise carregar
  // o próprio id para montar uma query.
  const dono = textoDaQuery(query.assigned_user_id);
  if (dono === "me") where.assignedUserId = usuarioAtual;
  else if (dono === "none") where.assignedUserId = null;
  else if (dono) where.assignedUserId = dono;

  return where;
}



/**
 * A leitura completa da query, num lugar só. Existe separada da rota para poder
 * ser exercitada sem banco: é AQUI que mora a régua de "entrada inválida cai no
 * padrão em vez de virar erro", e essa régua não se prova pelo caminho feliz.
 */
export function lerConsultaDaFila(query: any, usuarioAtual: string) {
  const ordemPedida = textoDaQuery(query.sort);
  // `hasOwnProperty`, e não `in`: `in` caminha a cadeia de protótipos, então
  // `?sort=__proto__` passaria pela peneira e a rota chamaria
  // `ORDENS["__proto__"](dir)` — que é `Object.prototype`, não uma função. Sai
  // 500 a partir de texto que qualquer um pode digitar na barra de endereços.
  // Achado por um teste que afirmava o lado do RECUSAR, não o do aceitar.
  const sort =
    ordemPedida === ORDEM_SLA || Object.prototype.hasOwnProperty.call(ORDENS, ordemPedida) ? ordemPedida : ORDEM_PADRAO;
  const dir: "asc" | "desc" = textoDaQuery(query.dir).toLowerCase() === "desc" ? "desc" : "asc";

  const limitePedido = numeroDaQuery(query.limit);
  const limit =
    limitePedido !== null && limitePedido > 0 ? Math.min(Math.floor(limitePedido), LIMITE_MAXIMO) : LIMITE_PADRAO;
  const deslocamentoPedido = numeroDaQuery(query.offset);
  const offset = deslocamentoPedido !== null && deslocamentoPedido > 0 ? Math.floor(deslocamentoPedido) : 0;

  return { sort, dir, limit, offset, filtros: filtrosDeColuna(query, usuarioAtual) };
}

/**
 * A ordenação por prazo do SLA, feita fora do banco pelo motivo comentado em
 * `ORDEM_SLA`. Recebe só o que `calcularDueAt` lê, devolve os ids na ordem.
 */
export function ordenarPorPrazoDoSla(
  linhas: Array<{ id: string; deadline: Date }>,
  sla: (ConfiguracaoDeSla & { assignmentPolicy: string }) | null,
  dir: "asc" | "desc",
): string[] {
  const comPrazo = linhas.map((d) => {
    const due = sla ? calcularDueAt(d as any, sla) : null;
    return { id: d.id, quando: due ? due.getTime() : null, deadline: d.deadline.getTime() };
  });
  comPrazo.sort((a, b) => {
    // Sem prazo do SLA vai para o FIM nas duas direções, e não é detalhe:
    // instalação sem SLA configurado tem `due_at` nulo em todas as linhas, e
    // jogá-las para o topo em `desc` faria a ordenação parecer quebrada.
    if (a.quando === null && b.quando === null) return a.deadline - b.deadline || a.id.localeCompare(b.id);
    if (a.quando === null) return 1;
    if (b.quando === null) return -1;
    // Mesmo desempate por `id` da ordenação de banco, e pelo mesmo motivo: duas
    // demandas com o mesmo prazo do SLA precisam sair sempre na mesma ordem,
    // senão a página 2 repete o que a página 1 já mostrou.
    const porPrazo = dir === "asc" ? a.quando - b.quando : b.quando - a.quando;
    return porPrazo || a.id.localeCompare(b.id);
  });
  return comPrazo.map((d) => d.id);
}
