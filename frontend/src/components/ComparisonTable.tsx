import { useState } from 'react';
import { Award, Eye } from 'lucide-react';
import type { ResultadoPropuesta } from '../api/types';
import { cn } from '../lib/cn';
import { money } from '../lib/format';
import { MOTIVO_LABEL, TIPO_LABEL } from '../lib/labels';
import { CostBreakdown } from './CostBreakdown';
import { Badge, Button, Modal } from './ui';

interface ComparisonTableProps {
  resultados: ResultadoPropuesta[];
  recomendadaId: string | null;
  tasaBcv: number;
}

type Filtro = 'todas' | 'validas' | 'descartadas';

export function ComparisonTable({ resultados, recomendadaId, tasaBcv }: ComparisonTableProps) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [detalle, setDetalle] = useState<ResultadoPropuesta | null>(null);

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
      <div className="flex flex-wrap items-center gap-2 print:hidden">
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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="table-base">
          <thead>
            <tr>
              <th>#</th>
              <th>Propuesta / Proveedor</th>
              <th className="text-right">Declarado</th>
              <th className="text-right">Ajustes ocultos</th>
              <th className="text-right">Costo real USD</th>
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
                    {r.moneda !== 'USD' && (
                      <div className="text-xs text-slate-500">{money(r.total_declarado_usd)}</div>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {sumAjustes > 0 ? (
                      <span className="font-medium text-amber-700">+ {money(sumAjustes)}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-right font-semibold tabular-nums text-slate-900">
                    {money(r.total_ajustado_usd)}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            r.valida ? 'bg-indigo-600' : 'bg-slate-300',
                          )}
                          style={{ width: `${Math.min(100, Math.max(0, r.puntaje_tecnico))}%` }}
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
        onClose={() => setDetalle(null)}
        title={detalle ? `${detalle.codigo} — ${detalle.proveedor}` : ''}
        size="xl"
      >
        {detalle && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
              <span className="font-semibold">Dictamen: </span>
              {detalle.dictamen}
            </div>
            <CostBreakdown resultado={detalle} tasaBcv={tasaBcv} />
          </div>
        )}
      </Modal>
    </div>
  );
}
