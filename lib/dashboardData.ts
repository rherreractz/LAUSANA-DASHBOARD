import { getHubspotStatusMap } from './hubspot';
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
import type { ProcessedLead } from './types';

export interface DashboardData {
  leads: ProcessedLead[];
  hubspotLimit: number;
  leadQualityHistoryChart: { data: LeadQualityHistoryChartPoint[]; fuentes: string[] };
}

/**
 * Carga todo lo que necesita el dashboard: leads (100% HubSpot — Lausana ya
 * no usa Google Sheet ni GoHighLevel como fuente de leads), snapshot de
 * calidad guardado en el Sheet de STORAGE, e historial para la gráfica de
 * línea de tiempo.
 *
 * Centralizado acá porque app/page.tsx y app/meta-ads/page.tsx necesitan
 * exactamente lo mismo (antes esta lógica estaba duplicada en los dos
 * archivos, letra por letra).
 *
 * @param logPrefix Prefijo para los console.error, para saber desde qué
 * página salió el error si algo falla (ej. 'page' o 'meta-ads/page').
 */
export async function loadDashboardData(logPrefix: string): Promise<DashboardData> {
  // Si HubSpot falla o tarda demasiado, no tumbamos el dashboard — se
  // muestra vacío por esta vez en vez de un error 500.
  const hubspotMap = await getHubspotStatusMap().catch((err) => {
    console.error(`[${logPrefix}] Error al leer HubSpot, se muestra el dashboard sin leads por esta vez:`, err);
    return { byPhone: new Map(), byEmail: new Map(), all: [], limit: 300 };
  });

  // getHubspotRawLeads() arma un RawLead por cada contacto (Etapa vacía);
  // mergeHubspotStatus() cruza esos mismos leads contra el MISMO mapa de
  // HubSpot por teléfono/correo para rellenar etapaLeadCrm/estadoLeadCrm/
  // propietarioCrm — como cada contacto tiene su propio teléfono/correo,
  // siempre se empareja consigo mismo. Mismo patrón que ya usaba este
  // archivo para enriquecer leads del Sheet, solo que ahora HubSpot es la
  // fuente Y el enriquecimiento a la vez.
  const rawLeads = getHubspotRawLeads(hubspotMap);
  const leads = mergeHubspotStatus(processLeads(rawLeads), hubspotMap);

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

  return { leads, hubspotLimit: hubspotMap.limit, leadQualityHistoryChart };
}