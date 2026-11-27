import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  clearSession,
  getRefreshToken,
  getStoredUser,
  getToken,
  getTokenExpiryMs,
  saveSession,
  updateTokens,
} from '../session';
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

function makeJwt(payload: Record<string, unknown>, base64Url = true): string {
  const encode = (obj: Record<string, unknown>) => {
    const b64 = btoa(JSON.stringify(obj));
    return base64Url ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
  };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const sampleUser: Usuario = {
  id: 'u-1',
  nombre: 'Rosa Revisora',
  email: 'revisor@gob.ve',
  rol: 'revisor',
  activo: true,
  creado_en: '2026-11-26T10:00:00Z',
};

describe('session storage helpers', () => {
  let sessionStorageMock: Storage;
  let localStorageMock: Storage;

  beforeEach(() => {
    sessionStorageMock = createMemoryStorage();
    localStorageMock = createMemoryStorage();
    vi.stubGlobal('window', {
      sessionStorage: sessionStorageMock,
      localStorage: localStorageMock,
      location: { origin: 'http://localhost', assign: vi.fn() },
    });
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('guarda token, usuario y refresh token en sessionStorage y purga claves heredadas en localStorage', () => {
    localStorageMock.setItem('aeps.token', 'legacy-token');
    localStorageMock.setItem('aeps.refresh_token', 'legacy-rt');
    localStorageMock.setItem('aeps.user', '{"id":"legacy"}');
    localStorageMock.setItem('otra.clave', 'conservar');

    saveSession('access-123', sampleUser, 'refresh-456');

    expect(getToken()).toBe('access-123');
    expect(getRefreshToken()).toBe('refresh-456');
    expect(getStoredUser()).toEqual(sampleUser);

    expect(sessionStorageMock.getItem('aeps.token')).toBe('access-123');
    expect(sessionStorageMock.getItem('aeps.refresh_token')).toBe('refresh-456');
    expect(localStorageMock.getItem('aeps.token')).toBeNull();
    expect(localStorageMock.getItem('aeps.refresh_token')).toBeNull();
    expect(localStorageMock.getItem('aeps.user')).toBeNull();
    expect(localStorageMock.getItem('otra.clave')).toBe('conservar');
  });

  it('elimina refresh token si saveSession recibe null y lo conserva si recibe undefined', () => {
    saveSession('access-1', sampleUser, 'rt-1');
    expect(getRefreshToken()).toBe('rt-1');

    saveSession('access-2', sampleUser);
    expect(getToken()).toBe('access-2');
    expect(getRefreshToken()).toBe('rt-1');

    saveSession('access-3', sampleUser, null);
    expect(getToken()).toBe('access-3');
    expect(getRefreshToken()).toBeNull();
  });

  it('actualiza access y refresh token con updateTokens sin perder el usuario guardado', () => {
    saveSession('access-old', sampleUser, 'rt-old');

    updateTokens('access-new');
    expect(getToken()).toBe('access-new');
    expect(getRefreshToken()).toBe('rt-old');
    expect(getStoredUser()).toEqual(sampleUser);

    updateTokens('access-final', 'rt-final');
    expect(getToken()).toBe('access-final');
    expect(getRefreshToken()).toBe('rt-final');
  });

  it('limpia sessionStorage y localStorage heredado con clearSession', () => {
    saveSession('access-1', sampleUser, 'rt-1');
    sessionStorageMock.setItem('otro.dato', 'mantener');
    localStorageMock.setItem('aeps.token', 'old');
    localStorageMock.setItem('aeps.refresh_token', 'old-rt');
    localStorageMock.setItem('aeps.user', '{}');
    localStorageMock.setItem('aeps.mockdb', '{"version":1}');

    clearSession();

    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(sessionStorageMock.getItem('otro.dato')).toBe('mantener');
    expect(localStorageMock.getItem('aeps.token')).toBeNull();
    expect(localStorageMock.getItem('aeps.refresh_token')).toBeNull();
    expect(localStorageMock.getItem('aeps.user')).toBeNull();
    expect(localStorageMock.getItem('aeps.mockdb')).toBe('{"version":1}');
  });

  it('devuelve null en getStoredUser si el JSON almacenado es inválido', () => {
    sessionStorageMock.setItem('aeps.user', '{json-corrupto');
    expect(getStoredUser()).toBeNull();
  });

  it('no falla cuando window no está definido', () => {
    vi.stubGlobal('window', undefined);

    expect(() => saveSession('t', sampleUser, 'rt')).not.toThrow();
    expect(() => updateTokens('t2', 'rt2')).not.toThrow();
    expect(() => clearSession()).not.toThrow();
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('extrae la expiración en milisegundos de JWT válidos e ignora tokens inválidos', () => {
    const expSeconds = 1800000123;
    expect(getTokenExpiryMs(makeJwt({ sub: 'u-1', exp: expSeconds }, true))).toBe(expSeconds * 1000);
    expect(getTokenExpiryMs(makeJwt({ sub: 'u-1', exp: expSeconds, pad: 'ab' }, false))).toBe(expSeconds * 1000);

    expect(getTokenExpiryMs(null)).toBeNull();
    expect(getTokenExpiryMs('')).toBeNull();
    expect(getTokenExpiryMs('mock-u-admin')).toBeNull();
    expect(getTokenExpiryMs('solo.dos')).toBeNull();
    expect(getTokenExpiryMs('a.b.c.d')).toBeNull();
    expect(getTokenExpiryMs('hdr.!!!no-base64!!!.sig')).toBeNull();
    expect(getTokenExpiryMs(makeJwt({ sub: 'u-1' }))).toBeNull();
    expect(getTokenExpiryMs(makeJwt({ sub: 'u-1', exp: '1800000123' }))).toBeNull();
  });

  it('construye ApiError preservando status y mensaje', () => {
    const err = new ApiError(403, 'Acceso denegado');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Acceso denegado');
  });
});
