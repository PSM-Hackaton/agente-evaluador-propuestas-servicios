// Tipos que reflejan las tablas definidas en docs/PLAN_DE_TRABAJO.md (§3.2).
// El backend debe devolver JSON con estos mismos nombres de campos.

export type Rol = 'admin' | 'cargador' | 'revisor' | 'aprobador' | 'auditor';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
  activo: boolean;
  creado_en: string;
}

export interface NuevoUsuario {
  nombre: string;
  email: string;
  rol: Rol;
  password: string;
}

export type EstadoProyecto =
  | 'EN_RECEPCION'
  | 'EN_EVALUACION'
  | 'EN_REVISION_COMITE'
  | 'ADJUDICADO'
  | 'CERRADO';

export type Moneda = 'USD' | 'VES';

export interface Proyecto {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  presupuesto_ref: number | null;
  moneda_ref: Moneda;
  estado: EstadoProyecto;
  archivo_proyecto: string | null; // nombre del documento del proyecto
  creado_por: string; // nombre del usuario
  creado_en: string;
  total_propuestas: number;
}

export interface NuevoProyecto {
  nombre: string;
  descripcion: string;
  ubicacion: string;
  presupuesto_ref: number | null;
  moneda_ref: Moneda;
}

export interface HistorialEstado {
  id: string;
  proyecto_id: string;
  estado_anterior: EstadoProyecto | null;
  estado_nuevo: EstadoProyecto;
  usuario: string;
  fecha: string;
  nota: string | null;
}

export interface Proveedor {
  id: string;
  nombre: string;
  rif: string | null;
  ubicacion: string | null;
  telefono: string | null;
  email: string | null;
  alerta: boolean;
  motivo_alerta: string | null;
  total_participaciones: number;
}

export interface Participacion {
  proyecto_id: string;
  proyecto_nombre: string;
  propuesta_codigo: string;
  fecha: string;
  resultado: 'pendiente' | 'valida' | 'descartada' | 'adjudicada';
  posicion: number | null;
  motivos_descarte: MotivoDescarte[];
  total_ajustado_usd: number | null;
}

export interface ProveedorDetalle extends Proveedor {
  participaciones: Participacion[];
}

export type TipoArchivo = 'pdf' | 'pdf_escaneado' | 'xlsx' | 'imagen' | 'captura';

export interface Propuesta {
  id: string;
  codigo: string; // nombre del archivo sin extensión
  proyecto_id: string;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  archivo_nombre: string;
  tipo: TipoArchivo;
  moneda: Moneda | null;
  total_declarado: number | null;
  estado: 'cargada' | 'procesada' | 'error';
  subido_en: string;
}

export type MotivoDescarte =
  | 'alcance'
  | 'incompatibilidad'
  | 'capacidad'
  | 'obsoleto'
  | 'abusivo'
  | 'aritmetico'
  | 'inyeccion';

export interface ItemEvaluado {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal_declarado: number;
  subtotal_calculado: number;
  precio_mercado: number | null;
  fuente_mercado: string | null;
  sobreprecio_pct: number | null;
}

export type ConceptoAjuste = 'flete' | 'recargo' | 'seguro' | 'iva' | 'instalacion' | 'otro';

export interface AjusteCosto {
  concepto: ConceptoAjuste;
  descripcion: string;
  monto_usd: number;
  porcentaje: number | null;
  fuente_texto: string; // texto literal donde el agente encontró el costo
}

export interface ResultadoPropuesta {
  propuesta_id: string;
  codigo: string;
  proveedor: string;
  tipo: TipoArchivo;
  posicion: number;
  valida: boolean;
  motivos_descarte: MotivoDescarte[];
  moneda: Moneda;
  total_declarado: number; // en la moneda original
  total_declarado_usd: number;
  ajustes: AjusteCosto[];
  total_ajustado_usd: number;
  puntaje_tecnico: number; // 0-100
  dictamen: string;
  items: ItemEvaluado[];
}

export interface Evaluacion {
  id: string;
  proyecto_id: string;
  estado: 'en_curso' | 'completada' | 'error';
  inicio: string;
  fin: string | null;
  recomendada_id: string | null;
  ranking: string[]; // códigos de propuesta en orden
  tasa_bcv_usada: number;
  ejecutada_por: string;
  resultados: ResultadoPropuesta[];
}

export type PasoAgente =
  | 'inicio'
  | 'lectura'
  | 'extraccion'
  | 'aritmetica'
  | 'alcance'
  | 'compatibilidad'
  | 'logistica'
  | 'mercado'
  | 'inyeccion'
  | 'normalizacion'
  | 'ranking'
  | 'dictamen'
  | 'error';

export interface TrazaAgente {
  id: string;
  ts: string;
  paso: PasoAgente;
  propuesta_id: string | null;
  codigo: string | null;
  mensaje: string;
  nivel: 'info' | 'ok' | 'alerta' | 'error';
  datos?: Record<string, unknown>;
}

export type AccionRevision = 'nota' | 'confirmar' | 'aprobar' | 'rechazar';

export interface Revision {
  id: string;
  evaluacion_id: string;
  usuario: string;
  rol: Rol;
  accion: AccionRevision;
  comentario: string;
  fecha: string;
}

export interface RegistroAuditoria {
  id: string;
  usuario: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  cambios: Record<string, unknown> | null;
  ip: string | null;
  fecha: string;
}

export interface TasaCambio {
  fecha: string;
  usd_ves: number;
  fuente: 'bcv' | 'manual';
}

export interface MensajeChat {
  id: string;
  rol: 'user' | 'assistant';
  contenido: string;
  fecha: string;
}

export type FormatoExport = 'pdf' | 'xlsx';

/** Contrato que implementan tanto la API real (http.ts) como la simulada (mock/). */
export interface Api {
  auth: {
    login(email: string, password: string): Promise<{ token: string; user: Usuario }>;
    me(): Promise<Usuario>;
  };
  projects: {
    list(): Promise<Proyecto[]>;
    get(id: string): Promise<Proyecto>;
    create(data: NuevoProyecto, archivo: File | null): Promise<Proyecto>;
    changeState(id: string, estado: EstadoProyecto, nota?: string): Promise<Proyecto>;
    history(id: string): Promise<HistorialEstado[]>;
  };
  proposals: {
    list(projectId: string): Promise<Propuesta[]>;
    upload(projectId: string, files: File[]): Promise<Propuesta[]>;
    remove(id: string): Promise<void>;
  };
  evaluations: {
    start(projectId: string): Promise<Evaluacion>;
    latest(projectId: string): Promise<Evaluacion | null>;
    get(id: string): Promise<Evaluacion>;
    trazas(id: string): Promise<TrazaAgente[]>;
    /** Suscribe a la trazabilidad en vivo. Devuelve una función para cancelar. */
    stream(
      id: string,
      onEvent: (t: TrazaAgente) => void,
      onDone: (e: Evaluacion | null) => void,
      onError?: (msg: string) => void,
    ): () => void;
    exportFile(id: string, formato: FormatoExport): Promise<Blob>;
  };
  reviews: {
    list(evaluacionId: string): Promise<Revision[]>;
    add(evaluacionId: string, accion: AccionRevision, comentario: string): Promise<Revision>;
  };
  suppliers: {
    list(): Promise<Proveedor[]>;
    get(id: string): Promise<ProveedorDetalle>;
  };
  audit: {
    list(): Promise<RegistroAuditoria[]>;
  };
  users: {
    list(): Promise<Usuario[]>;
    create(data: NuevoUsuario): Promise<Usuario>;
    update(id: string, data: Partial<Pick<Usuario, 'nombre' | 'rol' | 'activo'>>): Promise<Usuario>;
  };
  currency: {
    bcv(): Promise<TasaCambio>;
  };
  chat: {
    history(projectId: string): Promise<MensajeChat[]>;
    send(projectId: string, contenido: string): Promise<MensajeChat>;
  };
}
