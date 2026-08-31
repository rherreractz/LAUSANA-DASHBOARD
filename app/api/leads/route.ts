import { NextRequest, NextResponse } from 'next/server';
import { getHubspotStatusMap } from '@/lib/hubspot';
import { getHubspotRawLeads, processLeads, mergeHubspotStatus } from '@/lib/leadUtils';

/**
 * Usado por el botón "Cargar más leads" del dashboard: permite pedir un
 * límite de contactos de HubSpot más alto que el default
 * (?hubspotLimit=500). Lausana usa HubSpot como fuente única (ya no hay
 * Google Sheet fuente que combinar).
 */
export async function GET(request: NextRequest) {
  const hubspotLimitParam = Number(request.nextUrl.searchParams.get('hubspotLimit'));
  const hubspotLimit = Number.isFinite(hubspotLimitParam) && hubspotLimitParam > 0 ? hubspotLimitParam : undefined;

  const hubspotMap = await getHubspotStatusMap(hubspotLimit);
  const rawLeads = getHubspotRawLeads(hubspotMap);
  const leads = mergeHubspotStatus(processLeads(rawLeads), hubspotMap);

  // Si HubSpot devolvió menos contactos que el límite pedido, ya no quedan
  // más por traer (se agotaron los contactos disponibles).
  const hasMore = hubspotMap.all.length >= hubspotMap.limit;

  return NextResponse.json({ leads, hubspotLimit: hubspotMap.limit, hasMore });
}
