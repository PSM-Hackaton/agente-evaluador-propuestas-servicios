import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApiUrl, httpApi, parseApiBase } from '../http';
import { ApiError, getRefreshToken, getToken, saveSession } from '../session';
import type { Usuario } from '../types';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleUser: Usuario = {
  id: 'u-1',
  nombre: 'Ana Admin',
  email: 'admin@gob.ve',
  rol: 'admin',
  activo: true,
  creado_en: '2026-11-26T10:00:00Z',
};

describe('parseApiBase', () => {
  it('resuelve rutas relativas contra el origen de respaldo con barra final', () => {
    const url = parseApiBase('/api/v1', 'https://app.example.com');
    expect(url.toString()).toBe('https://app.example.com/api/v1/');

    const withSlash = parseApiBase('/api/v1/', 'http://localhost:5173');
    expect(withSlash.toString()).toBe('http://localhost:5173/api/v1/');
  });

  it('preserva URLs absolutas http/https agregando barra final si falta', () => {
    expect(parseApiBase('https://api.example.com/v1').toString()).toBe('https://api.example.com/v1/');
    expect(parseApiBase('  http://localhost:8000/api/v1/  ').toString()).toBe('http://localhost:8000/api/v1/');
  });

  it('rechaza esquemas inválidos, cadenas vacías, protocol-relative, barras invertidas y caracteres de control con ApiError(500)', () => {
    const invalidInputs = [
      '',
      '   ',
      '//evil.com/api',
      'https://user:pass@api.example.com/api/v1',
      'javascript:alert(1)',
      'ftp://files.example.com/api',
      'data:text/plain,hola',
      '/api\\v1',
      '/api\nv1',
      '/api\x00v1',
    ];

    for (const raw of invalidInputs) {
      let caught: unknown;
      try {
        parseApiBase(raw, 'http://localhost');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ApiError);
      expect((caught as ApiError).status).toBe(500);
    }
  });
});

describe('buildApiUrl', () => {
  const base = new URL('https://api.example.com/api/v1/');

  it('construye rutas relativas válidas preservando query strings', () => {
    expect(buildApiUrl('/projects', base).toString()).toBe('https://api.example.com/api/v1/projects');
    expect(buildApiUrl('/audit-logs?limit=10', base).toString()).toBe(
      'https://api.example.com/api/v1/audit-logs?limit=10',
    );
    expect(buildApiUrl('/projects/p-1/proposals', new URL('https://api.example.com/api/v1')).toString()).toBe(
      'https://api.example.com/api/v1/projects/p-1/proposals',
    );
  });

  it('rechaza intentos de SSRF, rutas absolutas, traversal y caracteres inválidos con ApiError(400)', () => {
    const maliciousPaths = [
      'https://evil.com/steal',
      'http://evil.com/steal',
      'projects',
      '//evil.com',
      '///evil.com/path',
      '/https://evil.com',
      '/javascript:alert(1)',
      '/data:text/html,xss',
      '\\evil',
      '/projects\\evil',
      '/\x00projects',
      '/projects\n',
      '/projects\x7f',
      '/../admin',
      '/../../etc/passwd',
      '/projects/../../admin',
      '/projects/../proposals',
      '/projects/./proposals',
      '/projects/%2e%2e/proposals',
    ];

    for (const path of maliciousPaths) {
      let caught: unknown;
      try {
        buildApiUrl(path, base);
      } catch (err) {
        caught = err;
      }
      expect(caught, `Se esperaba rechazo para: ${path}`).toBeInstanceOf(ApiError);
      expect((caught as ApiError).status).toBe(400);
    }
  });

  it('rechaza una URL base con protocolo distinto de http/https con ApiError(400)', () => {
    let caught: unknown;
    try {
      buildApiUrl('/projects', new URL('ftp://example.com/api/v1/'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(400);
  });
});

describe('httpApi', () => {
  let assignMock: ReturnType<typeof vi.fn>;
  let sessionStorageMock: Storage;
  let localStorageMock: Storage;

  beforeEach(() => {
    sessionStorageMock = createMemoryStorage();
    localStorageMock = createMemoryStorage();
    assignMock = vi.fn();

    vi.stubGlobal('window', {
      sessionStorage: sessionStorageMock,
      localStorage: localStorageMock,
      location: { origin: 'http://localhost', assign: assignMock },
    });
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ejecuta un único refresh en 401 concurrentes (single-flight) y reintenta con el nuevo token', async () => {
    saveSession('expired-token', sampleUser, 'rt-valid');

    let refreshCalls = 0;
    const authHeadersByUrl: Record<string, string[]> = {};

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(urlStr).pathname;
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      (authHeadersByUrl[pathname] ??= []).push(auth);

      if (pathname === '/api/v1/auth/refresh') {
        refreshCalls += 1;
        await Promise.resolve();
        return jsonResponse({
          access_token: 'fresh-token',
          refresh_token: 'fresh-rt',
          role: 'admin',
          user_id: 'u-1',
          full_name: 'Ana Admin',
        });
      }

      if (auth !== 'Bearer fresh-token') {
        return jsonResponse({ detail: 'Token expirado' }, 401);
      }

      if (pathname === '/api/v1/projects') {
        return jsonResponse([
          {
            id: 'pr-1',
            name: 'Laboratorio',
            description: null,
            execution_location: 'Caracas',
            reference_budget: 10000,
            reference_currency: 'USD',
            status: 'en_recepcion',
            document_filename: 'bases.pdf',
            proposals_count: 3,
            evaluations_count: 0,
            latest_evaluation_id: null,
            created_by_id: 'u-1',
            created_at: '2026-11-26T12:00:00',
          },
        ]);
      }

      if (pathname === '/api/v1/suppliers') {
        return jsonResponse([
          {
            id: 'sup-1',
            name: 'Proveedor Uno C.A.',
            rif: 'J-12345678-9',
            location: 'Caracas',
            representative: null,
            phone: null,
            email: null,
            notes: null,
            alerts_count: 0,
            proposals_count: 1,
          },
        ]);
      }

      return jsonResponse({ detail: 'No encontrado' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const [projects, suppliers] = await Promise.all([httpApi.projects.list(), httpApi.suppliers.list()]);

    expect(refreshCalls).toBe(1);
    expect(authHeadersByUrl['/api/v1/projects']).toEqual(['Bearer expired-token', 'Bearer fresh-token']);
    expect(authHeadersByUrl['/api/v1/suppliers']).toEqual(['Bearer expired-token', 'Bearer fresh-token']);
    expect(getToken()).toBe('fresh-token');
    expect(getRefreshToken()).toBe('fresh-rt');
    expect(projects).toHaveLength(1);
    expect(projects[0].nombre).toBe('Laboratorio');
    expect(suppliers).toHaveLength(1);
    expect(suppliers[0].nombre).toBe('Proveedor Uno C.A.');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('limpia la sesión y redirige a /login cuando el refresh tras 401 falla', async () => {
    saveSession('expired-token', sampleUser, 'rt-invalid');

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(urlStr).pathname;
      if (pathname === '/api/v1/auth/refresh') {
        return jsonResponse({ detail: 'Refresh inválido' }, 401);
      }
      return jsonResponse({ detail: 'No autorizado' }, 401);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(httpApi.projects.list()).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(assignMock).toHaveBeenCalledWith('/login');
  });

  it('projects.documentUrl y proposals.downloadUrl solicitan stream-ticket y devuelven ?ticket= sin ?token=', async () => {
    saveSession('jwt-secret', sampleUser, 'rt-1');

    let ticketCounter = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const pathname = new URL(urlStr).pathname;

      if (pathname === '/api/v1/auth/stream-ticket' && init?.method === 'POST') {
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-secret');
        ticketCounter += 1;
        return jsonResponse({ ticket: `efimero-${ticketCounter}` });
      }

      return jsonResponse({ detail: 'Ruta inesperada' }, 404);
    });

    vi.stubGlobal('fetch', fetchMock);

    const docUrl = await httpApi.projects.documentUrl('proj/1');
    const propUrl = await httpApi.proposals.downloadUrl('prop/2');

    expect(ticketCounter).toBe(2);
    expect(docUrl).toBe('http://localhost/api/v1/projects/proj%2F1/document/download?ticket=efimero-1');
    expect(propUrl).toBe('http://localhost/api/v1/proposals/prop%2F2/download?ticket=efimero-2');
    expect(docUrl).not.toContain('token=');
    expect(propUrl).not.toContain('token=');
    expect(docUrl).not.toContain('jwt-secret');
    expect(propUrl).not.toContain('jwt-secret');
  });
});
