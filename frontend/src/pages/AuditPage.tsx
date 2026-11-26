import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Search } from 'lucide-react';
import { api } from '../api';
import { datetime } from '../lib/format';
import { Alert, Badge, Card, CardBody, EmptyState, Spinner } from '../components/ui';

export function AuditPage() {
  const [busqueda, setBusqueda] = useState('');
  const [entidadFiltro, setEntidadFiltro] = useState('TODAS');

  const { data: registros = [], isLoading, error } = useQuery({
    queryKey: ['audit'],
    queryFn: api.audit.list,
  });

  const entidades = Array.from(new Set(registros.map((r) => r.entidad))).sort();
  const q = busqueda.trim().toLowerCase();

  const filtrados = registros.filter((r) => {
    if (entidadFiltro !== 'TODAS' && r.entidad !== entidadFiltro) return false;
    if (!q) return true;
    return (
      r.usuario.toLowerCase().includes(q) ||
      r.accion.toLowerCase().includes(q) ||
      r.entidad.toLowerCase().includes(q) ||
      (r.entidad_id ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Registro de auditoría</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Bitácora inmutable de acciones, revisiones humanas y cambios de estado en el sistema
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            className="input pl-9"
            placeholder="Filtrar por usuario, acción o entidad..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <select
          className="input w-full sm:w-52"
          value={entidadFiltro}
          onChange={(e) => setEntidadFiltro(e.target.value)}
        >
          <option value="TODAS">Todas las entidades</option>
          {entidades.map((ent) => (
            <option key={ent} value={ent}>
              {ent}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <Spinner label="Cargando bitácora..." className="py-12" />
      ) : error ? (
        <Alert tone="error">{error instanceof Error ? error.message : 'Error al cargar auditoría'}</Alert>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Sin eventos coincidentes"
          description="No hay registros de auditoría para el filtro seleccionado."
        />
      ) : (
        <Card>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Acción</th>
                    <th>Entidad</th>
                    <th>Detalles</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filtrados.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-xs text-slate-600">{datetime(r.fecha)}</td>
                      <td className="font-medium text-slate-900">{r.usuario}</td>
                      <td>
                        <Badge tone="indigo">{r.accion}</Badge>
                      </td>
                      <td className="text-xs text-slate-600">
                        <span className="font-medium text-slate-800">{r.entidad}</span>
                        {r.entidad_id && (
                          <span className="ml-1.5 font-mono text-slate-400">{r.entidad_id}</span>
                        )}
                      </td>
                      <td className="text-xs text-slate-600">
                        {r.cambios ? (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(r.cambios).map(([k, v]) => (
                              <span
                                key={k}
                                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
                              >
                                {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="font-mono text-xs text-slate-500">{r.ip ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
