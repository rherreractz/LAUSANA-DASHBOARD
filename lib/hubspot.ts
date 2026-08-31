const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/**
 * Variables de entorno requeridas (.env.local):
 *
 * HUBSPOT_ACCESS_TOKEN="pat-xxxx-xxxxxxxx-xxxx-xxxx-xxxxxxxxxxxx"
 *   Token de una Private App / Service Key de HubSpot. Scopes de lectura
 *   necesarios:
 *     - crm.objects.contacts.read (siempre)
 *     - crm.objects.owners.read   (solo si quieres resolver "Propietario del contacto")
 *
 * HUBSPOT_LEAD_STAGE_PROPERTY="etapa_del_lead"
 *   Nombre INTERNO de la propiedad "Etapa del lead". Por defecto: 'etapa_del_lead'.
 *
 * HUBSPOT_EXTRA_PROPERTIES="empresa,jobtitle,hs_analytics_source"
 *   Lista opcional separada por comas de cualquier otra propiedad de
 *   contacto (nombres internos). Disponible en `info.extra['nombre_interno']`.
 *
 * HUBSPOT_CREATED_SINCE="2026-06-01"
 *   Opcional (YYYY-MM-DD). Si se define, solo se traen contactos creados en
 *   HubSpot desde esa fecha en adelante.
 *
 * HUBSPOT_CONTACT_LIMIT="300"
 *   Cuántos contactos de HubSpot traer como máximo, ordenados del más
 *   reciente al más viejo. Por defecto 300. Se pagina en bloques de 100
 *   (el máximo por llamada de la Search API de HubSpot), así que no hay
 *   límite real más allá de lo que quieras esperar a que cargue.
 */

export interface HubspotContactInfo {
  /** ID interno del contacto en HubSpot */
  contactId: string;
  /** Valor de la propiedad estándar hs_lead_status, ej. "Intento de contacto" */
  estadoLead: string;
  /** Valor de la propiedad personalizada configurada en HUBSPOT_LEAD_STAGE_PROPERTY */
  etapaLead: string;
  /** Nombre (o correo, si no tiene nombre) del propietario del contacto, ya resuelto */
  propietario: string;
  /** Cualquier propiedad adicional pedida vía HUBSPOT_EXTRA_PROPERTIES, por nombre interno */
  extra: Record<string, string>;
  /** Nombre completo del contacto (firstname + lastname) */
  nombre: string;
  /** Teléfono crudo (sin normalizar) */
  telefono: string;
  /** Correo crudo */
  correo: string;
  /** Fecha de creación en HubSpot (ISO) */
  fechaCreacion: string;
}

export interface HubspotStatusMap {
  byPhone: Map<string, HubspotContactInfo>;
  byEmail: Map<string, HubspotContactInfo>;
  /** TODOS los contactos traídos de HubSpot, en el orden que llegaron (más reciente primero). */
  all: HubspotContactInfo[];
  /** Límite efectivo usado en este fetch (para saber si "Cargar más" tiene sentido). */
  limit: number;
}

const OWNER_PROPERTY = 'hubspot_owner_id';
const DEFAULT_LIMIT = 300;
const EMPTY_MAP: HubspotStatusMap = { byPhone: new Map(), byEmail: new Map(), all: [], limit: DEFAULT_LIMIT };

function normalizePhoneKey(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

function normalizeEmailKey(email?: string | null): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

function getExtraPropertyNames(): string[] {
  const raw = process.env.HUBSPOT_EXTRA_PROPERTIES;
  if (!raw) return [];
  return raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Trae todos los "owners" y arma un mapa id -> nombre legible. */
async function fetchOwnerMap(accessToken: string): Promise<Map<string, string>> {
  const ownerMap = new Map<string, string>();
  let after: string | undefined;

  try {
    do {
      const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/owners`);
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });

      if (!res.ok) {
        console.error(`[hubspot] Error ${res.status} al leer owners:`, await res.text());
        break;
      }

      const data = await res.json();

      for (const owner of data.results ?? []) {
        const nombre = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim();
        ownerMap.set(String(owner.id), nombre || owner.email || 'Sin nombre');
      }

      after = data.paging?.next?.after;
    } while (after);
  } catch (error) {
    console.error('[hubspot] Error al leer owners de HubSpot:', error);
  }

  return ownerMap;
}

/**
 * hs_lead_status y las propiedades tipo "lista desplegable" en HubSpot
 * guardan internamente un código (ej. "CONNECTED"), no la etiqueta que se
 * ve en la UI (ej. "Conectado"). Esta función trae el catálogo de opciones
 * de una propiedad y arma un mapa código -> etiqueta legible.
 */
async function fetchPropertyLabelMap(accessToken: string, propertyName: string): Promise<Map<string, string>> {
  const labelMap = new Map<string, string>();

  try {
    const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/properties/contacts/${propertyName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[hubspot] Error ${res.status} al leer opciones de "${propertyName}":`, await res.text());
      return labelMap;
    }

    const data = await res.json();
    for (const option of data.options ?? []) {
      labelMap.set(option.value, option.label);
    }
  } catch (error) {
    console.error(`[hubspot] Error al leer opciones de "${propertyName}":`, error);
  }

  return labelMap;
}

/**
 * Versión SIN caché — hace la búsqueda completa de contactos contra la
 * Search API de HubSpot (paginada en bloques de 100). Cada llamada aquí
 * es varias peticiones seguidas a HubSpot, así que puede disparar 429
 * "secondly limit" si se invoca en cada carga del dashboard. Para el uso
 * normal usa getHubspotStatusMap() de abajo, que cachea el resultado.
 */
async function getHubspotStatusMapUncached(overrideLimit?: number): Promise<HubspotStatusMap> {
  const { HUBSPOT_ACCESS_TOKEN, HUBSPOT_LEAD_STAGE_PROPERTY } = process.env;

  if (!HUBSPOT_ACCESS_TOKEN) {
    console.error('[hubspot] Falta la variable de entorno HUBSPOT_ACCESS_TOKEN.');
    return EMPTY_MAP;
  }

  const etapaProp = HUBSPOT_LEAD_STAGE_PROPERTY || 'etapa_del_lead';
  const extraPropNames = getExtraPropertyNames();
  const propertyNames = [
    'phone',
    'email',
    'firstname',
    'lastname',
    'createdate',
    'hs_lead_status',
    etapaProp,
    OWNER_PROPERTY,
    ...extraPropNames,
  ];

  // `overrideLimit` (usado por /api/leads para "Cargar más") tiene prioridad
  // sobre HUBSPOT_CONTACT_LIMIT; si ninguno está definido, cae en DEFAULT_LIMIT.
  const totalLimit = (() => {
    if (Number.isFinite(overrideLimit) && (overrideLimit as number) > 0) return overrideLimit as number;
    const envLimit = Number(process.env.HUBSPOT_CONTACT_LIMIT);
    return Number.isFinite(envLimit) && envLimit > 0 ? envLimit : DEFAULT_LIMIT;
  })();

  const createdSinceRaw = process.env.HUBSPOT_CREATED_SINCE;
  const filterGroups = createdSinceRaw
    ? [
        {
          filters: [
            {
              propertyName: 'createdate',
              operator: 'GTE',
              value: new Date(createdSinceRaw).getTime(),
            },
          ],
        },
      ]
    : undefined;

  const ownerMapPromise = fetchOwnerMap(HUBSPOT_ACCESS_TOKEN);
  const estadoLabelsPromise = fetchPropertyLabelMap(HUBSPOT_ACCESS_TOKEN, 'hs_lead_status');
  const etapaLabelsPromise = fetchPropertyLabelMap(HUBSPOT_ACCESS_TOKEN, etapaProp);

  const byPhone = new Map<string, HubspotContactInfo>();
  const byEmail = new Map<string, HubspotContactInfo>();
  const all: HubspotContactInfo[] = [];

  let after: string | undefined;

  try {
    do {
      const pageSize = Math.min(100, totalLimit - all.length);

      const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
          limit: pageSize,
          properties: propertyNames,
          ...(filterGroups ? { filterGroups } : {}),
          ...(after ? { after } : {}),
        }),
        cache: 'no-store',
      });

      if (!res.ok) {
        console.error(`[hubspot] Error ${res.status} al leer contactos:`, await res.text());
        break;
      }

      const data = await res.json();
      const ownerMap = await ownerMapPromise;
      const estadoLabels = await estadoLabelsPromise;
      const etapaLabels = await etapaLabelsPromise;

      for (const contact of data.results ?? []) {
        const props = contact.properties ?? {};

        const extra: Record<string, string> = {};
        for (const propName of extraPropNames) {
          extra[propName] = props[propName] ?? '';
        }

        const ownerId = props[OWNER_PROPERTY];
        const nombre = [props.firstname, props.lastname].filter(Boolean).join(' ').trim();

        const estadoRaw = props.hs_lead_status ?? '';
        const etapaRaw = props[etapaProp] ?? '';

        const info: HubspotContactInfo = {
          contactId: String(contact.id),
          estadoLead: estadoRaw ? estadoLabels.get(estadoRaw) ?? estadoRaw : '',
          etapaLead: etapaRaw ? etapaLabels.get(etapaRaw) ?? etapaRaw : '',
          propietario: ownerId ? ownerMap.get(String(ownerId)) ?? '' : '',
          extra,
          nombre,
          telefono: props.phone ?? '',
          correo: props.email ?? '',
          fechaCreacion: props.createdate ?? '',
        };

        const phoneKey = normalizePhoneKey(props.phone);
        const emailKey = normalizeEmailKey(props.email);

        if (phoneKey) byPhone.set(phoneKey, info);
        if (emailKey) byEmail.set(emailKey, info);
        all.push(info);
      }

      after = data.paging?.next?.after;
    } while (after && all.length < totalLimit);
  } catch (error) {
    console.error('[hubspot] Error al leer HubSpot:', error);
    return { byPhone: new Map(), byEmail: new Map(), all: [], limit: totalLimit };
  }

  console.log(`[hubspot] Contactos obtenidos de HubSpot: ${all.length} (límite configurado: ${totalLimit})`);

  return { byPhone, byEmail, all, limit: totalLimit };
}

/**
 * CACHÉ EN MEMORIA — sin esto, cada carga del dashboard disparaba una
 * búsqueda completa de contactos contra HubSpot (varias llamadas seguidas
 * a la Search API), lo que causaba errores 429 "secondly limit" con dos
 * pestañas abiertas o refrescos rápidos. Con esto, solo la primera visita
 * (o la primera después de que expire el caché) paga ese costo — el resto
 * se sirve al instante desde memoria.
 *
 * Vive mientras la función serverless siga "caliente" (se reutiliza la
 * misma instancia entre requests seguidos); en un cold start se vuelve a
 * llenar solo. Mismo patrón que lib/ghl.ts de vtower.
 */
const HUBSPOT_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutos

let hubspotCache: { data: HubspotStatusMap; fetchedAt: number } | null = null;
let hubspotCacheInFlight: Promise<HubspotStatusMap> | null = null;

/**
 * Punto de entrada que usa el resto del proyecto.
 *
 * - Con `overrideLimit` (lo usa /api/leads para "Cargar más"): va directo
 *   a la versión sin caché, porque pide un universo de contactos distinto
 *   al de la carga default y no debe contaminar ni leer el caché.
 * - Sin `overrideLimit` (la carga default del dashboard): cachea el
 *   resultado en memoria con TTL de 3 min y deduplica llamadas
 *   simultáneas con un flag "in-flight".
 */
export async function getHubspotStatusMap(overrideLimit?: number): Promise<HubspotStatusMap> {
  if (Number.isFinite(overrideLimit) && (overrideLimit as number) > 0) {
    return getHubspotStatusMapUncached(overrideLimit);
  }

  const now = Date.now();

  if (hubspotCache && now - hubspotCache.fetchedAt < HUBSPOT_CACHE_TTL_MS) {
    return hubspotCache.data;
  }

  // Si ya hay un refresh en curso (dos requests casi al mismo tiempo con
  // el caché vencido), que ambas esperen la MISMA llamada en vez de
  // disparar la búsqueda completa dos veces por separado.
  if (hubspotCacheInFlight) {
    return hubspotCacheInFlight;
  }

  hubspotCacheInFlight = getHubspotStatusMapUncached()
    .then((data) => {
      hubspotCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      hubspotCacheInFlight = null;
    });

  return hubspotCacheInFlight;
}