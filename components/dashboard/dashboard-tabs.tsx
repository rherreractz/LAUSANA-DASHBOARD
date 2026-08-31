'use client';

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardShell } from './dashboard-shell';
import { MetaAuditPanel } from './meta-audit-panel';
import { MetaCampaignPanel } from './meta-campaign-panel';
import { SettingsPanel } from './settings-panel';
import type { LeadQualityHistoryChartPoint } from '@/lib/leadUtils';
import type { ProcessedLead } from '@/lib/types';
import type { AppSettings } from '@/lib/settingsStorage';

export function DashboardTabs({
  leads,
  initialHubspotLimit,
  leadQualityHistory,
  settings,
  effectiveMetaPageId,
}: {
  leads: ProcessedLead[];
  initialHubspotLimit: number;
  leadQualityHistory: { data: LeadQualityHistoryChartPoint[]; fuentes: string[] };
  settings: AppSettings;
  effectiveMetaPageId: string;
}) {
  // Controlado (en vez de solo defaultValue) para que el botón de engranaje
  // pueda cambiar a la vista de Ajustes sin que "Ajustes" sea una pestaña
  // más dentro de la misma fila que Leads/Auditoría/Generar Campaña — vive
  // separado, a propósito, para no competir visualmente con las 3
  // pestañas principales del día a día.
  const [activeView, setActiveView] = useState('leads');

  return (
    <Tabs value={activeView} onValueChange={(v) => setActiveView(v as string)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
        <TabsList variant="line" className="h-10 gap-1 p-0">
          <TabsTrigger value="leads" className="rounded-md px-3 text-sm text-muted-foreground data-active:text-foreground">
            Leads
          </TabsTrigger>
          <TabsTrigger value="meta-ads" className="rounded-md px-3 text-sm text-muted-foreground data-active:text-foreground">
            Auditoría Meta Ads
          </TabsTrigger>
          <TabsTrigger value="meta-campaign" className="rounded-md px-3 text-sm text-muted-foreground data-active:text-foreground">
            Generar Campaña
          </TabsTrigger>
        </TabsList>

        {/* Separado a propósito de las 3 pestañas de arriba — un divisor
            vertical + el botón de engranaje solo, como en HubSpot/apps
            similares donde Ajustes no compite con la navegación principal. */}
        <button
          type="button"
          onClick={() => setActiveView('settings')}
          aria-label="Ajustes"
          title="Ajustes"
          className={`ml-3 flex h-8 w-8 items-center justify-center rounded-md border-l border-border pl-3 text-muted-foreground hover:text-foreground ${
            activeView === 'settings' ? 'text-foreground' : ''
          }`}
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* La pestaña de Leads mantiene su layout original (tabla + gráficas). */}
      <TabsContent value="leads" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardShell leads={leads} initialHubspotLimit={initialHubspotLimit} leadQualityHistory={leadQualityHistory} />
      </TabsContent>

      <TabsContent value="meta-ads" className="min-h-0 flex-1 overflow-auto">
        <MetaAuditPanel />
      </TabsContent>

      <TabsContent value="meta-campaign" className="min-h-0 flex-1 overflow-auto">
        <MetaCampaignPanel defaultPageId={effectiveMetaPageId} />
      </TabsContent>

      <TabsContent value="settings" className="min-h-0 flex-1 overflow-hidden">
        <SettingsPanel initialSettings={settings} />
      </TabsContent>
    </Tabs>
  );
}