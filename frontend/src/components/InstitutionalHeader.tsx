import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export function InstitutionalHeader() {
  const [temaOscuro, setTemaOscuro] = useState(
    () => document.documentElement.dataset.tema === 'oscuro',
  );

  const cambiarTema = () => {
    const siguiente = temaOscuro ? 'claro' : 'oscuro';
    document.documentElement.dataset.tema = siguiente;
    document.documentElement.classList.toggle('tema-oscuro', siguiente === 'oscuro');
    setTemaOscuro(siguiente === 'oscuro');
    try {
      window.localStorage.setItem('aeps.tema', siguiente);
    } catch {
      // El tema cambia en esta sesión aunque no se pueda persistir la preferencia.
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-[var(--cintillo-fondo)] print:hidden">
      <div className="franja-tricolor" aria-hidden="true" />
      <div className="cintillo">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/bandera.svg" width="27" height="18" alt="" aria-hidden="true" />
          <span className="cintillo-republica">República Bolivariana de Venezuela</span>
          <span className="cintillo-separador" aria-hidden="true">·</span>
          <span className="cintillo-servicio truncate">Agente Evaluador de Propuestas de Servicios</span>
        </div>
        <button
          type="button"
          onClick={cambiarTema}
          aria-label={temaOscuro ? 'Activar tema claro' : 'Activar tema oscuro'}
          aria-pressed={temaOscuro}
          title={temaOscuro ? 'Activar tema claro' : 'Activar tema oscuro'}
          className="ml-auto inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-md px-2 text-[color:var(--cintillo-texto)] hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {temaOscuro ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden sm:inline">{temaOscuro ? 'Claro' : 'Oscuro'}</span>
        </button>
      </div>
    </header>
  );
}
