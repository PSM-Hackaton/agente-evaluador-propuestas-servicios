import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { App } from './App';
import './index.css';

function initializeTheme() {
  let savedTheme: string | null = null;
  try {
    savedTheme = window.localStorage.getItem('aeps.tema');
  } catch {
    // El tema del sistema sigue disponible si el almacenamiento está bloqueado.
  }
  const dark =
    savedTheme === 'oscuro' ||
    (savedTheme !== 'claro' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.tema = dark ? 'oscuro' : 'claro';
  document.documentElement.classList.toggle('tema-oscuro', dark);
}

initializeTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
