// CDC 16 — Fase 6. O CNPJ do edital, para a busca no CRM ser EXATA (ADR 0001 §2.9).
//
// ## Por que regex e dígito verificador, e não a IA
//
// A extração do intake já lê os documentos com IA, e acrescentar "customer_tax_id" ao prompt
// seria uma linha. Não é o que se faz aqui, e o motivo é o que acontece quando ela erra: um
// CNPJ inventado tem a forma certa, passa por qualquer conferência de formato e **casa com a
// empresa errada** no CRM — silenciosamente, porque o resultado é exato e ninguém revisa um
// casamento por CNPJ. Um CNPJ é um número com dígito verificador: ou está escrito no documento,
// e a regex o acha, ou não está, e a busca cai para o nome, que sempre volta para confirmação
// humana. Não há terreno intermediário em que adivinhar ajude.
//
// A busca por nome continua existindo justamente para o caso de não haver CNPJ no edital.

const PADRAO = /\b(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})\b/g;

/** Só os dígitos. */
export function normalizarCnpj(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/**
 * O dígito verificador do CNPJ (módulo 11, pesos 2..9 cíclicos da direita para a esquerda).
 *
 * É ele que separa "um número de 14 dígitos no meio de um edital" de "um CNPJ": números de
 * processo, de empenho e de protocolo têm 14 dígitos o tempo todo, e sem esta conta metade das
 * buscas sairia com o número errado.
 */
export function cnpjValido(bruto: string | null | undefined): boolean {
  const d = normalizarCnpj(bruto);
  if (d.length !== 14) return false;
  // Todos iguais passa no módulo 11 e não é CNPJ de ninguém.
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calcular = (ate: number): number => {
    let peso = 2;
    let soma = 0;
    for (let i = ate - 1; i >= 0; i--) {
      soma += Number(d[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(12) === Number(d[12]) && calcular(13) === Number(d[13]);
}

/**
 * O primeiro CNPJ VÁLIDO do texto.
 *
 * O primeiro, e não o mais frequente: num edital, o CNPJ do órgão que publica aparece no
 * cabeçalho, e é ele que interessa. O mais frequente costuma ser o de um anexo de modelo de
 * declaração, que traz o CNPJ de exemplo repetido em cada folha.
 */
export function acharCnpjNoTexto(texto: string | null | undefined): string | null {
  if (!texto) return null;
  PADRAO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PADRAO.exec(texto)) !== null) {
    const candidato = m.slice(1).join("");
    if (cnpjValido(candidato)) return candidato;
  }
  return null;
}

export function formatarCnpj(bruto: string): string {
  const d = normalizarCnpj(bruto);
  if (d.length !== 14) return bruto;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
