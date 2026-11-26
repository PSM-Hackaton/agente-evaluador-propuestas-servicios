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
VITE_API_URL=/api
BACKEND_URL=http://localhost:8000
```

## Contrato de endpoints REST y SSE (`src/api/http.ts`)

| Módulo | Método y ruta | Descripción |
|---|---|---|
| Auth | `POST /api/auth/login` | Devuelve `{ access_token, user }` |
| Auth | `GET /api/auth/me` | Usuario autenticado actual |
| Proyectos | `GET /api/projects` | Lista de proyectos |
| Proyectos | `POST /api/projects` | `FormData` con `datos` (JSON) y `archivo` |
| Proyectos | `GET /api/projects/{id}` | Detalle de un proyecto |
| Proyectos | `PATCH /api/projects/{id}/estado` | Body `{ estado, nota }` |
| Proyectos | `GET /api/projects/{id}/historial` | Historial de estados |
| Propuestas | `GET /api/projects/{id}/proposals` | Propuestas cargadas |
| Propuestas | `POST /api/projects/{id}/proposals` | `FormData` con múltiples `archivos` |
| Propuestas | `DELETE /api/proposals/{id}` | Elimina una propuesta |
| Evaluación | `POST /api/projects/{id}/evaluate` | Inicia el agente y devuelve `Evaluacion` |
| Evaluación | `GET /api/projects/{id}/evaluations/latest` | Última evaluación del proyecto (o 404) |
| Evaluación | `GET /api/evaluations/{id}` | Detalle y resultados de evaluación |
| Evaluación | `GET /api/evaluations/{id}/trazas` | Trazas persistidas |
| Evaluación | `GET /api/evaluations/{id}/stream?token=...` | SSE de trazas en vivo (`message` + evento `done`) |
| Evaluación | `GET /api/evaluations/{id}/export?formato=pdf\|xlsx` | Descarga binaria en PDF o Excel |
| Revisiones | `GET /api/evaluations/{id}/revisiones` | Historial de revisiones humanas |
| Revisiones | `POST /api/evaluations/{id}/revisiones` | Body `{ accion, comentario }` |
| Proveedores | `GET /api/suppliers` | Directorio con alertas |
| Proveedores | `GET /api/suppliers/{id}` | Ficha y participaciones |
| Auditoría | `GET /api/audit` | Registro de cambios |
| Usuarios | `GET /api/users` | Lista de usuarios (admin) |
| Usuarios | `POST /api/users` | Crear usuario (admin) |
| Usuarios | `PATCH /api/users/{id}` | Actualizar rol o estado (admin) |
| Moneda | `GET /api/currency/bcv` | Tasa oficial BCV vigente |
| Chat | `GET /api/projects/{id}/chat` | Historial del chat del proyecto |
| Chat | `POST /api/projects/{id}/chat` | Body `{ contenido }` |
