import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const password = process.env.PANEL_PASSWORD;
  if (!password) {
    return NextResponse.json({ error: 'PANEL_PASSWORD no está configurado en el servidor.' }, { status: 500 });
  }

  // Usuario compartido opcional: si PANEL_USER está definido, además de la
  // contraseña hay que enviar el usuario correcto. Si no está definido, se
  // mantiene el comportamiento anterior (solo contraseña).
  const expectedUser = process.env.PANEL_USER;

  const body = await req.json().catch(() => ({}));
  const submitted: string | undefined = body?.password;
  const submittedUser: string | undefined = body?.user;

  if (expectedUser && submittedUser?.trim() !== expectedUser) {
    return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  }

  if (submitted !== password) {
    return NextResponse.json({ error: expectedUser ? 'Usuario o contraseña incorrectos.' : 'Contraseña incorrecta.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('panel_auth', password, {
    httpOnly: true,
    // 'Secure' solo debe ir en producción (HTTPS) — en localhost (http) el
    // navegador puede rechazar guardar la cookie si va marcada Secure, lo
    // que hace que el login "funcione" pero nunca te deje pasar.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 días
  });
  return res;
}