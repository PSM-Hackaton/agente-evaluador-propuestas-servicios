import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Usuario } from '../api';
import {
  clearSession,
  getRefreshToken,
  getStoredUser,
  getToken,
  getTokenExpiryMs,
  saveSession,
  updateTokens,
} from '../api/session';

const WARN_WINDOW_MS = 5 * 60_000;

interface AuthContextValue {
  user: Usuario | null;
  loading: boolean;
  sessionExpiringSoon: boolean;
  renewing: boolean;
  login: (email: string, password: string) => Promise<Usuario>;
  logout: () => void;
  renewSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<Usuario | null>(() => getStoredUser());
  const [loading, setLoading] = useState<boolean>(() => !!getToken());
  const [sessionExpiringSoon, setSessionExpiringSoon] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setSessionExpiringSoon(false);
    qc.clear();
  }, [qc]);

  const renewSession = useCallback(async (): Promise<boolean> => {
    const rt = getRefreshToken();
    if (!rt) return false;
    setRenewing(true);
    try {
      const { token, refreshToken } = await api.auth.refresh(rt);
      updateTokens(token, refreshToken);
      setSessionExpiringSoon(false);
      return true;
    } catch {
      logout();
      return false;
    } finally {
      setRenewing(false);
    }
  }, [logout]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    api.auth
      .me()
      .then((u) => {
        if (cancelled) return;
        saveSession(getToken() ?? token, u, getRefreshToken());
        setUser(u);
      })
      .catch(() => {
        if (cancelled) return;
        clearSession();
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const checkExpiry = () => {
      const exp = getTokenExpiryMs(getToken());
      if (!exp) {
        setSessionExpiringSoon(false);
        return;
      }
      setSessionExpiringSoon(exp - Date.now() <= WARN_WINDOW_MS);
    };
    const initTimer = window.setTimeout(checkExpiry, 0);
    const timer = window.setInterval(checkExpiry, 30_000);
    return () => {
      window.clearTimeout(initTimer);
      window.clearInterval(timer);
    };
  }, [user]);

  const expiringSoon = Boolean(user) && sessionExpiringSoon;

  const login = useCallback(async (email: string, password: string) => {
    const { token, refreshToken, user: logged } = await api.auth.login(email, password);
    saveSession(token, logged, refreshToken);
    setUser(logged);
    setSessionExpiringSoon(false);
    return logged;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, sessionExpiringSoon: expiringSoon, renewing, login, logout, renewSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
