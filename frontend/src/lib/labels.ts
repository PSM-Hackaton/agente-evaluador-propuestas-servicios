import type { EstadoProyecto, Moneda, Rol, TipoArchivo, MotivoDescarte, ConceptoAjuste, PasoAgente, AccionRevision } from '../api/types';

export const ESTADOS: EstadoProyecto[] = [
  'EN_RECEPCION',
  'EN_EVALUACION',
  'EN_REVISION_COMITE',
  'ADJUDICADO',
  'CERRADO',
];

export const ESTADO_LABEL: Record<EstadoProyecto, string> = {
  EN_RECEPCION: 'En recepción',
  EN_EVALUACION: 'En evaluación',
  EN_REVISION_COMITE: 'En revisión del comité',
  ADJUDICADO: 'Adjudicado',
  CERRADO: 'Cerrado',
};

export type Tone = 'slate' | 'blue' | 'amber' | 'violet' | 'green' | 'red' | 'indigo';

export const ESTADO_TONE: Record<EstadoProyecto, Tone> = {
  EN_RECEPCION: 'blue',
  EN_EVALUACION: 'amber',
  EN_REVISION_COMITE: 'violet',
  ADJUDICADO: 'green',
  CERRADO: 'slate',
};

export const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administrador',
  cargador: 'Carga de documentos',
  revisor: 'Revisor técnico-financiero',
  aprobador: 'Aprobador',
  auditor: 'Auditor (solo lectura)',
};

export const ROLES: Rol[] = ['admin', 'cargador', 'revisor', 'aprobador', 'auditor'];

export const TIPO_LABEL: Record<TipoArchivo, string> = {
  pdf: 'PDF digital',
  pdf_escaneado: 'PDF escaneado',
  xlsx: 'Hoja de cálculo',
  imagen: 'Imagen / manuscrito',
  captura: 'Captura de chat',
};

export const MOTIVO_LABEL: Record<MotivoDescarte, string> = {
  alcance: 'Alcance incompleto',
  incompatibilidad: 'Incompatibilidad técnica',
  capacidad: 'Capacidad insuficiente',
  obsoleto: 'Equipo obsoleto o reciclado',
  abusivo: 'Costos o condiciones abusivas',
  aritmetico: 'Error aritmético',
  inyeccion: 'Instrucciones ocultas a la IA',
};

export const CONCEPTO_LABEL: Record<ConceptoAjuste, string> = {
  flete: 'Flete / traslado',
  recargo: 'Recargo',
  seguro: 'Seguro',
  iva: 'IVA',
  instalacion: 'Instalación',
  otro: 'Otro',
};

export const PASO_LABEL: Record<PasoAgente, string> = {
  inicio: 'Inicio',
  lectura: 'Lectura de documento',
  extraccion: 'Extracción',
  aritmetica: 'Verificación aritmética',
  alcance: 'Alcance',
  compatibilidad: 'Compatibilidad técnica',
  logistica: 'Letra pequeña / logística',
  mercado: 'Precio de mercado',
  inyeccion: 'Seguridad del documento',
  normalizacion: 'Normalización de moneda',
  ranking: 'Ranking',
  dictamen: 'Dictamen',
  error: 'Error',
};

export const ACCION_REVISION_LABEL: Record<AccionRevision, string> = {
  nota: 'Nota',
  confirmar: 'Confirma análisis',
  aprobar: 'Aprueba adjudicación',
  rechazar: 'Rechaza / devuelve',
};

export const MONEDAS: Moneda[] = ['USD', 'VES'];
