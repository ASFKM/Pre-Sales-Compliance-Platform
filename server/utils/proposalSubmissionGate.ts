/*
 * F7 (rodada 09/2026): o GATE RÍGIDO DE ENVIO, como regra pura.
 *
 * Está fora da rota (server/routes/approvals.ts) pelo mesmo motivo que a F6 tirou a exigência de
 * justificativa de dentro da dela: é uma afirmação sobre o que o servidor RECUSA, e uma afirmação
 * dessas precisa de teste que não dependa de subir rota - senão ela acaba não sendo escrita.
 *
 * A regra, em uma frase: nenhum apontamento de severidade "critical" da última rodada pode estar
 * em "aberto" ou "em_tratativa" na hora de submeter para aprovação.
 *
 * O que NÃO barra, e cada caso é uma decisão:
 *   - "aceito_com_risco": é a saída explícita. Alguém leu o crítico, decidiu seguir assim e
 *     assinou a justificativa (o PATCH recusa sem ela, com autor e instante carimbados). Esse
 *     registro é a peça que sobra para quem tiver de explicar depois por que a proposta foi assim.
 *   - "resolvido" / "descartado": o apontamento saiu de pauta por decisão humana.
 *   - severidade "warning" e "info": um aviso não impede uma proposta de ir para aprovação; se
 *     impedisse, ninguém marcaria nada como aviso.
 *
 * A checagem de justificativa em "aceito_com_risco" é REDUNDANTE com o PATCH de propósito. Uma
 * linha gravada antes desta fase, ou por um caminho que não passe pela rota, não deve conseguir
 * abrir o portão só por ter o status certo - o que sustenta a decisão é a justificativa, e é ela
 * que este módulo confere.
 */

export interface ApontamentoParaGate {
  id: string;
  title: string;
  severity: string;
  status: string;
  resolutionNote: string | null;
  targetKey?: string | null;
}

const STATUS_EM_ABERTO = new Set(["aberto", "em_tratativa"]);

/** Os apontamentos que impedem a submissão. Lista vazia = o portão está aberto. */
export function apontamentosQueBarramEnvio(apontamentos: readonly ApontamentoParaGate[]): ApontamentoParaGate[] {
  return apontamentos.filter((a) => {
    if (a.severity !== "critical") return false;
    if (STATUS_EM_ABERTO.has(a.status)) return true;
    // "aceito com risco" sem justificativa não é aceite: é status trocado sem decisão registrada.
    if (a.status === "aceito_com_risco" && !(a.resolutionNote ?? "").trim()) return true;
    return false;
  });
}

/**
 * A mensagem que o usuário lê. Nomeia cada apontamento que está barrando e diz a saída - porque
 * "não é possível submeter" sem dizer o quê nem como sair transforma um gate em um beco.
 */
export function mensagemDoGateDeEnvio(barrando: readonly ApontamentoParaGate[]): string {
  const lista = barrando
    .map((a) => `• "${a.title}"${a.targetKey ? ` (seção ${a.targetKey})` : ""} — ${a.status === "em_tratativa" ? "em tratativa" : a.status === "aceito_com_risco" ? "aceito com risco, mas sem justificativa registrada" : "aberto"}`)
    .join("\n");
  const plural = barrando.length > 1;
  return `Esta proposta não pode ser submetida para aprovação: ${barrando.length} apontamento${plural ? "s" : ""} crítico${plural ? "s" : ""} da última revisão continua${plural ? "m" : ""} em aberto.\n\n${lista}\n\nResolva ${plural ? "cada um" : "o apontamento"} ou marque como "aceito com risco", com justificativa, no painel de pareceres do Estúdio de Propostas.`;
}
