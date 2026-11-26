// Implementación real: consume la API REST de FastAPI.
// Los endpoints están documentados en frontend/README.md.
import { ApiError, clearSession, getToken } from './session';
import type {
  Api,
  Evaluacion,
  HistorialEstado,
  MensajeChat,
  Propuesta,
  Proveedor,
  ProveedorDetalle,
  Proyecto,
  RegistroAuditoria,
  Revision,
  TasaCambio,
  TrazaAgente,
  Usuario,
} from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

async function raw(path: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearSession();
    window.location.assign('/login');
  }
  if (!res.ok) {
    let msg = res.statusText || 'Error de comunicación con el servidor';
    try {
      const body = await res.json();
      msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await raw(path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const httpApi: Api = {
  auth: {
    async login(email, password) {
      const r = await req<{ access_token: string; user: Usuario }>('/auth/login', {
        method: 'POST',
        body: json({ email, password }),
      });
      return { token: r.access_token, user: r.user };
    },
    me: () => req<Usuario>('/auth/me'),
  },

  projects: {
    list: () => req<Proyecto[]>('/projects'),
    get: (id) => req<Proyecto>(`/projects/${id}`),
    create(data, archivo) {
      const fd = new FormData();
      fd.append('datos', json(data));
      if (archivo) fd.append('archivo', archivo);
      return req<Proyecto>('/projects', { method: 'POST', body: fd });
    },
    changeState: (id, estado, nota) =>
      req<Proyecto>(`/projects/${id}/estado`, { method: 'PATCH', body: json({ estado, nota }) }),
    history: (id) => req<HistorialEstado[]>(`/projects/${id}/historial`),
  },

  proposals: {
    list: (projectId) => req<Propuesta[]>(`/projects/${projectId}/proposals`),
    upload(projectId, files) {
      const fd = new FormData();
      files.forEach((f) => fd.append('archivos', f));
      return req<Propuesta[]>(`/projects/${projectId}/proposals`, { method: 'POST', body: fd });
    },
    remove: (id) => req<void>(`/proposals/${id}`, { method: 'DELETE' }),
  },

  evaluations: {
    start: (projectId) => req<Evaluacion>(`/projects/${projectId}/evaluate`, { method: 'POST' }),
    async latest(projectId) {
      try {
        return await req<Evaluacion>(`/projects/${projectId}/evaluations/latest`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    get: (id) => req<Evaluacion>(`/evaluations/${id}`),
    trazas: (id) => req<TrazaAgente[]>(`/evaluations/${id}/trazas`),
    stream(id, onEvent, onDone, onError) {
      // EventSource no permite cabeceras: el token viaja como query param.
      const token = getToken() ?? '';
      const es = new EventSource(`${BASE}/evaluations/${id}/stream?token=${encodeURIComponent(token)}`);
      es.onmessage = (ev) => {
        try {
          onEvent(JSON.parse(ev.data) as TrazaAgente);
        } catch {
          /* evento mal formado */
        }
      };
      es.addEventListener('done', async () => {
        es.close();
        try {
          onDone(await req<Evaluacion>(`/evaluations/${id}`));
        } catch {
          onDone(null);
        }
      });
      es.onerror = () => {
        es.close();
        onError?.('Se perdió la conexión con el agente');
      };
      return () => es.close();
    },
    async exportFile(id, formato) {
      const res = await raw(`/evaluations/${id}/export?formato=${formato}`);
      return res.blob();
    },
  },

  reviews: {
    list: (evaluacionId) => req<Revision[]>(`/evaluations/${evaluacionId}/revisiones`),
    add: (evaluacionId, accion, comentario) =>
      req<Revision>(`/evaluations/${evaluacionId}/revisiones`, {
        method: 'POST',
        body: json({ accion, comentario }),
      }),
  },

  suppliers: {
    list: () => req<Proveedor[]>('/suppliers'),
    get: (id) => req<ProveedorDetalle>(`/suppliers/${id}`),
  },

  audit: {
    list: () => req<RegistroAuditoria[]>('/audit'),
  },

  users: {
    list: () => req<Usuario[]>('/users'),
    create: (data) => req<Usuario>('/users', { method: 'POST', body: json(data) }),
    update: (id, data) => req<Usuario>(`/users/${id}`, { method: 'PATCH', body: json(data) }),
  },

  currency: {
    bcv: () => req<TasaCambio>('/currency/bcv'),
  },

  chat: {
    history: (projectId) => req<MensajeChat[]>(`/projects/${projectId}/chat`),
    send: (projectId, contenido) =>
      req<MensajeChat>(`/projects/${projectId}/chat`, { method: 'POST', body: json({ contenido }) }),
  },
};
