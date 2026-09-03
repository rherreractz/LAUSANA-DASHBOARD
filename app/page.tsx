import { loadDashboardData } from '@/lib/dashboardData';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';
import { Logo } from '@/components/dashboard/logo';
import type { CSSProperties } from 'react';

// Render dinámico siempre: la página vive detrás de login y lee el CRM en
// vivo. `revalidate` entra en conflicto con los fetch `cache: 'no-store'` de
// lib/hubspot.ts (DYNAMIC_SERVER_USAGE en build). El rate-limit hacia HubSpot
// ya lo cubre el caché en memoria de 3 min de lib/hubspot.ts.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Server Component -> las credenciales nunca se envían al cliente. La
  // fuente de leads (HubSpot/GHL) se decide en vivo por settings.activeSource
  // (ver lib/dashboardData.ts) — ya no está fija en el código.
  const { leads, hubspotLimit, leadQualityHistoryChart, settings } = await loadDashboardData('page');

  const lastUpdated = new Date().toLocaleString('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  // El Page ID de Meta puede venir de Ajustes (settings.metaPageId) o, si
  // nunca se tocó ese ajuste, del valor fijo del servidor. Se resuelve acá
  // (server-side) y se pasa como prop — así el override desde Ajustes SÍ
  // toma efecto en vivo, sin rebuild (a diferencia de leer
  // process.env.NEXT_PUBLIC_* directo en un componente de cliente, que
  // queda fijo desde que se compiló el proyecto).
  const effectiveMetaPageId = settings.metaPageId || process.env.NEXT_PUBLIC_META_PAGE_ID || '';

  const displayName = settings.displayName || 'Lausana';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground" style={settings.primaryColor ? ({ '--brand-color': settings.primaryColor } as CSSProperties) : undefined}>
      <header className="flex shrink-0 flex-col justify-between gap-1 border-b border-border px-6 py-4 sm:flex-row sm:items-end">
        <div className="flex items-center gap-3">
          <Logo src={settings.logoDataUri} alt={displayName} background={settings.logoBackground} className="h-9 shrink-0" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground" style={settings.primaryColor ? { color: settings.primaryColor } : undefined}>
              {displayName}
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Panel de Reportes</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-muted-foreground">Última actualización: {lastUpdated}</p>
        </div>
      </header>

      <DashboardTabs
        leads={leads}
        initialHubspotLimit={hubspotLimit}
        leadQualityHistory={leadQualityHistoryChart}
        settings={settings}
        effectiveMetaPageId={effectiveMetaPageId}
      />
    </div>
  );
}
