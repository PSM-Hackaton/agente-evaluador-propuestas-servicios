// Implementación real: consume la API REST/SSE del backend FastAPI (prefijo /api/v1).
// Las rutas reproducen app/api/v1/*.py de la rama del backend; la traducción de campos
// está en adapters.ts. Ver frontend/README.md para la tabla de endpoints.
import {
  accionHaciaBackend,
  fechaUtc,
  estadoDesdeBackend,
  estadoHaciaBackend,
  toAuditoria,
  toEvaluacion,
  toMensaje,
  toMotivos,
  toPropuesta,
  toProveedor,
  toProyecto,
  toRevision,
  toTasa,
  toTraza,
  toUsuario,
  type BAudit,
  type BBcv,
  type BChat,
  type BEvaluation,
  type BParticipation,
  type BProject,
  type BProposal,
  type BReview,
  type BSupplier,
  type BSupplierAlert,
  type BToken,
  type BTraceStep,
  type BUser,
} from './adapters';
import { detectarTipo } from '../lib/files';
import { ApiError, clearSession, getToken } from './session';
import type { Api, DashboardStats, HistorialEstado, Participacion, ProveedorDetalle, TipoArchivo } from './types';

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1').replace(/\/$/, '');

async function raw(path: string, opts: RequestInit = {}, token: string | null = getToken()): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...opts, headers });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Verifique que el backend esté en ejecución.');
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearSession();
    window.location.assign('/login');
  }
  if (!res.ok) {
    let msg = res.statusText || 'Error de comunicación con el servidor';
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') msg = body.detail;
      else if (Array.isArray(body.detail))
        msg = body.detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join('; ');
      else msg = JSON.stringify(body.detail ?? body);
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res;
}

async function req<T>(path: string, opts: RequestInit = {}, token?: string): Promise<T> {
  const res = await raw(path, opts, token ?? getToken());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;\n]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/["']/g, '').trim());
    } catch {
      /* ignorar */
    }
  }
  const plain = header.match(/filename="?([^";\n]+)"?/i);
  return plain?.[1]?.trim() ?? null;
}

/** Tipo de archivo de cada propuesta (el detalle de evaluación no lo incluye). */
async function tiposDeProyecto(projectId: string): Promise<Map<string, TipoArchivo>> {
  try {
    const props = await req<BProposal[]>(`/projects/${projectId}/proposals`);
    return new Map(props.map((p) => [p.id, detectarTipo(p.original_filename)]));
  } catch {
    return new Map();
  }
}

async function evaluacionDetalle(id: string) {
  const e = await req<BEvaluation>(`/evaluations/${id}`);
  return toEvaluacion(e, await tiposDeProyecto(e.project_id));
}

export const httpApi: Api = {
  auth: {
    async login(email, password) {
      const t = await req<BToken>('/auth/login', { method: 'POST', body: json({ email, password }) });
      const me = await req<BUser>('/auth/me', {}, t.access_token);
      return { token: t.access_token, user: toUsuario(me) };
    },
    me: async () => toUsuario(await req<BUser>('/auth/me')),
  },

  dashboard: {
    async stats(): Promise<DashboardStats> {
      const r = await req<{
        active_supplier_alerts: number;
        prompt_injections_blocked: number;
        security_status: {
          encryption_at_rest: string;
          db_sensitive_columns_encrypted: boolean;
          storage_files_encrypted: boolean;
          tls_enabled: boolean;
          tls_min_version: string;
          audit_log_entries: number;
          llm_provider: string;
        };
      }>('/dashboard/stats');
      return {
        active_supplier_alerts: r.active_supplier_alerts,
        prompt_injections_blocked: r.prompt_injections_blocked,
        encryption_at_rest: r.security_status.encryption_at_rest,
        db_encrypted: r.security_status.db_sensitive_columns_encrypted,
        storage_encrypted: r.security_status.storage_files_encrypted,
        tls_enabled: r.security_status.tls_enabled,
        tls_min_version: r.security_status.tls_min_version,
        audit_log_entries: r.security_status.audit_log_entries,
        llm_provider: r.security_status.llm_provider,
      };
    },
  },

  projects: {
    list: async () => (await req<BProject[]>('/projects')).map(toProyecto),
    get: async (id) => toProyecto(await req<BProject>(`/projects/${id}`)),
    async create(data, archivo) {
      const p = await req<BProject>('/projects', {
        method: 'POST',
        body: json({
          name: data.nombre,
          description: data.descripcion || null,
          execution_location: data.ubicacion,
          reference_budget: data.presupuesto_ref,
          reference_currency: data.moneda_ref,
        }),
      });
      if (!archivo) return toProyecto(p);
      const fd = new FormData();
      fd.append('file', archivo);
      return toProyecto(await req<BProject>(`/projects/${p.id}/document`, { method: 'POST', body: fd }));
    },
    changeState: async (id, estado, nota) =>
      toProyecto(
        await req<BProject>(`/projects/${id}/status`, {
          method: 'POST',
          body: json({ target_status: estadoHaciaBackend(estado), notes: nota ?? null }),
        }),
      ),
    async history(id) {
      // El backend no expone un historial de estados propio: se reconstruye desde la bitácora.
      const logs = await req<BAudit[]>(
        `/audit-logs?resource_type=project&resource_id=${encodeURIComponent(id)}&limit=500`,
      );
      const out: HistorialEstado[] = [];
      for (const a of [...logs].reverse()) {
        const d = (a.details ?? {}) as Record<string, string | null>;
        if (a.action === 'project.create') {
          out.push({
            id: a.id,
            proyecto_id: id,
            estado_anterior: null,
            estado_nuevo: 'EN_RECEPCION',
            usuario: a.actor_email,
            fecha: fechaUtc(a.created_at),
            nota: 'Proyecto creado',
          });
        } else if (a.action === 'project.status_transition' && d.to_status) {
          out.push({
            id: a.id,
            proyecto_id: id,
            estado_anterior: d.from_status ? estadoDesdeBackend(d.from_status) : null,
            estado_nuevo: estadoDesdeBackend(d.to_status),
            usuario: a.actor_email,
            fecha: fechaUtc(a.created_at),
            nota: d.notes ?? null,
          });
        }
      }
      return out;
    },
    documentUrl(id) {
      const token = getToken() ?? '';
      return `${BASE}/projects/${id}/document/download?token=${encodeURIComponent(token)}`;
    },
  },

  proposals: {
    list: async (projectId) => (await req<BProposal[]>(`/projects/${projectId}/proposals`)).map(toPropuesta),
    async upload(projectId, files) {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const r = await req<BProposal[]>(`/projects/${projectId}/proposals`, { method: 'POST', body: fd });
      return r.map(toPropuesta);
    },
    remove: (id) => req<void>(`/proposals/${id}`, { method: 'DELETE' }),
    downloadUrl(id) {
      const token = getToken() ?? '';
      return `${BASE}/proposals/${id}/download?token=${encodeURIComponent(token)}`;
    },
  },

  evaluations: {
    async start(projectId) {
      const e = await req<BEvaluation>(`/projects/${projectId}/evaluate`, {
        method: 'POST',
        body: json({ run_in_background: true, enable_web_search: true }),
      });
      return toEvaluacion(e, await tiposDeProyecto(projectId));
    },
    async latest(projectId) {
      const p = await req<BProject>(`/projects/${projectId}`);
      if (!p.latest_evaluation_id) return null;
      try {
        return await evaluacionDetalle(p.latest_evaluation_id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    get: (id) => evaluacionDetalle(id),
    async trazas(id) {
      const e = await req<BEvaluation>(`/evaluations/${id}`);
      return (e.trace_steps ?? []).map((t) => toTraza(id, t));
    },
    stream(id, onEvent, onDone, onError) {
      // EventSource no permite cabeceras: el token viaja como query param (?token=).
      const token = getToken() ?? '';
      const es = new EventSource(`${BASE}/evaluations/${id}/stream?token=${encodeURIComponent(token)}`);
      let terminado = false;
      es.addEventListener('trace_step', (ev) => {
        try {
          onEvent(toTraza(id, JSON.parse((ev as MessageEvent).data) as BTraceStep));
        } catch {
          /* evento mal formado */
        }
      });
      const fin = async () => {
        terminado = true;
        es.close();
        try {
          onDone(await evaluacionDetalle(id));
        } catch {
          onDone(null);
        }
      };
      es.addEventListener('completed', fin);
      es.addEventListener('failed', fin);
      es.onerror = () => {
        if (terminado) return;
        es.close();
        onError?.('Se perdió la conexión con el agente. Recargue la página para ver el estado actual.');
      };
      return () => {
        terminado = true;
        es.close();
      };
    },
    async exportFile(id, formato) {
      const res = await raw(`/evaluations/${id}/export/${formato}`);
      return {
        blob: await res.blob(),
        filename: parseContentDispositionFilename(res.headers.get('Content-Disposition')),
      };
    },
  },

  reviews: {
    async list(evaluacionId) {
      const e = await req<BEvaluation>(`/evaluations/${evaluacionId}`);
      return (e.human_reviews ?? []).map(toRevision);
    },
    async add(evaluacionId, accion, comentario) {
      const body = accionHaciaBackend(accion, comentario);
      const rev = toRevision(
        await req<BReview>(`/evaluations/${evaluacionId}/reviews`, { method: 'POST', body: json(body) }),
      );
      // El backend registra la revisión pero no mueve el proceso: «Aprobar» adjudica la
      // propuesta recomendada y «Rechazar y devolver» regresa el proyecto a evaluación,
      // igual que en el modo demostración.
      if (accion === 'aprobar' || accion === 'rechazar') {
        const e = await req<BEvaluation>(`/evaluations/${evaluacionId}`);
        await req<BProject>(`/projects/${e.project_id}/status`, {
          method: 'POST',
          body: json(
            accion === 'aprobar'
              ? { target_status: 'adjudicado', adjudicated_proposal_id: e.recommended_proposal_id, notes: body.notes }
              : { target_status: 'en_evaluacion', notes: body.notes },
          ),
        });
      }
      return rev;
    },
  },

  suppliers: {
    list: async () => (await req<BSupplier[]>('/suppliers')).map((s) => toProveedor(s)),
    async get(id) {
      const d = await req<{ supplier: BSupplier; alerts: BSupplierAlert[]; participation_history: BParticipation[] }>(
        `/suppliers/${id}`,
      );
      const alerta = d.alerts.find((a) => !a.is_resolved) ?? null;
      // El historial trae evaluation_run_id; se resuelve el proyecto y la fecha de cada evaluación.
      const runs = new Map<string, { proyecto_id: string; fecha: string; nombre: string }>();
      await Promise.all(
        [...new Set(d.participation_history.map((h) => h.evaluation_run_id))].map(async (runId) => {
          try {
            const e = await req<BEvaluation>(`/evaluations/${runId}`);
            const p = await req<BProject>(`/projects/${e.project_id}`);
            runs.set(runId, { proyecto_id: p.id, fecha: fechaUtc(e.started_at), nombre: p.name });
          } catch {
            /* evaluación no accesible */
          }
        }),
      );
      const participaciones: Participacion[] = d.participation_history.map((h) => {
        const r = runs.get(h.evaluation_run_id);
        return {
          proyecto_id: r?.proyecto_id ?? '',
          proyecto_nombre: r?.nombre ?? 'Proyecto',
          propuesta_codigo: h.proposal_identifier,
          fecha: r?.fecha ?? '',
          resultado: h.is_valid ? 'valida' : 'descartada',
          posicion: h.rank_position,
          motivos_descarte: toMotivos(h.discard_reasons),
          total_ajustado_usd: h.adjusted_tco_usd,
        };
      });
      const detalle: ProveedorDetalle = {
        ...toProveedor(d.supplier, alerta?.summary ?? null),
        participaciones,
      };
      return detalle;
    },
  },

  audit: {
    list: async () => (await req<BAudit[]>('/audit-logs?limit=500')).map(toAuditoria),
  },

  users: {
    list: async () => (await req<BUser[]>('/auth/users')).map(toUsuario),
    create: async (data) =>
      toUsuario(
        await req<BUser>('/auth/register', {
          method: 'POST',
          body: json({ email: data.email, full_name: data.nombre, password: data.password, role: data.rol }),
        }),
      ),
    async update(id, data) {
      // PATCH /auth/users/{id} exige el rol; si solo cambia el estado se reenvía el rol actual.
      let rol = data.rol;
      if (!rol) {
        const actual = (await req<BUser[]>('/auth/users')).find((u) => u.id === id);
        rol = actual ? toUsuario(actual).rol : undefined;
      }
      return toUsuario(
        await req<BUser>(`/auth/users/${id}`, {
          method: 'PATCH',
          body: json({ role: rol, is_active: data.activo ?? null }),
        }),
      );
    },
  },

  currency: {
    bcv: async () => toTasa(await req<BBcv>('/finance/bcv-rate')),
  },

  chat: {
    history: async (projectId) => (await req<BChat[]>(`/projects/${projectId}/chat`)).map(toMensaje),
    send: async (projectId, contenido) =>
      toMensaje(
        await req<BChat>(`/projects/${projectId}/chat`, { method: 'POST', body: json({ question: contenido }) }),
      ),
    clear: (projectId) => req<void>(`/projects/${projectId}/chat`, { method: 'DELETE' }),
  },
};
