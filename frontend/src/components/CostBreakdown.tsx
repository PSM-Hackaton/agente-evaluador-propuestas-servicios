import type { ResultadoPropuesta } from '../api/types';
import { money, number, pct } from '../lib/format';
import { CONCEPTO_LABEL } from '../lib/labels';
import { cn } from '../lib/cn';
import { Badge } from './ui';

interface CostBreakdownProps {
  resultado: ResultadoPropuesta;
  tasaBcv: number;
}

export function CostBreakdown({ resultado: r, tasaBcv }: CostBreakdownProps) {
  const diffPct =
    r.total_declarado_usd > 0
      ? ((r.total_ajustado_usd - r.total_declarado_usd) / r.total_declarado_usd) * 100
      : 0;

  return (
    <div className="space-y-5">
      {/* Desglose paso a paso */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Normalización y desglose del costo real
        </h4>
        <div className="mt-3 space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-700">
              Monto total declarado ({r.moneda})
            </span>
            <span className="font-medium tabular-nums text-slate-900">
              {money(r.total_declarado, r.moneda)}
            </span>
          </div>

          {r.moneda === 'VES' && (
            <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 text-slate-600">
              <span>Conversión a USD según tasa BCV (Bs. {number(tasaBcv)} / USD)</span>
              <span className="font-medium tabular-nums text-slate-900">
                {money(r.total_declarado_usd)}
              </span>
            </div>
          )}

          {r.ajustes.length === 0 ? (
            <div className="flex items-center justify-between gap-4 border-t border-slate-200/80 pt-2 text-slate-500">
              <span>Costos ocultos, fletes o recargos adicionales</span>
              <span className="tabular-nums">$ 0,00</span>
            </div>
          ) : (
            r.ajustes.map((a, idx) => (
              <div key={idx} className="border-t border-slate-200/80 pt-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="amber">+ {CONCEPTO_LABEL[a.concepto]}</Badge>
                      <span className="font-medium text-slate-800">{a.descripcion}</span>
                      {a.porcentaje != null && (
                        <span className="text-xs text-slate-500">({number(a.porcentaje)} %)</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs italic text-slate-500">“{a.fuente_texto}”</p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums text-amber-700">
                    + {money(a.monto_usd)}
                  </span>
                </div>
              </div>
            ))
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-slate-300 pt-3">
            <div>
              <p className="font-semibold text-slate-900">Costo real ajustado (USD)</p>
              <p className="text-xs text-slate-500">
                Equivalente en bolívares: {money(r.total_ajustado_usd * tasaBcv, 'VES')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums text-slate-900">
                {money(r.total_ajustado_usd)}
              </p>
              {Math.abs(diffPct) > 0.05 && (
                <p className="text-xs font-medium text-amber-700">
                  {pct(diffPct)} respecto al declarado en USD
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de ítems verificados */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Auditoría aritmética y contraste de mercado por ítem
        </h4>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="table-base">
            <thead>
              <tr>
                <th>Descripción</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">P. Unit.</th>
                <th className="text-right">Subt. declarado</th>
                <th className="text-right">Subt. calculado</th>
                <th className="text-right">Ref. mercado</th>
                <th className="text-right">Sobreprecio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {r.items.map((it, idx) => {
                const errArit = Math.abs(it.subtotal_declarado - it.subtotal_calculado) > 0.009;
                const sobreprecioAlto = (it.sobreprecio_pct ?? 0) > 40;
                return (
                  <tr key={idx} className={errArit ? 'bg-red-50/60' : undefined}>
                    <td className="text-slate-800">{it.descripcion}</td>
                    <td className="text-right tabular-nums">{number(it.cantidad, 0)}</td>
                    <td className="text-right tabular-nums">{money(it.precio_unitario)}</td>
                    <td className={cn('text-right tabular-nums', errArit && 'font-semibold text-red-700')}>
                      {money(it.subtotal_declarado)}
                    </td>
                    <td className={cn('text-right tabular-nums', errArit && 'font-semibold text-emerald-700')}>
                      {money(it.subtotal_calculado)}
                    </td>
                    <td className="text-right tabular-nums text-slate-600">
                      {it.precio_mercado != null ? (
                        <span title={it.fuente_mercado ?? undefined}>{money(it.precio_mercado)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {it.sobreprecio_pct != null ? (
                        <span
                          className={cn(
                            'font-medium',
                            sobreprecioAlto
                              ? 'text-red-700'
                              : it.sobreprecio_pct > 15
                                ? 'text-amber-700'
                                : 'text-slate-600',
                          )}
                        >
                          {pct(it.sobreprecio_pct)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
