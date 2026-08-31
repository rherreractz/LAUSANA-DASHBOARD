import { normalizeEmail, ghlLeadToRawLead } from './leadUtils';
import type { RawLead } from './types';

/**
 * Integración con GoHighLevel (GHL) — API v2, autenticada con un Private
 * Integration Token (los API Keys viejos de v1 ya no se pueden generar,
 * GHL los dio de baja a finales de 2025).
 *
 * Lausana usa HubSpot como fuente principal hoy, pero este archivo deja
 * lista la MISMA capacidad que ya tiene vtower para usar GHL como fuente
 * (ver getGhlRawLeads() abajo) — así, el día que este cliente tenga cuenta
 * real de GHL, cambiar la fuente desde Ajustes → Ajustes avanzados
 * "simplemente funciona", sin más código.
 *
 *   - getGhlRawLeads()  -> RawLead[] de TODAS las oportunidades (fuente
 *     primaria). NO descarta oportunidades sin correo — solo un contacto
 *     sin correo no podrá cruzarse por correo con otra fuente.
 *   - getGhlStatusMap() -> Map por correo (para enriquecer leads que
 *     vengan de otro lado — no se usa mientras el CRM activo sea GHL vía
 *     getGhlRawLeads(), se conserva por compatibilidad con el patrón
 *     original de este proyecto).
 *
 * A diferencia de vtower, AQUÍ NO se filtra por un pipeline específico por
 * default — no conocemos todavía la estructura real de pipelines de la
 * cuenta de GHL de Lausana. Si hace falta acotar a un pipeline en
 * particular más adelante (igual que vtower con "Marketing Pipeline"),
 * defínelo en GHL_MARKETING_PIPELINE_NAME.
 *
 * Variables de entorno requeridas:
 * GHL_PRIVATE_TOKEN="pit-..."
 * GHL_LOCATION_ID="..."
 *
 * Opcionales:
 * GHL_MARKETING_PIPELINE_NAME="..."
 *   Si se define, getGhlRawLeads() SOLO trae oportunidades de ese pipeline
 *   (por nombre exacto, no distingue mayúsculas). Si se deja vacío, trae
 *   oportunidades de TODOS los pipelines de la cuenta.
 * GHL_USERS_FALLBACK='{"userId1":"Nombre Apellido","userId2":"Otro Nombre"}'
 *   Mapa fijo de respaldo si el endpoint de usuarios de GHL falla.
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const MARKETING_PIPELINE_NAME = process.env.GHL_MARKETING_PIPELINE_NAME || '';

interface GhlPipelineStage {
  id: string;
  name: string;
}

interface GhlPipeline {
  id: string;
  name: string;
  stages: GhlPipelineStage[];
}

interface GhlAttribution {
  utmCampaign?: string | null;
  isFirst?: boolean;
  isLast?: boolean;
}

interface GhlOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  assignedTo?: string | null;
  contactId: string;
  /** Fuente/atribución de la oportunidad, si GHL la trae (ej. "Facebook"). */
  source?: string | null;
  createdAt?: string | null;
  dateAdded?: string | null;
  contact?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  /** Historial de atribución UTM — de aquí sacamos utmCampaign si existe. */
  attributions?: GhlAttribution[] | null;
}

export interface GhlStatusEntry {
  estadoGHL: string; // nombre del Stage, ej. "Registro", "Contacto"
  pipelineGHL: string; // nombre del Pipeline al que pertenece
  personaEncargadaGHL: string; // nombre del usuario asignado, o "Sin asignar"
}

export interface GhlStatusMap {
  byEmail: Map<string, GhlStatusEntry>;
}

function ghlHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_API_VERSION,
    Accept: 'application/json',
  };
}

/** Trae todos los pipelines de la Location, con sus Stages (id -> nombre). */
async function fetchPipelines(token: string, locationId: string): Promise<Map<string, GhlPipeline>> {
  const url = `${GHL_API_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`;
  const res = await fetch(url, { headers: ghlHeaders(token) });

  if (!res.ok) {
    console.error(`[ghl] Error ${res.status} al leer pipelines:`, await res.text());
    return new Map();
  }

  const data = await res.json();
  const pipelines: GhlPipeline[] = data.pipelines ?? [];
  return new Map(pipelines.map((p) => [p.id, p]));
}

/** Busca, por NOMBRE (no case-sensitive), el pipeline configurado como fuente de leads — solo si GHL_MARKETING_PIPELINE_NAME está definido. */
function resolveMarketingPipeline(pipelines: Map<string, GhlPipeline>): GhlPipeline | null {
  if (!MARKETING_PIPELINE_NAME) return null;
  const target = MARKETING_PIPELINE_NAME.trim().toLowerCase();
  for (const pipeline of pipelines.values()) {
    if (pipeline.name.trim().toLowerCase() === target) return pipeline;
  }
  return null;
}

/**
 * Trae el mapa userId -> nombre. Primero intenta la API real; si falla o
 * viene vacía (le pasa a veces a GHL), cae al mapa fijo de
 * GHL_USERS_FALLBACK si está configurado, para no dejar todo en blanco.
 */
async function fetchUsersMap(token: string, locationId: string): Promise<Map<string, string>> {
  try {
    const url = `${GHL_API_BASE}/users/?locationId=${encodeURIComponent(locationId)}`;
    const res = await fetch(url, { headers: ghlHeaders(token) });
    if (res.ok) {
      const data = await res.json();
      const users: { id: string; name?: string; firstName?: string; lastName?: string }[] = data.users ?? [];
      if (users.length > 0) {
        return new Map(
          users.map((u) => [u.id, u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Sin nombre']),
        );
      }
    } else {
      console.error(`[ghl] Error ${res.status} al leer usuarios, se usará el respaldo si existe:`, await res.text());
    }
  } catch (error) {
    console.error('[ghl] Error de red al leer usuarios, se usará el respaldo si existe:', error);
  }

  const fallbackRaw = process.env.GHL_USERS_FALLBACK;
  if (fallbackRaw) {
    try {
      const fallback = JSON.parse(fallbackRaw) as Record<string, string>;
      return new Map(Object.entries(fallback));
    } catch {
      console.error('[ghl] GHL_USERS_FALLBACK no es JSON válido.');
    }
  }

  return new Map();
}

/**
 * Trae TODAS las oportunidades de la Location (paginado), filtradas a un
 * solo pipeline si se pasa `pipelineId` (útil una vez que se sepa cuál es
 * el pipeline real de leads de Lausana en GHL).
 */
async function fetchAllOpportunities(token: string, locationId: string, pipelineId?: string): Promise<GhlOpportunity[]> {
  const all: GhlOpportunity[] = [];
  const pipelineFilter = pipelineId ? `&pipeline_id=${encodeURIComponent(pipelineId)}` : '';
  let nextPageUrl: string | null =
    `${GHL_API_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=100${pipelineFilter}`;

  // Tope de seguridad: máximo 60 páginas (a 100 por página = 6000
  // oportunidades) — con margen para que la cuenta siga creciendo.
  let safety = 0;
  while (nextPageUrl && safety < 60) {
    safety += 1;
    const res: Response = await fetch(nextPageUrl, { headers: ghlHeaders(token) });
    if (!res.ok) {
      console.error(`[ghl] Error ${res.status} al leer oportunidades:`, await res.text());
      break;
    }
    const data = await res.json();
    const opportunities: GhlOpportunity[] = data.opportunities ?? [];
    all.push(...opportunities);
    nextPageUrl = data.meta?.nextPageUrl ?? null;
  }

  return all;
}

/** Saca el nombre de campaña (utmCampaign) de la atribución de una oportunidad — prioriza el primer touchpoint (isFirst). */
function pickCampaignFromAttributions(attributions?: GhlAttribution[] | null): string {
  if (!attributions || attributions.length === 0) return '';
  const chosen = attributions.find((a) => a.isFirst) ?? attributions[0];
  return chosen?.utmCampaign?.trim() || '';
}

interface GhlDataSnapshot {
  pipelines: Map<string, GhlPipeline>;
  usersMap: Map<string, string>;
  opportunities: GhlOpportunity[];
}

/**
 * Versión SIN caché — hace el trabajo pesado real (pipelines + usuarios +
 * las páginas de oportunidades). Úsala solo si necesitas datos 100%
 * frescos ahora mismo; para el uso normal usa getGhlData() de abajo, que
 * cachea el resultado y lo comparte entre getGhlRawLeads()/getGhlStatusMap()
 * para no pagar el fetch pesado dos veces.
 */
async function getGhlDataUncached(): Promise<GhlDataSnapshot> {
  const token = process.env.GHL_PRIVATE_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!token || !locationId) {
    console.error('[ghl] Faltan GHL_PRIVATE_TOKEN / GHL_LOCATION_ID — se omite la integración con GoHighLevel.');
    return { pipelines: new Map(), usersMap: new Map(), opportunities: [] };
  }

  const pipelines = await fetchPipelines(token, locationId);
  const marketingPipeline = resolveMarketingPipeline(pipelines);

  if (MARKETING_PIPELINE_NAME && !marketingPipeline) {
    console.error(
      `[ghl] No se encontró el pipeline "${MARKETING_PIPELINE_NAME}" entre los pipelines de la cuenta ` +
        `(${Array.from(pipelines.values()).map((p) => p.name).join(', ') || 'ninguno'}). Se traen TODOS los pipelines por esta vez.`,
    );
  }

  const [usersMap, rawOpportunities] = await Promise.all([
    fetchUsersMap(token, locationId),
    fetchAllOpportunities(token, locationId, marketingPipeline?.id),
  ]);

  const byId = new Map<string, GhlOpportunity>();
  rawOpportunities.forEach((opp) => byId.set(opp.id, opp));

  return { pipelines, usersMap, opportunities: Array.from(byId.values()) };
}

/**
 * CACHÉ EN MEMORIA — evita pagar el costo del fetch pesado en cada carga
 * del dashboard. Compartido entre getGhlRawLeads() y getGhlStatusMap().
 */
const GHL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

let ghlCache: { data: GhlDataSnapshot; fetchedAt: number } | null = null;
let ghlCacheInFlight: Promise<GhlDataSnapshot> | null = null;

async function getGhlData(): Promise<GhlDataSnapshot> {
  const now = Date.now();

  if (ghlCache && now - ghlCache.fetchedAt < GHL_CACHE_TTL_MS) {
    return ghlCache.data;
  }
  if (ghlCacheInFlight) {
    return ghlCacheInFlight;
  }

  ghlCacheInFlight = getGhlDataUncached()
    .then((data) => {
      ghlCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      ghlCacheInFlight = null;
    });

  return ghlCacheInFlight;
}

/**
 * Fuente ALTERNA de leads (se activa desde Ajustes → Ajustes avanzados →
 * Fuente de leads = GoHighLevel): TODAS las oportunidades convertidas a
 * RawLead[]. NO descarta oportunidades sin correo (se dedupe por id de
 * oportunidad, no por correo).
 */
export async function getGhlRawLeads(): Promise<RawLead[]> {
  const { pipelines, usersMap, opportunities } = await getGhlData();

  const leads = opportunities.map((opp) => {
    const pipeline = pipelines.get(opp.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === opp.pipelineStageId);

    return ghlLeadToRawLead({
      createdAt: opp.createdAt || opp.dateAdded || '',
      nombre: opp.contact?.name || opp.name || 'Sin nombre',
      correo: opp.contact?.email || '',
      telefono: opp.contact?.phone || '',
      fuente: opp.source || '',
      campana: pickCampaignFromAttributions(opp.attributions),
      estadoGHL: stage?.name ?? 'Sin etapa',
      pipelineGHL: pipeline?.name ?? 'Sin pipeline',
      personaEncargadaGHL: opp.assignedTo ? (usersMap.get(opp.assignedTo) ?? 'Sin asignar') : 'Sin asignar',
    });
  });

  console.log(`[ghl] getGhlRawLeads: ${leads.length} oportunidades convertidas a leads.`);

  return leads;
}

/** Mapa por correo normalizado — para ENRIQUECER leads que ya vienen de otro lado (no se usa mientras GHL sea la fuente primaria). */
export async function getGhlStatusMap(): Promise<GhlStatusMap> {
  const { pipelines, usersMap, opportunities } = await getGhlData();

  const byEmail = new Map<string, GhlStatusEntry>();

  for (const opp of opportunities) {
    const email = normalizeEmail(opp.contact?.email);
    if (!email) continue;

    const pipeline = pipelines.get(opp.pipelineId);
    const stage = pipeline?.stages.find((s) => s.id === opp.pipelineStageId);

    byEmail.set(email, {
      estadoGHL: stage?.name ?? 'Sin etapa',
      pipelineGHL: pipeline?.name ?? 'Sin pipeline',
      personaEncargadaGHL: opp.assignedTo ? (usersMap.get(opp.assignedTo) ?? 'Sin asignar') : 'Sin asignar',
    });
  }

  console.log(`[ghl] Refrescado: ${byEmail.size} correos indexados de ${opportunities.length} oportunidades.`);

  return { byEmail };
}

/** Busca el estado de GHL de un lead por su correo (ya normalizado o crudo). */
export function lookupGhlStatus(map: GhlStatusMap, email?: string | null): GhlStatusEntry | null {
  const key = normalizeEmail(email);
  if (!key) return null;
  return map.byEmail.get(key) ?? null;
}
