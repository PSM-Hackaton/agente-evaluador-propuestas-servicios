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
  propuesta_adjudicada_id?: string | null;
  nota_adjudicacion?: string | null;
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
  representante?: string | null;
  telefono: string | null;
  email: string | null;
  notas?: string | null;
  alerta: boolean;
  motivo_alerta: string | null;
  total_participaciones: number;
}

export interface AlertaProveedor {
  id: string;
  proveedor_id: string;
  severidad: string;
  motivo: string;
  resumen: string;
  resuelta: boolean;
  fecha: string;
}

export interface ProveedorInput {
  nombre: string;
  rif?: string | null;
  ubicacion?: string | null;
  representante?: string | null;
  telefono?: string | null;
  email?: string | null;
  notas?: string | null;
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
  alertas: AlertaProveedor[];
  participaciones: Participacion[];
}

export type TipoArchivo = 'pdf' | 'pdf_escaneado' | 'xlsx' | 'imagen' | 'captura' | 'documento';

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
  evaluacion_propuesta_id?: string;
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

export interface EvaluacionResumen {
  id: string;
  proyecto_id: string;
  estado: Evaluacion['estado'];
  inicio: string;
  fin: string | null;
  tasa_bcv_usada: number;
  recomendada_codigo: string | null;
  ejecutada_por: string;
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
  propuesta_evaluacion_id?: string | null;
  propuesta_adjudicada_id?: string | null;
  es_anulacion?: boolean;
  usuario: string;
  rol: Rol;
  accion: AccionRevision;
  comentario: string;
  fecha: string;
}

export interface OpcionesRevision {
  propuesta_evaluacion_id?: string | null;
  propuesta_adjudicada_id?: string | null;
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
  origen?: string;
}

export interface TasaHistorialItem {
  id: string;
  usd_ves: number;
  fuente: string;
  es_manual: boolean;
  registrada_por: string | null;
  fecha: string;
}

export interface ParametrosEvaluacion {
  enable_web_search?: boolean;
  bcv_rate_override?: number | null;
  iva_rate?: number;
}

export interface MensajeChat {
  id: string;
  rol: 'user' | 'assistant';
  contenido: string;
  fecha: string;
}

export type FormatoExport = 'pdf' | 'markdown' | 'xlsx' | 'csv' | 'salida-json';

export interface ExportResult {
  blob: Blob;
  filename: string | null;
}

export interface DashboardStats {
  active_supplier_alerts: number;
  prompt_injections_blocked: number;
  encryption_at_rest: string;
  db_encrypted: boolean;
  storage_encrypted: boolean;
  tls_enabled: boolean;
  tls_min_version: string;
  audit_log_entries: number;
  llm_provider: string;
}

/** Contrato que implementan tanto la API real (http.ts) como la simulada (mock/). */
export interface Api {
  auth: {
    login(email: string, password: string): Promise<{ token: string; refreshToken?: string | null; user: Usuario }>;
    refresh(refreshToken: string): Promise<{ token: string; refreshToken?: string | null }>;
    me(): Promise<Usuario>;
  };
  dashboard: {
    stats(): Promise<DashboardStats>;
  };
  projects: {
    list(): Promise<Proyecto[]>;
    get(id: string): Promise<Proyecto>;
    create(data: NuevoProyecto, archivo: File | null): Promise<Proyecto>;
    changeState(
      id: string,
      estado: EstadoProyecto,
      nota?: string,
      propuestaAdjudicadaId?: string | null,
    ): Promise<Proyecto>;
    history(id: string): Promise<HistorialEstado[]>;
    documentUrl(id: string): Promise<string | null>;
  };
  proposals: {
    list(projectId: string): Promise<Propuesta[]>;
    upload(projectId: string, files: File[]): Promise<Propuesta[]>;
    remove(id: string): Promise<void>;
    downloadUrl(id: string): Promise<string | null>;
  };
  evaluations: {
    start(projectId: string, params?: ParametrosEvaluacion): Promise<Evaluacion>;
    list(projectId: string): Promise<EvaluacionResumen[]>;
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
    exportFile(id: string, formato: FormatoExport): Promise<ExportResult>;
  };
  reviews: {
    list(evaluacionId: string): Promise<Revision[]>;
    add(
      evaluacionId: string,
      accion: AccionRevision,
      comentario: string,
      opts?: OpcionesRevision,
    ): Promise<Revision>;
  };
  suppliers: {
    list(): Promise<Proveedor[]>;
    get(id: string): Promise<ProveedorDetalle>;
    create(data: ProveedorInput): Promise<Proveedor>;
    update(id: string, data: Partial<ProveedorInput>): Promise<Proveedor>;
    resolveAlert(alertId: string): Promise<AlertaProveedor>;
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
    bcv(refresh?: boolean): Promise<TasaCambio>;
    history(): Promise<TasaHistorialItem[]>;
    override(usdToVes: number, nota?: string): Promise<TasaCambio>;
  };
  chat: {
    history(projectId: string): Promise<MensajeChat[]>;
    send(projectId: string, contenido: string): Promise<MensajeChat>;
    clear(projectId: string): Promise<void>;
  };
}
