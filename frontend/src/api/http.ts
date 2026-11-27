// Implementación real: consume la API REST/SSE del backend FastAPI (prefijo /api/v1).
// Las rutas reproducen app/api/v1/*.py de la rama del backend; la traducción de campos
// está en adapters.ts. Ver frontend/README.md para la tabla de endpoints.
import {
  accionHaciaBackend,
  fechaUtc,
  estadoDesdeBackend,
  estadoHaciaBackend,
  toAlertaProveedor,
  toAuditoria,
  toEvaluacion,
  toEvaluacionResumen,
  toInvitacion,
  toMensaje,
  toMotivos,
  toPropuesta,
  toProveedor,
  toProyecto,
  toRevision,
  toTasa,
  toTasaHistorial,
  toTraza,
  toUsuario,
  toValidacionInvitacion,
  type BAudit,
  type BBcv,
  type BBcvHistoryItem,
  type BChat,
  type BEvaluation,
  type BInvitation,
  type BInvitationValidation,
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
import { ApiError, clearSession, getRefreshToken, getToken, updateTokens } from './session';
import type { Api, DashboardStats, HistorialEstado, Participacion, ProveedorDetalle, TipoArchivo } from './types';

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const SCHEME_PREFIX_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function parseApiBase(rawBase?: string, originFallback?: string): URL {
  const raw = rawBase ?? ((import.meta.env.VITE_API_URL as string | undefined) || '/api/v1');
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.includes('\\') || hasControlChars(trimmed)) {
    throw new ApiError(500, 'Configuración de VITE_API_URL inválida.');
  }
  const fallback =
    originFallback ??
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost');
  let url: URL;
  try {
    url = new URL(trimmed, fallback);
  } catch {
    throw new ApiError(500, 'Configuración de VITE_API_URL inválida.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new ApiError(500, 'Configuración de VITE_API_URL inválida.');
  }
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

const API_BASE: URL = parseApiBase();

export function buildApiUrl(path: string, base: URL = API_BASE): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || hasControlChars(path)) {
    throw new ApiError(400, 'Ruta de API inválida o fuera del origen permitido.');
  }
  const stripped = path.slice(1);
  if (stripped.startsWith('/') || SCHEME_PREFIX_RE.test(stripped)) {
    throw new ApiError(400, 'Ruta de API inválida o fuera del origen permitido.');
  }
  const rawPath = stripped.split(/[?#]/, 1)[0];
  if (rawPath.split('/').some((seg) => seg === '.' || seg === '..' || /^(%2e)+$/i.test(seg))) {
    throw new ApiError(400, 'Ruta de API inválida o fuera del origen permitido.');
  }
  const normalizedBase = base.pathname.endsWith('/') ? base : new URL(`${base.pathname}/`, base.origin);
  if (normalizedBase.protocol !== 'http:' && normalizedBase.protocol !== 'https:') {
    throw new ApiError(400, 'Ruta de API inválida o fuera del origen permitido.');
  }
  let url: URL;
  try {
    url = new URL(stripped, normalizedBase);
  } catch {
    throw new ApiError(400, 'Ruta de API inválida o fuera del origen permitido.');
  }
  const baseNoSlash =
    normalizedBase.pathname.length > 1 && normalizedBase.pathname.endsWith('/')
      ? normalizedBase.pathname.slice(0, -1)
      : normalizedBase.pathname;
  if (
    url.origin !== normalizedBase.origin ||
    url.protocol !== normalizedBase.protocol ||
    (url.pathname !== baseNoSlash && !url.pathname.startsWith(normalizedBase.pathname))
  ) {
    throw new ApiError(400, 'Ruta de API inválida o fuera del origen permitido.');
  }
  return url;
}

let refreshInFlight: Promise<string | null> | null = null;

async function tryRefreshSession(): Promise<string | null> {
  const rt = getRefreshToken();
  if (!rt) return null;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(buildApiUrl('/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as BToken;
        updateTokens(data.access_token, data.refresh_token);
        return data.access_token;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function raw(
  path: string,
  opts: RequestInit = {},
  token: string | null = getToken(),
  retried = false,
): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const url = buildApiUrl(path);
  let res: Response;
  try {
    // nosemgrep: nodejs_scan.javascript-ssrf-rule-node_ssrf -- código de navegador (no servidor Node); buildApiUrl solo admite rutas relativas al API_BASE del mismo origen y rechaza esquemas, '//', '\\', '..' y caracteres de control
    res = await fetch(url, { ...opts, headers });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Verifique que el backend esté en ejecución.');
  }
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (!retried) {
      const refreshed = await tryRefreshSession();
      if (refreshed) return raw(path, opts, refreshed, true);
    }
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

async function streamTicket(): Promise<string> {
  const { ticket } = await req<{ ticket: string }>('/auth/stream-ticket', { method: 'POST' });
  return ticket;
}

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
    const props = await req<BProposal[]>(`/projects/${encodeURIComponent(projectId)}/proposals`);
    return new Map(props.map((p) => [p.id, detectarTipo(p.original_filename)]));
  } catch {
    return new Map();
  }
}

async function evaluacionDetalle(id: string) {
  const e = await req<BEvaluation>(`/evaluations/${encodeURIComponent(id)}`);
  return toEvaluacion(e, await tiposDeProyecto(e.project_id));
}

export const httpApi: Api = {
  auth: {
    async login(email, password) {
      const t = await req<BToken>('/auth/login', { method: 'POST', body: json({ email, password }) });
      const me = await req<BUser>('/auth/me', {}, t.access_token);
      return { token: t.access_token, refreshToken: t.refresh_token, user: toUsuario(me) };
    },
    async signup(data) {
      const t = await req<BToken>('/auth/signup', {
        method: 'POST',
        body: json({
          full_name: data.nombre,
          email: data.email,
          password: data.password,
          ...(data.codigo_invitacion ? { invitation_code: data.codigo_invitacion } : {}),
        }),
      });
      const me = await req<BUser>('/auth/me', {}, t.access_token);
      return { token: t.access_token, refreshToken: t.refresh_token, user: toUsuario(me) };
    },
    async validateInvitation(code) {
      const res = await req<BInvitationValidation>('/auth/invitations/validate', {
        method: 'POST',
        body: json({ code }),
      });
      return toValidacionInvitacion(res);
    },
    async refresh(refreshToken) {
      const t = await req<BToken>('/auth/refresh', {
        method: 'POST',
        body: json({ refresh_token: refreshToken }),
      });
      return { token: t.access_token, refreshToken: t.refresh_token };
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
    get: async (id) => toProyecto(await req<BProject>(`/projects/${encodeURIComponent(id)}`)),
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
      return toProyecto(
        await req<BProject>(`/projects/${encodeURIComponent(p.id)}/document`, { method: 'POST', body: fd }),
      );
    },
    async uploadDocument(id, archivo) {
      const fd = new FormData();
      fd.append('file', archivo);
      return toProyecto(
        await req<BProject>(`/projects/${encodeURIComponent(id)}/document`, { method: 'POST', body: fd }),
      );
    },
    changeState: async (id, estado, nota, propuestaAdjudicadaId) =>
      toProyecto(
        await req<BProject>(`/projects/${encodeURIComponent(id)}/status`, {
          method: 'POST',
          body: json({
            target_status: estadoHaciaBackend(estado),
            adjudicated_proposal_id: propuestaAdjudicadaId ?? null,
            notes: nota ?? null,
          }),
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
    async documentUrl(id) {
      const ticket = await streamTicket();
      return buildApiUrl(
        `/projects/${encodeURIComponent(id)}/document/download?ticket=${encodeURIComponent(ticket)}`,
      ).toString();
    },
  },

  proposals: {
    list: async (projectId) =>
      (await req<BProposal[]>(`/projects/${encodeURIComponent(projectId)}/proposals`)).map(toPropuesta),
    async upload(projectId, files) {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const r = await req<BProposal[]>(`/projects/${encodeURIComponent(projectId)}/proposals`, {
        method: 'POST',
        body: fd,
      });
      return r.map(toPropuesta);
    },
    remove: (id) => req<void>(`/proposals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    async downloadUrl(id) {
      const ticket = await streamTicket();
      return buildApiUrl(
        `/proposals/${encodeURIComponent(id)}/download?ticket=${encodeURIComponent(ticket)}`,
      ).toString();
    },
  },

  evaluations: {
    async start(projectId, params) {
      const e = await req<BEvaluation>(`/projects/${encodeURIComponent(projectId)}/evaluate`, {
        method: 'POST',
        body: json({
          run_in_background: true,
          enable_web_search: params?.enable_web_search ?? true,
          bcv_rate_override: params?.bcv_rate_override ?? null,
          iva_rate: params?.iva_rate ?? 0.16,
        }),
      });
      return toEvaluacion(e, await tiposDeProyecto(projectId));
    },
    list: async (projectId) =>
      (await req<BEvaluation[]>(`/projects/${encodeURIComponent(projectId)}/evaluations`)).map(toEvaluacionResumen),
    async latest(projectId) {
      const p = await req<BProject>(`/projects/${encodeURIComponent(projectId)}`);
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
      const e = await req<BEvaluation>(`/evaluations/${encodeURIComponent(id)}`);
      return (e.trace_steps ?? []).map((t) => toTraza(id, t));
    },
    stream(id, onEvent, onDone, onError) {
      let terminado = false;
      let es: EventSource | null = null;

      void streamTicket()
        .then((ticket) => {
          if (terminado) return;
          es = new EventSource(
            buildApiUrl(
              `/evaluations/${encodeURIComponent(id)}/stream?ticket=${encodeURIComponent(ticket)}`,
            ).toString(),
          );
          es.addEventListener('trace_step', (ev) => {
            try {
              onEvent(toTraza(id, JSON.parse((ev as MessageEvent).data) as BTraceStep));
            } catch {
              /* evento mal formado */
            }
          });
          const fin = async () => {
            terminado = true;
            es?.close();
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
            terminado = true;
            es?.close();
            onError?.('Se perdió la conexión con el agente. Recargue la página para ver el estado actual.');
          };
        })
        .catch(() => {
          if (terminado) return;
          terminado = true;
          onError?.('No se pudo autorizar el flujo de trazabilidad en vivo.');
        });

      return () => {
        terminado = true;
        es?.close();
      };
    },
    async exportFile(id, formato) {
      const res = await raw(`/evaluations/${encodeURIComponent(id)}/export/${encodeURIComponent(formato)}`);
      return {
        blob: await res.blob(),
        filename: parseContentDispositionFilename(res.headers.get('Content-Disposition')),
      };
    },
  },

  reviews: {
    async list(evaluacionId) {
      const e = await req<BEvaluation>(`/evaluations/${encodeURIComponent(evaluacionId)}`);
      return (e.human_reviews ?? []).map(toRevision);
    },
    async add(evaluacionId, accion, comentario, opts) {
      let targetProposalId: string | null = opts?.propuesta_adjudicada_id ?? null;
      let ev: BEvaluation | null = null;
      if (accion === 'aprobar' || accion === 'rechazar') {
        ev = await req<BEvaluation>(`/evaluations/${encodeURIComponent(evaluacionId)}`);
        if (accion === 'aprobar' && !targetProposalId) {
          targetProposalId = ev.recommended_proposal_id;
        }
      }
      const esOverride = Boolean(
        accion === 'aprobar' && ev && targetProposalId && targetProposalId !== ev.recommended_proposal_id,
      );
      const body = accionHaciaBackend(accion, comentario, {
        proposal_evaluation_id: opts?.propuesta_evaluacion_id ?? null,
        override_recommended_proposal_id: esOverride ? targetProposalId : null,
      });
      const rev = toRevision(
        await req<BReview>(`/evaluations/${encodeURIComponent(evaluacionId)}/reviews`, {
          method: 'POST',
          body: json(body),
        }),
      );
      // El backend registra la revisión pero no mueve el proceso: «Aprobar» adjudica la
      // propuesta elegida y «Rechazar y devolver» regresa el proyecto a evaluación.
      if ((accion === 'aprobar' || accion === 'rechazar') && ev) {
        await req<BProject>(`/projects/${encodeURIComponent(ev.project_id)}/status`, {
          method: 'POST',
          body: json(
            accion === 'aprobar'
              ? { target_status: 'adjudicado', adjudicated_proposal_id: targetProposalId, notes: body.notes }
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
        `/suppliers/${encodeURIComponent(id)}`,
      );
      const activas = d.alerts.filter((a) => !a.is_resolved);
      const alerta = activas[0] ?? null;
      // El historial trae evaluation_run_id; se resuelve el proyecto y la fecha de cada evaluación.
      const runs = new Map<string, { proyecto_id: string; fecha: string; nombre: string }>();
      await Promise.all(
        [...new Set(d.participation_history.map((h) => h.evaluation_run_id))].map(async (runId) => {
          try {
            const e = await req<BEvaluation>(`/evaluations/${encodeURIComponent(runId)}`);
            const p = await req<BProject>(`/projects/${encodeURIComponent(e.project_id)}`);
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
      const base = toProveedor(d.supplier, alerta?.summary ?? null);
      const detalle: ProveedorDetalle = {
        ...base,
        alerta: activas.length > 0,
        motivo_alerta: alerta?.summary ?? null,
        alertas: d.alerts.map(toAlertaProveedor),
        participaciones,
      };
      return detalle;
    },
    create: async (data) =>
      toProveedor(
        await req<BSupplier>('/suppliers', {
          method: 'POST',
          body: json({
            name: data.nombre,
            rif: data.rif || null,
            location: data.ubicacion || null,
            representative: data.representante || null,
            phone: data.telefono || null,
            email: data.email || null,
            notes: data.notas || null,
          }),
        }),
      ),
    update: async (id, data) =>
      toProveedor(
        await req<BSupplier>(`/suppliers/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: json({
            ...(data.nombre !== undefined ? { name: data.nombre } : {}),
            ...(data.rif !== undefined ? { rif: data.rif || null } : {}),
            ...(data.ubicacion !== undefined ? { location: data.ubicacion || null } : {}),
            ...(data.representante !== undefined ? { representative: data.representante || null } : {}),
            ...(data.telefono !== undefined ? { phone: data.telefono || null } : {}),
            ...(data.email !== undefined ? { email: data.email || null } : {}),
            ...(data.notas !== undefined ? { notes: data.notas || null } : {}),
          }),
        }),
      ),
    resolveAlert: async (alertId) =>
      toAlertaProveedor(
        await req<BSupplierAlert>(`/suppliers/alerts/${encodeURIComponent(alertId)}/resolve`, { method: 'POST' }),
      ),
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
        await req<BUser>(`/auth/users/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: json({ role: rol, is_active: data.activo ?? null }),
        }),
      );
    },
    listInvitations: async () => (await req<BInvitation[]>('/auth/invitations')).map(toInvitacion),
    createInvitation: async (data) =>
      toInvitacion(
        await req<BInvitation>('/auth/invitations', {
          method: 'POST',
          body: json({
            role: data.rol,
            email: data.email || null,
            max_uses: data.usos_maximos ?? 1,
            expires_in_hours: data.horas_vigencia ?? 72,
          }),
        }),
      ),
    revokeInvitation: (id) => req<void>(`/auth/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  currency: {
    bcv: async (refresh = false) => toTasa(await req<BBcv>(`/finance/bcv-rate${refresh ? '?refresh=true' : ''}`)),
    history: async () => (await req<BBcvHistoryItem[]>('/finance/bcv-rate/history')).map(toTasaHistorial),
    override: async (usdToVes, nota) =>
      toTasa(
        await req<BBcv>('/finance/bcv-rate/override', {
          method: 'POST',
          body: json({ usd_to_ves: usdToVes, note: nota || null }),
        }),
      ),
  },

  chat: {
    history: async (projectId) =>
      (await req<BChat[]>(`/projects/${encodeURIComponent(projectId)}/chat`)).map(toMensaje),
    send: async (projectId, contenido) =>
      toMensaje(
        await req<BChat>(`/projects/${encodeURIComponent(projectId)}/chat`, {
          method: 'POST',
          body: json({ question: contenido }),
        }),
      ),
    clear: (projectId) => req<void>(`/projects/${encodeURIComponent(projectId)}/chat`, { method: 'DELETE' }),
  },
};
