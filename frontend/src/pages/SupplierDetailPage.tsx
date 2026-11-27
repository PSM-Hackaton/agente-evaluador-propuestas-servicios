import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Mail, MapPin, Pencil, Phone, UserCheck } from 'lucide-react';
import { api, type Participacion, type ProveedorInput } from '../api';
import { SupplierFormModal } from '../components/SupplierFormModal';
import { useAuth } from '../context/AuthContext';
import { date, datetime, money } from '../lib/format';
import { MOTIVO_LABEL, type Tone } from '../lib/labels';
import { can } from '../lib/roles';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Spinner } from '../components/ui';

const RESULTADO_LABEL: Record<Participacion['resultado'], { label: string; tone: Tone }> = {
  pendiente: { label: 'Pendiente', tone: 'slate' },
  valida: { label: 'Válida', tone: 'blue' },
  descartada: { label: 'Descartada', tone: 'red' },
  adjudicada: { label: 'Adjudicada', tone: 'green' },
};

const SEVERIDAD_TONE: Record<string, Tone> = {
  alta: 'red',
  high: 'red',
  media: 'amber',
  medium: 'amber',
  baja: 'slate',
  low: 'slate',
};

export function SupplierDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editarOpen, setEditarOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: prov, isLoading, error } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.suppliers.get(id),
    enabled: !!id,
  });

  const updateMut = useMutation({
    mutationFn: (data: Partial<ProveedorInput>) => api.suppliers.update(id, data),
    onSuccess: async () => {
      setEditarOpen(false);
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['supplier', id] }),
        qc.invalidateQueries({ queryKey: ['suppliers'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'No se pudo actualizar la ficha'),
  });

  const resolveMut = useMutation({
    mutationFn: (alertId: string) => api.suppliers.resolveAlert(alertId),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['supplier', id] }),
        qc.invalidateQueries({ queryKey: ['suppliers'] }),
        qc.invalidateQueries({ queryKey: ['dashboard-stats'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'No se pudo marcar la alerta'),
  });

  const puedeEditar = can(user?.rol, 'proveedor.editar');

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
              {prov.representante && (
                <span className="inline-flex items-center gap-1">
                  <UserCheck className="h-4 w-4 text-slate-400" />
                  Rep.: {prov.representante}
                </span>
              )}
            </div>
            {prov.notas && <p className="text-xs text-slate-500">{prov.notas}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {puedeEditar && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setEditarOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
                Editar ficha
              </Button>
            )}
            <div className="rounded-lg bg-slate-50 px-4 py-2 text-right ring-1 ring-slate-200">
              <p className="text-xs uppercase tracking-wide text-slate-500">Participaciones</p>
              <p className="text-xl font-bold tabular-nums text-slate-900">{prov.total_participaciones}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {actionError && !editarOpen && <Alert tone="error">{actionError}</Alert>}

      <Card>
        <CardHeader
          title={`Alertas de antecedentes (${prov.alertas.length})`}
          subtitle="Observaciones automáticas detectadas durante las evaluaciones de propuestas"
        />
        <CardBody>
          {prov.alertas.length === 0 ? (
            <p className="text-sm text-slate-500">Este proveedor no tiene alertas registradas.</p>
          ) : (
            <ul className="space-y-3">
              {prov.alertas.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERIDAD_TONE[a.severidad.toLowerCase()] ?? 'amber'}>
                        Severidad: {a.severidad}
                      </Badge>
                      <Badge tone={a.resuelta ? 'green' : 'red'}>
                        {a.resuelta ? 'Revisada' : 'Activa'}
                      </Badge>
                      <span className="font-mono text-xs text-slate-500">{a.motivo}</span>
                      <span className="text-xs text-slate-400">{datetime(a.fecha)}</span>
                    </div>
                    <p className="text-sm text-slate-800">{a.resumen}</p>
                  </div>
                  {puedeEditar && !a.resuelta && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={resolveMut.isPending}
                      onClick={() => resolveMut.mutate(a.id)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Marcar como revisada
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
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

      <SupplierFormModal
        open={editarOpen}
        onClose={() => setEditarOpen(false)}
        initial={prov}
        saving={updateMut.isPending}
        serverError={actionError}
        onSubmit={async (data) => {
          await updateMut.mutateAsync(data);
        }}
      />
    </div>
  );
}
