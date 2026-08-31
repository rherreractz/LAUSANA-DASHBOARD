import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings, type AppSettings } from '@/lib/settingsStorage';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

const VALID_KEYS: (keyof AppSettings)[] = ['displayName', 'primaryColor', 'activeSource', 'metaPageId'];
const VALID_SOURCES = ['hubspot', 'ghl'];

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

  const result = await saveSettings(partial);
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
