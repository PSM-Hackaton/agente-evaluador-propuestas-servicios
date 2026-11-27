import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, MapPin, Phone, Plus, Search } from 'lucide-react';
import { api, type ProveedorInput } from '../api';
import { SupplierFormModal } from '../components/SupplierFormModal';
import { useAuth } from '../context/AuthContext';
import { can } from '../lib/roles';
import { Alert, Badge, Button, Card, CardBody, EmptyState, Spinner } from '../components/ui';

export function SuppliersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [crearOpen, setCrearOpen] = useState(false);
  const [crearError, setCrearError] = useState<string | null>(null);

  const { data: proveedores = [], isLoading, error } = useQuery({
    queryKey: ['suppliers'],
    queryFn: api.suppliers.list,
  });

  const createMut = useMutation({
    mutationFn: (data: ProveedorInput) => api.suppliers.create(data),
    onSuccess: async () => {
      setCrearOpen(false);
      setCrearError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['suppliers'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setCrearError(e instanceof Error ? e.message : 'No se pudo registrar el proveedor'),
  });

  const puedeCrear = can(user?.rol, 'proveedor.crear');

  const conAlertas = proveedores.filter((p) => p.alerta).length;
  const q = busqueda.trim().toLowerCase();

  const filtrados = proveedores.filter((p) => {
    if (soloAlertas && !p.alerta) return false;
    if (!q) return true;
    return (
      p.nombre.toLowerCase().includes(q) ||
      (p.rif ?? '').toLowerCase().includes(q) ||
      (p.ubicacion ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Directorio de proveedores</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Fichas registradas, participaciones previas y alertas automáticas de evaluación
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="slate">{proveedores.length} registrados</Badge>
          {conAlertas > 0 && <Badge tone="red">{conAlertas} con alertas</Badge>}
          {puedeCrear && (
            <Button
              size="sm"
              onClick={() => {
                setCrearError(null);
                setCrearOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Nuevo proveedor
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Buscar proveedor"
            className="input pl-9"
            placeholder="Buscar por nombre, RIF o ciudad..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloAlertas}
            onChange={(e) => setSoloAlertas(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Mostrar solo proveedores con alertas
        </label>
      </div>

      {isLoading ? (
        <Spinner label="Cargando proveedores..." className="py-12" />
      ) : error ? (
        <Alert tone="error">{error instanceof Error ? error.message : 'Error al cargar proveedores'}</Alert>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No se encontraron proveedores"
          description="Prueba limpiando el filtro de búsqueda o el filtro de alertas."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>RIF</th>
                    <th>Ubicación</th>
                    <th>Teléfono</th>
                    <th className="text-center">Participaciones</th>
                    <th>Estado / Alertas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filtrados.map((p) => (
                    <tr key={p.id} className={p.alerta ? 'bg-red-50/30' : undefined}>
                      <td>
                        <Link
                          to={`/proveedores/${p.id}`}
                          className="font-semibold text-indigo-600 hover:underline"
                        >
                          {p.nombre}
                        </Link>
                      </td>
                      <td className="font-mono text-xs text-slate-600">{p.rif ?? '—'}</td>
                      <td>
                        {p.ubicacion ? (
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <MapPin className="h-3.5 w-3.5 text-slate-400" />
                            {p.ubicacion}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {p.telefono ? (
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            {p.telefono}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-center font-medium tabular-nums text-slate-800">
                        {p.total_participaciones}
                      </td>
                      <td>
                        {p.alerta ? (
                          <div className="space-y-1">
                            <Badge tone="red">
                              <AlertTriangle className="h-3 w-3" />
                              Con antecedente
                            </Badge>
                            {p.motivo_alerta && (
                              <p className="text-xs text-red-700">{p.motivo_alerta}</p>
                            )}
                          </div>
                        ) : (
                          <Badge tone="green">Sin alertas</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <SupplierFormModal
        open={crearOpen}
        onClose={() => setCrearOpen(false)}
        saving={createMut.isPending}
        serverError={crearError}
        onSubmit={async (data) => {
          await createMut.mutateAsync(data);
        }}
      />
    </div>
  );
}
