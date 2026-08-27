// CDC 16 — Fase 5. A REGRA de prazo e de carga, separada do banco de propósito.
//
// Tudo neste arquivo é função PURA: entra estado, sai decisão. Não há Prisma
// aqui, e não pode haver. A razão é a mesma que levou a F4 a separar o
// emparelhamento do KPI: estas funções decidem QUEM TRABALHA e QUANDO ALGUÉM É
// COBRADO, e uma regra dessas escondida dentro de uma consulta SQL não é
// revisável nem por quem a escreveu um mês depois. Aqui ela é lida como texto e
// provada caso a caso, sem subir banco nenhum.
//
// Decisões: D19 (SLA por etapa, do administrador da instalação), D20 (medição
// de tempo de resposta) e D40 (carga é demanda aberta ponderada pelo prazo).

/** A configuração da instalação, reduzida ao que a regra precisa. */
export interface ConfiguracaoDeSla {
  enabled: boolean;
  assumeHours: number;
  analysisHours: number;
  proposalHours: number;
}

export type EtapaDeSla = "assume" | "analysis" | "proposal";

/** A demanda, reduzida ao que a regra precisa. Os seis carimbos são da F1. */
export interface DemandaParaSla {
  id: string;
  status: string;
  /** O prazo do EDITAL, e é uma DATA CIVIL. Ver `fimDoDiaCivil` logo abaixo. */
  deadline: Date;
  queuedAt: Date;
  assignedAt: Date | null;
  analysisStartedAt: Date | null;
}

export const ESTADOS_ABERTOS: ReadonlySet<string> = new Set(["queued", "assigned", "in_analysis"]);

/**
 * A ETAPA que ainda é devida.
 *
 * Três etapas (D19), e cada uma abre quando a anterior fecha: a fila abre
 * `assume`, assumir abre `analysis`, começar a análise abre `proposal`. Estado
 * terminal não deve nada — devolvida, cancelada e concluída não têm prazo, e
 * inventar um faria a fila cobrar quem já entregou.
 */
export function etapaPendente(d: Pick<DemandaParaSla, "status">): EtapaDeSla | null {
  if (d.status === "queued") return "assume";
  if (d.status === "assigned") return "analysis";
  if (d.status === "in_analysis") return "proposal";
  return null;
}

/**
 * O fim do dia civil de uma data civil, em UTC.
 *
 * `deadline` é o prazo do edital, e é uma DATA CIVIL — o dia em que a licitação
 * fecha, não um instante. O produto inteiro já a lê assim, em UTC:
 * `src/dbStore.ts` a serializa com `toISOString().substring(0, 10)`, e é esse o
 * texto que aparece na tela e no DOCX. Ler a mesma coluna num outro fuso aqui
 * faria o prazo COBRADO diferir do prazo EXIBIDO em até um dia — e é exatamente
 * esse o defeito que já custou um dia de vigência de contrato neste código.
 *
 * Então a regra é uma só, dita em voz alta: a data civil é lida em UTC, e o
 * instante que a representa é o último milissegundo daquele dia em UTC.
 */
export function fimDoDiaCivil(deadline: Date): Date {
  return new Date(
    Date.UTC(
      deadline.getUTCFullYear(),
      deadline.getUTCMonth(),
      deadline.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
}

function horas(n: number): number {
  return n * 60 * 60 * 1000;
}

/**
 * O prazo da etapa pendente, como INSTANTE — e é isso que viaja como `due_at`.
 *
 * A conta é o instante que abriu a etapa mais as horas configuradas. A exceção
 * é a proposta: ela nunca pode ser prometida DEPOIS do fechamento do edital,
 * porque uma proposta entregue depois disso não é uma proposta atrasada, é uma
 * proposta inútil. Então o prazo da proposta é o MENOR entre a conta do SLA e o
 * fim do dia civil do edital.
 *
 * As duas primeiras etapas não recebem esse teto. Um edital que fecha amanhã
 * não torna "assumir" devido para ontem; o que ele torna é a demanda urgente, e
 * a urgência já é o peso da D40 na distribuição.
 */
export function calcularDueAt(d: DemandaParaSla, sla: ConfiguracaoDeSla | null): Date | null {
  if (!sla || !sla.enabled) return null;
  const etapa = etapaPendente(d);
  if (!etapa) return null;

  if (etapa === "assume") {
    return new Date(d.queuedAt.getTime() + horas(sla.assumeHours));
  }
  if (etapa === "analysis") {
    // Sem `assignedAt` a demanda não estaria em `assigned`; a guarda existe
    // porque um banco pode sempre estar num estado que o código não previu, e
    // um `Invalid Date` viajando como `due_at` seria pior do que nenhum prazo.
    if (!d.assignedAt) return null;
    return new Date(d.assignedAt.getTime() + horas(sla.analysisHours));
  }
  if (!d.analysisStartedAt) return null;
  const porSla = new Date(d.analysisStartedAt.getTime() + horas(sla.proposalHours));
  const porEdital = fimDoDiaCivil(d.deadline);
  return porSla.getTime() <= porEdital.getTime() ? porSla : porEdital;
}

export interface Violacao {
  demandId: string;
  stage: EtapaDeSla;
  dueAt: Date;
}

/**
 * Quais prazos venceram até `agora`.
 *
 * Devolve o VENCIMENTO, e não o instante em que se percebeu: um serviço parado
 * por duas horas não pode fazer o atraso parecer duas horas menor do que foi.
 */
export function avaliarViolacoes(
  demandas: readonly DemandaParaSla[],
  sla: ConfiguracaoDeSla | null,
  agora: Date
): Violacao[] {
  if (!sla || !sla.enabled) return [];
  const fora: Violacao[] = [];
  for (const d of demandas) {
    const etapa = etapaPendente(d);
    if (!etapa) continue;
    const due = calcularDueAt(d, sla);
    if (!due) continue;
    if (due.getTime() <= agora.getTime()) fora.push({ demandId: d.id, stage: etapa, dueAt: due });
  }
  return fora;
}

// ─── D40: a carga, e quem recebe a próxima ──────────────────────────────────

/**
 * O peso de UMA demanda aberta na carga de quem a segura (D40).
 *
 * 3 quando o prazo vence em até 3 dias, 2 em até 7, 1 no resto. O prazo aqui é
 * o do EDITAL, e não o `due_at` do SLA: a régua da D40 é medida em DIAS (3 e 7),
 * e o SLA de assumir é medido em horas — aplicar a régua ao prazo do SLA daria
 * peso 3 a absolutamente tudo, e a ponderação deixaria de ponderar. O que a
 * decisão quer dizer com "proximidade do prazo" é a pressão real do trabalho:
 * uma licitação que fecha na sexta ocupa mais a pessoa do que uma que fecha em
 * um mês.
 *
 * Vencido conta como o peso máximo. Uma demanda com prazo estourado não deixou
 * de ocupar a pessoa — ocupa mais.
 */
export function pesoDoPrazo(deadline: Date, agora: Date): number {
  const dias = diasCivisAte(deadline, agora);
  if (dias <= 3) return 3;
  if (dias <= 7) return 2;
  return 1;
}

/**
 * Quantos DIAS CIVIS faltam para o prazo do edital.
 *
 * Diferença entre datas civis, e não entre instantes, e a razão é que o número
 * precisa ser o MESMO que a fila mostra. `DemandQueue.tsx` escreve "faltam 3d"
 * comparando a data do edital com agora; se a régua da carga medisse até o FIM
 * daquele dia, um edital a "3 dias" na tela valeria 3,5 na conta e cairia na
 * faixa de peso 2. Duas contas de dia no mesmo produto, discordando por meio
 * dia, é o defeito que ninguém acha olhando qualquer uma das duas.
 *
 * Negativo quando o prazo já passou.
 */
export function diasCivisAte(deadline: Date, agora: Date): number {
  const diaCivil = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return Math.round((diaCivil(deadline) - diaCivil(agora)) / (24 * 60 * 60 * 1000));
}

/** Uma pessoa candidata a receber a próxima demanda, com o que ela já segura. */
export interface CandidatoParaCarga {
  userId: string;
  /** As demandas ABERTAS desta pessoa: `assigned` ou `in_analysis` (D40). */
  abertas: ReadonlyArray<{ deadline: Date; assignedAt: Date | null }>;
}

export interface CargaCalculada {
  userId: string;
  carga: number;
  /** O `assignedAt` mais antigo entre as abertas; `null` quando não segura nada. */
  assumiuHaMaisTempo: Date | null;
}

/**
 * A carga de cada candidato, pela régua da D40.
 *
 * Três coisas ficaram FORA, e cada uma por um motivo escrito na decisão: o
 * VALOR não entra (valor alto é mais dinheiro, não mais trabalho técnico); o
 * PORTE não entra (só se conhece depois da análise, e distribuir com dado que
 * ainda não existe é distribuir por adivinhação); e demanda devolvida ou
 * concluída não conta (carga é o que ainda ocupa a pessoa).
 */
export function calcularCargas(
  candidatos: readonly CandidatoParaCarga[],
  agora: Date
): CargaCalculada[] {
  return candidatos.map((c) => {
    let carga = 0;
    let maisAntigo: Date | null = null;
    for (const d of c.abertas) {
      carga += pesoDoPrazo(d.deadline, agora);
      if (d.assignedAt && (maisAntigo === null || d.assignedAt.getTime() < maisAntigo.getTime())) {
        maisAntigo = d.assignedAt;
      }
    }
    return { userId: c.userId, carga, assumiuHaMaisTempo: maisAntigo };
  });
}

/**
 * Quem recebe a próxima demanda (D40).
 *
 * Menor carga vence. Empate vai para quem assumiu há mais tempo — quem não
 * segura nada tem o `assignedAt` mais antigo possível e ganha de quem segura,
 * o que é a leitura certa de "há mais tempo" para quem está livre. Empate ainda
 * não resolvido cai no `userId`, que é arbitrário e ESTÁVEL: sem esse último
 * critério, duas execuções da mesma decisão poderiam escolher pessoas
 * diferentes conforme a ordem que o banco devolvesse, e a política deixaria de
 * ser explicável para quem recebeu.
 *
 * Sem candidato, devolve `null` — e quem chama deixa a demanda na fila, em vez
 * de inventar um dono.
 */
export function escolherResponsavel(
  candidatos: readonly CandidatoParaCarga[],
  agora: Date
): string | null {
  const cargas = calcularCargas(candidatos, agora);
  if (cargas.length === 0) return null;
  const ordenadas = [...cargas].sort((a, b) => {
    if (a.carga !== b.carga) return a.carga - b.carga;
    const ta = a.assumiuHaMaisTempo?.getTime() ?? Number.NEGATIVE_INFINITY;
    const tb = b.assumiuHaMaisTempo?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  return ordenadas[0].userId;
}

// ─── D20: a medição, agregada ───────────────────────────────────────────────

export interface DemandaParaMedicao {
  assignedUserId: string | null;
  sentAt: Date;
  queuedAt: Date;
  assignedAt: Date | null;
  analysisStartedAt: Date | null;
  completedAt: Date | null;
  returnedAt: Date | null;
}

export interface Medicao {
  /** Quantas demandas entraram em cada média. Sem isto, "12 h" não é lido. */
  amostraAteAssumir: number;
  amostraAteAnalise: number;
  amostraAteConcluir: number;
  /** Em segundos; `null` quando a amostra é zero. */
  mediaAteAssumirSegundos: number | null;
  mediaAteAnaliseSegundos: number | null;
  mediaAteConcluirSegundos: number | null;
  devolvidas: number;
  total: number;
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

function decorrido(fim: Date | null, inicio: Date | null): number | null {
  if (!fim || !inicio) return null;
  const s = Math.round((fim.getTime() - inicio.getTime()) / 1000);
  // Negativo é relógio fora de sincronia, não trabalho instantâneo. Omitido em
  // vez de somado: uma medição negativa envenena a média em silêncio, e é a
  // mesma regra que `montarPayloadDoEvento` já aplica ao `elapsed` que viaja.
  return s >= 0 ? s : null;
}

/**
 * A medição de tempo de resposta (D20), agregada sobre um conjunto de demandas.
 *
 * O tempo até assumir conta do `sentAt` — o instante em que o vendedor apertou
 * o botão do outro lado —, e não do `queuedAt`. É o que o vendedor espera, e é
 * o mesmo `since_sent_seconds` que já viaja nos eventos desde a F3; medir da
 * chegada esconderia justamente a demora da entrega.
 */
export function medir(demandas: readonly DemandaParaMedicao[]): Medicao {
  const ateAssumir: number[] = [];
  const ateAnalise: number[] = [];
  const ateConcluir: number[] = [];
  let devolvidas = 0;

  for (const d of demandas) {
    const a = decorrido(d.assignedAt, d.sentAt);
    if (a !== null) ateAssumir.push(a);
    const b = decorrido(d.analysisStartedAt, d.assignedAt);
    if (b !== null) ateAnalise.push(b);
    const c = decorrido(d.completedAt, d.sentAt);
    if (c !== null) ateConcluir.push(c);
    if (d.returnedAt) devolvidas += 1;
  }

  return {
    amostraAteAssumir: ateAssumir.length,
    amostraAteAnalise: ateAnalise.length,
    amostraAteConcluir: ateConcluir.length,
    mediaAteAssumirSegundos: media(ateAssumir),
    mediaAteAnaliseSegundos: media(ateAnalise),
    mediaAteConcluirSegundos: media(ateConcluir),
    devolvidas,
    total: demandas.length,
  };
}

/**
 * O desempenho POR PESSOA (D20).
 *
 * Existe só deste lado, e essa fronteira é decisão do dono: o CRM vê o tempo da
 * demanda dele e a média da equipe, e nunca o recorte por pessoa — ele não vira
 * ranking de gente de outro time. O agrupamento é feito aqui, e o que o CRM
 * consome é `medir()` sobre o conjunto inteiro.
 */
export function medirPorPessoa(
  demandas: readonly DemandaParaMedicao[]
): Array<{ userId: string; medicao: Medicao }> {
  const porPessoa = new Map<string, DemandaParaMedicao[]>();
  for (const d of demandas) {
    if (!d.assignedUserId) continue;
    const lista = porPessoa.get(d.assignedUserId) ?? [];
    lista.push(d);
    porPessoa.set(d.assignedUserId, lista);
  }
  return [...porPessoa.entries()]
    .map(([userId, lista]) => ({ userId, medicao: medir(lista) }))
    .sort((a, b) => b.medicao.total - a.medicao.total || (a.userId < b.userId ? -1 : 1));
}
