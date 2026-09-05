/*
 * F7 (rodada 09/2026): como se reconhece que um apontamento da rodada N é "o mesmo" da rodada N-1.
 *
 * Este é o problema central da comparação entre rodadas, e ele não tem resposta óbvia. As três
 * candidatas, e por que a escolha foi a combinação e não uma delas:
 *
 * 1. SÓ PELA SEÇÃO-ALVO (targetKind + targetKey). Grosseiro demais para servir sozinho: um parecer
 *    costuma trazer DOIS apontamentos sobre `payment_terms` (a rodada que esta fase mediu tem
 *    exatamente isso), e casá-los pela seção diria que um sumiu quando na verdade os dois
 *    continuam. Pior no alvo "geral", que não tem chave nenhuma: todos os transversais virariam um
 *    só. Como critério único, ele INFLA o número de sanados - o número que mais interessa a quem
 *    quer acreditar que está progredindo.
 *
 * 2. SÓ POR SIMILARIDADE DE TÍTULO. Frágil na direção oposta: a IA reescreve o título a cada
 *    rodada ("Histórico Interno Exposto nas Condições de Pagamento" vira "Remover notas internas
 *    nas condições de pagamento" - também medido na rodada real desta proposta). Sozinho, ele
 *    INFLA o número de novos, que é o número que faz o ciclo parecer inútil.
 *
 * 3. VÍNCULO EXPLÍCITO PEDIDO AO MODELO. É o único critério que carrega intenção: a IA da rodada N
 *    recebe a lista dos apontamentos abertos da N-1 (id + título + seção) e diz, para cada
 *    apontamento novo, qual deles ele continua. Mas depende do modelo lembrar de responder, e um
 *    id vindo de um modelo NUNCA pode ser confiado sem verificação.
 *
 * A escolha: o vínculo explícito é a fonte PRIMÁRIA, sempre revalidado contra a lista que o
 * servidor mesmo montou (um id fora dela é descartado sem cerimônia - a IA não inventa
 * antecessor); onde o modelo se calou, entra o desempate DETERMINÍSTICO, que exige as duas coisas
 * juntas - mesma seção-alvo E similaridade de título acima do limiar. Exigir as duas corrige o
 * defeito de cada uma isolada: dois apontamentos distintos da mesma seção não colidem (os títulos
 * diferem), e um título reescrito ainda casa (a seção não mudou).
 *
 * O que os números passam a significar, e é isso que a tela mostra:
 *   SANADO   = apontamento aberto na rodada N-1 que NÃO reapareceu na N (ninguém o citou como
 *              antecessor e nada casou com ele).
 *   PARCIAL  = apontamento da N-1 que REAPARECEU na N. O ponto continua de pé; que o texto tenha
 *              mudado no meio não o fecha. "Parcial" e não "persistente" porque é assim que ele se
 *              comporta na prática: a seção foi mexida e a IA voltou a apontá-la.
 *   NOVO     = apontamento da rodada N sem antecessor.
 *
 * Um apontamento da N-1 já FECHADO (resolvido/aceito com risco/descartado) fica fora da conta
 * inteira: ele saiu de pauta por decisão humana, e contá-lo como "sanado" atribuiria à IA um
 * mérito que foi de quem decidiu.
 */

export interface ApontamentoParaCasar {
  id: string;
  title: string;
  targetKind: string;
  targetKey: string | null;
  /** Só nos da rodada N: o id que o modelo declarou como antecessor, ainda não verificado. */
  previousFindingId?: string | null;
}

/** Limiar de Jaccard sobre os tokens do título, usado só quando o modelo não vinculou nada. */
export const LIMIAR_DE_SIMILARIDADE = 0.4;

/**
 * Tokens comparáveis de um título: minúsculas, sem acento, sem pontuação, sem as palavras curtas
 * que não distinguem nada ("de", "na", "do"). Sem isso, "Condições de Pagamento" e "condicoes de
 * pagamento" seriam títulos diferentes, e a similaridade acusaria mudança onde não houve.
 */
export function tokensDoTitulo(titulo: string): Set<string> {
  const normalizado = titulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  return new Set(normalizado.split(/\s+/).filter((t) => t.length > 2));
}

/** Jaccard: interseção sobre união. 1 = títulos iguais depois da normalização; 0 = nada em comum. */
export function similaridadeDeTitulo(a: string, b: string): number {
  const ta = tokensDoTitulo(a);
  const tb = tokensDoTitulo(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersecao = 0;
  for (const t of ta) if (tb.has(t)) intersecao++;
  return intersecao / (ta.size + tb.size - intersecao);
}

function mesmoAlvo(a: ApontamentoParaCasar, b: ApontamentoParaCasar): boolean {
  return a.targetKind === b.targetKind && (a.targetKey ?? null) === (b.targetKey ?? null);
}

export interface CasamentoDeApontamento {
  /** id do apontamento da rodada N */
  novoId: string;
  /** id do apontamento da rodada N-1 que ele continua, ou null se não continua nenhum */
  anteriorId: string | null;
  /** "modelo" quando veio do vínculo explícito; "heuristica" quando foi o desempate do servidor */
  origem: "modelo" | "heuristica" | null;
  similaridade: number | null;
}

/**
 * Casa os apontamentos da rodada nova contra os abertos da rodada anterior.
 *
 * Um apontamento anterior só pode ser reivindicado UMA vez: dois apontamentos novos que apontem
 * para o mesmo antecessor deixariam a conta sem sentido (o mesmo ponto sanado e não sanado ao
 * mesmo tempo). Quem chega primeiro fica com ele - o vínculo do modelo é processado antes de toda
 * a heurística, exatamente para que a intenção declarada nunca perca para um palpite de
 * similaridade.
 */
export function casarApontamentos(
  anteriores: readonly ApontamentoParaCasar[],
  novos: readonly ApontamentoParaCasar[]
): CasamentoDeApontamento[] {
  const idsAnteriores = new Set(anteriores.map((a) => a.id));
  const reivindicados = new Set<string>();
  const resultado = new Map<string, CasamentoDeApontamento>();

  // Passo 1: o vínculo explícito, revalidado. Um id que não esteja na lista que o servidor
  // ofereceu ao modelo é descartado - não vira erro, vira "sem antecessor", e o apontamento conta
  // como novo. É a mesma disciplina de `recortarApontamento` da F6: o modelo propõe, o servidor
  // decide.
  for (const novo of novos) {
    const declarado = novo.previousFindingId?.trim() || null;
    if (declarado && idsAnteriores.has(declarado) && !reivindicados.has(declarado)) {
      reivindicados.add(declarado);
      const anterior = anteriores.find((a) => a.id === declarado)!;
      resultado.set(novo.id, {
        novoId: novo.id,
        anteriorId: declarado,
        origem: "modelo",
        similaridade: similaridadeDeTitulo(anterior.title, novo.title),
      });
    }
  }

  // Passo 2: o desempate determinístico, só para quem sobrou. Mesma seção-alvo E similaridade
  // acima do limiar; entre os candidatos, o mais parecido.
  for (const novo of novos) {
    if (resultado.has(novo.id)) continue;
    let melhor: { id: string; similaridade: number } | null = null;
    for (const anterior of anteriores) {
      if (reivindicados.has(anterior.id)) continue;
      if (!mesmoAlvo(anterior, novo)) continue;
      const sim = similaridadeDeTitulo(anterior.title, novo.title);
      if (sim >= LIMIAR_DE_SIMILARIDADE && (!melhor || sim > melhor.similaridade)) {
        melhor = { id: anterior.id, similaridade: sim };
      }
    }
    if (melhor) {
      reivindicados.add(melhor.id);
      resultado.set(novo.id, { novoId: novo.id, anteriorId: melhor.id, origem: "heuristica", similaridade: melhor.similaridade });
    } else {
      resultado.set(novo.id, { novoId: novo.id, anteriorId: null, origem: null, similaridade: null });
    }
  }

  return novos.map((n) => resultado.get(n.id)!);
}

export interface ComparacaoDeRodadas {
  sanados: string[];
  parciais: string[];
  novos: string[];
}

/**
 * Os três números da tela, a partir dos casamentos. Recebe os apontamentos ANTERIORES já filtrados
 * para os que estavam abertos - o filtro é de quem consulta o banco, não daqui, porque "aberto"
 * é estado de linha e este módulo é puro de propósito (é o que permite testá-lo sem subir rota).
 */
export function compararRodadas(
  anterioresAbertos: readonly ApontamentoParaCasar[],
  novos: readonly ApontamentoParaCasar[],
  casamentos: readonly CasamentoDeApontamento[]
): ComparacaoDeRodadas {
  const anterioresQueVoltaram = new Set(casamentos.map((c) => c.anteriorId).filter((id): id is string => !!id));
  return {
    sanados: anterioresAbertos.filter((a) => !anterioresQueVoltaram.has(a.id)).map((a) => a.id),
    parciais: casamentos.filter((c) => c.anteriorId).map((c) => c.novoId),
    novos: casamentos.filter((c) => !c.anteriorId).map((c) => c.novoId),
  };
}
