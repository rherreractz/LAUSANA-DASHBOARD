import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatLeadDate, classifyGhlStageNumber } from '@/lib/leadUtils';
import type { ProcessedLead } from '@/lib/types';

/**
 * Nombres completos de las abreviaturas de Fuente, solo para mostrar — el
 * valor real (usado para elegir el color en fuentePillClassName) sigue
 * siendo el original ('fb', 'ig', 'an'), no se toca.
 *
 * 'an' = Audience Network (la red de apps/sitios externos donde Meta
 * también coloca anuncios, junto a Facebook e Instagram) — si no es
 * correcto, avisa y se corrige.
 */
const FUENTE_FULL_NAME: Record<string, string> = {
  fb: 'Facebook',
  ig: 'Instagram',
  an: 'Audience Network',
};

function fuenteDisplayName(fuente: string): string {
  return FUENTE_FULL_NAME[fuente.toLowerCase()] ?? fuente;
}

/** Clases del badge de "Estado GHL" — SOLO por el número de la etapa de GHL, gris si no hay dato real (nunca cae al color de la Etapa de HubSpot/Sheet, para no confundir). */
function ghlPillClassName(estadoGHL?: string): string {
  const color = estadoGHL ? classifyGhlStageNumber(estadoGHL) : null;
  if (color === 'Verde') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (color === 'Amarillo') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
  if (color === 'Rojo') return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400';
  return 'border-border bg-transparent text-muted-foreground';
}

/**
 * Colorea cualquier texto de estado/etapa como píldora, según palabras
 * clave. No asume un set cerrado de valores (el equipo puede cambiar las
 * opciones en HubSpot en cualquier momento) — por eso funciona por
 * coincidencia de palabras en vez de una lista fija de valores exactos.
 *
 * Rojo    -> perdido, rechazado, no califica, descartado
 * Verde   -> atendido, terminado, cerrado (ganado), conectado, calificado
 * Naranja -> en espera, en proceso, intento, seguimiento
 * Amarillo-> nuevo, sin contactar, primer contacto
 * Gris    -> cualquier otro valor (fallback neutro)
 */
function statusPillClassName(value?: string): string {
  const v = (value || '').toLowerCase();

  if (v.includes('perdid') || v.includes('rechaz') || v.includes('no califica') || v.includes('descartad')) {
    return 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400';
  }
  if (
    v.includes('atendid') ||
    v.includes('terminad') ||
    v.includes('cerrad') ||
    v.includes('conectad') ||
    v.includes('calific') ||
    v.includes('ganad')
  ) {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  }
  if (v.includes('espera') || v.includes('proceso') || v.includes('intento') || v.includes('seguimiento')) {
    return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400';
  }
  if (v.includes('nuevo') || v.includes('sin contact') || v.includes('primer contacto')) {
    return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
  }

  return 'border-border bg-transparent text-muted-foreground';
}

/**
 * Colorea la píldora de "Fuente" según el canal de origen. Usa
 * coincidencia por texto (no exacta) para tolerar mayúsculas/minúsculas.
 */
function fuentePillClassName(fuente?: string): string {
  const v = (fuente || '').toLowerCase();

  if (v === 'fb' || v.includes('facebook')) {
    return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400';
  }
  if (v === 'an') {
    return 'border-lime-400/30 bg-lime-400/10 text-lime-700 dark:text-lime-300';
  }
  if (v === 'ig' || v.includes('instagram')) {
    return 'border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-400';
  }
  if (v.includes('whatsapp') || v === 'wp') {
    return 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400';
  }
  if (v === 'hubspot') {
    return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400';
  }

  return 'border-border bg-transparent text-muted-foreground';
}

function isToday(date: Date | null) {
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function LeadsTable({ leads }: { leads: ProcessedLead[] }) {
  if (leads.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No hay leads que coincidan con los filtros.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground">FECHA</TableHead>
            <TableHead className="text-muted-foreground">NOMBRE</TableHead>
            <TableHead className="text-muted-foreground">ESTADO</TableHead>
            <TableHead className="text-muted-foreground">ESTADO GHL</TableHead>
            <TableHead className="text-muted-foreground">PERSONA ENCARGADA</TableHead>
            <TableHead className="text-muted-foreground">FUENTE</TableHead>
            <TableHead className="text-muted-foreground">CONTACTO</TableHead>
            <TableHead className="text-muted-foreground">CAMPAÑA</TableHead>
            <TableHead className="text-muted-foreground">EQUIPO ENCARGADO</TableHead>
            <TableHead className="text-muted-foreground">PROVEEDOR</TableHead>
            <TableHead className="text-muted-foreground">PRESUPUESTO</TableHead>
            <TableHead className="text-muted-foreground">MOTIVO</TableHead>
            <TableHead className="text-muted-foreground">COMENTARIOS</TableHead>
            <TableHead className="text-right text-muted-foreground">STATUS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => {
            // "Etapa" ahora muestra la etapa de HubSpot (etapaLeadCrm) si
            // existe; si no hay match en HubSpot, usa la Etapa cruda del
            // Sheet como respaldo.
            const etapaDisplay =
              lead.etapaLeadCrm && lead.etapaLeadCrm !== 'Sin dato' ? lead.etapaLeadCrm : lead.Etapa;

            return (
              <TableRow key={lead.id} className="border-border hover:bg-muted">
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatLeadDate(lead.parsedDate)}</TableCell>
                <TableCell className="max-w-[160px] truncate font-medium text-foreground" title={lead.Nombre || undefined}>
                  {lead.Nombre || 'Sin nombre'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {etapaDisplay ? (
                    <Badge variant="outline" className={statusPillClassName(etapaDisplay)}>
                      {etapaDisplay}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {lead.estadoGHL ? (
                    <Badge variant="outline" className={ghlPillClassName(lead.estadoGHL)}>
                      {lead.estadoGHL}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {(() => {
                    // HubSpot primero; si no hay dato ahí, cae a GHL — un
                    // lead no debería tener dueño en los dos CRMs a la vez,
                    // así que uno de los dos casi siempre va a estar vacío.
                    if (lead.propietarioCrm && lead.propietarioCrm !== 'Sin asignar') return lead.propietarioCrm;
                    if (lead.personaEncargadaGHL && lead.personaEncargadaGHL !== 'Sin asignar') return lead.personaEncargadaGHL;
                    return '—';
                  })()}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {lead.Fuente ? (
                    <Badge variant="outline" className={fuentePillClassName(lead.Fuente)}>
                      {fuenteDisplayName(lead.Fuente)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="flex flex-col">
                    <span>{lead.Correo || '—'}</span>
                    <span className="text-xs">{lead.Telefono || '—'}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{lead.Campana || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{lead.Equipo || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{lead.Proveedor || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{lead.presupuestoClean}</TableCell>
                <TableCell className="text-muted-foreground">{lead.motivoClean}</TableCell>
                <TableCell className="max-w-[200px] truncate text-muted-foreground" title={lead.Comentarios || undefined}>
                  {lead.Comentarios || '—'}
                </TableCell>
                <TableCell className="text-right">
                  {lead.status === 'Duplicado' ? (
                    <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-400">
                      Duplicado
                    </Badge>
                  ) : isToday(lead.parsedDate) ? (
                    <Badge className="border-transparent bg-[#53958B] text-zinc-950 hover:bg-[#53958B]">
                      Nuevo
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-border font-normal text-muted-foreground">
                      Válido
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}