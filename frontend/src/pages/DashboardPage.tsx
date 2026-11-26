import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  FileText,
  FolderKanban,
  MapPin,
  Plus,
  Search,
} from 'lucide-react';
import { api, type EstadoProyecto, type Moneda } from '../api';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { date, money } from '../lib/format';
import { ESTADOS, ESTADO_LABEL, ESTADO_TONE, MONEDAS } from '../lib/labels';
import { can } from '../lib/roles';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Modal,
  Spinner,
} from '../components/ui';

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [busqueda, setBusqueda] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<'TODOS' | EstadoProyecto>('TODOS');
  const [modalOpen, setModalOpen] = useState(false);

  // Formulario de nuevo proyecto
  const [nombre, setNombre] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [presupuesto, setPresupuesto] = useState('');
  const [moneda, setMoneda] = useState<Moneda>('USD');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: proyectos = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects.list,
  });

  const crearMut = useMutation({
    mutationFn: () =>
      api.projects.create(
        {
          nombre: nombre.trim(),
          ubicacion: ubicacion.trim(),
          descripcion: descripcion.trim(),
          presupuesto_ref: presupuesto ? Number(presupuesto) : null,
          moneda_ref: moneda,
        },
        archivo,
      ),
    onSuccess: async (creado) => {
      await qc.invalidateQueries({ queryKey: ['projects'] });
      await qc.invalidateQueries({ queryKey: ['audit'] });
      setModalOpen(false);
      setNombre('');
      setUbicacion('');
      setDescripcion('');
      setPresupuesto('');
      setArchivo(null);
      navigate(`/proyectos/${creado.id}`);
    },
    onError: (e) => {
      setFormError(e instanceof Error ? e.message : 'No se pudo crear el proyecto');
    },
  });

  const handleCrear = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!nombre.trim() || !ubicacion.trim()) {
      setFormError('El nombre y la ubicación son obligatorios.');
      return;
    }
    crearMut.mutate();
  };

  const enProceso = proyectos.filter((p) => p.estado === 'EN_RECEPCION' || p.estado === 'EN_EVALUACION').length;
  const enComite = proyectos.filter((p) => p.estado === 'EN_REVISION_COMITE').length;
  const adjudicados = proyectos.filter((p) => p.estado === 'ADJUDICADO').length;

  const q = busqueda.trim().toLowerCase();
  const filtrados = proyectos.filter((p) => {
    if (estadoFiltro !== 'TODOS' && p.estado !== estadoFiltro) return false;
    if (!q) return true;
    return (
      p.nombre.toLowerCase().includes(q) ||
      p.ubicacion.toLowerCase().includes(q) ||
      p.descripcion.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Proyectos de contratación</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Seguimiento de requerimientos, evaluación agéntica de propuestas y adjudicaciones
          </p>
        </div>
        {can(user?.rol, 'proyecto.crear') && (
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Nuevo proyecto
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total de proyectos', val: proyectos.length, color: 'text-slate-900' },
          { label: 'Recepción / evaluación', val: enProceso, color: 'text-blue-700' },
          { label: 'En revisión del comité', val: enComite, color: 'text-violet-700' },
          { label: 'Adjudicados', val: adjudicados, color: 'text-emerald-700' },
        ].map((k) => (
          <Card key={k.label}>
            <CardBody className="py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{k.label}</p>
              <p className={cn('mt-1 text-2xl font-bold tabular-nums', k.color)}>{k.val}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEstadoFiltro('TODOS')}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              estadoFiltro === 'TODOS'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100',
            )}
          >
            Todos ({proyectos.length})
          </button>
          {ESTADOS.map((est) => {
            const count = proyectos.filter((p) => p.estado === est).length;
            return (
              <button
                key={est}
                type="button"
                onClick={() => setEstadoFiltro(est)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  estadoFiltro === est
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100',
                )}
              >
                {ESTADO_LABEL[est]} ({count})
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="search"
            aria-label="Buscar proyecto o ubicación"
            className="input pl-9"
            placeholder="Buscar proyecto o ubicación..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <Spinner label="Cargando proyectos..." className="py-12" />
      ) : error ? (
        <Alert tone="error">{error instanceof Error ? error.message : 'Error al cargar proyectos'}</Alert>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No hay proyectos que coincidan"
          description={
            proyectos.length === 0
              ? 'Crea el primer proyecto para cargar los términos de referencia y las propuestas.'
              : 'Prueba cambiando el filtro de estado o el texto de búsqueda.'
          }
          action={
            can(user?.rol, 'proyecto.crear') && proyectos.length === 0 ? (
              <Button onClick={() => setModalOpen(true)}>
                <Plus className="h-4 w-4" />
                Crear primer proyecto
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4">
          {filtrados.map((p) => (
            <Link key={p.id} to={`/proyectos/${p.id}`} className="group block">
              <Card className="transition-all group-hover:border-indigo-300 group-hover:shadow-md">
                <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-base font-semibold text-slate-900 group-hover:text-indigo-700">
                        {p.nombre}
                      </h2>
                      <Badge tone={ESTADO_TONE[p.estado]}>{ESTADO_LABEL[p.estado]}</Badge>
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-600">{p.descripcion}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {p.ubicacion}
                      </span>
                      {p.archivo_proyecto && (
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" />
                          {p.archivo_proyecto}
                        </span>
                      )}
                      <span>Creado por {p.creado_por} · {date(p.creado_en)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-6 border-t border-slate-100 pt-3 sm:border-t-0 sm:pt-0">
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-semibold text-slate-900">
                        {p.total_propuestas} {p.total_propuestas === 1 ? 'propuesta' : 'propuestas'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {p.presupuesto_ref != null
                          ? `Ref.: ${money(p.presupuesto_ref, p.moneda_ref)}`
                          : 'Sin presupuesto fijo'}
                      </p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-600" />
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Modal nuevo proyecto */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nuevo proyecto de servicios o dotación"
        size="lg"
      >
        <form onSubmit={handleCrear} className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}

          <div>
            <label htmlFor="dashboard-campo-1" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Nombre del proyecto *
            </label>
            <input
              id="dashboard-campo-1"
              type="text"
              required
              className="input"
              placeholder="Ej. Dotación de Laboratorio de Computación"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="dashboard-campo-2" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Ubicación de ejecución *
            </label>
            <input
              id="dashboard-campo-2"
              type="text"
              required
              className="input"
              placeholder="Ej. La Hoyada, Municipio Libertador, Caracas"
              value={ubicacion}
              onChange={(e) => setUbicacion(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="dashboard-campo-3" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Descripción y alcance
            </label>
            <textarea
              id="dashboard-campo-3"
              rows={3}
              className="input"
              placeholder="Resumen de objetivos, equipos requeridos o alcance del servicio..."
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dashboard-campo-4" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Presupuesto referencial (opcional)
              </label>
              <input
                id="dashboard-campo-4"
                type="number"
                min="0"
                step="0.01"
                className="input"
                placeholder="Ej. 20000"
                value={presupuesto}
                onChange={(e) => setPresupuesto(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="dashboard-campo-5" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Moneda de referencia
              </label>
              <select
                id="dashboard-campo-5"
                className="input"
                value={moneda}
                onChange={(e) => setMoneda(e.target.value as Moneda)}
              >
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="dashboard-campo-6" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Documento del proyecto / Términos de referencia (PDF)
            </label>
            <input
              id="dashboard-campo-6"
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={crearMut.isPending}>
              Crear proyecto
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
