import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Mail, MapPin, Phone } from 'lucide-react';
import { api, type Participacion } from '../api';
import { date, money } from '../lib/format';
import { MOTIVO_LABEL, type Tone } from '../lib/labels';
import { Alert, Badge, Card, CardBody, CardHeader, Spinner } from '../components/ui';

const RESULTADO_LABEL: Record<Participacion['resultado'], { label: string; tone: Tone }> = {
  pendiente: { label: 'Pendiente', tone: 'slate' },
  valida: { label: 'Válida', tone: 'blue' },
  descartada: { label: 'Descartada', tone: 'red' },
  adjudicada: { label: 'Adjudicada', tone: 'green' },
};

export function SupplierDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  const { data: prov, isLoading, error } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.suppliers.get(id),
    enabled: !!id,
  });

  if (isLoading) return <Spinner label="Cargando ficha del proveedor..." className="py-20" />;

  if (error || !prov) {
    return (
      <div className="space-y-4">
        <Link to="/proveedores" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Volver al directorio
        </Link>
        <Alert tone="error">
          {error instanceof Error ? error.message : 'Proveedor no encontrado'}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/proveedores"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Directorio de proveedores
      </Link>

      {prov.alerta && (
        <Alert tone="error" title="Alerta de antecedentes">
          {prov.motivo_alerta || 'Este proveedor presenta descartes previos por irregularidades o incumplimiento.'}
        </Alert>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-900">{prov.nombre}</h1>
              {prov.alerta ? (
                <Badge tone="red">Con alerta</Badge>
              ) : (
                <Badge tone="green">Sin alertas</Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600">
              <span>RIF: <strong className="font-mono text-slate-800">{prov.rif ?? 'No registrado'}</strong></span>
              {prov.ubicacion && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4 text-slate-400" />
                  {prov.ubicacion}
                </span>
              )}
              {prov.telefono && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {prov.telefono}
                </span>
              )}
              {prov.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {prov.email}
                </span>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-4 py-2 text-right ring-1 ring-slate-200">
            <p className="text-xs uppercase tracking-wide text-slate-500">Participaciones</p>
            <p className="text-xl font-bold tabular-nums text-slate-900">{prov.total_participaciones}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Historial de participaciones" />
        <CardBody className="p-0">
          {prov.participaciones.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">Sin participaciones registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Propuesta</th>
                    <th>Fecha</th>
                    <th className="text-center">Posición</th>
                    <th className="text-right">Costo ajustado USD</th>
                    <th>Resultado</th>
                    <th>Motivos de descarte</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {prov.participaciones.map((part, idx) => {
                    const res = RESULTADO_LABEL[part.resultado];
                    return (
                      <tr key={`${part.proyecto_id}-${idx}`}>
                        <td>
                          <Link
                            to={`/proyectos/${part.proyecto_id}`}
                            className="font-medium text-indigo-600 hover:underline"
                          >
                            {part.proyecto_nombre}
                          </Link>
                        </td>
                        <td className="font-mono text-xs text-slate-600">{part.propuesta_codigo}</td>
                        <td className="text-xs text-slate-500">{date(part.fecha)}</td>
                        <td className="text-center tabular-nums">
                          {part.posicion != null ? `#${part.posicion}` : '—'}
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {money(part.total_ajustado_usd)}
                        </td>
                        <td>
                          <Badge tone={res.tone}>{res.label}</Badge>
                        </td>
                        <td>
                          {part.motivos_descarte.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {part.motivos_descarte.map((m) => (
                                <Badge key={m} tone="amber">
                                  {MOTIVO_LABEL[m]}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
