import type { Moneda } from '../api/types';

const num = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 });

export function money(n: number | null | undefined, moneda: Moneda = 'USD'): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${moneda === 'USD' ? '$' : 'Bs.'} ${num.format(n)}`;
}

export function number(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return decimals === 0 ? int.format(n) : num.format(n);
}

export function pct(n: number | null | undefined, signed = true): string {
  if (n == null || Number.isNaN(n)) return '—';
  const s = `${num.format(Math.abs(n))} %`;
  if (!signed) return s;
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function datetime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function duration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const s = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
