import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Bot, KeyRound, Lock, Mail } from 'lucide-react';
import { isMock, type Rol } from '../api';
import { DEMO_PASSWORD } from '../api/mock/specs';
import { useAuth } from '../context/AuthContext';
import { ROL_LABEL } from '../lib/labels';
import { Alert, Badge, Button, Card, CardBody } from '../components/ui';
import { InstitutionalHeader } from '../components/InstitutionalHeader';

const CUENTAS_DEMO: { email: string; nombre: string; rol: Rol }[] = [
  { email: 'admin@demo.ve', nombre: 'Ana Administradora', rol: 'admin' },
  { email: 'carga@demo.ve', nombre: 'Carlos Carga', rol: 'cargador' },
  { email: 'revisor@demo.ve', nombre: 'Rosa Revisora', rol: 'revisor' },
  { email: 'aprobador@demo.ve', nombre: 'Alberto Aprobador', rol: 'aprobador' },
  { email: 'auditor@demo.ve', nombre: 'Aurora Auditora', rol: 'auditor' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to={from} replace />;
  }

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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    entrar(email, password);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#contenido" className="saltar-contenido">Saltar al contenido principal</a>
      <InstitutionalHeader />
      <main id="contenido" className="mx-auto flex min-h-[calc(100vh-49px)] w-full max-w-[420px] flex-col justify-center px-4 py-10">
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
            {error && <Alert tone="error">{error}</Alert>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-campo-1" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    id="login-campo-1"
                    type="email"
                    required
                    className="input pl-9"
                    placeholder="usuario@institucion.ve"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-campo-2" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    id="login-campo-2"
                    type="password"
                    required
                    className="input pl-9"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" loading={submitting}>
                Iniciar sesión
              </Button>
            </form>
          </CardBody>
        </Card>

        {isMock && (
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  Cuentas de demostración (clic para entrar)
                </div>
                <Badge tone="amber">Clave: {DEMO_PASSWORD}</Badge>
              </div>
              <div className="grid gap-2">
                {CUENTAS_DEMO.map((c) => (
                  <button
                    key={c.email}
                    type="button"
                    disabled={submitting}
                    onClick={() => entrar(c.email, DEMO_PASSWORD)}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/70 disabled:opacity-50"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{c.nombre}</p>
                      <p className="text-xs text-slate-500">{c.email}</p>
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
