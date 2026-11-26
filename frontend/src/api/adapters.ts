// Traducción entre el contrato real del backend FastAPI (rama enggel, prefijo /api/v1,
// campos en inglés) y los tipos que consume la interfaz (types.ts, campos en castellano).
// Si el backend cambia un campo, solo hay que tocar este archivo.
import { detectarTipo, proveedorDesdeCodigo } from '../lib/files';
import type {
  AccionRevision,
  AjusteCosto,
  ConceptoAjuste,
  EstadoProyecto,
  Evaluacion,
  ItemEvaluado,
  MensajeChat,
  Moneda,
  MotivoDescarte,
  PasoAgente,
  Propuesta,
  Proveedor,
  Proyecto,
  RegistroAuditoria,
  ResultadoPropuesta,
  Revision,
  Rol,
  TasaCambio,
  TipoArchivo,
  TrazaAgente,
  Usuario,
} from './types';

// ── Esquemas del backend (app/schemas/*.py) ─────────────────────────────────
export interface BUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface BToken {
  access_token: string;
  refresh_token: string;
  role: string;
  user_id: string;
  full_name: string;
}

export interface BProject {
  id: string;
  name: string;
  description: string | null;
  execution_location: string;
  reference_budget: number | null;
  reference_currency: string;
  status: string;
  document_filename: string | null;
  proposals_count: number;
  evaluations_count: number;
  latest_evaluation_id: string | null;
  created_by_id: string | null;
  created_at: string;
}

export interface BProposal {
  id: string;
  project_id: string;
  supplier_id: string | null;
  proposal_identifier: string;
  original_filename: string;
  file_extension: string;
  ingestion_method: string | null;
  created_at: string;
}

interface BDiscardReason {
  code: string;
  detail?: string;
}

interface BTcoStep {
  step: string;
  amount_usd?: number;
  note?: string;
}

interface BLineItem {
  description?: string;
  quantity?: number;
  unit_price?: number;
  declared_subtotal?: number | null;
  computed_subtotal?: number | null;
}

interface BMarket {
  item?: string;
  market_reference_mid_usd?: number;
  reference_label?: string;
  variance_pct?: number;
  sources?: { title?: string; url?: string }[];
}

export interface BProposalEvaluation {
  id: string;
  proposal_id: string;
  proposal_identifier: string;
  supplier_name: string | null;
  is_valid: boolean;
  rank_position: number;
  technical_score: number;
  declared_currency: string;
  declared_total_original: number;
  declared_total_usd: number;
  shipping_cost_usd: number;
  installation_cost_usd: number;
  hidden_surcharges_usd: number;
  taxes_iva_usd: number;
  adjusted_tco_usd: number;
  discard_reasons: BDiscardReason[] | null;
  discard_verdict_text: string | null;
  recommendation_rationale: string | null;
  tco_breakdown: { steps?: BTcoStep[] } | null;
  line_items: BLineItem[] | null;
  fine_print_findings: string[] | null;
  market_comparison: BMarket[] | null;
}

export interface BTraceStep {
  id?: string;
  step_number: number;
  phase: string;
  proposal_identifier: string | null;
  tool_name: string | null;
  status?: string;
  message: string;
  metadata_json?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  timestamp?: string;
}

export interface BReview {
  id: string;
  evaluation_run_id: string;
  reviewer_name: string;
  reviewer_role: string;
  decision: string;
  notes: string;
  created_at: string;
}

export interface BEvaluation {
  id: string;
  project_id: string;
  status: string;
  llm_provider_used: string;
  bcv_rate_used: number;
  started_at: string;
  finished_at: string | null;
  recommended_proposal_id: string | null;
  ranking_identifiers: string[] | null;
  error_message: string | null;
  proposal_evaluations?: BProposalEvaluation[];
  trace_steps?: BTraceStep[];
  human_reviews?: BReview[];
}

export interface BSupplier {
  id: string;
  name: string;
  rif: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  alerts_count: number;
  proposals_count: number;
}

export interface BSupplierAlert {
  summary: string;
  is_resolved: boolean;
}

export interface BParticipation {
  evaluation_run_id: string;
  proposal_identifier: string;
  is_valid: boolean;
  rank_position: number;
  adjusted_tco_usd: number;
  discard_reasons: BDiscardReason[];
}

export interface BAudit {
  id: string;
  actor_email: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface BChat {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface BBcv {
  usd_to_ves: number;
  fetched_at: string;
  is_manual_override: boolean;
}

// ── Conversores ──────────────────────────────────────────────────────────────
/** El backend serializa datetimes UTC sin zona («2026-11-26T19:00:16»); se marcan como UTC. */
export function fechaUtc(v: string | null | undefined): string {
  if (!v) return '';
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v}Z`;
}

const ROLES: Rol[] = ['admin', 'cargador', 'revisor', 'aprobador', 'auditor'];
const asRol = (r: string): Rol => (ROLES.includes(r as Rol) ? (r as Rol) : 'auditor');

export const estadoDesdeBackend = (s: string): EstadoProyecto => s.toUpperCase() as EstadoProyecto;
export const estadoHaciaBackend = (e: EstadoProyecto): string => e.toLowerCase();

const asMoneda = (m: string | null | undefined): Moneda => (m === 'VES' || m === 'BS' ? 'VES' : 'USD');

export function toUsuario(u: BUser): Usuario {
  return {
    id: u.id,
    nombre: u.full_name,
    email: u.email,
    rol: asRol(u.role),
    activo: u.is_active,
    creado_en: fechaUtc(u.created_at),
  };
}

export function toProyecto(p: BProject): Proyecto {
  return {
    id: p.id,
    nombre: p.name,
    descripcion: p.description ?? '',
    ubicacion: p.execution_location,
    presupuesto_ref: p.reference_budget,
    moneda_ref: asMoneda(p.reference_currency),
    estado: estadoDesdeBackend(p.status),
    archivo_proyecto: p.document_filename,
    creado_por: '—',
    creado_en: fechaUtc(p.created_at),
    total_propuestas: p.proposals_count,
  };
}

export function toPropuesta(p: BProposal): Propuesta {
  return {
    id: p.id,
    codigo: p.proposal_identifier,
    proyecto_id: p.project_id,
    proveedor_id: p.supplier_id,
    proveedor_nombre: proveedorDesdeCodigo(p.proposal_identifier),
    archivo_nombre: p.original_filename,
    tipo: detectarTipo(p.original_filename),
    moneda: null,
    total_declarado: null,
    estado: p.ingestion_method ? 'procesada' : 'cargada',
    subido_en: fechaUtc(p.created_at),
  };
}

const MOTIVOS: Record<string, MotivoDescarte> = {
  alcance_incompleto: 'alcance',
  incompatibilidad_tecnica: 'incompatibilidad',
  capacidad_insuficiente: 'capacidad',
  equipos_obsoletos_reciclados: 'obsoleto',
  costos_condiciones_abusivas: 'abusivo',
  error_aritmetico: 'aritmetico',
  inyeccion_prompt: 'inyeccion',
};

export function toMotivos(reasons: BDiscardReason[] | null | undefined): MotivoDescarte[] {
  const out = new Set<MotivoDescarte>();
  for (const r of reasons ?? []) {
    const m = MOTIVOS[r.code];
    if (m) out.add(m);
  }
  return [...out];
}

function conceptoDesdePaso(step: string): ConceptoAjuste {
  const s = step.toLowerCase();
  if (s.includes('flete') || s.includes('envío') || s.includes('envio')) return 'flete';
  if (s.includes('instalación') || s.includes('instalacion')) return 'instalacion';
  if (s.includes('iva')) return 'iva';
  if (s.includes('seguro')) return 'seguro';
  if (s.includes('recargo')) return 'recargo';
  return 'otro';
}

function toAjustes(pe: BProposalEvaluation): AjusteCosto[] {
  // tco_breakdown.steps es la fuente de verdad: el primer paso es el monto declarado y el
  // último el TCO; los intermedios son los costos añadidos. Los campos shipping_cost_usd e
  // installation_cost_usd pueden venir incluidos en el total declarado, por eso no se suman.
  const steps = pe.tco_breakdown?.steps;
  if (steps) {
    return steps
      .filter((s) => !/^monto declarado/i.test(s.step) && !/^costo total real/i.test(s.step) && (s.amount_usd ?? 0) !== 0)
      .map((s) => ({
        concepto: conceptoDesdePaso(s.step),
        descripcion: s.step,
        monto_usd: s.amount_usd ?? 0,
        porcentaje: null,
        fuente_texto: s.note ?? '',
      }));
  }
  const delta = Math.round((pe.adjusted_tco_usd - pe.declared_total_usd) * 100) / 100;
  if (delta <= 0) return [];
  return [
    {
      concepto: 'otro',
      descripcion: 'Costos añadidos al total declarado',
      monto_usd: delta,
      porcentaje: null,
      fuente_texto: (pe.fine_print_findings ?? []).join(' · '),
    },
  ];
}

function toItems(pe: BProposalEvaluation): ItemEvaluado[] {
  const mercado = pe.market_comparison ?? [];
  return (pe.line_items ?? []).map((it) => {
    const desc = it.description ?? '';
    const cantidad = Number(it.quantity ?? 0);
    const precio = Number(it.unit_price ?? 0);
    const calc = it.computed_subtotal ?? cantidad * precio;
    const ref = mercado.find((m) => m.item && desc && (desc.startsWith(m.item) || m.item.startsWith(desc.slice(0, 40))));
    return {
      descripcion: desc,
      cantidad,
      precio_unitario: precio,
      subtotal_declarado: it.declared_subtotal ?? calc,
      subtotal_calculado: calc,
      precio_mercado: ref?.market_reference_mid_usd ?? null,
      fuente_mercado: ref ? (ref.sources?.[0]?.url ?? ref.reference_label ?? null) : null,
      sobreprecio_pct: ref?.variance_pct ?? null,
    };
  });
}

export function toResultado(pe: BProposalEvaluation, tipos: Map<string, TipoArchivo>): ResultadoPropuesta {
  const motivos = toMotivos(pe.discard_reasons);
  const dictamen = pe.is_valid
    ? (pe.recommendation_rationale ?? 'Propuesta válida.')
    : pe.discard_verdict_text ||
      (pe.discard_reasons ?? []).map((r) => r.detail ?? r.code).join('; ') ||
      'Propuesta descartada.';
  return {
    propuesta_id: pe.proposal_id,
    codigo: pe.proposal_identifier,
    proveedor: pe.supplier_name ?? proveedorDesdeCodigo(pe.proposal_identifier),
    tipo: tipos.get(pe.proposal_id) ?? 'pdf',
    posicion: pe.rank_position,
    valida: pe.is_valid,
    motivos_descarte: motivos,
    moneda: asMoneda(pe.declared_currency),
    total_declarado: pe.declared_total_original,
    total_declarado_usd: pe.declared_total_usd,
    ajustes: toAjustes(pe),
    total_ajustado_usd: pe.adjusted_tco_usd,
    puntaje_tecnico: Math.round(pe.technical_score),
    dictamen,
    items: toItems(pe),
  };
}

const ESTADO_EVAL: Record<string, Evaluacion['estado']> = {
  completed: 'completada',
  failed: 'error',
  pending: 'en_curso',
  running: 'en_curso',
};

export function toEvaluacion(e: BEvaluation, tipos: Map<string, TipoArchivo>): Evaluacion {
  return {
    id: e.id,
    proyecto_id: e.project_id,
    estado: ESTADO_EVAL[e.status] ?? 'en_curso',
    inicio: fechaUtc(e.started_at),
    fin: e.finished_at ? fechaUtc(e.finished_at) : null,
    recomendada_id: e.recommended_proposal_id,
    ranking: e.ranking_identifiers ?? [],
    tasa_bcv_usada: e.bcv_rate_used,
    ejecutada_por: e.llm_provider_used ? `Agente (${e.llm_provider_used})` : 'Agente evaluador',
    resultados: (e.proposal_evaluations ?? []).map((pe) => toResultado(pe, tipos)),
  };
}

const PASOS: Record<string, PasoAgente> = {
  inicializacion: 'inicio',
  normalizacion_financiera: 'normalizacion',
  ingesta_multimodal: 'lectura',
  seguridad_inyeccion: 'inyeccion',
  historial_proveedor: 'lectura',
  verificacion_aritmetica: 'aritmetica',
  calculo_tco: 'logistica',
  auditoria_tecnica: 'compatibilidad',
  contraste_mercado: 'mercado',
  ranking: 'ranking',
  dictamen_final: 'dictamen',
  error: 'error',
};

function nivelDeTraza(t: BTraceStep): TrazaAgente['nivel'] {
  if (t.status === 'failed' || t.phase === 'error') return 'error';
  const meta = (t.metadata_json ?? t.metadata ?? {}) as Record<string, unknown>;
  const msg = t.message.toLowerCase();
  if (
    meta.is_valid === false ||
    meta.detected === true ||
    meta.status === 'sobrecosto_abusivo' ||
    /descart|discrepan|inyecci|alerta|abusiv|incumpl/.test(msg)
  )
    return 'alerta';
  if (/verificad|superad|válid|valida|correct/.test(msg)) return 'ok';
  return 'info';
}

export function toTraza(evaluacionId: string, t: BTraceStep): TrazaAgente {
  return {
    id: t.id ?? `${evaluacionId}-${t.step_number}`,
    ts: fechaUtc(t.created_at ?? t.timestamp) || new Date().toISOString(),
    paso: PASOS[t.phase] ?? 'extraccion',
    propuesta_id: null,
    codigo: t.proposal_identifier,
    mensaje: t.message,
    nivel: nivelDeTraza(t),
    datos: (t.metadata_json ?? t.metadata ?? undefined) as Record<string, unknown> | undefined,
  };
}

// El backend admite confirmed | observed | overridden | approved. «Rechazar y devolver»
// no existe como decisión: se registra como observación marcada con un prefijo.
const PREFIJO_RECHAZO = '[Rechazo] ';

export function accionHaciaBackend(accion: AccionRevision, comentario: string): { decision: string; notes: string } {
  const defecto: Record<AccionRevision, string> = {
    nota: 'Observación del evaluador',
    confirmar: 'Análisis técnico y financiero confirmado',
    aprobar: 'Adjudicación aprobada por el comité',
    rechazar: 'Evaluación rechazada y devuelta',
  };
  const texto = comentario.trim().length >= 3 ? comentario.trim() : defecto[accion];
  switch (accion) {
    case 'confirmar':
      return { decision: 'confirmed', notes: texto };
    case 'aprobar':
      return { decision: 'approved', notes: texto };
    case 'rechazar':
      return { decision: 'observed', notes: PREFIJO_RECHAZO + texto };
    default:
      return { decision: 'observed', notes: texto };
  }
}

export function toRevision(r: BReview): Revision {
  let accion: AccionRevision = 'nota';
  let comentario = r.notes;
  if (r.decision === 'confirmed') accion = 'confirmar';
  else if (r.decision === 'approved') accion = 'aprobar';
  else if (r.decision === 'overridden' || r.notes.startsWith(PREFIJO_RECHAZO)) {
    accion = 'rechazar';
    comentario = r.notes.replace(PREFIJO_RECHAZO, '');
  }
  return {
    id: r.id,
    evaluacion_id: r.evaluation_run_id,
    usuario: r.reviewer_name,
    rol: asRol(r.reviewer_role),
    accion,
    comentario,
    fecha: fechaUtc(r.created_at),
  };
}

export function toProveedor(s: BSupplier, motivo: string | null = null): Proveedor {
  return {
    id: s.id,
    nombre: s.name,
    rif: s.rif,
    ubicacion: s.location,
    telefono: s.phone,
    email: s.email,
    alerta: s.alerts_count > 0,
    motivo_alerta:
      motivo ?? (s.alerts_count > 0 ? `${s.alerts_count} alerta(s) de antecedentes registradas` : null),
    total_participaciones: s.proposals_count,
  };
}

export function toAuditoria(a: BAudit): RegistroAuditoria {
  return {
    id: a.id,
    usuario: a.actor_email,
    accion: a.action,
    entidad: a.resource_type,
    entidad_id: a.resource_id,
    cambios: a.details,
    ip: a.ip_address,
    fecha: fechaUtc(a.created_at),
  };
}

export function toMensaje(m: BChat): MensajeChat {
  return {
    id: m.id,
    rol: m.role === 'user' ? 'user' : 'assistant',
    contenido: m.content,
    fecha: fechaUtc(m.created_at),
  };
}

export function toTasa(b: BBcv): TasaCambio {
  return { fecha: fechaUtc(b.fetched_at), usd_ves: b.usd_to_ves, fuente: b.is_manual_override ? 'manual' : 'bcv' };
}
