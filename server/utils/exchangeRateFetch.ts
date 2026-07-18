// Busca a cotação de venda do dólar (PTAX) direto da API pública do Banco Central do Brasil -
// mesma fonte oficial usada para operações comerciais/importação no Brasil, sem chave de API.
// PTAX não é publicada em fins de semana/feriados - tenta os últimos dias corridos até achar o
// pregão mais recente disponível. Fail-open: qualquer falha de rede/parsing retorna null, quem
// chama mantém a última cotação conhecida em vez de travar a tela de preços por causa disso.
import { logger } from "./logger";

export interface BcbExchangeRateResult {
  rate: number;
  quotedAt: string;
}

function formatDateForBcb(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

const MAX_DAYS_BACK = 10;

export async function fetchUsdBrlExchangeRateFromBcb(): Promise<BcbExchangeRateResult | null> {
  const today = new Date();
  for (let daysAgo = 0; daysAgo <= MAX_DAYS_BACK; daysAgo++) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dateParam = formatDateForBcb(date);
    try {
      const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao='${dateParam}')?$format=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data: any = await res.json();
      const entry = data?.value?.[0];
      if (entry && typeof entry.cotacaoVenda === "number") {
        return { rate: entry.cotacaoVenda, quotedAt: entry.dataHoraCotacao };
      }
    } catch (err) {
      logger.warn({ err, dateParam }, "Failed to fetch PTAX exchange rate from Banco Central for this date, trying an earlier date");
    }
  }
  logger.warn({ daysAttempted: MAX_DAYS_BACK }, "Could not fetch a PTAX exchange rate from Banco Central for any recent date");
  return null;
}
