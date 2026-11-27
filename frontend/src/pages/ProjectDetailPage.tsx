import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Award,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileBarChart2,
  FileText,
  FolderOpen,
  History,
  MapPin,
  MessageSquare,
  Play,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  api,
  isMock,
  type EstadoProyecto,
  type ParametrosEvaluacion,
  type ResultadoPropuesta,
  type TrazaAgente,
} from '../api';
import { ComparisonTable } from '../components/ComparisonTable';
import { CostBreakdown } from '../components/CostBreakdown';
import { ExportButtons } from '../components/ExportButtons';
import { FileDropzone } from '../components/FileDropzone';
import { ProjectChat } from '../components/ProjectChat';
import { ReviewPanel } from '../components/ReviewPanel';
import { TraceTimeline } from '../components/TraceTimeline';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Modal,
  Spinner,
} from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { ACCEPT_DOCUMENTO_PROYECTO } from '../lib/files';
import { date, datetime, duration, money, number } from '../lib/format';
import {
  CONCEPTO_LABEL,
  ESTADOS,
  ESTADO_LABEL,
  ESTADO_TONE,
  MOTIVO_LABEL,
  TIPO_LABEL,
} from '../lib/labels';
import { can, transicionesPermitidas, type Transicion } from '../lib/roles';

type Tab = 'propuestas' | 'trazabilidad' | 'informe' | 'chat' | 'historial';

export function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [pickedTab, setPickedTab] = useState<{ projectId: string; tab: Tab } | null>(null);
  const pickTab = (t: Tab) => setPickedTab({ projectId: id, tab: t });

  const [selectedEvalState, setSelectedEvalState] = useState<{ projectId: string; evalId: string } | null>(null);
  const selectedEvalId = selectedEvalState?.projectId === id ? selectedEvalState.evalId : null;
  const setSelectedEvalId = (evalId: string | null) =>
    setSelectedEvalState(evalId ? { projectId: id, evalId } : null);

  const [traceState, setTraceState] = useState<{
    evalId: string;
    list: TrazaAgente[];
    ended: boolean;
    error: string | null;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [transicionModal, setTransicionModal] = useState<Transicion | null>(null);
  const [transicionNota, setTransicionNota] = useState('');
  const [recDetalle, setRecDetalle] = useState<ResultadoPropuesta | null>(null);
  const [verOtrasValidas, setVerOtrasValidas] = useState(false);
  const [evalModalOpen, setEvalModalOpen] = useState(false);
  const [evalParamError, setEvalParamError] = useState<string | null>(null);
  const [paramWebSearch, setParamWebSearch] = useState(true);
  const [paramIvaPct, setParamIvaPct] = useState('16');
  const [paramBcvOverride, setParamBcvOverride] = useState('');

  const projectQ = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id),
    enabled: !!id,
  });

  const proposalsQ = useQuery({
    queryKey: ['proposals', id],
    queryFn: () => api.proposals.list(id),
    enabled: !!id,
  });

  const evaluationsListQ = useQuery({
    queryKey: ['evaluations-list', id],
    queryFn: () => api.evaluations.list(id),
    enabled: !!id,
  });

  const evaluationQ = useQuery({
    queryKey: ['evaluation', id, selectedEvalId ?? 'latest'],
    queryFn: () => (selectedEvalId ? api.evaluations.get(selectedEvalId) : api.evaluations.latest(id)),
    enabled: !!id,
  });

  const historyQ = useQuery({
    queryKey: ['project-history', id],
    queryFn: () => api.projects.history(id),
    enabled: !!id,
  });

  const evaluacion = evaluationQ.data ?? null;
  const defaultTab: Tab =
    evaluacion?.estado === 'en_curso'
      ? 'trazabilidad'
      : evaluacion?.estado === 'completada'
        ? 'informe'
        : 'propuestas';
  const tab: Tab = pickedTab?.projectId === id ? pickedTab.tab : defaultTab;

  const evalId = evaluacion?.id ?? null;
  const evalEstado = evaluacion?.estado ?? null;
  const trazas = evalId && traceState?.evalId === evalId ? traceState.list : [];
  const streamError = evalId && traceState?.evalId === evalId ? traceState.error : null;
  const streaming = Boolean(
    evalId && evalEstado === 'en_curso' && !(traceState?.evalId === evalId && traceState.ended),
  );

  // Suscripción SSE o carga de trazas persistidas
  useEffect(() => {
    if (!evalId || !evalEstado) return;
    if (evalEstado === 'en_curso') {
      const stop = api.evaluations.stream(
        evalId,
        (evento) => {
          setTraceState((prev) => {
            const base = prev?.evalId === evalId ? prev.list : [];
            if (base.some((x) => x.id === evento.id)) return prev;
            return { evalId, list: [...base, evento], ended: false, error: null };
          });
        },
        async () => {
          setTraceState((prev) => ({
            evalId,
            list: prev?.evalId === evalId ? prev.list : [],
            ended: true,
            error: null,
          }));
          await Promise.all([
            qc.invalidateQueries({ queryKey: ['project', id] }),
            qc.invalidateQueries({ queryKey: ['proposals', id] }),
            qc.invalidateQueries({ queryKey: ['evaluation', id] }),
            qc.invalidateQueries({ queryKey: ['evaluations-list', id] }),
            qc.invalidateQueries({ queryKey: ['project-history', id] }),
            qc.invalidateQueries({ queryKey: ['suppliers'] }),
            qc.invalidateQueries({ queryKey: ['audit'] }),
          ]);
        },
        (msg) => {
          setTraceState((prev) => ({
            evalId,
            list: prev?.evalId === evalId ? prev.list : [],
            ended: true,
            error: msg,
          }));
        },
      );
      return stop;
    }

    let cancelled = false;
    api.evaluations
      .trazas(evalId)
      .then((list) => {
        if (!cancelled) setTraceState({ evalId, list, ended: true, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setTraceState({
            evalId,
            list: [],
            ended: true,
            error: e instanceof Error ? e.message : 'No se pudo cargar la trazabilidad',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [evalId, evalEstado, id, qc]);

  const uploadMut = useMutation({
    mutationFn: (files: File[]) => api.proposals.upload(id, files),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['proposals', id] }),
        qc.invalidateQueries({ queryKey: ['project', id] }),
        qc.invalidateQueries({ queryKey: ['suppliers'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Error al subir propuestas'),
  });

  const docMut = useMutation({
    mutationFn: (archivo: File) => api.projects.uploadDocument(id, archivo),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['project', id] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Error al subir el documento del proyecto'),
  });

  const deleteMut = useMutation({
    mutationFn: (proposalId: string) => api.proposals.remove(proposalId),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['proposals', id] }),
        qc.invalidateQueries({ queryKey: ['project', id] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'No se pudo eliminar'),
  });

  const startEvalMut = useMutation({
    mutationFn: (params?: ParametrosEvaluacion) => api.evaluations.start(id, params),
    onSuccess: async (ev) => {
      setActionError(null);
      setEvalModalOpen(false);
      setSelectedEvalId(null);
      qc.setQueryData(['evaluation', id, 'latest'], ev);
      pickTab('trazabilidad');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['project', id] }),
        qc.invalidateQueries({ queryKey: ['evaluations-list', id] }),
        qc.invalidateQueries({ queryKey: ['project-history', id] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'No se pudo iniciar la evaluación'),
  });

  const stateMut = useMutation({
    mutationFn: ({ estado, nota }: { estado: EstadoProyecto; nota: string }) =>
      api.projects.changeState(id, estado, nota || undefined),
    onSuccess: async () => {
      setTransicionModal(null);
      setTransicionNota('');
      setActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['project', id] }),
        qc.invalidateQueries({ queryKey: ['project-history', id] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'No se pudo cambiar el estado'),
  });

  if (projectQ.isLoading) {
    return <Spinner label="Cargando proyecto..." className="py-20" />;
  }

  if (projectQ.error || !projectQ.data) {
    return (
      <div className="space-y-4">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline">
          <ArrowLeft className="h-4 w-4" />
          Volver a proyectos
        </Link>
        <Alert tone="error">
          {projectQ.error instanceof Error ? projectQ.error.message : 'Proyecto no encontrado'}
        </Alert>
      </div>
    );
  }

  const proyecto = projectQ.data;
  const propuestas = proposalsQ.data ?? [];
  const historial = historyQ.data ?? [];
  const listaEvaluaciones = evaluationsListQ.data ?? [];
  const latestRunId = listaEvaluaciones[0]?.id ?? null;
  const viendoHistorica = !!evaluacion && !!latestRunId && evaluacion.id !== latestRunId;

  const evalSelectorBlock =
    listaEvaluaciones.length > 0 ? (
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="eval-run-selector" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ejecución consultada ({listaEvaluaciones.length})
            </label>
            <select
              id="eval-run-selector"
              value={selectedEvalId ?? latestRunId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedEvalId(v && v !== latestRunId ? v : null);
              }}
              className="input w-auto max-w-full py-1.5 text-sm"
            >
              {listaEvaluaciones.map((run, idx) => {
                const estadoTxt =
                  run.estado === 'completada'
                    ? 'Completada'
                    : run.estado === 'error'
                      ? 'Con error'
                      : 'En curso';
                const tag = idx === 0 ? 'Más reciente' : `Histórica #${listaEvaluaciones.length - idx}`;
                return (
                  <option key={run.id} value={run.id}>
                    {tag} · {datetime(run.inicio)} · {estadoTxt}
                    {run.recomendada_codigo ? ` (${run.recomendada_codigo})` : ''}
                  </option>
                );
              })}
            </select>
          </div>
          {viendoHistorica && (
            <Button size="sm" variant="secondary" onClick={() => setSelectedEvalId(null)}>
              Volver a la más reciente
            </Button>
          )}
        </div>
        {viendoHistorica && evaluacion && (
          <Alert tone="info" title="Vista de ejecución histórica">
            Estás revisando una evaluación anterior ({datetime(evaluacion.inicio)}). Los reportes exportados y la trazabilidad mostrados corresponden a esa corrida específica.
          </Alert>
        )}
      </div>
    ) : null;

  const puedeSubirDocumento =
    can(user?.rol, 'proyecto.crear') &&
    (proyecto.estado === 'EN_RECEPCION' || proyecto.estado === 'EN_EVALUACION');

  const puedeSubir =
    can(user?.rol, 'propuesta.cargar') &&
    (proyecto.estado === 'EN_RECEPCION' || proyecto.estado === 'EN_EVALUACION');

  const enCurso = evaluacion?.estado === 'en_curso' || streaming;
  const bloqueadoPorEstado = proyecto.estado === 'ADJUDICADO' || proyecto.estado === 'CERRADO';
  const puedeEvaluar =
    can(user?.rol, 'evaluacion.ejecutar') &&
    propuestas.length >= 3 &&
    propuestas.length <= 20 &&
    !enCurso &&
    !bloqueadoPorEstado;

  const transiciones = transicionesPermitidas(proyecto.estado, user?.rol);
  const idxEstadoActual = ESTADOS.indexOf(proyecto.estado);

  const resultados = evaluacion?.resultados ?? [];
  const ordenada = [...resultados].sort((a, b) => a.posicion - b.posicion);
  const recomendada = ordenada.find((r) => r.propuesta_id === evaluacion?.recomendada_id) ?? null;
  const descartadas = ordenada.filter((r) => !r.valida);
  const otrasValidas = ordenada.filter((r) => r.valida && r.propuesta_id !== recomendada?.propuesta_id);

  const abrirDescarga = async (getUrl: () => Promise<string | null>) => {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    try {
      const url = await getUrl();
      if (!url) {
        if (popup && !popup.closed) popup.close();
        return;
      }
      if (popup && !popup.closed) {
        popup.location.replace(url);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {
      if (popup && !popup.closed) popup.close();
      setActionError(e instanceof Error ? e.message : 'No se pudo autorizar la descarga');
    }
  };

  const tabs: { key: Tab; label: string; icon: typeof FolderOpen; badge?: string | number }[] = [
    { key: 'propuestas', label: 'Propuestas', icon: FolderOpen, badge: propuestas.length },
    { key: 'trazabilidad', label: 'Trazabilidad', icon: Activity, badge: enCurso ? 'En vivo' : trazas.length || undefined },
    { key: 'informe', label: 'Informe', icon: FileBarChart2 },
    { key: 'chat', label: 'Chat', icon: MessageSquare },
    { key: 'historial', label: 'Historial', icon: History, badge: historial.length || undefined },
  ];

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 print:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          Todos los proyectos
        </Link>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{proyecto.nombre}</h1>
              <Badge tone={ESTADO_TONE[proyecto.estado]}>{ESTADO_LABEL[proyecto.estado]}</Badge>
            </div>
            {proyecto.estado === 'ADJUDICADO' && (() => {
              const propAdj =
                propuestas.find((p) => p.id === proyecto.propuesta_adjudicada_id) ?? null;
              const resAdj =
                resultados.find((r) => r.propuesta_id === proyecto.propuesta_adjudicada_id) ?? null;
              return (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-xs text-emerald-900">
                  <span className="font-semibold">Adjudicado a: </span>
                  {resAdj ? `${resAdj.proveedor} (${resAdj.codigo})` : propAdj ? `${propAdj.proveedor_nombre ?? propAdj.codigo} (${propAdj.codigo})` : 'Propuesta seleccionada por el comité'}
                  {proyecto.nota_adjudicacion && (
                    <span className="text-emerald-800"> · {proyecto.nota_adjudicacion}</span>
                  )}
                </div>
              );
            })()}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {proyecto.ubicacion}
              </span>
              {proyecto.archivo_proyecto &&
                (!isMock ? (
                  <button
                    type="button"
                    onClick={() => void abrirDescarga(() => api.projects.documentUrl(proyecto.id))}
                    className="inline-flex items-center gap-1.5 text-indigo-600 hover:underline"
                    title="Descargar documento cifrado"
                  >
                    <FileText className="h-4 w-4" />
                    {proyecto.archivo_proyecto}
                    <Download className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="h-4 w-4" />
                    {proyecto.archivo_proyecto}
                  </span>
                ))}
              {puedeSubirDocumento && (
                <label
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 text-indigo-600 hover:underline',
                    docMut.isPending && 'pointer-events-none opacity-60',
                  )}
                  title="Subir o reemplazar el documento de requerimientos del proyecto (PDF, DOCX, TXT o MD)"
                >
                  <Upload className="h-4 w-4" />
                  {docMut.isPending
                    ? 'Subiendo documento…'
                    : proyecto.archivo_proyecto
                      ? 'Reemplazar documento'
                      : 'Subir documento del proyecto'}
                  <input
                    type="file"
                    className="sr-only"
                    accept={ACCEPT_DOCUMENTO_PROYECTO}
                    aria-label="Documento del proyecto"
                    onChange={(e) => {
                      const archivo = e.target.files?.[0];
                      e.target.value = '';
                      if (archivo) docMut.mutate(archivo);
                    }}
                  />
                </label>
              )}
              <span>
                Presupuesto ref.:{' '}
                <strong className="text-slate-700">
                  {proyecto.presupuesto_ref != null
                    ? money(proyecto.presupuesto_ref, proyecto.moneda_ref)
                    : 'Abierto / orientativo'}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {can(user?.rol, 'chat.usar') && (
              <Button variant="primary" size="sm" onClick={() => pickTab('chat')}>
                <MessageSquare className="h-4 w-4" />
                Preguntar a la IA
              </Button>
            )}
            {transiciones.map((t) => (
                <Button
                  key={`${t.de}-${t.a}`}
                  variant={t.a === 'ADJUDICADO' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setTransicionModal(t)}
                >
                  {t.label}
                </Button>
              ))}
          </div>
        </div>

        {/* Barra de etapas del proceso */}
        <Card className="print:hidden">
          <CardBody className="py-3">
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {ESTADOS.map((est, i) => {
                const done = i < idxEstadoActual;
                const active = i === idxEstadoActual;
                return (
                  <li
                    key={est}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium',
                      active
                        ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                        : done
                          ? 'bg-emerald-50/70 text-emerald-700'
                          : 'text-slate-500',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                        active
                          ? 'bg-indigo-600 text-white'
                          : done
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-200 text-slate-600',
                      )}
                    >
                      {done ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="truncate">{ESTADO_LABEL[est]}</span>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      </div>

      {/* Pestañas */}
      <div className="border-b border-slate-200 print:hidden">
        <div className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Secciones del proyecto">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={active}
                aria-controls={`panel-${t.key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => pickTab(t.key)}
                onKeyDown={(e) => {
                  const idx = tabs.findIndex((x) => x.key === t.key);
                  let next = -1;
                  if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
                  else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
                  else if (e.key === 'Home') next = 0;
                  else if (e.key === 'End') next = tabs.length - 1;
                  if (next < 0) return;
                  e.preventDefault();
                  pickTab(tabs[next].key);
                  document.getElementById(`tab-${tabs[next].key}`)?.focus();
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                  active
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{t.label}</span>
                {t.badge != null && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>

      {/* TAB 1: PROPUESTAS */}
      {tab === 'propuestas' && (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Requerimiento del proyecto y ejecución del agente"
              action={
                <Button
                  onClick={() => {
                    setEvalParamError(null);
                    setEvalModalOpen(true);
                  }}
                  loading={startEvalMut.isPending}
                  disabled={!puedeEvaluar}
                >
                  <Play className="h-4 w-4" />
                  Evaluar Propuestas de Servicios
                </Button>
              }
            />
            <CardBody className="space-y-3">
              <p className="text-sm text-slate-700">{proyecto.descripcion}</p>
              {!can(user?.rol, 'evaluacion.ejecutar') ? (
                <p className="text-xs text-slate-500">
                  Su rol no tiene permiso para lanzar evaluaciones (corresponde a revisor, aprobador o administrador).
                </p>
              ) : bloqueadoPorEstado ? (
                <p className="text-xs text-slate-500">
                  El proceso ya está {ESTADO_LABEL[proyecto.estado].toLowerCase()}.
                </p>
              ) : propuestas.length < 3 ? (
                <Alert tone="warning">
                  Se requieren al menos 3 propuestas cargadas para iniciar la evaluación (actualmente hay {propuestas.length}).
                </Alert>
              ) : propuestas.length > 20 ? (
                <Alert tone="warning">
                  El límite máximo permitido es de 20 propuestas por proyecto (actualmente hay {propuestas.length}). Elimina las excedentes antes de evaluar.
                </Alert>
              ) : null}
            </CardBody>
          </Card>

          {puedeSubir && (
            <Card>
              <CardHeader
                title="Carga masiva de propuestas"
                subtitle="Sube entre 3 y 20 propuestas en PDF, Excel, imágenes manuscritas o capturas de chat"
              />
              <CardBody className="space-y-3">
                {propuestas.length >= 20 && (
                  <div role="alert">
                    <Alert tone="warning" title="Capacidad máxima alcanzada">
                      Ya se alcanzó el máximo de 20 propuestas para este proyecto. Elimina alguna si deseas reemplazarla.
                    </Alert>
                  </div>
                )}
                <FileDropzone
                  maxFiles={20}
                  currentCount={propuestas.length}
                  disabled={propuestas.length >= 20}
                  onUpload={async (files) => {
                    await uploadMut.mutateAsync(files);
                  }}
                  uploading={uploadMut.isPending}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title={`Propuestas cargadas (${propuestas.length})`}
              subtitle="Cada archivo se identifica por su nombre sin extensión"
            />
            <CardBody className="p-0">
              {proposalsQ.isLoading ? (
                <Spinner label="Cargando propuestas..." className="py-10" />
              ) : propuestas.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={FolderOpen}
                    title="Aún no hay propuestas"
                    description="Carga al menos 3 ofertas de proveedores para que el agente pueda evaluarlas."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Proveedor</th>
                        <th>Archivo</th>
                        <th>Formato</th>
                        <th className="text-right">Declarado</th>
                        <th>Estado</th>
                        <th>Cargado</th>
                        {puedeSubir && <th className="text-right">Acción</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {propuestas.map((p) => (
                        <tr key={p.id}>
                          <td className="font-mono text-xs font-medium text-slate-800">{p.codigo}</td>
                          <td>
                            {p.proveedor_id ? (
                              <Link
                                to={`/proveedores/${p.proveedor_id}`}
                                className="font-medium text-indigo-600 hover:underline"
                              >
                                {p.proveedor_nombre ?? 'Ver proveedor'}
                              </Link>
                            ) : (
                              <span className="text-slate-600">{p.proveedor_nombre ?? '—'}</span>
                            )}
                          </td>
                          <td className="text-xs text-slate-500">
                            {!isMock ? (
                              <button
                                type="button"
                                onClick={() => void abrirDescarga(() => api.proposals.downloadUrl(p.id))}
                                className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                                title="Descargar archivo original descifrado"
                              >
                                <span>{p.archivo_nombre}</span>
                                <Download className="h-3 w-3 shrink-0" />
                              </button>
                            ) : (
                              p.archivo_nombre
                            )}
                          </td>
                          <td>
                            <Badge tone="indigo">{TIPO_LABEL[p.tipo]}</Badge>
                          </td>
                          <td className="text-right tabular-nums text-slate-700">
                            {p.total_declarado != null && p.moneda
                              ? money(p.total_declarado, p.moneda)
                              : '—'}
                          </td>
                          <td>
                            <Badge
                              tone={
                                p.estado === 'procesada'
                                  ? 'green'
                                  : p.estado === 'error'
                                    ? 'red'
                                    : 'slate'
                              }
                            >
                              {p.estado === 'procesada'
                                ? 'Procesada'
                                : p.estado === 'error'
                                  ? 'Error'
                                  : 'Cargada'}
                            </Badge>
                          </td>
                          <td className="text-xs text-slate-500">{date(p.subido_en)}</td>
                          {puedeSubir && (
                            <td className="text-right">
                              <button
                                type="button"
                                onClick={() => deleteMut.mutate(p.id)}
                                disabled={deleteMut.isPending || enCurso}
                                className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                                title="Eliminar propuesta"
                                aria-label={`Eliminar propuesta ${p.codigo}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* TAB 2: TRAZABILIDAD */}
      {tab === 'trazabilidad' && (
        <div className="space-y-4">
          {evalSelectorBlock}
          {streamError && <Alert tone="error">{streamError}</Alert>}
          {!evaluacion ? (
            <EmptyState
              icon={Activity}
              title="Sin ejecución registrada"
              description="Ve a la pestaña Propuestas y presiona «Evaluar Propuestas de Servicios» para ver la trazabilidad del agente."
              action={
                <Button variant="secondary" onClick={() => pickTab('propuestas')}>
                  Ir a Propuestas
                </Button>
              }
            />
          ) : (
            <Card>
              <CardHeader
                title="Trazabilidad del Agente Autónomo"
                subtitle={`Iniciada por ${evaluacion.ejecutada_por} · ${datetime(evaluacion.inicio)}`}
                action={
                  evaluacion.estado === 'completada' && (
                    <Button size="sm" onClick={() => pickTab('informe')}>
                      Ver informe completo
                    </Button>
                  )
                }
              />
              <CardBody>
                <TraceTimeline trazas={trazas} running={enCurso} />
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* TAB 3: INFORME */}
      {tab === 'informe' && (
        <div className="space-y-6">
          {evalSelectorBlock}
          {!evaluacion ? (
            <EmptyState
              icon={FileBarChart2}
              title="Aún no se ha generado el informe"
              description="Ejecuta la evaluación de las propuestas para obtener la recomendación técnica y financiera."
              action={
                <Button variant="secondary" onClick={() => pickTab('propuestas')}>
                  Ir a Propuestas
                </Button>
              }
            />
          ) : evaluacion.estado === 'en_curso' ? (
            <Alert tone="info" title="Evaluación en curso">
              El agente está auditando las propuestas en este momento. Puedes seguir el progreso en la pestaña Trazabilidad.
            </Alert>
          ) : (
            <>
              {/* Cabecera del informe y exportaciones */}
              <Card>
                <CardBody className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Informe de Análisis y Factibilidad Financiera
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Evaluado el {datetime(evaluacion.fin ?? evaluacion.inicio)} · Duración:{' '}
                      {duration(evaluacion.inicio, evaluacion.fin)} · Tasa BCV: Bs.{' '}
                      {number(evaluacion.tasa_bcv_usada)} / USD ·{' '}
                      {resultados.filter((r) => r.valida).length} válidas y {descartadas.length} descartadas
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ExportButtons evaluacion={evaluacion} proyecto={proyecto} />
                    {can(user?.rol, 'chat.usar') && (
                      <Button variant="secondary" size="sm" onClick={() => pickTab('chat')} className="print:hidden">
                        <MessageSquare className="h-4 w-4" />
                        Preguntar a la IA sobre este informe
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>

              {/* Propuesta recomendada */}
              {recomendada ? (
                <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2 max-w-3xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="green">
                          <Award className="h-3.5 w-3.5" />
                          Propuesta recomendada (#1)
                        </Badge>
                        <Badge tone="indigo">{TIPO_LABEL[recomendada.tipo]}</Badge>
                      </div>
                      <h3 className="text-xl font-bold text-slate-900">
                        {recomendada.proveedor}
                      </h3>
                      <p className="break-all font-mono text-xs text-slate-600">{recomendada.codigo}</p>
                      <p className="text-sm text-slate-800">{recomendada.dictamen}</p>
                    </div>

                    <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                      <div className="rounded-lg bg-white px-4 py-2.5 ring-1 ring-emerald-200 text-left sm:text-right">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Costo real ajustado
                        </p>
                        <p className="text-2xl font-bold tabular-nums text-emerald-700">
                          {money(recomendada.total_ajustado_usd)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Puntaje técnico: {recomendada.puntaje_tecnico}/100
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="print:hidden"
                        onClick={() => setRecDetalle(recomendada)}
                      >
                        Ver desglose completo
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Alert tone="warning" title="Ninguna propuesta resultó válida">
                  Todas las propuestas evaluadas presentaron causales de descarte. Revisa el dictamen abajo.
                </Alert>
              )}

              {/* Tabla comparativa */}
              <Card>
                <CardHeader
                  title="Tabla comparativa de propuestas"
                  subtitle="Montos declarados frente a costos reales ajustados (incluyendo fletes, recargos e impuestos)"
                />
                <CardBody>
                  <ComparisonTable
                    resultados={resultados}
                    recomendadaId={evaluacion.recomendada_id}
                    tasaBcv={evaluacion.tasa_bcv_usada}
                    evaluacionId={evaluacion.id}
                  />
                </CardBody>
              </Card>

              {/* Dictamen de descarte y otras válidas */}
              <Card>
                <CardHeader
                  title={`Dictamen de descarte (${descartadas.length})`}
                  subtitle="Justificación explícita por incumplimiento técnico, aritmético, costos ocultos abusivos o manipulación"
                />
                <CardBody className="space-y-4">
                  {descartadas.length === 0 ? (
                    <p className="text-sm text-slate-500">No hubo propuestas descartadas en esta evaluación.</p>
                  ) : (
                    <div className="grid gap-3">
                      {descartadas.map((r) => (
                        <div
                          key={r.propuesta_id}
                          className="rounded-xl border border-red-200 bg-red-50/40 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-red-600" />
                                <span className="font-semibold text-slate-900">{r.proveedor}</span>
                                <span className="break-all font-mono text-xs text-slate-500">{r.codigo}</span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {r.motivos_descarte.map((m) => (
                                  <Badge key={m} tone="red">
                                    {MOTIVO_LABEL[m]}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div className="text-right text-xs text-slate-600">
                              <div>Declarado: {money(r.total_declarado, r.moneda)}</div>
                              <div className="font-semibold text-slate-900">
                                Costo real: {money(r.total_ajustado_usd)}
                              </div>
                            </div>
                          </div>
                          <p className="mt-2.5 text-sm text-slate-800">{r.dictamen}</p>
                          {r.ajustes.length > 0 && (
                            <ul className="mt-2 space-y-1 border-t border-red-200/70 pt-2 text-xs text-slate-700">
                              {r.ajustes.map((a, idx) => (
                                <li key={idx}>
                                  <strong>{CONCEPTO_LABEL[a.concepto]} (+{money(a.monto_usd)}):</strong>{' '}
                                  <span className="italic">{a.fuente_texto}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {otrasValidas.length > 0 && (
                    <div className="border-t border-slate-200 pt-4">
                      <button
                        type="button"
                        onClick={() => setVerOtrasValidas((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline print:hidden"
                      >
                        {verOtrasValidas ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {verOtrasValidas ? 'Ocultar' : 'Ver'} dictamen de las otras {otrasValidas.length} propuestas válidas
                      </button>
                      {(verOtrasValidas || false) && (
                        <div className="mt-3 grid gap-3">
                          {otrasValidas.map((r) => (
                            <div key={r.propuesta_id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge tone="blue">#{r.posicion}</Badge>
                                  <span className="font-semibold text-slate-900">{r.proveedor}</span>
                                  <span className="font-mono text-xs text-slate-500">{r.codigo}</span>
                                </div>
                                <span className="text-sm font-semibold text-slate-900">
                                  {money(r.total_ajustado_usd)} · {r.puntaje_tecnico}/100
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-700">{r.dictamen}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Revisión del comité */}
              <ReviewPanel evaluacion={evaluacion} proyecto={proyecto} />
            </>
          )}
        </div>
      )}

      {/* TAB 4: CHAT */}
      {tab === 'chat' && <ProjectChat projectId={id} />}

      {/* TAB 5: HISTORIAL */}
      {tab === 'historial' && (
        <Card>
          <CardHeader title="Historial de estados del proceso" />
          <CardBody>
            {historyQ.isLoading ? (
              <Spinner label="Cargando historial..." />
            ) : historial.length === 0 ? (
              <p className="text-sm text-slate-500">Sin registros de cambios de estado.</p>
            ) : (
              <ol className="space-y-3">
                {historial.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {h.estado_anterior && (
                          <>
                            <Badge tone={ESTADO_TONE[h.estado_anterior]}>
                              {ESTADO_LABEL[h.estado_anterior]}
                            </Badge>
                            <span className="text-slate-400">→</span>
                          </>
                        )}
                        <Badge tone={ESTADO_TONE[h.estado_nuevo]}>
                          {ESTADO_LABEL[h.estado_nuevo]}
                        </Badge>
                        <span className="text-xs text-slate-500">por {h.usuario}</span>
                      </div>
                      {h.nota && <p className="text-xs text-slate-600">{h.nota}</p>}
                    </div>
                    <span className="text-xs text-slate-500">{datetime(h.fecha)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      )}

      </div>

      {/* Modal desglose de propuesta recomendada */}
      <Modal
        open={!!recDetalle}
        onClose={() => setRecDetalle(null)}
        title={recDetalle ? `${recDetalle.codigo} — ${recDetalle.proveedor}` : ''}
        size="xl"
      >
        {recDetalle && evaluacion && (
          <CostBreakdown resultado={recDetalle} tasaBcv={evaluacion.tasa_bcv_usada} />
        )}
      </Modal>

      {/* Modal transición de estado */}
      <Modal
        open={!!transicionModal}
        onClose={() => setTransicionModal(null)}
        title={transicionModal ? transicionModal.label : ''}
      >
        {transicionModal && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              El estado del proyecto cambiará de{' '}
              <strong>{ESTADO_LABEL[transicionModal.de]}</strong> a{' '}
              <strong>{ESTADO_LABEL[transicionModal.a]}</strong>.
            </p>
            <div>
              <label htmlFor="projectdetail-campo-1" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Nota o motivo (opcional)
              </label>
              <textarea
                id="projectdetail-campo-1"
                rows={3}
                className="input"
                placeholder="Agrega una observación para el historial..."
                value={transicionNota}
                onChange={(e) => setTransicionNota(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setTransicionModal(null)}>
                Cancelar
              </Button>
              <Button
                loading={stateMut.isPending}
                onClick={() =>
                  stateMut.mutate({ estado: transicionModal.a, nota: transicionNota.trim() })
                }
              >
                Confirmar cambio
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal parámetros de evaluación */}
      <Modal
        open={evalModalOpen}
        onClose={() => {
          setEvalModalOpen(false);
          setEvalParamError(null);
        }}
        title="Parámetros de evaluación del agente"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const ivaNum = Number(paramIvaPct.replace(',', '.'));
            const bcvNum = paramBcvOverride.trim() ? Number(paramBcvOverride.replace(',', '.')) : null;
            if (!Number.isFinite(ivaNum) || ivaNum < 0 || ivaNum > 50) {
              setEvalParamError('La alícuota de IVA debe estar entre 0 % y 50 %.');
              return;
            }
            if (bcvNum != null && (!Number.isFinite(bcvNum) || bcvNum <= 0)) {
              setEvalParamError('La tasa BCV de anulación debe ser mayor a 0.');
              return;
            }
            setEvalParamError(null);
            startEvalMut.mutate({
              enable_web_search: paramWebSearch,
              iva_rate: ivaNum / 100,
              bcv_rate_override: bcvNum,
            });
          }}
        >
          <p className="text-sm text-slate-600">
            Configura las condiciones financieras y de verificación antes de iniciar el análisis de {propuestas.length} propuestas.
          </p>

          {evalParamError && (
            <div role="alert">
              <Alert tone="error">{evalParamError}</Alert>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-800">
            <input
              id="eval-web-search"
              type="checkbox"
              checked={paramWebSearch}
              onChange={(e) => setParamWebSearch(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Habilitar contraste de precios en internet (búsqueda web)
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="eval-iva-rate" className="mb-1 block text-xs font-semibold text-slate-700">
                Alícuota IVA (%)
              </label>
              <input
                id="eval-iva-rate"
                type="number"
                step="0.5"
                min="0"
                max="50"
                required
                className="input"
                value={paramIvaPct}
                onChange={(e) => {
                  setParamIvaPct(e.target.value);
                  setEvalParamError(null);
                }}
              />
            </div>

            <div>
              <label htmlFor="eval-bcv-override" className="mb-1 block text-xs font-semibold text-slate-700">
                Anular tasa BCV (opcional, Bs./USD)
              </label>
              <input
                id="eval-bcv-override"
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                value={paramBcvOverride}
                onChange={(e) => {
                  setParamBcvOverride(e.target.value);
                  setEvalParamError(null);
                }}
                placeholder="Usar tasa BCV activa"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setEvalModalOpen(false);
                setEvalParamError(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={startEvalMut.isPending}>
              <Play className="h-4 w-4" />
              Iniciar evaluación
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
