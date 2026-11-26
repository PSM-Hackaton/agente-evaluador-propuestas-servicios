import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import type { TrazaAgente } from '../api/types';
import { cn } from '../lib/cn';
import { time } from '../lib/format';
import { PASO_LABEL, type Tone } from '../lib/labels';
import { Badge } from './ui';

interface TraceTimelineProps {
  trazas: TrazaAgente[];
  running?: boolean;
}

const NIVEL_ICON: Record<TrazaAgente['nivel'], { icon: typeof Info; color: string; tone: Tone }> = {
  info: { icon: Info, color: 'text-blue-600 bg-blue-50 ring-blue-200', tone: 'blue' },
  ok: { icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50 ring-emerald-200', tone: 'green' },
  alerta: { icon: AlertTriangle, color: 'text-amber-600 bg-amber-50 ring-amber-200', tone: 'amber' },
  error: { icon: XCircle, color: 'text-red-600 bg-red-50 ring-red-200', tone: 'red' },
};

export function TraceTimeline({ trazas, running = false }: TraceTimelineProps) {
  const alertas = trazas.filter((t) => t.nivel === 'alerta' || t.nivel === 'error').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <div className="flex items-center gap-2.5" role="status" aria-live="polite">
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              <span className="font-medium text-indigo-700">Agente ejecutándose en vivo...</span>
            </>
          ) : (
            <span className="font-medium text-slate-700">Trazabilidad registrada</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge tone="slate">{trazas.length} pasos</Badge>
          {alertas > 0 && <Badge tone="amber">{alertas} alertas detectadas</Badge>}
        </div>
      </div>

      {trazas.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          {running ? 'Esperando los primeros eventos del agente...' : 'No hay eventos de trazabilidad registrados.'}
        </p>
      ) : (
        <ol className="relative ml-3 space-y-3 border-l border-slate-200 pl-6">
          {trazas.map((t) => {
            const cfg = NIVEL_ICON[t.nivel];
            const Icon = cfg.icon;
            return (
              <li key={t.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[35px] top-1 flex h-6 w-6 items-center justify-center rounded-full ring-2',
                    cfg.color,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{time(t.ts)}</span>
                    <Badge tone={cfg.tone}>{PASO_LABEL[t.paso]}</Badge>
                    {t.codigo && (
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                        {t.codigo}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-800">{t.mensaje}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
