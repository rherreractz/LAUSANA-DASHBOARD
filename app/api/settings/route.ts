import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings, LOGO_DATA_URI_MAX_LENGTH, type AppSettings } from '@/lib/settingsStorage';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

const VALID_KEYS: (keyof AppSettings)[] = ['displayName', 'primaryColor', 'activeSource', 'metaPageId', 'logoDataUri', 'logoBackground'];
const VALID_SOURCES = ['hubspot', 'ghl'];
const VALID_LOGO_BACKGROUNDS = ['', 'dark'];

export async function POST(req: NextRequest) {
  let body: Partial<AppSettings>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido, se esperaba JSON.' }, { status: 400 });
  }

  // Solo se aceptan las llaves conocidas — nunca se deja guardar nada
  // arbitrario en el Sheet desde este endpoint (defensa básica, aunque el
  // panel de Ajustes ya solo manda estas llaves).
  const partial: Partial<AppSettings> = {};
  for (const key of VALID_KEYS) {
    if (key in body) {
      (partial as any)[key] = body[key];
    }
  }

  if (partial.activeSource && !VALID_SOURCES.includes(partial.activeSource)) {
    return NextResponse.json({ ok: false, error: `activeSource debe ser uno de: ${VALID_SOURCES.join(', ')}.` }, { status: 400 });
  }

  if (typeof partial.logoDataUri === 'string' && partial.logoDataUri !== '') {
    if (!/^data:image\/(png|jpeg|webp|svg\+xml|gif);base64,/.test(partial.logoDataUri)) {
      return NextResponse.json(
        { ok: false, error: 'El logo debe ser una imagen (PNG, JPG, WEBP, SVG o GIF) en formato data URI base64.' },
        { status: 400 },
      );
    }
    if (partial.logoDataUri.length > LOGO_DATA_URI_MAX_LENGTH) {
      return NextResponse.json(
        { ok: false, error: `El logo pesa demasiado para guardarse (máx. ~${Math.round(LOGO_DATA_URI_MAX_LENGTH / 1000)} KB codificado). Sube una imagen más pequeña.` },
        { status: 400 },
      );
    }
  }

  if (partial.logoBackground !== undefined && !VALID_LOGO_BACKGROUNDS.includes(partial.logoBackground)) {
    return NextResponse.json({ ok: false, error: `logoBackground debe ser uno de: ${VALID_LOGO_BACKGROUNDS.map((v) => v || '(vacío)').join(', ')}.` }, { status: 400 });
  }

  const result = await saveSettings(partial);
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
