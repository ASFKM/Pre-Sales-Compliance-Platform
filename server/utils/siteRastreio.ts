// Fase I (add-on): shipment tracking via Seu Rastreio (https://seurastreio.com.br), chosen after
// comparing real 2026 pricing/free-tier terms against Infosimples (R$100/month mandatory minimum
// even at low volume), 17TRACK (stopped being a recurring free allocation in 2026) and Frenet
// (oriented at full freight quoting, not pure tracking) - 1000 requests/month free, recurring, best
// cost-benefit for this module's low volume. API key is configured as an IntegrationConnector row
// (type "site_rastreio") in Configurações > Integrações e API, same generic connector screen every
// other CRM/ERP integration already uses - no dedicated settings UI needed for the credential
// itself.
import { dbStore } from "../../src/dbStore";
import { decryptSecret } from "./security";

const SITE_RASTREIO_BASE_URL = "https://seurastreio.com.br/api/public/rastreio";

export interface SiteRastreioResult {
  found: boolean;
  // Literal text from the carrier (eventoMaisRecente.descricao) - per product decision
  // (2026-07-13), the POC equipment status shows this exact text, never our own simplified
  // vocabulary (Enviado/Na casa do cliente/Devolvido).
  carrierStatusText: string | null;
  eventDate: string | null;
  eventLocation: string | null;
}

// Looks up this tenant's Site Rastreio API key from the generic IntegrationConnector table -
// returns undefined (not an error) when nothing is configured yet, since not every tenant using
// the POC module necessarily has shipment tracking set up: callers fall back to the NF-based
// status in that case rather than failing.
export async function getSiteRastreioApiKey(): Promise<string | undefined> {
  const integrations = await dbStore.getIntegrations();
  const connector = integrations.find((i) => i.type === "site_rastreio");
  if (!connector?.api_key) return undefined;
  try {
    return decryptSecret(connector.api_key);
  } catch {
    return undefined;
  }
}

export async function queryTrackingStatus(apiKey: string, trackingCode: string): Promise<SiteRastreioResult> {
  const res = await fetch(`${SITE_RASTREIO_BASE_URL}/${encodeURIComponent(trackingCode)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (res.status === 404) {
    return { found: false, carrierStatusText: null, eventDate: null, eventLocation: null };
  }
  if (!res.ok) {
    throw new Error(`Site Rastreio respondeu ${res.status} ao consultar o código de rastreio.`);
  }

  const data: any = await res.json();
  if (!data?.success || !data?.eventoMaisRecente) {
    return { found: false, carrierStatusText: null, eventDate: null, eventLocation: null };
  }

  return {
    found: true,
    carrierStatusText: data.eventoMaisRecente.descricao || null,
    eventDate: data.eventoMaisRecente.data || null,
    eventLocation: data.eventoMaisRecente.local || null,
  };
}
