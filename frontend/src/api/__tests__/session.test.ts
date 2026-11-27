import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  getRefreshToken,
  getStoredUser,
  getToken,
  getTokenExpiryMs,
  saveSession,
  updateTokens,
} from '../session';
import type { Usuario } from '../types';

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

const user: Usuario = {
  id: 'user-1',
  nombre: 'Revisora',
  email: 'revisora@example.test',
  rol: 'revisor',
  activo: true,
  creado_en: '2026-11-27T00:00:00Z',
};

describe('sesión del navegador', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('guarda y renueva tokens en sessionStorage, y elimina la sesión', () => {
    const sessionStorage = new MemoryStorage();
    const localStorage = new MemoryStorage();
    localStorage.setItem('aeps.token', 'legacy');
    vi.stubGlobal('window', { sessionStorage, localStorage });

    saveSession('access-1', user, 'refresh-1');
    expect(getToken()).toBe('access-1');
    expect(getRefreshToken()).toBe('refresh-1');
    expect(getStoredUser()).toEqual(user);
    expect(localStorage.getItem('aeps.token')).toBeNull();

    updateTokens('access-2', null);
    expect(getToken()).toBe('access-2');
    expect(getRefreshToken()).toBeNull();

    clearSession();
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('lee la expiración JWT y rechaza payloads inválidos', () => {
    const payload = btoa(JSON.stringify({ exp: 1_800_000_000 })).replace(/=/g, '');
    expect(getTokenExpiryMs(`header.${payload}.signature`)).toBe(1_800_000_000_000);
    expect(getTokenExpiryMs('malformed')).toBeNull();
    expect(getTokenExpiryMs('header.not-json.signature')).toBeNull();
  });
});
