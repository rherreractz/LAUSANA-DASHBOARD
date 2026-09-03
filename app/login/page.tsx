import { getSettings } from '@/lib/settingsStorage';
import { LoginFormBoundary } from './login-form';

// Render dinámico: lee el logo/nombre desde la pestaña Settings del Sheet en
// vivo (con caché de 2 min en lib/settingsStorage.ts). No debe prerenderizarse
// en build — ahí todavía no hay credenciales ni tiene sentido llamar a Google.
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // getSettings() nunca lanza: si el Sheet falla, devuelve los valores por
  // defecto (sin logo, nombre vacío) — el login sigue funcionando igual.
  const settings = await getSettings();

  // El campo de usuario solo se pide si el servidor tiene PANEL_USER
  // configurado (ver app/api/login/route.ts). Así, si nadie lo definió, el
  // login se comporta como antes (solo contraseña) y no bloquea a nadie.
  const requireUser = Boolean(process.env.PANEL_USER);

  return (
    <LoginFormBoundary
      displayName={settings.displayName}
      logoDataUri={settings.logoDataUri}
      logoBackground={settings.logoBackground}
      requireUser={requireUser}
    />
  );
}
