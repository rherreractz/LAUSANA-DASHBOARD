/**
 * Último paso para completar el anuncio: sube la imagen a la galería de
 * Meta, crea el "ad creative" (el diseño: imagen + copy + botón) y crea el
 * Ad final dentro del Ad Set que ya existe — SIEMPRE en PAUSED, igual que
 * el resto del flujo.
 *
 * No usamos ningún storage propio: la imagen se manda directo desde el
 * navegador a esta ruta, y de aquí se reenvía a Meta en el mismo request
 * (no se guarda en disco en ningún punto).
 */

const GRAPH_BASE = 'https://graph.facebook.com';

/**
 * TypeScript trata Buffer.buffer como ArrayBufferLike (podría en teoría
 * ser un SharedArrayBuffer), pero el constructor de Blob exige
 * ArrayBuffer específicamente. En la práctica, un Buffer de Node siempre
 * está respaldado por un ArrayBuffer real — esta función solo satisface
 * al type-checker sin cambiar nada en tiempo de ejecución.
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const backing = buffer.buffer as ArrayBuffer;
  // `Buffer.from(arrayBuffer)` (lo que usa la descarga de Drive) crea una
  // vista SIN copiar: en ese caso la vista cubre todo el ArrayBuffer y se
  // puede devolver tal cual, sin duplicar en memoria — importante con
  // videos de ~170 MB en un servidor con poca RAM. Solo se copia cuando el
  // Buffer es un trozo de un pool compartido más grande.
  if (buffer.byteOffset === 0 && buffer.byteLength === backing.byteLength) {
    return backing;
  }
  return backing.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/**
 * Mapa de textos de botón en español (los que genera Claude) a los
 * valores exactos que acepta la API de Meta (catálogo cerrado, en
 * inglés). Si el texto generado no hace match con nada de la lista, se
 * usa LEARN_MORE por default.
 */
const CTA_MAP: Record<string, string> = {
  'más información': 'LEARN_MORE',
  'saber más': 'LEARN_MORE',
  'contáctanos': 'CONTACT_US',
  contactanos: 'CONTACT_US',
  'solicitar cotización': 'GET_QUOTE',
  'solicitar cotizacion': 'GET_QUOTE',
  cotizar: 'GET_QUOTE',
  registrarse: 'SIGN_UP',
  suscribirse: 'SUBSCRIBE',
  'comprar ahora': 'SHOP_NOW',
  'ver más': 'LEARN_MORE',
  'agendar cita': 'BOOK_TRAVEL',
  'enviar mensaje': 'MESSAGE_PAGE',
  whatsapp: 'WHATSAPP_MESSAGE',
  'descargar': 'DOWNLOAD',
  'aplicar ahora': 'APPLY_NOW',
};

export function mapCtaToMetaEnum(ctaText: string): string {
  const normalized = ctaText.trim().toLowerCase();
  return CTA_MAP[normalized] || 'LEARN_MORE';
}

interface GraphError {
  _error: { status: number; message: string; body: unknown };
}

function isGraphError(value: unknown): value is GraphError {
  return !!value && typeof value === 'object' && '_error' in (value as object);
}

/**
 * Lee el body de una respuesta de fetch como JSON, sin tronar con un error
 * genérico ("Unexpected end of JSON input") si Meta devuelve algo vacío o
 * cortado a medias (pasa por hipos de red, timeouts del lado de Meta, o
 * rate limiting que corta la respuesta). En vez de eso, devuelve un objeto
 * con el status y el texto crudo, para poder armar un mensaje de error que
 * sí diga algo útil.
 */
async function safeParseJson(res: Response): Promise<any> {
  const raw = await res.text();
  if (!raw) {
    return { __parseError: true, __status: res.status, __raw: '' };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { __parseError: true, __status: res.status, __raw: raw.slice(0, 500) };
  }
}

function graphErrorFromParsed(path: string, res: Response, data: any): GraphError {
  if (data?.__parseError) {
    console.error(`[metaCreative] POST ${path} devolvió una respuesta no-JSON (status ${data.__status}):`, data.__raw);
    const message = data.__raw
      ? `Meta devolvió una respuesta inesperada (no-JSON, HTTP ${data.__status}): ${data.__raw}`
      : data.__status === 413
        ? `Meta rechazó el archivo por tamaño (HTTP 413) — es demasiado grande para subirse en un solo request. Los videos grandes deben ir por partes.`
        : `Meta devolvió una respuesta vacía (HTTP ${data.__status}) — probablemente un hipo de red o timeout, intenta de nuevo.`;
    return { _error: { status: data.__status, message, body: data.__raw } };
  }
  const err = data?.error ?? {};
  const detailedMessage = [err.error_user_title, err.error_user_msg, err.message, err.error_subcode ? `(subcode ${err.error_subcode})` : null]
    .filter(Boolean)
    .join(' — ');
  console.error(`[metaCreative] POST ${path} falló:`, JSON.stringify(data, null, 2));
  return { _error: { status: res.status, message: detailedMessage || `HTTP ${res.status}`, body: data } };
}

async function graphPostForm(path: string, form: FormData, token: string, apiVersion: string): Promise<any> {
  const url = `${GRAPH_BASE}/${apiVersion}/${path.replace(/^\//, '')}`;
  form.set('access_token', token);

  const res = await fetch(url, { method: 'POST', body: form });
  const data = await safeParseJson(res);

  if (!res.ok || data?.__parseError) {
    return graphErrorFromParsed(path, res, data) satisfies GraphError;
  }

  return data;
}

async function graphPostJSON(path: string, params: Record<string, unknown>, token: string, apiVersion: string): Promise<any> {
  const url = `${GRAPH_BASE}/${apiVersion}/${path.replace(/^\//, '')}`;
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  });
  body.set('access_token', token);

  const res = await fetch(url, { method: 'POST', body });
  const data = await safeParseJson(res);

  if (!res.ok || data?.__parseError) {
    return graphErrorFromParsed(path, res, data) satisfies GraphError;
  }

  return data;
}

export type ImageSource =
  | { kind: 'file'; file: File }
  | { kind: 'buffer'; buffer: Buffer; filename: string; mimeType: string };

export interface CreateAdInput {
  accountId: string;
  token: string;
  adSetId: string;
  pageId: string;
  image: ImageSource;
  headline: string;
  primaryText: string;
  destinationLink: string;
  ctaText: string; // texto libre en español (de la variante generada) o la selección del usuario
  adName: string;
  /**
   * Si se da, el anuncio abre el Instant Form de Meta en vez de mandar a
   * destinationLink (típico para objetivo "leads"). destinationLink igual
   * se manda como respaldo/fallback en algunos placements.
   */
  leadFormId?: string;
}

export interface CreateAdResult {
  adId: string;
  creativeId: string;
  adsManagerUrl: string;
}

function buildLinkData(input: {
  headline: string;
  primaryText: string;
  destinationLink: string;
  ctaText: string;
  leadFormId?: string;
  imageHash?: string;
  videoId?: string;
}) {
  const ctaType = input.leadFormId ? 'SIGN_UP' : mapCtaToMetaEnum(input.ctaText);
  const ctaValue: Record<string, unknown> = input.leadFormId
    ? { lead_gen_form_id: input.leadFormId }
    : { link: input.destinationLink };

  return {
    message: input.primaryText,
    link: input.destinationLink,
    name: input.headline,
    ...(input.imageHash ? { image_hash: input.imageHash } : {}),
    call_to_action: { type: ctaType, value: ctaValue },
  };
}

export async function createPausedAdWithImage(input: CreateAdInput): Promise<CreateAdResult> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';

  // 1. Subir la imagen a la galería de anuncios de la cuenta.
  const imageForm = new FormData();
  if (input.image.kind === 'file') {
    imageForm.set('source', input.image.file, input.image.file.name);
  } else {
    const blob = new Blob([bufferToArrayBuffer(input.image.buffer)], { type: input.image.mimeType });
    imageForm.set('source', blob, input.image.filename);
  }

  const uploadResult = await graphPostForm(`${input.accountId}/adimages`, imageForm, input.token, apiVersion);
  if (isGraphError(uploadResult)) {
    throw new Error(`No se pudo subir la imagen a Meta: ${uploadResult._error.message}`);
  }

  // La respuesta viene como { images: { "nombre-del-archivo": { hash, url, ... } } }
  const imagesObj = uploadResult.images ?? {};
  const firstImageKey = Object.keys(imagesObj)[0];
  const imageHash: string | undefined = firstImageKey ? imagesObj[firstImageKey]?.hash : undefined;

  if (!imageHash) {
    throw new Error('Meta no devolvió un hash de imagen válido tras la subida.');
  }

  // 2. Crear el ad creative (el diseño del anuncio).
  const creative = await graphPostJSON(
    `${input.accountId}/adcreatives`,
    {
      name: `${input.adName} — creativo`,
      object_story_spec: {
        page_id: input.pageId,
        link_data: buildLinkData({ ...input, imageHash }),
      },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(creative)) {
    throw new Error(`No se pudo crear el creativo: ${creative._error.message}`);
  }

  const creativeId: string = creative.id;

  // 3. Crear el Ad final, PAUSED.
  const ad = await graphPostJSON(
    `${input.accountId}/ads`,
    {
      name: input.adName,
      adset_id: input.adSetId,
      status: 'PAUSED',
      creative: { creative_id: creativeId },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(ad)) {
    throw new Error(`El creativo se creó, pero no se pudo crear el anuncio: ${ad._error.message}`);
  }

  return {
    adId: ad.id,
    creativeId,
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${input.accountId.replace('act_', '')}&selected_ad_ids=${ad.id}`,
  };
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

export type VideoSource =
  | { kind: 'file'; file: File }
  | { kind: 'buffer'; buffer: Buffer; filename: string; mimeType: string };

export interface CreateVideoAdInput {
  accountId: string;
  token: string;
  adSetId: string;
  pageId: string;
  video: VideoSource;
  headline: string;
  primaryText: string;
  destinationLink: string;
  ctaText: string;
  adName: string;
  leadFormId?: string;
  /** Cuánto esperar máximo (ms) a que Meta termine de procesar el video antes de rendirse. Default 45s. */
  maxWaitMs?: number;
}

/**
 * `/advideos` devuelve HTTP 413 si un video "grande" se manda entero en un
 * solo POST multipart. El umbral real depende del borde de la API de Meta
 * (no está documentado con precisión), así que cualquier cosa por encima
 * de este tamaño se sube por partes con el protocolo start/transfer/finish.
 * Los videos chicos siguen yendo en un solo request, que es más rápido.
 */
const VIDEO_SINGLE_SHOT_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB

async function videoSourceToBytes(
  source: VideoSource,
): Promise<{ bytes: ArrayBuffer; filename: string; mimeType: string }> {
  if (source.kind === 'file') {
    return {
      bytes: await source.file.arrayBuffer(),
      filename: source.file.name || 'video.mp4',
      mimeType: source.file.type || 'video/mp4',
    };
  }
  return {
    bytes: bufferToArrayBuffer(source.buffer),
    filename: source.filename || 'video.mp4',
    mimeType: source.mimeType || 'video/mp4',
  };
}

/**
 * Sube un video al Ad Account y devuelve su video_id. Para archivos por
 * debajo de VIDEO_SINGLE_SHOT_MAX_BYTES hace un POST directo; para los
 * grandes usa el protocolo por partes de Meta (upload_phase
 * start/transfer/finish), que es el que evita el HTTP 413 que devuelve
 * /advideos cuando el archivo entero va en un solo request.
 */
async function uploadAdVideo(
  accountId: string,
  source: VideoSource,
  token: string,
  apiVersion: string,
): Promise<string> {
  const { bytes, filename, mimeType } = await videoSourceToBytes(source);
  const path = `${accountId}/advideos`;

  // --- Camino simple: archivo chico, un solo POST ---
  if (bytes.byteLength <= VIDEO_SINGLE_SHOT_MAX_BYTES) {
    const form = new FormData();
    form.set('source', new Blob([bytes], { type: mimeType }), filename);
    const res = await graphPostForm(path, form, token, apiVersion);
    if (isGraphError(res)) {
      throw new Error(`No se pudo subir el video a Meta: ${res._error.message}`);
    }
    if (!res.id) throw new Error('Meta no devolvió un ID de video tras la subida.');
    return String(res.id);
  }

  // --- Camino por partes: archivo grande ---
  // 1. start — Meta responde con la sesión y el primer rango de bytes a mandar.
  const startForm = new FormData();
  startForm.set('upload_phase', 'start');
  startForm.set('file_size', String(bytes.byteLength));
  const start = await graphPostForm(path, startForm, token, apiVersion);
  if (isGraphError(start)) {
    throw new Error(`No se pudo iniciar la subida por partes del video: ${start._error.message}`);
  }

  const uploadSessionId: string | undefined = start.upload_session_id;
  const startedVideoId: string | undefined = start.video_id;
  if (!uploadSessionId || !startedVideoId) {
    throw new Error('Meta no devolvió upload_session_id / video_id al iniciar la subida por partes.');
  }

  let startOffset = Number(start.start_offset ?? 0);
  let endOffset = Number(start.end_offset ?? 0);

  // 2. transfer — se manda el trozo del rango que Meta pide; su respuesta
  //    trae el siguiente rango. Termina cuando start alcanza a end.
  while (startOffset < endOffset) {
    const chunk = bytes.slice(startOffset, endOffset);
    const transferForm = new FormData();
    transferForm.set('upload_phase', 'transfer');
    transferForm.set('upload_session_id', uploadSessionId);
    transferForm.set('start_offset', String(startOffset));
    transferForm.set('video_file_chunk', new Blob([chunk], { type: mimeType }), filename);

    const transfer = await graphPostForm(path, transferForm, token, apiVersion);
    if (isGraphError(transfer)) {
      throw new Error(
        `Falló la subida por partes del video en el byte ${startOffset}/${bytes.byteLength}: ${transfer._error.message}`,
      );
    }

    const nextStart = Number(transfer.start_offset);
    const nextEnd = Number(transfer.end_offset);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd) || nextStart <= startOffset) {
      throw new Error('Meta no avanzó el offset durante la subida por partes del video — se aborta para no quedar en bucle infinito.');
    }
    startOffset = nextStart;
    endOffset = nextEnd;
  }

  // 3. finish — cierra la sesión; a partir de aquí Meta procesa el video.
  const finishForm = new FormData();
  finishForm.set('upload_phase', 'finish');
  finishForm.set('upload_session_id', uploadSessionId);
  const finish = await graphPostForm(path, finishForm, token, apiVersion);
  if (isGraphError(finish)) {
    throw new Error(`No se pudo finalizar la subida por partes del video: ${finish._error.message}`);
  }

  return String(startedVideoId);
}

/**
 * Sube el video, espera a que Meta lo termine de procesar (es asíncrono —
 * puede tardar de segundos a un par de minutos según duración/peso), y
 * arma el Ad final. Si no termina de procesar dentro de maxWaitMs, avisa
 * con un error claro en vez de fallar en silencio — el video sigue
 * procesándose del lado de Meta aunque nuestra función se rinda, así que
 * reintentar más tarde con el mismo video_id (no implementado todavía,
 * ver nota abajo) funcionaría.
 */
export async function createPausedAdWithVideo(input: CreateVideoAdInput): Promise<CreateAdResult> {
  const apiVersion = process.env.META_API_VERSION || 'v22.0';
  const maxWaitMs = input.maxWaitMs ?? 45000;

  // 1. Subir el video (por partes si supera VIDEO_SINGLE_SHOT_MAX_BYTES —
  //    /advideos devuelve 413 si un archivo grande va entero en un POST).
  const videoId = await uploadAdVideo(input.accountId, input.video, input.token, apiVersion);

  // 2. Esperar a que termine de procesar (polling).
  const start = Date.now();
  let thumbnailUrl: string | undefined;
  let ready = false;

  while (Date.now() - start < maxWaitMs) {
    const statusUrl = `${GRAPH_BASE}/${apiVersion}/${videoId}?fields=status,thumbnails&access_token=${input.token}`;
    const res = await fetch(statusUrl);
    const data = await safeParseJson(res);

    if (data?.__parseError) {
      // Un hipo de red al consultar el estado no significa que el video
      // haya fallado — solo lo salta y reintenta en el siguiente ciclo del
      // polling, en vez de tronar toda la generación de campaña por esto.
      console.error(`[metaCreative] Estado del video ${videoId}: respuesta no-JSON, se reintenta en el siguiente ciclo.`, data.__raw);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }

    const videoStatus = data?.status?.video_status;
    if (videoStatus === 'ready') {
      ready = true;
      thumbnailUrl = data?.thumbnails?.data?.[0]?.uri;
      break;
    }
    if (videoStatus === 'error') {
      throw new Error('Meta reportó un error al procesar el video (formato/tamaño no soportado).');
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (!ready) {
    throw new Error(
      `El video se subió (ID ${videoId}) pero Meta todavía lo está procesando después de ${Math.round(maxWaitMs / 1000)}s. Espera unos minutos y vuelve a intentar crear el anuncio — videos largos/pesados pueden tardar más.`,
    );
  }

  // 3. Crear el ad creative de video.
  const ctaType = input.leadFormId ? 'SIGN_UP' : mapCtaToMetaEnum(input.ctaText);
  const ctaValue: Record<string, unknown> = input.leadFormId
    ? { lead_gen_form_id: input.leadFormId }
    : { link: input.destinationLink };

  const creative = await graphPostJSON(
    `${input.accountId}/adcreatives`,
    {
      name: `${input.adName} — creativo`,
      object_story_spec: {
        page_id: input.pageId,
        video_data: {
          video_id: videoId,
          title: input.headline,
          message: input.primaryText,
          link_description: input.destinationLink,
          call_to_action: { type: ctaType, value: ctaValue },
          ...(thumbnailUrl ? { image_url: thumbnailUrl } : {}),
        },
      },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(creative)) {
    throw new Error(`No se pudo crear el creativo de video: ${creative._error.message}`);
  }

  const creativeId: string = creative.id;

  // 4. Crear el Ad final, PAUSED.
  const ad = await graphPostJSON(
    `${input.accountId}/ads`,
    {
      name: input.adName,
      adset_id: input.adSetId,
      status: 'PAUSED',
      creative: { creative_id: creativeId },
    },
    input.token,
    apiVersion,
  );

  if (isGraphError(ad)) {
    throw new Error(`El creativo de video se creó, pero no se pudo crear el anuncio: ${ad._error.message}`);
  }

  return {
    adId: ad.id,
    creativeId,
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${input.accountId.replace('act_', '')}&selected_ad_ids=${ad.id}`,
  };
}