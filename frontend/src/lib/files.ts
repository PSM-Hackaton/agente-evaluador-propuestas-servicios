import type { TipoArchivo } from '../api/types';

// Mismas extensiones que SUPPORTED_DOCUMENT_EXTENSIONS del backend (services/ingestion/pipeline.py)
export const EXT_PERMITIDAS = [
  'pdf', 'docx', 'xlsx', 'xlsm', 'xls', 'csv', 'tsv',
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'txt', 'md',
];
export const ACCEPT_PROPUESTAS = EXT_PERMITIDAS.map((e) => `.${e}`).join(',');
export const ACCEPT_DOCUMENTO_PROYECTO = '.pdf,.docx,.txt,.md';

export function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Tipo preliminar según la extensión. El backend lo confirma (p. ej. detecta PDF escaneado). */
export function detectarTipo(name: string): TipoArchivo {
  const ext = extension(name);
  if (ext === 'pdf') return 'pdf';
  if (['xlsx', 'xlsm', 'xls', 'csv', 'tsv'].includes(ext)) return 'xlsx';
  if (['docx', 'txt', 'md'].includes(ext)) return 'documento';
  if (ext === 'png') return 'captura';
  return 'imagen';
}

export function esPermitido(name: string): boolean {
  return EXT_PERMITIDAS.includes(extension(name));
}

/** Identificador de la propuesta: nombre del archivo sin la extensión. */
export function codigoDesdeArchivo(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** "Propuesta_923_Grupo_Digital_Miranda_CA" → "Grupo Digital Miranda C.A." */
export function proveedorDesdeCodigo(codigo: string): string {
  const m = codigo.match(/^Propuesta_\d+_(.+)$/i);
  const base = (m ? m[1] : codigo).replace(/_+/g, ' ').trim();
  return base.replace(/\bCA$/i, 'C.A.');
}
