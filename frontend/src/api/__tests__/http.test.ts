import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpApi } from '../http';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

describe('autorización HTTP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renueva una sesión tras 401 y reintenta la petición con el token nuevo', async () => {
    const sessionStorage = new MemoryStorage();
    sessionStorage.setItem('aeps.token', 'expired');
    sessionStorage.setItem('aeps.refresh_token', 'refresh-1');
    const assign = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', token_type: 'bearer' }),
      )
      .mockResolvedValueOnce(
        Response.json({
          active_supplier_alerts: 0,
          prompt_injections_blocked: 0,
          security_status: {
            encryption_at_rest: 'AES-256-GCM',
            db_sensitive_columns_encrypted: true,
            storage_files_encrypted: true,
            tls_enabled: true,
            tls_min_version: 'TLSv1.2',
            audit_log_entries: 0,
            llm_provider: 'test',
          },
        }),
      );
    vi.stubGlobal('window', {
      sessionStorage,
      localStorage: new MemoryStorage(),
      location: { assign },
    });
    vi.stubGlobal('fetch', fetch);

    await expect(httpApi.dashboard.stats()).resolves.toMatchObject({
      encryption_at_rest: 'AES-256-GCM',
      tls_min_version: 'TLSv1.2',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0]).toContain('/auth/refresh');
    expect(new Headers(fetch.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer access-2');
    expect(sessionStorage.getItem('aeps.refresh_token')).toBe('refresh-2');
    expect(assign).not.toHaveBeenCalled();
  });

  it('autoriza descargas con un ticket efímero en vez de enviar el token', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ticket: 'ticket one' }));
    vi.stubGlobal('fetch', fetch);

    await expect(httpApi.projects.documentUrl('project-1')).resolves.toBe(
      '/api/v1/projects/project-1/document/download?ticket=ticket%20one',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/auth/stream-ticket');
    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
  });
});
