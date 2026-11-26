import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const certPath = env.VITE_TLS_CERT;
  const keyPath = env.VITE_TLS_KEY;
  const httpsConfig =
    certPath && keyPath && existsSync(certPath) && existsSync(keyPath)
      ? {
          cert: readFileSync(certPath),
          key: readFileSync(keyPath),
          minVersion: 'TLSv1.2' as const,
        }
      : undefined;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      ...(httpsConfig ? { https: httpsConfig } : {}),
      proxy: {
        // En modo real, /api se redirige al backend FastAPI
        '/api': {
          target: env.BACKEND_URL || 'http://localhost:8000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
