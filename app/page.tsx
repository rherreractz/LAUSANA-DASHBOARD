import { loadDashboardData } from '@/lib/dashboardData';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';

// Revalida la página cada 60s (coordinado con el caché de página de Next).
export const revalidate = 60;

export default async function DashboardPage() {
  // Server Component -> las credenciales de HubSpot nunca se envían al
  // cliente. Lausana usa HubSpot como fuente ÚNICA de leads (a diferencia
  // del panel anterior: no hay Google Sheet fuente ni GoHighLevel).
  const { leads, hubspotLimit, leadQualityHistoryChart } = await loadDashboardData('page');

  const lastUpdated = new Date().toLocaleString('es-MX', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-col justify-between gap-1 border-b border-zinc-800 px-6 py-4 sm:flex-row sm:items-end">
        <div>
          {/* TODO: confirmar nombre/branding exacto del cliente. */}
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Lausana</p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Panel de Reportes</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-zinc-500">Última actualización: {lastUpdated}</p>
        </div>
      </header>

      <DashboardTabs leads={leads} initialHubspotLimit={hubspotLimit} leadQualityHistory={leadQualityHistoryChart} />
    </div>
  );
}
