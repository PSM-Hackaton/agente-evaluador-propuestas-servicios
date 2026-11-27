import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  Ticket,
  User,
  UserPlus,
} from 'lucide-react';
import { api, isMock, type Rol, type ValidacionInvitacion } from '../api';
import { DEMO_PASSWORD } from '../api/mock/specs';
import { useAuth } from '../context/AuthContext';
import {
  DEFAULT_LOGIN_DOMAIN,
  DEMO_LOGIN_DOMAIN,
  normalizeLoginIdentifier,
} from '../lib/auth';
import { cn } from '../lib/cn';
import { date } from '../lib/format';
import { ROL_LABEL } from '../lib/labels';
import { Alert, Badge, Button, Card, CardBody } from '../components/ui';
import { InstitutionalHeader } from '../components/InstitutionalHeader';

type AuthView = 'login' | 'register' | 'invite';
type LoginMode = 'usuario' | 'correo';

interface QuickAccount {
  email: string;
  nombre: string;
  rol: Rol;
  password: string;
}

const CUENTAS_MOCK: QuickAccount[] = [
  { email: 'admin@demo.ve', nombre: 'Ana Administradora', rol: 'admin', password: DEMO_PASSWORD },
  { email: 'carga@demo.ve', nombre: 'Carlos Carga', rol: 'cargador', password: DEMO_PASSWORD },
  { email: 'revisor@demo.ve', nombre: 'Rosa Revisora', rol: 'revisor', password: DEMO_PASSWORD },
  { email: 'aprobador@demo.ve', nombre: 'Alberto Aprobador', rol: 'aprobador', password: DEMO_PASSWORD },
  { email: 'auditor@demo.ve', nombre: 'Aurora Auditora', rol: 'auditor', password: DEMO_PASSWORD },
];

const CUENTAS_BACKEND_DEV: QuickAccount[] = [
  { email: 'admin@evaluador.ve', nombre: 'Administrador del Sistema', rol: 'admin', password: 'Admin2026!' },
  { email: 'cargador@evaluador.ve', nombre: 'Elena Rivas', rol: 'cargador', password: 'Cargador2026!' },
  { email: 'revisor@evaluador.ve', nombre: 'Carlos Mendoza', rol: 'revisor', password: 'Revisor2026!' },
  { email: 'aprobador@evaluador.ve', nombre: 'Dra. María Bolívar', rol: 'aprobador', password: 'Aprobador2026!' },
  { email: 'auditor@evaluador.ve', nombre: 'Lic. José Paredes', rol: 'auditor', password: 'Auditor2026!' },
];

export function LoginPage() {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';
  const inviteParam = searchParams.get('invite')?.trim() || '';

  const [view, setView] = useState<AuthView>(() => (inviteParam ? 'invite' : 'login'));
  const [mode, setMode] = useState<LoginMode>('usuario');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Registro / Código de invitación
  const [fullName, setFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState(inviteParam);
  const [inviteInfo, setInviteInfo] = useState<ValidacionInvitacion | null>(null);
  const [validatingInvite, setValidatingInvite] = useState(() => Boolean(inviteParam));

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!inviteParam) return;
    let cancelled = false;
    api.auth
      .validateInvitation(inviteParam)
      .then((info) => {
        if (cancelled) return;
        setInviteInfo(info);
        if (info.email_bloqueado) setRegEmail(info.email_bloqueado);
      })
      .catch((e) => {
        if (cancelled) return;
        setInviteInfo(null);
        setError(e instanceof Error ? e.message : 'El código de invitación no es válido.');
      })
      .finally(() => {
        if (!cancelled) setValidatingInvite(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteParam]);

  if (user) {
    return <Navigate to={from} replace />;
  }

  const defaultDomain = isMock ? DEMO_LOGIN_DOMAIN : DEFAULT_LOGIN_DOMAIN;
  const showQuickAccess = isMock || import.meta.env.DEV;
  const quickAccounts = isMock ? CUENTAS_MOCK : CUENTAS_BACKEND_DEV;

  const entrar = async (correo: string, clave: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(correo, clave);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = (e: FormEvent) => {
    e.preventDefault();
    const resolvedEmail = normalizeLoginIdentifier(identifier, defaultDomain);
    if (!resolvedEmail) {
      setError(mode === 'usuario' ? 'Ingresa tu usuario.' : 'Ingresa tu correo electrónico.');
      return;
    }
    void entrar(resolvedEmail, password);
  };

  const handleValidateInvite = async () => {
    const clean = inviteCode.trim();
    if (!clean) {
      setError('Ingresa un código de invitación para validarlo.');
      return;
    }
    setError(null);
    setValidatingInvite(true);
    try {
      const info = await api.auth.validateInvitation(clean);
      setInviteInfo(info);
      if (info.email_bloqueado) setRegEmail(info.email_bloqueado);
    } catch (e) {
      setInviteInfo(null);
      setError(e instanceof Error ? e.message : 'No se pudo validar el código de invitación.');
    } finally {
      setValidatingInvite(false);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanCode = inviteCode.trim();
    if (view === 'invite' && !cleanCode) {
      setError('Ingresa el código de invitación para continuar.');
      return;
    }
    if (fullName.trim().length < 2) {
      setError('Ingresa tu nombre completo.');
      return;
    }
    if (!regEmail.trim()) {
      setError('Ingresa tu correo electrónico.');
      return;
    }
    if (regPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (regPassword !== regConfirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setSubmitting(true);
    try {
      await signup({
        nombre: fullName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        ...(cleanCode ? { codigo_invitacion: cleanCode } : {}),
      });
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar el registro.');
    } finally {
      setSubmitting(false);
    }
  };

  const switchView = (next: AuthView) => {
    setView(next);
    setError(null);
  };

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#contenido" className="saltar-contenido">Saltar al contenido principal</a>
      <InstitutionalHeader />
      <main id="contenido" className="mx-auto flex min-h-[calc(100vh-49px)] w-full max-w-[460px] flex-col justify-center px-4 py-10">
        <div className="w-full space-y-6">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md">
              <Bot className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
              Agente Evaluador de Propuestas
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Auditoría financiera, contraste de mercado y gestión de adjudicaciones
            </p>
          </div>

          <Card>
            <CardBody className="space-y-4">
              <div
                role="tablist"
                aria-label="Opciones de acceso"
                className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'login'}
                  onClick={() => switchView('login')}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                    view === 'login'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                  Entrar
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'register'}
                  onClick={() => switchView('register')}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                    view === 'register'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Registrarse
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'invite'}
                  onClick={() => switchView('invite')}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
                    view === 'invite'
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900',
                  )}
                >
                  <Ticket className="h-3.5 w-3.5" aria-hidden="true" />
                  Invitación
                </button>
              </div>

              {error && <Alert tone="error">{error}</Alert>}

              {view === 'login' ? (
                <>
                  <div
                    role="tablist"
                    aria-label="Modo de inicio de sesión"
                    className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'usuario'}
                      onClick={() => switchMode('usuario')}
                      className={cn(
                        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                        mode === 'usuario'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      <User className="h-3.5 w-3.5" aria-hidden="true" />
                      Usuario y clave
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'correo'}
                      onClick={() => switchMode('correo')}
                      className={cn(
                        'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                        mode === 'correo'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                      Correo y clave
                    </button>
                  </div>

                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div>
                      <label
                        htmlFor="login-campo-1"
                        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
                      >
                        {mode === 'usuario' ? 'Usuario' : 'Correo electrónico'}
                      </label>
                      <div className="relative">
                        {mode === 'usuario' ? (
                          <User
                            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                            aria-hidden="true"
                          />
                        ) : (
                          <Mail
                            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                            aria-hidden="true"
                          />
                        )}
                        <input
                          id="login-campo-1"
                          type={mode === 'usuario' ? 'text' : 'email'}
                          autoComplete={mode === 'usuario' ? 'username' : 'email'}
                          required
                          className="input pl-9"
                          placeholder={mode === 'usuario' ? 'admin' : `usuario@${defaultDomain}`}
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          disabled={submitting}
                        />
                      </div>
                      {mode === 'usuario' && (
                        <p className="mt-1 text-xs text-slate-500">
                          Usuarios disponibles: <span className="font-medium">admin</span>,{' '}
                          <span className="font-medium">cargador</span>,{' '}
                          <span className="font-medium">revisor</span>,{' '}
                          <span className="font-medium">aprobador</span> o{' '}
                          <span className="font-medium">auditor</span>.
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="login-campo-2"
                        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
                      >
                        Contraseña
                      </label>
                      <div className="relative">
                        <Lock
                          className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          id="login-campo-2"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="current-password"
                          required
                          className="input pl-9 pr-10"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={submitting}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                          aria-pressed={showPassword}
                          className="absolute right-2.5 top-2 rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>

                    <Button type="submit" className="w-full" loading={submitting}>
                      Iniciar sesión
                    </Button>
                  </form>
                </>
              ) : (
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="reg-invite-code"
                      className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Código de invitación {view === 'invite' ? '*' : '(opcional)'}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Ticket
                          className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          id="reg-invite-code"
                          type="text"
                          required={view === 'invite'}
                          className="input pl-9 uppercase tracking-wider"
                          placeholder="INV-XXXX-XXXX"
                          value={inviteCode}
                          onChange={(e) => {
                            setInviteCode(e.target.value);
                            setInviteInfo(null);
                          }}
                          disabled={submitting || validatingInvite}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleValidateInvite}
                        loading={validatingInvite}
                        disabled={submitting || !inviteCode.trim()}
                      >
                        Validar
                      </Button>
                    </div>
                    {inviteInfo?.valida && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                        <span>
                          Código válido · Rol asignado:{' '}
                          <strong className="font-semibold">{ROL_LABEL[inviteInfo.rol]}</strong>
                          {inviteInfo.expira_en ? ` · Vence ${date(inviteInfo.expira_en)}` : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="reg-nombre"
                      className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Nombre completo *
                    </label>
                    <div className="relative">
                      <User
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id="reg-nombre"
                        type="text"
                        autoComplete="name"
                        required
                        minLength={2}
                        className="input pl-9"
                        placeholder="Ej. María González"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="reg-email"
                      className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Correo electrónico *
                    </label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        required
                        readOnly={Boolean(inviteInfo?.email_bloqueado)}
                        className="input pl-9"
                        placeholder={`nombre@${defaultDomain}`}
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="reg-password"
                      className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Contraseña (mínimo 8 caracteres) *
                    </label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id="reg-password"
                        type={showRegPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        className="input pl-9 pr-10"
                        placeholder="••••••••"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        disabled={submitting}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword((prev) => !prev)}
                        aria-label={showRegPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        aria-pressed={showRegPassword}
                        className="absolute right-2.5 top-2 rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        {showRegPassword ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="reg-confirm"
                      className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
                    >
                      Confirmar contraseña *
                    </label>
                    <div className="relative">
                      <Lock
                        className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id="reg-confirm"
                        type={showRegPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        className="input pl-9"
                        placeholder="••••••••"
                        value={regConfirm}
                        onChange={(e) => setRegConfirm(e.target.value)}
                        disabled={submitting}
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full" loading={submitting}>
                    {view === 'invite' ? 'Canjear invitación y entrar' : 'Crear cuenta y entrar'}
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>

          {showQuickAccess && (
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <KeyRound className="h-4 w-4 text-amber-600" aria-hidden="true" />
                    Acceso rápido ({isMock ? 'modo demo' : 'entorno local'})
                  </div>
                  <Badge tone="amber">{isMock ? `Clave: ${DEMO_PASSWORD}` : '1 clic para entrar'}</Badge>
                </div>
                <div className="grid gap-2">
                  {quickAccounts.map((c) => (
                    <button
                      key={c.email}
                      type="button"
                      disabled={submitting}
                      onClick={() => entrar(c.email, c.password)}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/70 disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{c.nombre}</p>
                        <p className="truncate text-xs text-slate-500">{c.email}</p>
                      </div>
                      <Badge tone="indigo">{ROL_LABEL[c.rol]}</Badge>
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
