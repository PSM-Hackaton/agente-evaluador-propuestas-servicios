# Frontend — Agente Evaluador de Propuestas de Servicios

Aplicación web SPA construida con **React + Vite + TypeScript + TailwindCSS**, **React Router** y **TanStack Query**.

## Puesta en marcha

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Compilación para producción (incluye verificación estricta de TypeScript):

```bash
npm run build
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
| Auth | `POST /auth/login` → `GET /auth/me` | Inicio de sesión (token Bearer) |
| Proyectos | `GET /projects`, `GET /projects/{id}` | Listado y detalle |
| Proyectos | `POST /projects` (JSON) + `POST /projects/{id}/document` (`file`) | Alta con documento del proyecto |
| Proyectos | `POST /projects/{id}/status` `{target_status, notes}` | Cambio de etapa |
| Historial | `GET /audit-logs?resource_type=project&resource_id={id}` | Historial de estados (reconstruido desde la bitácora) |
| Propuestas | `GET/POST /projects/{id}/proposals` (campo `files`), `DELETE /proposals/{id}` | Carga masiva y gestión |
| Evaluación | `POST /projects/{id}/evaluate` `{run_in_background: true}` | Botón «Evaluar Propuestas de Servicios» |
| Evaluación | `GET /evaluations/{id}` | Resultados, trazas persistidas y revisiones |
| Evaluación | `GET /evaluations/{id}/stream?token=` | SSE: eventos `trace_step`, `completed`, `failed`, `heartbeat` |
| Exportación | `GET /evaluations/{id}/export/{pdf\|xlsx}` | Informe PDF y comparativa Excel (Markdown/CSV se generan en el navegador) |
| Revisiones | `POST /evaluations/{id}/reviews` `{decision, notes}` | Nota, confirmación, aprobación, rechazo |
| Proveedores | `GET /suppliers`, `GET /suppliers/{id}` | Directorio, alertas e historial |
| Auditoría | `GET /audit-logs` | Registro de cambios |
| Usuarios | `GET /auth/users`, `POST /auth/register`, `PATCH /auth/users/{id}` | Administración (solo admin) |
| Moneda | `GET /finance/bcv-rate` | Tasa BCV vigente |
| Chat | `GET/POST /projects/{id}/chat` `{question}` | Consulta en lenguaje natural |
