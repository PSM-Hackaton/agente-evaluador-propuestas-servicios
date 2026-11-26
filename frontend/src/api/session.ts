import type { Usuario } from './types';

const TOKEN_KEY = 'aeps.token';
const REFRESH_KEY = 'aeps.refresh_token';
const USER_KEY = 'aeps.user';

function safeSessionStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  return window.sessionStorage;
}

function purgeLegacyLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function getToken(): string | null {
  return safeSessionStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return safeSessionStorage()?.getItem(REFRESH_KEY) ?? null;
}

export function getStoredUser(): Usuario | null {
  const raw = safeSessionStorage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Usuario;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: Usuario, refreshToken?: string | null) {
  purgeLegacyLocalStorage();
  const ss = safeSessionStorage();
  if (!ss) return;
  ss.setItem(TOKEN_KEY, token);
  ss.setItem(USER_KEY, JSON.stringify(user));
  if (refreshToken) {
    ss.setItem(REFRESH_KEY, refreshToken);
  } else if (refreshToken === null) {
    ss.removeItem(REFRESH_KEY);
  }
}

export function updateTokens(token: string, refreshToken?: string | null) {
  const ss = safeSessionStorage();
  if (!ss) return;
  ss.setItem(TOKEN_KEY, token);
  if (refreshToken) ss.setItem(REFRESH_KEY, refreshToken);
}

export function clearSession() {
  purgeLegacyLocalStorage();
  const ss = safeSessionStorage();
  if (!ss) return;
  ss.removeItem(TOKEN_KEY);
  ss.removeItem(REFRESH_KEY);
  ss.removeItem(USER_KEY);
}

export function getTokenExpiryMs(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(pad)) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
