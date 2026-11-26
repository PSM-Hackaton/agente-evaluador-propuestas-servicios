import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Building2,
  ClipboardList,
  FolderKanban,
  LogOut,
  Menu,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import { api, isMock } from '../api';
import { resetMockData } from '../api/mock';
import { useAuth } from '../context/AuthContext';
import { cn } from '../lib/cn';
import { number } from '../lib/format';
import { ROL_LABEL } from '../lib/labels';
import { can } from '../lib/roles';
import { Badge, Button } from '../components/ui';

const DEMO_USER_IDS = new Set(['u-admin', 'u-carga', 'u-rev', 'u-apro', 'u-aud']);

export function AppLayout() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: tasa } = useQuery({
    queryKey: ['bcv'],
    queryFn: api.currency.bcv,
    staleTime: 5 * 60_000,
  });

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
        <div
          className="fixed inset-0 z-40 flex lg:hidden print:hidden"
          onClick={() => setSidebarOpen(false)}
        >
          <div className="fixed inset-0 bg-slate-900/50" />
          <aside className="relative z-10 w-64 max-w-xs" onClick={(e) => e.stopPropagation()}>
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
              <Badge tone="indigo">
                BCV: Bs. {number(tasa.usd_ves)} / USD
              </Badge>
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

        <main id="contenido" tabIndex={-1} className="mx-auto focus:outline-none w-full max-w-7xl flex-1 p-4 sm:p-6 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
