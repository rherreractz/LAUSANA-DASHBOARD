import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

/**
 * Configuración editable desde el panel de "Ajustes" del dashboard, sin
 * necesidad de tocar el servidor. Vive en una pestaña nueva del MISMO
 * Google Sheet de storage (no una base de datos aparte) — mismo patrón que
 * MetaAudits/CampaignHistory/LeadQualitySummary.
 *
 * IMPORTANTE — qué SÍ y qué NO vive aquí:
 * - SÍ: nombre/marca a mostrar, color primario, qué CRM está activo
 *   (hubspot/ghl), IDs no sensibles (Page ID de Meta).
 * - NO: tokens de API, claves privadas, ni ningún secreto. Esas siguen
 *   SOLO en el .env del servidor — meterlas en una hoja de cálculo editable
 *   desde el navegador sería un riesgo de seguridad real (cualquiera con
 *   acceso al panel podría verlas/robarlas). Si el valor guardado aquí
 *   está vacío, todo el código sigue cayendo al valor de process.env como
 *   viene haciendo hasta ahora — esto es un OVERRIDE opcional, no un
 *   reemplazo obligatorio.
 *
 * Configuración en tu Google Sheet (mismo patrón que las otras pestañas):
 * 1. Crea una pestaña nueva llamada exactamente: Settings
 * 2. Encabezados en la fila 1: Key | Value
 * 3. No hace falta llenar filas a mano — se crean solas la primera vez que
 *    alguien guarda algo desde el panel de Ajustes.
 */

const WRITE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEET_TITLE = 'Settings';

export interface AppSettings {
  /** Nombre del cliente a mostrar en el encabezado (vacío = usa el default hardcodeado del proyecto). */
  displayName: string;
  /** Color primario en hex, ej. "#53958B" (vacío = usa el default del tema). */
  primaryColor: string;
  /** Qué CRM se usa como fuente de leads. */
  activeSource: 'hubspot' | 'ghl';
  /** Override del Page ID de Meta (vacío = usa NEXT_PUBLIC_META_PAGE_ID del .env). */
  metaPageId: string;
}

const SETTINGS_KEYS = ['displayName', 'primaryColor', 'activeSource', 'metaPageId'] as const;

function defaultSettings(): AppSettings {
  return {
    displayName: '',
    primaryColor: '',
    // Default razonable: si hay token de HubSpot configurado, asumimos que
    // ese es el CRM real en uso hoy — evita que un cliente que nunca tocó
    // Ajustes se quede sin leads por un default equivocado.
    activeSource: process.env.HUBSPOT_ACCESS_TOKEN ? 'hubspot' : 'ghl',
    metaPageId: '',
  };
}

async function getSheet() {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID } = process.env;

  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_SHEET_ID) {
    console.error('[settingsStorage] Faltan variables de entorno de Google.');
    return null;
  }

  const jwt = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: WRITE_SCOPES,
  });

  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, jwt);
  await doc.loadInfo();

  let sheet = doc.sheetsByTitle[SHEET_TITLE];
  if (!sheet) {
    // A diferencia de las otras pestañas (que si faltan solo se dejan de
    // guardar datos), esta si la creamos sola si no existe — Ajustes debe
    // poder usarse sin que alguien tenga que ir a crear la pestaña a mano
    // primero.
    console.warn(`[settingsStorage] No existía la pestaña "${SHEET_TITLE}", se crea automáticamente.`);
    sheet = await doc.addSheet({ title: SHEET_TITLE, headerValues: ['Key', 'Value'] });
  }

  return sheet;
}

async function getSettingsUncached(): Promise<AppSettings> {
  const settings = defaultSettings();

  try {
    const sheet = await getSheet();
    if (!sheet) return settings;

    const rows = await sheet.getRows();
    for (const row of rows) {
      const key = row.get('Key');
      const value = row.get('Value');
      if (SETTINGS_KEYS.includes(key) && typeof value === 'string' && value !== '') {
        (settings as any)[key] = value;
      }
    }
  } catch (err) {
    console.error('[settingsStorage] Error al leer Settings, se usan los valores por default:', err);
  }

  return settings;
}

/**
 * CACHÉ EN MEMORIA de 2 minutos — mismo motivo que el resto del proyecto:
 * sin esto, cada carga del dashboard (Leads, Auditoría, Generar Campaña,
 * el propio panel de Ajustes) pegaría contra el Sheet por separado.
 */
const SETTINGS_CACHE_TTL_MS = 2 * 60 * 1000;

let settingsCache: { data: AppSettings; fetchedAt: number } | null = null;
let settingsCacheInFlight: Promise<AppSettings> | null = null;

export async function getSettings(): Promise<AppSettings> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.fetchedAt < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.data;
  }
  if (settingsCacheInFlight) {
    return settingsCacheInFlight;
  }

  settingsCacheInFlight = getSettingsUncached()
    .then((data) => {
      settingsCache = { data, fetchedAt: Date.now() };
      return data;
    })
    .finally(() => {
      settingsCacheInFlight = null;
    });

  return settingsCacheInFlight;
}

/**
 * Guarda settings (parcial — solo actualiza las llaves que le pases).
 * Invalida el caché de inmediato para que la siguiente carga del dashboard
 * ya vea el cambio, sin esperar los 2 minutos del TTL.
 */
export async function saveSettings(partial: Partial<AppSettings>): Promise<{ ok: boolean; error?: string }> {
  const sheet = await getSheet();
  if (!sheet) {
    return { ok: false, error: 'Faltan variables de entorno de Google, o no se pudo crear/leer la pestaña Settings.' };
  }

  try {
    const rows = await sheet.getRows();

    for (const [key, value] of Object.entries(partial)) {
      const existingRow = rows.find((r) => r.get('Key') === key);
      if (existingRow) {
        existingRow.set('Value', String(value));
        await existingRow.save();
      } else {
        await sheet.addRow({ Key: key, Value: String(value) });
      }
    }

    settingsCache = null; // fuerza a releer en la siguiente llamada
    return { ok: true };
  } catch (err) {
    console.error('[settingsStorage] Error al guardar Settings:', err);
    return { ok: false, error: 'Error al guardar en Google Sheets — revisa los logs del servidor.' };
  }
}
