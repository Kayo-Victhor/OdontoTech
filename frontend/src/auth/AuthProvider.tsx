import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import axios from 'axios';
import { api } from '../services/api';

export type UserRole = 'ADMIN' | 'RECEPTIONIST' | 'DENTIST' | 'PATIENT';
export interface SessionUser { id: string; name: string; role: UserRole }
interface AuthContextValue {
  user: SessionUser | null;
  initializing: boolean;
  initializationError: boolean;
  retry: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export const rolePaths: Record<UserRole, string> = { ADMIN: '/admin', RECEPTIONIST: '/recepcao', DENTIST: '/dentista', PATIENT: '/paciente' };
export const roleNames: Record<UserRole, string> = { ADMIN: 'Administrador', RECEPTIONIST: 'Recepção', DENTIST: 'Dentista', PATIENT: 'Paciente' };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Respostas de consultas antigas não devem restaurar uma sessão após logout/login.
  const version = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++version.current;
    setInitializing(true);
    setInitializationError(false);
    api.get<{ user: SessionUser }>('/auth/me', { signal: controller.signal }).then(({ data }) => {
      if (version.current === current) setUser(data.user);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || version.current !== current) return;
      setUser(null);
      if (!axios.isAxiosError(error) || error.response?.status !== 401) setInitializationError(true);
    }).finally(() => { if (!controller.signal.aborted && version.current === current) setInitializing(false); });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const clear = () => { setUser(null); };
    window.addEventListener('auth:unauthorized', clear);
    return () => window.removeEventListener('auth:unauthorized', clear);
  }, []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const current = version.current;
    const check = () => {
      void api.get<{ user: SessionUser }>('/auth/me', { signal: controller.signal }).then(({ data }) => {
        if (version.current === current) setUser(data.user);
      }).catch(() => { /* 401 é tratado pelo cliente HTTP; indisponibilidade não revela dados novos. */ });
    };
    const timer = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [user?.id]);

  const login = useCallback(async (email: string, password: string) => {
    ++version.current;
    const { data } = await api.post<{ user: SessionUser }>('/auth/login', { email, password });
    setUser(data.user);
    setInitializationError(false);
  }, []);
  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    ++version.current;
    setUser(null);
  }, []);
  return <AuthContext.Provider value={{ user, initializing, initializationError, retry: () => setAttempt((value) => value + 1), login, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser utilizado dentro de AuthProvider.');
  return context;
}
