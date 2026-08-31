'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AppSettings } from '@/lib/settingsStorage';

type Section = 'general' | 'advanced';

const THEME_OPTIONS: { value: string; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'system', label: 'Sistema' },
];

/**
 * Selector de modo claro / oscuro. Usa el hook `useTheme()` de next-themes —
 * el mismo sistema que alterna el atajo de teclado "D", así que ambos se
 * mantienen sincronizados. `mounted` evita el desajuste de hidratación
 * (en el server `theme` siempre es undefined).
 */
function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? theme ?? 'system' : 'system';

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm text-muted-foreground">Modo claro / oscuro</label>
      <div className="inline-flex w-fit rounded-md border border-border p-0.5">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={`rounded px-3 py-1 text-sm transition-colors ${
              current === opt.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        También puedes alternar con la tecla <kbd className="rounded border border-border px-1">D</kbd> (fuera de un campo de texto).
      </p>
    </div>
  );
}

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'advanced', label: 'Avanzado' },
];

/**
 * Panel de Ajustes, con layout tipo sidebar (menú a la izquierda, contenido
 * a la derecha) — mismo patrón que Stripe/Notion/HubSpot para sus pantallas
 * de configuración. Guarda en la pestaña "Settings" del Sheet de storage
 * (vía /api/settings) — NUNCA maneja tokens/claves de API, esas se quedan
 * en el .env del servidor por seguridad.
 */
export function SettingsPanel({ initialSettings }: { initialSettings: AppSettings }) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [section, setSection] = useState<Section>('general');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : null;

      if (!res.ok || !data?.ok) {
        setError(data?.error || `No se pudo guardar (HTTP ${res.status}).`);
        return;
      }

      setSavedAt(Date.now());
    } catch (err) {
      setError('No se pudo conectar con el servidor. ¿Se actualizó el sitio? Intenta recargar la página (Ctrl+Shift+R).');
      console.error('[settings-panel] Error al guardar:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar de navegación interna de Ajustes */}
      <nav className="w-48 shrink-0 border-r border-border p-3">
        <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Ajustes</p>
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  section === item.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Contenido de la sección seleccionada */}
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-xl flex-col gap-6">
          {section === 'general' && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-foreground">General</h2>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="displayName" className="text-sm text-muted-foreground">
                  Nombre a mostrar
                </label>
                <Input
                  id="displayName"
                  value={settings.displayName}
                  onChange={(e) => setSettings((s) => ({ ...s, displayName: e.target.value }))}
                  placeholder="(usa el nombre por default del proyecto)"
                  className="border-border bg-background text-foreground"
                />
                <p className="text-xs text-muted-foreground">Aparece en el encabezado del panel. Déjalo vacío para usar el nombre por default.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="primaryColor" className="text-sm text-muted-foreground">
                  Color primario
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="Color primario"
                    value={settings.primaryColor || '#53958B'}
                    onChange={(e) => setSettings((s) => ({ ...s, primaryColor: e.target.value }))}
                    className="h-9 w-9 cursor-pointer rounded border border-border bg-background p-0.5"
                  />
                  <Input
                    id="primaryColor"
                    value={settings.primaryColor}
                    onChange={(e) => setSettings((s) => ({ ...s, primaryColor: e.target.value }))}
                    placeholder="(usa el color por default del proyecto)"
                    className="border-border bg-background text-foreground"
                  />
                </div>
              </div>

              <ThemeSwitch />
            </div>
          )}

          {section === 'advanced' && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-foreground">Avanzado</h2>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-foreground">Fuente de leads</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="radio"
                      name="activeSource"
                      checked={settings.activeSource === 'hubspot'}
                      onChange={() => setSettings((s) => ({ ...s, activeSource: 'hubspot' }))}
                    />
                    HubSpot
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="radio"
                      name="activeSource"
                      checked={settings.activeSource === 'ghl'}
                      onChange={() => setSettings((s) => ({ ...s, activeSource: 'ghl' }))}
                    />
                    GoHighLevel
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cambia de dónde se leen los leads en la pestaña "Leads". Solo funciona si ese CRM ya tiene credenciales configuradas en
                  el servidor — si cambias a uno sin configurar, vas a ver el dashboard sin leads y un aviso en los logs del servidor, no
                  un error visible aquí.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="metaPageId" className="text-sm text-muted-foreground">
                  Page ID de Meta
                </label>
                <Input
                  id="metaPageId"
                  value={settings.metaPageId}
                  onChange={(e) => setSettings((s) => ({ ...s, metaPageId: e.target.value }))}
                  placeholder="(usa NEXT_PUBLIC_META_PAGE_ID del servidor)"
                  className="border-border bg-background text-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Precarga este ID en el formulario de "Generar Campaña". Déjalo vacío para usar el que ya está configurado en el
                  servidor.
                </p>
              </div>

              <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                Cualquier tipo de modificacion en esta sección puede afectar la forma en que el panel funciona y se conecta a los CRMs. Solo cambia estos valores si sabes lo que estás haciendo.
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
            {savedAt && <span className="text-sm text-emerald-700 dark:text-emerald-400">✓ Guardado</span>}
            {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Los cambios pueden tardar hasta 2 minutos en reflejarse en el resto del panel (caché interno) — recarga la página después de
            ese tiempo si no los ves de inmediato.
          </p>
        </div>
      </div>
    </div>
  );
}