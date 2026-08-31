import { getHubspotStatusMap } from './hubspot';
import { getGhlRawLeads } from './ghl';
import {
  getHubspotRawLeads,
  processLeads,
  mergeHubspotStatus,
  summarizeLeadQualityByFuente,
  summarizeLeadQualityByCampana,
  buildLeadQualityHistoryChartData,
  type LeadQualityHistoryChartPoint,
} from './leadUtils';
import { saveLeadQualitySummary, getLeadQualityHistory } from './leadQualityStorage';
import { getSettings, type AppSettings } from './settingsStorage';
import type { ProcessedLead } from './types';

export interface DashboardData {
  leads: ProcessedLead[];
  hubspotLimit: number;
  leadQualityHistoryChart: { data: LeadQualityHistoryChartPoint[]; fuentes: string[] };
  settings: AppSettings;
}

/**
 * Carga todo lo que necesita el dashboard. La fuente de leads YA NO está
 * fija en el código — se decide en vivo según settings.activeSource
 * (editable desde Ajustes → Ajustes avanzados → Fuente de leads), leído de
 * la pestaña Settings del Sheet de storage. Por default cae a HubSpot (el
 * CRM que este cliente usa hoy) si nunca se tocó ese ajuste.
 *
 * Centralizado acá porque app/page.tsx y app/meta-ads/page.tsx necesitan
 * exactamente lo mismo.
 *
 * @param logPrefix Prefijo para los console.error, para saber desde qué
 * página salió el error si algo falla (ej. 'page' o 'meta-ads/page').
 */
export async function loadDashboardData(logPrefix: string): Promise<DashboardData> {
  const settings = await getSettings();

  let leads: ProcessedLead[];
  let hubspotLimit = 0;

  if (settings.activeSource === 'ghl') {
    const rawLeads = await getGhlRawLeads().catch((err) => {
      console.error(`[${logPrefix}] Error al leer GoHighLevel, se muestra el dashboard sin leads por esta vez:`, err);
      return [];
    });
    leads = processLeads(rawLeads);
  } else {
    // Si HubSpot falla o tarda demasiado, no tumbamos el dashboard — se
    // muestra vacío por esta vez en vez de un error 500.
    const hubspotMap = await getHubspotStatusMap().catch((err) => {
      console.error(`[${logPrefix}] Error al leer HubSpot, se muestra el dashboard sin leads por esta vez:`, err);
      return { byPhone: new Map(), byEmail: new Map(), all: [], limit: 300 };
    });
    hubspotLimit = hubspotMap.limit;

    // getHubspotRawLeads() arma un RawLead por cada contacto (Etapa vacía);
    // mergeHubspotStatus() cruza esos mismos leads contra el MISMO mapa de
    // HubSpot por teléfono/correo para rellenar etapaLeadCrm/estadoLeadCrm/
    // propietarioCrm — como cada contacto tiene su propio teléfono/correo,
    // siempre se empareja consigo mismo.
    const hubspotRawLeads = getHubspotRawLeads(hubspotMap);
    leads = mergeHubspotStatus(processLeads(hubspotRawLeads), hubspotMap);
  }

  // Snapshot de calidad de leads (por Fuente y por Campaña, según el
  // semáforo) — se guarda para que la generación de campañas lo use como
  // contexto real. Se espera (await) en vez de fire-and-forget: en un
  // entorno serverless, una promesa sin esperar puede cortarse antes de
  // terminar cuando la respuesta ya se mandó.
  try {
    await saveLeadQualitySummary({
      generatedAt: new Date().toISOString(),
      byFuente: summarizeLeadQualityByFuente(leads),
      byCampana: summarizeLeadQualityByCampana(leads),
    });
  } catch (err) {
    console.error(`[${logPrefix}] Error al guardar calidad de leads:`, err);
  }

  // Historial completo (un punto por día) para la gráfica de línea del
  // tiempo — ya incluye el snapshot de hoy que se acaba de guardar arriba.
  let leadQualityHistoryChart: { data: LeadQualityHistoryChartPoint[]; fuentes: string[] } = { data: [], fuentes: [] };
  try {
    const history = await getLeadQualityHistory();
    leadQualityHistoryChart = buildLeadQualityHistoryChartData(history);
  } catch (err) {
    console.error(`[${logPrefix}] Error al leer historial de calidad de leads:`, err);
  }

  return { leads, hubspotLimit, leadQualityHistoryChart, settings };
}
