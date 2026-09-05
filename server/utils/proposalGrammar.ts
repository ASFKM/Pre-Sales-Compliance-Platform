/*
 * F7 (rodada 09/2026): a revisão gramatical devolve CORREÇÕES PONTUAIS, nunca a seção reescrita.
 *
 * A diferença não é de forma, é de controle. `POST /secoes/:targetKey/sugerir-texto` (F6) devolve
 * um texto novo inteiro: aceitar é tudo ou nada, e quem revisa não consegue ficar com a vírgula
 * certa e recusar a frase que mudou o sentido. Uma correção gramatical é, por natureza, uma lista
 * de trocas independentes - e é assim que ela tem de chegar à tela, para que cada uma tenha o seu
 * próprio aceitar e recusar.
 *
 * Isso impõe uma regra que o servidor precisa cumprir e o modelo não pode garantir: um
 * `trecho_original` que não existe LITERALMENTE no texto atual é inaplicável. O modelo às vezes
 * devolve o trecho já normalizado (aspas curvas viram retas, espaço duplo vira simples), e uma
 * correção assim viraria um botão "aceitar" que não muda nada - o pior desfecho, porque a pessoa
 * acredita ter corrigido. Então: localiza-se cada trecho no texto real, e o que não é localizado
 * é DESCARTADO aqui, antes de chegar à tela.
 *
 * O offset é o que sustenta o aceitar por item. Sem ele, aplicar duas correções em sequência com
 * String.replace pegaria a primeira ocorrência das duas vezes - e um "que" corrigido no terceiro
 * parágrafo seria trocado no primeiro. Com offset, cada aplicação sabe exatamente onde escrever.
 */

export interface CorrecaoBruta {
  trecho_original: string;
  trecho_corrigido: string;
  motivo: string;
}

export interface CorrecaoLocalizada {
  id: string;
  trecho_original: string;
  trecho_corrigido: string;
  motivo: string;
  /** Índice do caractere onde `trecho_original` começa no texto atual da seção. */
  offset: number;
}

/**
 * Localiza cada correção no texto e descarta as inaplicáveis.
 *
 * Duas coisas descartam uma correção: o trecho não existir no texto, e o trecho corrigido ser
 * idêntico ao original (o modelo às vezes "corrige" devolvendo a mesma coisa - um item que não
 * muda nada só ocuparia espaço na tela pedindo uma decisão inexistente).
 *
 * Ocorrências repetidas: cada correção consome a primeira ocorrência AINDA NÃO consumida por outra
 * correção. É o que permite ao modelo apontar a mesma palavra errada em dois lugares e as duas
 * chegarem como itens separados, cada uma no seu offset.
 */
export function localizarCorrecoes(texto: string, brutas: readonly CorrecaoBruta[], prefixoDeId = "gc"): CorrecaoLocalizada[] {
  const localizadas: CorrecaoLocalizada[] = [];
  const consumidos: Array<{ inicio: number; fim: number }> = [];

  for (const bruta of brutas) {
    const original = bruta.trecho_original ?? "";
    const corrigido = bruta.trecho_corrigido ?? "";
    if (original.length === 0 || original === corrigido) continue;

    let busca = 0;
    let offset = -1;
    while (busca <= texto.length) {
      const encontrado = texto.indexOf(original, busca);
      if (encontrado === -1) break;
      const colide = consumidos.some((c) => encontrado < c.fim && encontrado + original.length > c.inicio);
      if (!colide) { offset = encontrado; break; }
      busca = encontrado + 1;
    }
    if (offset === -1) continue;

    consumidos.push({ inicio: offset, fim: offset + original.length });
    localizadas.push({
      id: `${prefixoDeId}_${localizadas.length}`,
      trecho_original: original,
      trecho_corrigido: corrigido,
      motivo: bruta.motivo ?? "",
      offset,
    });
  }

  return localizadas.sort((a, b) => a.offset - b.offset);
}

/**
 * Aplica UMA correção ao texto, no offset dela - e só ela.
 *
 * Devolve null quando o texto no offset não é mais o `trecho_original` esperado: significa que o
 * texto mudou depois que as correções foram calculadas (a pessoa editou a seção à mão, ou aceitou
 * outra correção que deslocou esta). Recusar em silêncio seria escrever no lugar errado.
 */
export function aplicarCorrecao(texto: string, correcao: CorrecaoLocalizada): string | null {
  const fim = correcao.offset + correcao.trecho_original.length;
  if (texto.slice(correcao.offset, fim) !== correcao.trecho_original) return null;
  return texto.slice(0, correcao.offset) + correcao.trecho_corrigido + texto.slice(fim);
}

/**
 * Reposiciona as correções restantes depois que UMA foi aplicada.
 *
 * Aceitar uma correção muda o comprimento do texto, e toda correção depois dela escorrega. A
 * correção aplicada sai da lista; as anteriores a ela ficam onde estavam.
 */
export function reposicionarAposAplicar(
  correcoes: readonly CorrecaoLocalizada[],
  aplicada: CorrecaoLocalizada
): CorrecaoLocalizada[] {
  const delta = aplicada.trecho_corrigido.length - aplicada.trecho_original.length;
  return correcoes
    .filter((c) => c.id !== aplicada.id)
    .map((c) => (c.offset > aplicada.offset ? { ...c, offset: c.offset + delta } : c));
}
