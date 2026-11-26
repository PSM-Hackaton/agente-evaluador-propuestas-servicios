import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Building2,
  ClipboardList,
  FolderKanban,
  LogOut,
  Menu,
  RefreshCw,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import { api, isMock } from '../api';
import { resetMockData } from '../api/mock';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { datetime, number } from '../lib/format';
import { ROL_LABEL } from '../lib/labels';
import { can } from '../lib/roles';
import { Alert, Badge, Button, Modal, Spinner } from '../components/ui';

const DEMO_USER_IDS = new Set(['u-admin', 'u-carga', 'u-rev', 'u-apro', 'u-aud']);

export function AppLayout() {
  const { user, logout, sessionExpiringSoon, renewing, renewSession } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bcvModalOpen, setBcvModalOpen] = useState(false);
  const [manualRate, setManualRate] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [bcvError, setBcvError] = useState<string | null>(null);

  const { data: tasa } = useQuery({
    queryKey: ['bcv'],
    queryFn: () => api.currency.bcv(),
    staleTime: 5 * 60_000,
  });

  const historyQ = useQuery({
    queryKey: ['bcv-history'],
    queryFn: api.currency.history,
    enabled: bcvModalOpen,
  });

  const refreshMut = useMutation({
    mutationFn: () => api.currency.bcv(true),
    onSuccess: async (t) => {
      setBcvError(null);
      qc.setQueryData(['bcv'], t);
      await qc.invalidateQueries({ queryKey: ['bcv-history'] });
    },
    onError: (e) => setBcvError(e instanceof Error ? e.message : 'No se pudo refrescar la tasa BCV'),
  });

  const overrideMut = useMutation({
    mutationFn: ({ val, nota }: { val: number; nota?: string }) => api.currency.override(val, nota),
    onSuccess: async (t) => {
      setBcvError(null);
      setManualRate('');
      setManualNote('');
      qc.setQueryData(['bcv'], t);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['bcv-history'] }),
        qc.invalidateQueries({ queryKey: ['audit'] }),
      ]);
    },
    onError: (e) => setBcvError(e instanceof Error ? e.message : 'No se pudo fijar la tasa manual'),
  });

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    const val = Number(manualRate.replace(',', '.'));
    if (!Number.isFinite(val) || val <= 0) {
      setBcvError('Ingresa una tasa USD/Bs válida mayor a 0.');
      return;
    }
    overrideMut.mutate({ val, nota: manualNote.trim() || undefined });
  };

  if (!user) return null;

  const navItems = [
    { to: '/', label: 'Proyectos', icon: FolderKanban, show: true, end: true },
    { to: '/proveedores', label: 'Proveedores', icon: Building2, show: true, end: false },
    { to: '/auditoria', label: 'Auditoría', icon: ClipboardList, show: can(user.rol, 'auditoria.ver'), end: false },
    { to: '/usuarios', label: 'Usuarios', icon: Users, show: can(user.rol, 'usuarios.admin'), end: false },
  ].filter((item) => item.show);

  const handleResetDemo = async () => {
    resetMockData();
    await qc.invalidateQueries();
    if (!DEMO_USER_IDS.has(user.id)) {
      logout();
      navigate('/login');
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-200">
      <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
            <Bot className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Agente Evaluador</p>
            <p className="text-[11px] text-slate-400">Propuestas de Servicios</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          aria-label="Cerrar menú"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-4 text-xs text-slate-400">
        <p className="font-medium text-slate-300">{user.nombre}</p>
        <p className="mt-0.5 truncate">{user.email}</p>
        <p className="mt-1 text-[11px] text-indigo-300">{ROL_LABEL[user.rol]}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-indigo-700 focus:shadow"
      >
        Saltar al contenido
      </a>
      {/* Sidebar escritorio */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col print:hidden">
        {sidebarContent}
      </aside>

      {/* Drawer móvil */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden print:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Cerrar menú lateral"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/50"
          />
          <aside className="relative z-10 w-64 max-w-xs">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Contenido principal */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 print:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            {tasa && (
              <button
                type="button"
                onClick={() => {
                  setBcvError(null);
                  setBcvModalOpen(true);
                }}
                title="Consultar fuente, historial o fijar tasa BCV manual"
                className="inline-flex items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Badge tone={tasa.fuente === 'manual' ? 'amber' : 'indigo'}>
                  BCV: Bs. {number(tasa.usd_ves)} / USD
                  {tasa.fuente === 'manual' ? ' (manual)' : ''}
                </Badge>
              </button>
            )}
            {isMock && (
              <div className="hidden items-center gap-2 sm:flex">
                <Badge tone="amber">Modo demo</Badge>
                <Button variant="ghost" size="sm" onClick={handleResetDemo} title="Restaurar datos de prueba">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reiniciar demo
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-800">{user.nombre}</p>
              <p className="text-xs text-slate-500">{ROL_LABEL[user.rol]}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Cerrar sesión"
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </header>

        {sessionExpiringSoon && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6 print:hidden"
          >
            <span>Tu sesión está por expirar pronto. Renueva el acceso para evitar interrupciones.</span>
            <Button
              size="sm"
              variant="secondary"
              loading={renewing}
              onClick={() => void renewSession()}
            >
              Renovar sesión
            </Button>
          </div>
        )}

        <main id="contenido" tabIndex={-1} className="mx-auto focus:outline-none w-full max-w-7xl flex-1 p-4 sm:p-6 print:p-0">
          <Outlet />
        </main>
      </div>

      <Modal
        open={bcvModalOpen}
        onClose={() => setBcvModalOpen(false)}
        title="Tasa de cambio oficial BCV (USD / VES)"
        size="lg"
      >
        <div className="space-y-5">
          {bcvError && (
            <div role="alert">
              <Alert tone="error">{bcvError}</Alert>
            </div>
          )}

          {tasa && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tasa activa en sistema
                </p>
                <p className="text-2xl font-bold tabular-nums text-slate-900">
                  Bs. {number(tasa.usd_ves)} / USD
                </p>
                <p className="text-xs text-slate-500">
                  Fuente: <strong>{tasa.origen ?? (tasa.fuente === 'manual' ? 'Manual' : 'BCV')}</strong> ·{' '}
                  {datetime(tasa.fecha)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={refreshMut.isPending}
                onClick={() => refreshMut.mutate()}
              >
                <RefreshCw className="h-4 w-4" />
                Refrescar tasa BCV
              </Button>
            </div>
          )}

          {can(user.rol, 'bcv.fijar') && (
            <form onSubmit={handleManualSubmit} className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Fijar tasa manual de contingencia
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="bcv-manual-rate" className="mb-1 block text-xs font-medium text-slate-700">
                    Nueva tasa (Bs. / USD) *
                  </label>
                  <input
                    id="bcv-manual-rate"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="input"
                    value={manualRate}
                    onChange={(e) => setManualRate(e.target.value)}
                    placeholder={tasa ? String(tasa.usd_ves) : 'Ej. 52.40'}
                  />
                </div>
                <div>
                  <label htmlFor="bcv-manual-note" className="mb-1 block text-xs font-medium text-slate-700">
                    Nota / justificación (opcional)
                  </label>
                  <input
                    id="bcv-manual-note"
                    className="input"
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder="Ej. Resolución comité / contingencia BCV"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={overrideMut.isPending}>
                  Aplicar tasa manual
                </Button>
              </div>
            </form>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Historial reciente de tasas
            </h3>
            {historyQ.isLoading ? (
              <Spinner label="Cargando historial BCV..." />
            ) : (historyQ.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">Sin registros históricos disponibles.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th className="text-right">Tasa</th>
                      <th>Fuente</th>
                      <th>Registrada por</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {(historyQ.data ?? []).map((h) => (
                      <tr key={h.id}>
                        <td className="text-xs text-slate-600">{datetime(h.fecha)}</td>
                        <td className="text-right font-semibold tabular-nums text-slate-900">
                          Bs. {number(h.usd_ves)}
                        </td>
                        <td>
                          <Badge tone={h.es_manual ? 'amber' : 'indigo'}>{h.fuente}</Badge>
                        </td>
                        <td className="text-xs text-slate-500">{h.registrada_por ?? 'sistema'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
