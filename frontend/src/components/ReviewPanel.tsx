import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, MessageSquarePlus, ShieldCheck, XOctagon } from 'lucide-react';
import { api, type AccionRevision, type Evaluacion, type Proyecto } from '../api';
import { useAuth } from '../context/AuthContext';
import { datetime } from '../lib/format';
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
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: revisiones = [], isLoading } = useQuery({
    queryKey: ['reviews', evaluacion.id],
    queryFn: () => api.reviews.list(evaluacion.id),
  });

  const mut = useMutation({
    mutationFn: ({ accion, texto }: { accion: AccionRevision; texto: string }) =>
      api.reviews.add(evaluacion.id, accion, texto),
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

  const enviar = (accion: AccionRevision) => {
    const texto = comentario.trim();
    if ((accion === 'nota' || accion === 'rechazar') && !texto) {
      setError('Escribe un comentario para esta acción.');
      return;
    }
    mut.mutate({ accion, texto });
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
            {revisiones.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{r.usuario}</span>
                    <Badge tone="slate">{ROL_LABEL[r.rol]}</Badge>
                    <Badge tone={ACCION_TONE[r.accion]}>{ACCION_REVISION_LABEL[r.accion]}</Badge>
                  </div>
                  <span className="text-xs text-slate-500">{datetime(r.fecha)}</span>
                </div>
                {r.comentario && <p className="mt-2 text-sm text-slate-700">{r.comentario}</p>}
              </li>
            ))}
          </ul>
        )}

        {(puedeNota || puedeConfirmar || puedeAprobar) && (
          <div className="space-y-3 border-t border-slate-200 pt-4 print:hidden">
            {error && <Alert tone="error">{error}</Alert>}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Comentario u observación del evaluador
              </label>
              <textarea
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
