import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Eye, MessageSquarePlus } from 'lucide-react';
import { api, type Moneda, type ResultadoPropuesta } from '../api';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { datetime, money, number } from '../lib/format';
import { MOTIVO_LABEL, TIPO_LABEL } from '../lib/labels';
import { can } from '../lib/roles';
import { CostBreakdown } from './CostBreakdown';
import { Alert, Badge, Button, Modal } from './ui';

interface ComparisonTableProps {
  resultados: ResultadoPropuesta[];
  recomendadaId: string | null;
  tasaBcv: number;
  evaluacionId?: string;
}

type Filtro = 'todas' | 'validas' | 'descartadas';

export function ComparisonTable({ resultados, recomendadaId, tasaBcv, evaluacionId }: ComparisonTableProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [monedaVista, setMonedaVista] = useState<Moneda>('USD');
  const [detalle, setDetalle] = useState<ResultadoPropuesta | null>(null);
  const [notaPropuesta, setNotaPropuesta] = useState('');
  const [notaError, setNotaError] = useState<string | null>(null);
  const mult = monedaVista === 'VES' ? tasaBcv : 1;

  const { data: revisiones = [] } = useQuery({
    queryKey: ['reviews', evaluacionId],
    queryFn: () => api.reviews.list(evaluacionId!),
    enabled: !!evaluacionId,
  });

  const notaMut = useMutation({
    mutationFn: ({ peId, texto }: { peId: string; texto: string }) =>
      api.reviews.add(evaluacionId!, 'nota', texto, { propuesta_evaluacion_id: peId }),
    onSuccess: async () => {
      setNotaPropuesta('');
      setNotaError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['reviews', evaluacionId] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setNotaError(e instanceof Error ? e.message : 'No se pudo guardar la nota'),
  });

  const puedeNota = Boolean(evaluacionId && can(user?.rol, 'revision.nota'));
  const targetPeId = detalle ? detalle.evaluacion_propuesta_id ?? detalle.propuesta_id : null;
  const notasDetalle = targetPeId
    ? revisiones.filter((r) => r.propuesta_evaluacion_id === targetPeId)
    : [];

  const handleGuardarNota = (e: FormEvent) => {
    e.preventDefault();
    if (!targetPeId || !evaluacionId) return;
    if (notaPropuesta.trim().length < 3) {
      setNotaError('Escribe al menos 3 caracteres en la nota de la propuesta.');
      return;
    }
    notaMut.mutate({ peId: targetPeId, texto: notaPropuesta.trim() });
  };

  const ordenados = [...resultados].sort((a, b) => a.posicion - b.posicion);
  const validasCount = ordenados.filter((r) => r.valida).length;
  const descartadasCount = ordenados.length - validasCount;

  const visibles = ordenados.filter((r) => {
    if (filtro === 'validas') return r.valida;
    if (filtro === 'descartadas') return !r.valida;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['todas', `Todas (${ordenados.length})`],
              ['validas', `Válidas (${validasCount})`],
              ['descartadas', `Descartadas (${descartadasCount})`],
            ] as [Filtro, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filtro === k}
              onClick={() => setFiltro(k)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filtro === k
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Tasa: Bs. {number(tasaBcv)} / USD</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            {(['USD', 'VES'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={monedaVista === m}
                onClick={() => setMonedaVista(m)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium transition-colors',
                  monedaVista === m ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {m === 'USD' ? 'USD' : 'Bs.'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Propuesta / Proveedor</th>
              <th className="text-right">Declarado</th>
              <th className="text-right">Ajustes ocultos</th>
              <th className="text-right">Costo real {monedaVista === 'USD' ? 'USD' : 'Bs.'}</th>
              <th>Puntaje</th>
              <th>Estado</th>
              <th className="text-right print:hidden">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibles.map((r) => {
              const esRec = r.propuesta_id === recomendadaId;
              const sumAjustes = r.ajustes.reduce((s, a) => s + a.monto_usd, 0);
              return (
                <tr key={r.propuesta_id} className={esRec ? 'bg-emerald-50/40' : undefined}>
                  <td className="font-semibold text-slate-700">{r.posicion}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900">{r.proveedor}</span>
                      {esRec && (
                        <Badge tone="green">
                          <Award className="h-3 w-3" />
                          Recomendada
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{r.codigo}</span>
                      <Badge tone="slate">{TIPO_LABEL[r.tipo]}</Badge>
                    </div>
                  </td>
                  <td className="text-right tabular-nums text-slate-700">
                    <div>{money(r.total_declarado, r.moneda)}</div>
                    {r.moneda !== monedaVista && (
                      <div className="text-xs text-slate-500">{money(r.total_declarado_usd * mult, monedaVista)}</div>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {sumAjustes > 0 ? (
                      <span className="font-medium text-amber-700">+ {money(sumAjustes * mult, monedaVista)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-right font-semibold tabular-nums text-slate-900">
                    {money(r.total_ajustado_usd * mult, monedaVista)}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            'barra-puntaje h-full rounded-full',
                            r.valida ? 'bg-indigo-600' : 'bg-slate-300',
                          )}
                          aria-hidden="true"
                          ref={(element) => {
                            element?.style.setProperty(
                              '--progreso',
                              `${Math.min(100, Math.max(0, r.puntaje_tecnico))}%`,
                            );
                          }}
                        />
                      </div>
                      <span className="text-xs font-medium tabular-nums text-slate-700">
                        {r.puntaje_tecnico}/100
                      </span>
                    </div>
                  </td>
                  <td>
                    {r.valida ? (
                      <Badge tone="green">Válida</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <Badge tone="red">Descartada</Badge>
                        {r.motivos_descarte.map((m) => (
                          <Badge key={m} tone="amber">
                            {MOTIVO_LABEL[m]}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="text-right print:hidden">
                    <Button variant="secondary" size="sm" onClick={() => setDetalle(r)}>
                      <Eye className="h-3.5 w-3.5" />
                      Desglose
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!detalle}
        onClose={() => {
          setDetalle(null);
          setNotaPropuesta('');
          setNotaError(null);
        }}
        title={detalle ? `${detalle.codigo} — ${detalle.proveedor}` : ''}
        size="xl"
      >
        {detalle && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
              <span className="font-semibold">Dictamen: </span>
              {detalle.dictamen}
            </div>
            <CostBreakdown resultado={detalle} tasaBcv={tasaBcv} monedaVista={monedaVista} />

            {evaluacionId && (
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Notas del comité sobre esta propuesta ({notasDetalle.length})
                </h4>
                {notasDetalle.length === 0 ? (
                  <p className="text-xs text-slate-500">Sin notas específicas registradas para esta propuesta.</p>
                ) : (
                  <ul className="space-y-2">
                    {notasDetalle.map((n) => (
                      <li key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-slate-700">{n.usuario}</span>
                          <span>{datetime(n.fecha)}</span>
                        </div>
                        <p className="mt-1 text-slate-800">{n.comentario}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {puedeNota && (
                  <form onSubmit={handleGuardarNota} className="space-y-2">
                    {notaError && (
                      <div role="alert">
                        <Alert tone="error">{notaError}</Alert>
                      </div>
                    )}
                    <label htmlFor="prop-note-input" className="block text-xs font-medium text-slate-700">
                      Agregar nota específica sobre {detalle.codigo}
                    </label>
                    <textarea
                      id="prop-note-input"
                      rows={2}
                      className="input text-sm"
                      value={notaPropuesta}
                      onChange={(e) => setNotaPropuesta(e.target.value)}
                      placeholder="Observación técnica o económica vinculada a esta oferta..."
                      disabled={notaMut.isPending}
                    />
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" variant="secondary" loading={notaMut.isPending}>
                        <MessageSquarePlus className="h-4 w-4" />
                        Guardar nota en propuesta
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
