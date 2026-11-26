import type { Evaluacion, Proyecto } from '../api/types';
import { CONCEPTO_LABEL, MOTIVO_LABEL, TIPO_LABEL } from './labels';
import { datetime, money } from './format';

function ordenados(ev: Evaluacion) {
  return [...ev.resultados].sort((a, b) => a.posicion - b.posicion);
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tabla(ev: Evaluacion): { header: string[]; rows: (string | number)[][] } {
  const header = [
    'Posicion',
    'Propuesta',
    'Proveedor',
    'Formato',
    'Estado',
    'Motivos de descarte',
    'Moneda',
    'Total declarado',
    'Total declarado USD',
    'Ajustes USD',
    'Detalle ajustes',
    'Total ajustado USD',
    'Puntaje tecnico',
    'Dictamen',
  ];
  const rows = ordenados(ev).map((r) => {
    const ajustes = r.ajustes.reduce((s, a) => s + a.monto_usd, 0);
    return [
      r.posicion,
      r.codigo,
      r.proveedor,
      TIPO_LABEL[r.tipo],
      r.valida ? 'Valida' : 'Descartada',
      r.motivos_descarte.map((m) => MOTIVO_LABEL[m]).join(', '),
      r.moneda,
      r.total_declarado.toFixed(2),
      r.total_declarado_usd.toFixed(2),
      ajustes.toFixed(2),
      r.ajustes.map((a) => `${CONCEPTO_LABEL[a.concepto]}: ${a.monto_usd.toFixed(2)}`).join(' | '),
      r.total_ajustado_usd.toFixed(2),
      r.puntaje_tecnico,
      r.dictamen,
    ];
  });
  return { header, rows };
}

/** CSV con separador ";" y BOM para que Excel en español lo abra bien. */
export function evaluacionToCSV(ev: Evaluacion): string {
  const { header, rows } = tabla(ev);
  return '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
}

export function evaluacionToMarkdown(ev: Evaluacion, proyecto: Proyecto): string {
  const res = ordenados(ev);
  const rec = res.find((r) => r.propuesta_id === ev.recomendada_id);
  const validas = res.filter((r) => r.valida);
  const descartadas = res.filter((r) => !r.valida);
  const lines: string[] = [];
  lines.push(`# Informe de Análisis y Factibilidad Financiera`);
  lines.push('');
  lines.push(`**Proyecto:** ${proyecto.nombre}  `);
  lines.push(`**Ubicación:** ${proyecto.ubicacion}  `);
  lines.push(`**Fecha de evaluación:** ${datetime(ev.fin ?? ev.inicio)}  `);
  lines.push(`**Tasa BCV usada:** Bs. ${ev.tasa_bcv_usada} por USD  `);
  lines.push(`**Propuestas evaluadas:** ${res.length} (${validas.length} válidas, ${descartadas.length} descartadas)`);
  lines.push('');
  if (rec) {
    lines.push(`## Propuesta recomendada`);
    lines.push('');
    lines.push(`**${rec.codigo}** — ${rec.proveedor}  `);
    lines.push(`Costo real ajustado: **${money(rec.total_ajustado_usd)}**  `);
    lines.push(`Puntaje técnico: ${rec.puntaje_tecnico}/100`);
    lines.push('');
    lines.push(rec.dictamen);
    lines.push('');
  }
  lines.push(`## Tabla comparativa`);
  lines.push('');
  lines.push('| # | Propuesta | Proveedor | Declarado | Declarado USD | Ajustes USD | Ajustado USD | Puntaje | Estado |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of res) {
    const aj = r.ajustes.reduce((s, a) => s + a.monto_usd, 0);
    lines.push(
      `| ${r.posicion} | ${r.codigo} | ${r.proveedor} | ${money(r.total_declarado, r.moneda)} | ${money(r.total_declarado_usd)} | ${money(aj)} | ${money(r.total_ajustado_usd)} | ${r.puntaje_tecnico} | ${r.valida ? 'Válida' : 'Descartada'} |`,
    );
  }
  lines.push('');
  lines.push(`## Dictamen por propuesta`);
  lines.push('');
  for (const r of res) {
    lines.push(`### ${r.posicion}. ${r.codigo} — ${r.valida ? 'Válida' : 'Descartada'}`);
    if (r.motivos_descarte.length) {
      lines.push(`**Motivos:** ${r.motivos_descarte.map((m) => MOTIVO_LABEL[m]).join(', ')}  `);
    }
    if (r.ajustes.length) {
      lines.push(`**Costos ocultos incorporados:**`);
      for (const a of r.ajustes) lines.push(`- ${CONCEPTO_LABEL[a.concepto]}: ${money(a.monto_usd)} — _"${a.fuente_texto}"_`);
    }
    lines.push('');
    lines.push(r.dictamen);
    lines.push('');
  }
  return lines.join('\n');
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tabla HTML que Excel abre como hoja de cálculo (.xls). Se usa en modo demo. */
export function evaluacionToExcelHtml(ev: Evaluacion): string {
  const { header, rows } = tabla(ev);
  return `<html><head><meta charset="utf-8"></head><body><table border="1">
<thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('\n')}</tbody>
</table></body></html>`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, mime: string) {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
}
