import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, MessageSquarePlus, ShieldCheck, XOctagon } from 'lucide-react';
import { api, type AccionRevision, type Evaluacion, type OpcionesRevision, type Proyecto } from '../api';
import { useAuth } from '../context/AuthContext';
import { datetime, money } from '../lib/format';
import { ACCION_REVISION_LABEL, ROL_LABEL, type Tone } from '../lib/labels';
import { can } from '../lib/roles';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Spinner } from './ui';

interface ReviewPanelProps {
  evaluacion: Evaluacion;
  proyecto: Proyecto;
}

const ACCION_TONE: Record<AccionRevision, Tone> = {
  nota: 'slate',
  confirmar: 'indigo',
  aprobar: 'green',
  rechazar: 'red',
};

export function ReviewPanel({ evaluacion, proyecto }: ReviewPanelProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const validas = evaluacion.resultados
    .filter((r) => r.valida)
    .sort((a, b) => a.posicion - b.posicion);
  const [comentario, setComentario] = useState('');
  const [propuestaElegida, setPropuestaElegida] = useState<string>(
    evaluacion.recomendada_id ?? validas[0]?.propuesta_id ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPropuestaElegida(evaluacion.recomendada_id ?? validas[0]?.propuesta_id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluacion.id, evaluacion.recomendada_id]);

  const { data: revisiones = [], isLoading } = useQuery({
    queryKey: ['reviews', evaluacion.id],
    queryFn: () => api.reviews.list(evaluacion.id),
  });

  const mut = useMutation({
    mutationFn: ({ accion, texto, opts }: { accion: AccionRevision; texto: string; opts?: OpcionesRevision }) =>
      api.reviews.add(evaluacion.id, accion, texto, opts),
    onSuccess: async () => {
      setComentario('');
      setError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['reviews', evaluacion.id] }),
        qc.invalidateQueries({ queryKey: ['project', proyecto.id] }),
        qc.invalidateQueries({ queryKey: ['project-history', proyecto.id] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la revisión');
    },
  });

  const puedeNota = can(user?.rol, 'revision.nota');
  const puedeConfirmar = can(user?.rol, 'revision.confirmar');
  const puedeAprobar = can(user?.rol, 'revision.aprobar') && proyecto.estado === 'EN_REVISION_COMITE';
  const esAnulacion = Boolean(
    propuestaElegida && evaluacion.recomendada_id && propuestaElegida !== evaluacion.recomendada_id,
  );

  const enviar = (accion: AccionRevision) => {
    const texto = comentario.trim();
    if ((accion === 'nota' || accion === 'rechazar') && !texto) {
      setError('Escribe un comentario para esta acción.');
      return;
    }
    if (accion === 'aprobar' && esAnulacion && texto.length < 10) {
      setError('Cuando adjudicas una propuesta distinta a la recomendada por el agente debes justificar el cambio (mínimo 10 caracteres).');
      return;
    }
    mut.mutate({
      accion,
      texto,
      opts: accion === 'aprobar' ? { propuesta_adjudicada_id: propuestaElegida || evaluacion.recomendada_id } : undefined,
    });
  };

  return (
    <Card>
      <CardHeader
        title="Revisión humana y aprobación del comité"
        subtitle="Registro de observaciones, confirmación técnica y aprobación final"
      />
      <CardBody className="space-y-5">
        {isLoading ? (
          <Spinner label="Cargando historial de revisiones..." />
        ) : revisiones.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no hay revisiones registradas para esta evaluación.</p>
        ) : (
          <ul className="space-y-3">
            {revisiones.map((r) => {
              const targetProp = r.propuesta_evaluacion_id
                ? evaluacion.resultados.find(
                    (x) => (x.evaluacion_propuesta_id ?? x.propuesta_id) === r.propuesta_evaluacion_id,
                  )
                : null;
              return (
                <li key={r.id} className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{r.usuario}</span>
                      <Badge tone="slate">{ROL_LABEL[r.rol]}</Badge>
                      <Badge tone={ACCION_TONE[r.accion]}>{ACCION_REVISION_LABEL[r.accion]}</Badge>
                      {r.es_anulacion && <Badge tone="amber">Adjudicación alternativa</Badge>}
                      {targetProp && <Badge tone="indigo">{targetProp.codigo}</Badge>}
                    </div>
                    <span className="text-xs text-slate-500">{datetime(r.fecha)}</span>
                  </div>
                  {r.comentario && <p className="mt-2 text-sm text-slate-700">{r.comentario}</p>}
                </li>
              );
            })}
          </ul>
        )}

        {(puedeNota || puedeConfirmar || puedeAprobar) && (
          <div className="space-y-3 border-t border-slate-200 pt-4 print:hidden">
            {error && (
              <div role="alert">
                <Alert tone="error">{error}</Alert>
              </div>
            )}

            {puedeAprobar && validas.length > 0 && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <label htmlFor="reviewpanel-adjudicar" className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Propuesta a adjudicar
                </label>
                <select
                  id="reviewpanel-adjudicar"
                  className="input text-sm"
                  value={propuestaElegida}
                  onChange={(e) => setPropuestaElegida(e.target.value)}
                  disabled={mut.isPending}
                >
                  {validas.map((r) => (
                    <option key={r.propuesta_id} value={r.propuesta_id}>
                      #{r.posicion} · {r.proveedor} ({r.codigo}) — {money(r.total_ajustado_usd)}
                      {r.propuesta_id === evaluacion.recomendada_id ? ' · Recomendada por el agente' : ''}
                    </option>
                  ))}
                </select>
                {esAnulacion && (
                  <Alert tone="warning" title="Selección alternativa al dictamen del agente">
                    Estás eligiendo una propuesta distinta a la recomendada (#1). El comentario explicando los motivos es obligatorio para registrar la adjudicación alternativa.
                  </Alert>
                )}
              </div>
            )}

            <div>
              <label htmlFor="reviewpanel-campo-1" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Comentario u observación del evaluador {esAnulacion ? '(obligatorio)' : ''}
              </label>
              <textarea
                id="reviewpanel-campo-1"
                rows={3}
                className="input"
                placeholder="Agrega observaciones técnicas, confirmación de precios o motivos de aprobación/devolución..."
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                disabled={mut.isPending}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {puedeNota && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => enviar('nota')}
                  loading={mut.isPending}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  Agregar nota
                </Button>
              )}
              {puedeConfirmar && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => enviar('confirmar')}
                  loading={mut.isPending}
                >
                  <CheckCheck className="h-4 w-4" />
                  Confirmar análisis
                </Button>
              )}
              {puedeAprobar && (
                <>
                  <Button
                    size="sm"
                    onClick={() => enviar('aprobar')}
                    loading={mut.isPending}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Aprobar adjudicación
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => enviar('rechazar')}
                    loading={mut.isPending}
                  >
                    <XOctagon className="h-4 w-4" />
                    Rechazar y devolver
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
