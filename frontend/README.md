# Frontend — Agente Evaluador de Propuestas de Servicios

Aplicación web SPA construida con **React + Vite + TypeScript + TailwindCSS**, **React Router** y **TanStack Query**.

## Puesta en marcha

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Scripts de validación y compilación

```bash
npm run lint       # ESLint (react-hooks, jsx-a11y y TypeScript)
npm run typecheck  # Verificación estricta de tipos (tsc --noEmit)
npm test           # Pruebas unitarias con Vitest (vitest run)
npm run build      # Verificación de tipos y compilación de producción (tsc --noEmit && vite build)
```

## Modos de funcionamiento

### 1. Modo demostración (sin backend)
Por defecto en `.env.example`, `VITE_USE_MOCK=true`. En este modo toda la plataforma funciona en el navegador usando `localStorage`, simulando la carga de archivos, la trazabilidad en vivo del agente, el chat sobre los documentos, las alertas de proveedores y la bitácora de auditoría.

**Cuentas de demostración** (contraseña: `demo1234`):
- `admin@demo.ve` — Administrador (acceso total)
- `carga@demo.ve` — Carga de documentos
- `revisor@demo.ve` — Revisor técnico-financiero
- `aprobador@demo.ve` — Aprobador
- `auditor@demo.ve` — Auditor (solo lectura)

### 2. Conexión al backend real (FastAPI)
Edita `frontend/.env`:

```env
VITE_USE_MOCK=false
VITE_API_URL=/api/v1
BACKEND_URL=http://localhost:8000
# HTTPS opcional en `npm run dev` (TLS 1.2+). Rutas locales fuera del repositorio:
# VITE_TLS_CERT=
# VITE_TLS_KEY=
```

Cuentas sembradas por el backend (`app/db/seed.py`): `admin@evaluador.ve`, `cargador@evaluador.ve`, `revisor@evaluador.ve`, `aprobador@evaluador.ve`, `auditor@evaluador.ve` (las contraseñas están en el README del backend).

## Contrato consumido (`src/api/http.ts` + `src/api/adapters.ts`)

El backend expone campos en inglés; `adapters.ts` los traduce a los tipos de `types.ts`. Prefijo: `/api/v1`.

| Módulo | Método y ruta | Uso en la interfaz |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/stream-ticket`, `GET /auth/me` | Inicio de sesión (`sessionStorage`), renovación en `401` y tickets efímeros (`?ticket=`) para SSE y descargas |
| Dashboard | `GET /dashboard/stats` | Métricas de alertas, bloqueos y postura de seguridad |
| Proyectos | `GET /projects`, `GET /projects/{id}`, `GET /projects/{id}/document/download?ticket=` | Listado, detalle y descarga de documento cifrado con ticket efímero |
| Proyectos | `POST /projects` (JSON) + `POST /projects/{id}/document` (`file`) | Alta con documento del proyecto |
| Proyectos | `POST /projects/{id}/status` `{target_status, adjudicated_proposal_id, notes}` | Cambio de etapa y adjudicación |
| Historial | `GET /audit-logs?resource_type=project&resource_id={id}` | Historial de estados (reconstruido desde la bitácora) |
| Propuestas | `GET/POST /projects/{id}/proposals` (campo `files`), `DELETE /proposals/{id}`, `GET /proposals/{id}/download?ticket=` | Carga masiva (3 a 20), gestión y descarga con ticket efímero |
| Evaluación | `POST /projects/{id}/evaluate` `{run_in_background, enable_web_search, bcv_rate_override, iva_rate}` | Botón «Evaluar Propuestas de Servicios» con parámetros configurables |
| Evaluación | `GET /projects/{id}/evaluations`, `GET /evaluations/{id}` | Historial de corridas, resultados, trazas persistidas y revisiones |
| Evaluación | `GET /evaluations/{id}/stream?ticket=` | SSE autorizado mediante ticket efímero (`POST /auth/stream-ticket`): eventos `trace_step`, `completed`, `failed`, `heartbeat` |
| Exportación | `GET /evaluations/{id}/export/{pdf\|xlsx\|markdown\|csv\|salida-json}` | Exportes unificados desde el backend con `Content-Disposition` (PDF, Excel, Markdown, CSV y `salida.json`) |
| Revisiones | `POST /evaluations/{id}/reviews` `{decision, notes, ...}` | Nota, confirmación, aprobación (incluyendo adjudicación alternativa) y rechazo |
| Proveedores | `GET/POST /suppliers`, `GET/PATCH /suppliers/{id}`, `POST /suppliers/alerts/{alertId}/resolve` | Directorio, CRUD, resolución de alertas e historial |
| Auditoría | `GET /audit-logs` | Registro de cambios |
| Usuarios | `GET /auth/users`, `POST /auth/register`, `PATCH /auth/users/{id}` | Administración (solo admin) |
| Moneda | `GET /finance/bcv-rate`, `GET /finance/bcv-rate/history`, `POST /finance/bcv-rate/override` | Tasa BCV vigente, historial y anulación manual |
| Chat | `GET/POST/DELETE /projects/{id}/chat` `{question}` | Consulta en lenguaje natural y limpieza del historial |
