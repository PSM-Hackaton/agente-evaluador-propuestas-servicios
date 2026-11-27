# AGENTS.md — Contexto del Sistema, Avance del Día 1 y Guía de Relevo

> **Propósito (FinOps / Ahorro de Tokens):** Lee este archivo primero al iniciar una sesión nueva. Resume toda la arquitectura del sistema, el estado exacto de ramas, lo construido el **26-11-2026** y los pendientes prioritarios para el **27-11-2026** sin necesidad de releer decenas de archivos.
> **Nota de entrega:** `AGENTS.md` está excluido explícitamente en `scripts/exclusiones-entrega.txt`; nunca se publica al GitLab del evento ni interfiere con `scripts/subir-por-etapas.sh`.

---

## 1. Resumen Ejecutivo y Estado de Ramas (Corte: 26-11-2026, noche)

- **Proyecto:** **Agente Evaluador de Propuestas de Servicios** — Hackatón Venezuela INNOVA 2026 (Reto Grupal 3, 26 y 27 nov 2026).
- **Producto:** SPA React/Vite/TypeScript (`frontend/`) + API REST/SSE FastAPI (`backend/`) + CLI en modo lote (`salida.json`) para evaluar licitaciones (`proyecto.pdf` + 3 a 20 propuestas heterogéneas en PDF/DOCX/XLSX/imágenes/capturas de chat).
- **Relación entre repositorios y ramas:**
  - `JarviScott/hackaton` (`main`, commit `1539daa`) es **idéntico** a `PSM-Hackaton/agente-evaluador-propuestas-servicios` rama `javier` (`1539daa`).
  - `origin/javier` está **100% al día en frontend** respecto a `origin/staging` (los 7 commits de Javier `5685928..1539daa` entraron por squash en `origin/staging` como `c12accd` / PR #43).
  - **Lo único que le falta a `javier` frente a `origin/staging`** es el commit `b349cbb` (PR #44 de Enggel: fix directorio padre SQLite en Alembic, buffer SSE desde paso 1, sobreprecios entre partidas + prioridad inyección, rate-limit en login, recuperación total Propuesta 331 y ajuste de `docs/resultado_esperado_lote.md`).
  - `origin/main` (`f4f3d15`) solo tiene estructura inicial + `CODEOWNERS` (aún sin integración).
  - **Importante al sincronizar mañana:** Como `origin/staging` integró el PR #43 como *squash* (`c12accd`), sincronizar `javier` haciendo rebase o reset sobre `origin/staging` (evitar duplicar commits de frontend).

---

## 2. Criterios de Evaluación del Reto (100 pts)

| Bloque | Peso | Detalle crítico |
|---|---:|---|
| **Plataforma (Sec. 2.E y 2.F)** | **75 pts** | Ingesta multimodal, aritmética `Decimal`, TCO + BCV + IVA, contraste web, defensa contra *prompt injection*, trazabilidad SSE, historial/estados, RBAC 5 roles, revisión humana + auditoría, directorio/alertas de proveedores, exportes PDF/MD/XLSX/CSV, chat sobre documentos, TLS 1.2/1.3 y AES-256-GCM en reposo. |
| **Evaluación automática (`salida.json`, Sec. 3.C/3.D)** | **25 pts** | Escala 0–20 × 1.25: **Filtro** `8 × Vk/k` (8 pts) + **Orden** `8 × (1 − D/Dmax)` con `Dmax=⌊k²/2⌋` (8 pts) + **Primera** (4 pts). **Reglas fatales:** repetidos en `ranking` = **0 pts**; `commit` debe venir de `git rev-parse HEAD` y `repositorio` debe ser la ruta real en GitLab (`HACKATHON_REPO_PATH`). |

- **Lote de práctica (`docs/reto/`, `docs/resultado_esperado_lote.md`):**
  - 5 válidas ordenadas: `[602, 923, 841, 638, 832]`.
  - 5 descartadas: `131` (inyección + AM5/AM4), `331` (condición abusiva/flete), `734` (RAM > slots + fórmula), `898` (Xeon E5/X99 obsoleto), `975` (DDR5 en placa DDR4 + sin teclado/ratón).

---

## 3. Qué se Hizo Hoy (Jueves 26-11-2026)

### 3.1 Línea de Tiempo del Equipo (15 commits en `javier` / `hackaton`)
1. `6d60af8` (11:34, Diego): Estructura inicial, `.gitignore`, `README.md` y material oficial en `docs/reto/`.
2. `0192c25` (15:04, Diego): `.github/CODEOWNERS` (`@diego-landaeta`, `@lya0509`).
3. `9410011` (15:42, Diego / trabajo de Enggel, PR #18): Backend base completo (72 archivos, +10,169L).
4. `58ebe34` (15:42, Diego / trabajo de Javier, PR #26): Frontend conectado a `/api/v1` (54 archivos, +9,768L).
5. `677fcd3` (15:42, Diego, PR #32): `README.md`, matriz de cumplimiento, flujo GitLab, hooks y scripts de entrega.
6. `1c0c7c5` (16:36, Diego, PR #34): Normalización GitLab (plantilla evento, commits detallados y noreply GitLab).
7. `0b24dd3` (16:41, Enggel, PR #35): Alembic, ingesta completa (PDFs escaneados + deskew + chats), TLS 1.2+, rango 3–20, `salida.json` con repo/commit reales, antecedentes en agente y fechas UTC.
8. `4605b35` (16:43, Diego, PR #42): Scripts de subida por etapas sobre `gitlab/desarrollo` con identidades reales.
9. `5685928` → `1539daa` (17:06–17:09, **Javier Rodríguez**): 7 commits de frontend detallados abajo.
10. *(Solo en `origin/staging`)* `b349cbb` (PR #44, Enggel): Fixes finales de backend (55/55 pytest y ruff en verde).

### 3.2 Detalle de los 7 Commits de Javier (Frontend)

| Commit | Issue | Qué se implementó | Archivos clave |
|---|---|---|---|
| `5685928` | `#4` | Exportes unificados desde backend (`pdf`, `markdown`, `csv`, `xlsx`, `salida-json`) con `Content-Disposition`; panel de postura de seguridad (`GET /dashboard/stats`); descargas de documentos y botón limpiar chat (`DELETE /projects/{id}/chat`). | `http.ts`, `ExportButtons.tsx`, `ProjectChat.tsx`, `DashboardPage.tsx`, `ProjectDetailPage.tsx` |
| `f7092ca` | `#22` | Límite estricto **3 a 20 propuestas** en carga masiva (`FileDropzone`) y bloqueo del botón evaluar fuera de rango. | `FileDropzone.tsx`, `ProjectDetailPage.tsx` |
| `b55560a` | `#13` | Selector de historial de evaluaciones por proyecto (`GET /projects/{id}/evaluations`) en tabs Trazabilidad e Informe. | `adapters.ts`, `http.ts`, `types.ts`, `ProjectDetailPage.tsx` |
| `62d1325` | `#14` | CRUD de proveedores (`POST /suppliers`, `PATCH /suppliers/{id}`), permisos `proveedor.crear`/`proveedor.editar`, modal `SupplierFormModal` (validación RIF) y resolución de alertas (`POST /suppliers/alerts/{alertId}/resolve`). | `SupplierFormModal.tsx`, `SuppliersPage.tsx`, `SupplierDetailPage.tsx`, `lib/roles.ts` |
| `8b8aff6` | `#15` | Diálogo interactivo BCV en `AppLayout` (historial + override manual con `bcv.fijar`), modal de parámetros pre-evaluación (`enable_web_search`, `iva_rate`, `bcv_rate_override`) y toggle `USD`/`Bs.` en comparativa y TCO. | `AppLayout.tsx`, `ComparisonTable.tsx`, `CostBreakdown.tsx`, `ProjectDetailPage.tsx` |
| `6f4ac34` | `#16` | Adjudicación alternativa (`decision: overridden` + justificación ≥10 chars + `override_recommended_proposal_id`), notas por propuesta en comparativa y banner "Adjudicado a..." en cabecera del proyecto. | `ReviewPanel.tsx`, `ComparisonTable.tsx`, `ProjectDetailPage.tsx` |
| `1539daa` | `#17`, `#23` | Tokens movidos a `sessionStorage` + auto-refresh en `401` (`POST /auth/refresh`) + aviso de expiración; **tickets efímeros** (`POST /auth/stream-ticket`) eliminando `?token=` en SSE/descargas; **Vitest** (7/7 en `adapters.test.ts`); **ESLint 9** (`react-hooks`, `jsx-a11y`, trap de foco en `Modal.tsx`); CI `.github/workflows/frontend.yml`; **HTTPS TLS 1.2+ opcional** en Vite. | `session.ts`, `http.ts`, `AuthContext.tsx`, `Modal.tsx`, `adapters.test.ts`, `eslint.config.js`, `vite.config.ts`, `frontend.yml` |

---

## 4. Mapa de Arquitectura del Sistema

### 4.1 Backend (`backend/`)
- **Stack (`pyproject.toml`, Python ≥3.11):** FastAPI, Uvicorn, SQLAlchemy 2 async (`aiosqlite`, WAL), Alembic, Pydantic v2, `cryptography` (AES-256-GCM + HKDF-SHA256 + HMAC blind index), `PyJWT` + `scrypt`, `google-genai`, `openai`, `ddgs`, `httpx`, `pymupdf`, `openpyxl`, `Pillow`, `pytesseract` (vía `stdin`/`stdout` en memoria), `reportlab`, `pytest`, `ruff`.
- **Módulos principales:**
  - `app/main.py`, `app/run.py`: `create_app()`, lifespan (valida secretos en `staging`/`production`, `init_db`, `seed_default_users`), TLS 1.2+ (`build_tls_ssl_context()`).
  - `app/core/`: `config.py`, `crypto.py` (subclaves HKDF + rotación `PREVIOUS_ENCRYPTION_KEY`), `security.py` (5 roles: `admin`, `cargador`, `revisor`, `aprobador`, `auditor`).
  - `app/db/models.py` (**12 tablas ORM** con `EncryptedText`/`EncryptedFloat`/`EncryptedJSON`/`UTCDateTime` + `*_hash` HMAC): `users`, `suppliers`, `supplier_alerts`, `projects`, `proposals`, `evaluation_runs`, `proposal_evaluations`, `agent_trace_steps`, `human_reviews`, `audit_logs`, `chat_messages`, `bcv_rate_snapshots`. Migración única: `alembic/versions/0001_initial_schema.py`.
  - `app/services/ingestion/`: 16 extensiones (`.pdf`, `.docx`, `.xlsx/.xlsm/.xls`, `.csv/.tsv`, imágenes, `.txt/.md`); detecta texto oculto/blanco/microtexto, fórmulas seguras vía `ast`, deskew + OCR dual-pass y capturas de chat.
  - `app/services/agent/`: `orchestrator.py` (pipeline de 9 pasos: BCV → ingesta + `security_guard.py` → extracción heurística + tool calling LLM máx. 6 pasos con `_verify_llm_issue_evidence` → historial proveedor `-10 pts` → aritmética `Decimal` tol `$0.05` → TCO USD/VES +4% gestión + IVA → `technical_audit.py` 7 causales → contraste web `market/search.py` descarte `>=85%` → ranking 85% técnico / 15% económico + alertas automáticas), `chat_service.py`.
  - `app/services/reports/`: `exporter.py` (PDF, MD, XLSX 4 hojas, CSV BOM) y `salida_json.py`.
  - `app/services/storage/encrypted_storage.py`: archivos cifrados AES-256-GCM con borrado seguro.
  - `app/cli/batch.py`: `python -m app.cli.batch --lote ... --output salida.json`.
- **API (43 rutas: `GET /health` + 42 bajo `/api/v1`):**
  - `auth`: `/login`, `/refresh`, `/stream-ticket`, `/me`, `/register`, `/users`, `/users/{id}`.
  - `dashboard`: `/dashboard/stats`.
  - `projects`: `CRUD /projects`, `/projects/{id}/document` (+ `/download`), `/projects/{id}/evaluations`, `/projects/{id}/status`.
  - `proposals`: `POST/GET /projects/{id}/proposals` (máx. 20), `GET/DELETE /proposals/{id}`, `/proposals/{id}/download`.
  - `evaluations`: `POST /projects/{id}/evaluate` (exige 3–20), `GET /evaluations/{id}`, `/stream` (SSE), `/export/{fmt}`, `POST /evaluations/{id}/reviews`.
  - `suppliers`: `GET/POST /suppliers`, `GET/PATCH /suppliers/{id}`, `POST /suppliers/alerts/{alert_id}/resolve`.
  - `finance`: `GET /finance/bcv-rate`, `/history`, `POST /override`, `POST /tco-preview`.
  - `chat`, `audit`, `batch`: `/projects/{id}/chat` (`POST/GET/DELETE`), `GET /audit-logs`, `POST /batch/run`, `POST /batch/validate-salida`.
- **Tests (`backend/tests/`):** 6 suites (`test_api_end_to_end.py`, `test_crypto_and_storage.py`, `test_ingestion_and_security.py`, `test_diego_issues_r3.py`, `test_lote_tls_y_contrato.py`, `test_revision_correcciones.py`).

### 4.2 Frontend (`frontend/`)
- **Stack (`package.json`):** React 18.3, TypeScript 5.6 (`strict`), Vite 7.3 (puerto `5173`, proxy `/api` → `BACKEND_URL`), React Router 7, TanStack Query 5, Tailwind CSS 3.4, Lucide Icons, Vitest 3.2, ESLint 9 (`react-hooks`, `jsx-a11y`).
- **Rutas (`src/App.tsx`):** `/login`, `/` (`DashboardPage`), `/proyectos/:id` (`ProjectDetailPage`, 1,164L), `/proveedores` (`SuppliersPage`), `/proveedores/:id` (`SupplierDetailPage`), `/auditoria` (`AuditPage`, permiso `auditoria.ver`), `/usuarios` (`UsersPage`, permiso `usuarios.admin`).
- **Capa API (`src/api/`):** `index.ts` conmuta `mockApi` / `httpApi` según `VITE_USE_MOCK !== 'false'`; `session.ts` (`sessionStorage` + `getTokenExpiryMs`); `http.ts` (auto-refresh single-flight en `401` + `streamTicket` para SSE/descargas); `adapters.ts` (traducción inglés↔español + `fechaUtc`).
- **Scripts:** `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- **Env (`frontend/.env.example`):** `VITE_USE_MOCK`, `VITE_API_URL=/api/v1`, `BACKEND_URL=http://localhost:8000`, `VITE_TLS_CERT`, `VITE_TLS_KEY`.

---

## 5. Reglas del Repositorio, Hooks y Entrega a GitLab

- **Hooks (`scripts/hooks/`):**
  - `commit-msg`: exige Conventional Commits en español `tipo(ámbito): descripción (#issue)` (≥10 chars) + línea en blanco + cuerpo de **≥2 líneas descriptivas** (≥15 chars c/u: Qué / Por qué / Verificación / Riesgos).
  - `pre-commit`: exige identidad real (o noreply `@users.noreply.gitlab.nube.gob.ve`); bloquea `.env`, llaves/certs, `*.db`, `*.enc`, `backend/data/`, archivos >5 MB, secretos/tokens reales y nombres de herramientas externas o líneas de coautoría.
  - `pre-push`: corre `pytest` en `backend/` y `npm run build` en `frontend/` (filtrable con `PREPUSH_SOLO=backend|frontend`).
- **Entrega GitLab:** `scripts/preparar-entrega.sh`, `scripts/subir-por-etapas.sh` y `scripts/sincronizar-gitlab.sh`. Todo archivo nuevo fuera de `backend/` y `frontend/` que no sea de entrega pública debe estar en `scripts/exclusiones-entrega.txt` o asignado en `scripts/etapas-entrega.txt`.
- **CI GitHub:** `.github/workflows/frontend.yml` valida `lint`, `typecheck`, `test` y `build` en Node 20 (actualmente en `push` a `[staging, javier, feat/*]` y `pull_request` a `[staging, main]`).

---

## 6. Bugs Detectados y Pendientes Prioritarios para Mañana (Viernes 27-11-2026)

### P0 — Bloqueantes / Críticos
1. **Sincronizar rama `javier` con `origin/staging`:** Traer PR #44 (`b349cbb`) mediante rebase/reset sobre `origin/staging` para trabajar con el backend más reciente.
2. **Bug en migración Alembic (`backend/alembic/versions/0001_initial_schema.py:280`):** Crea `created_at` en `bcv_rate_snapshots`, pero `app/db/models.py:392`, `bcv.py` y `finance.py` usan `fetched_at`. Si se levanta una BD limpia solo con `alembic upgrade head` (p. ej. PostgreSQL/Supabase), `GET /finance/bcv-rate` y `GET /dashboard/stats` fallarán. Corregir columna + índice y agregar aserción de columnas en `test_issue5_alembic_upgrade_and_downgrade_clean`.
3. **Prueba E2E real (Frontend + Backend + LLM + Web Search + TLS 1.2+):** Levantar `VITE_USE_MOCK=false`, API key real de Gemini/OpenAI, búsqueda web activa y TLS (`TLS_ENABLED=true` o Nginx) para validar flujo completo en navegador.

### P1 — Fixes Rápidos y Calidad (Frontend)
4. **Error oculto tras modal (`frontend/src/pages/ProjectDetailPage.tsx:1086-1093`):** Las validaciones de `paramIvaPct` / `paramBcvOverride` llaman a `setActionError`, que renderiza fuera del `<Modal>` (detrás del backdrop). Mostrar error dentro del modal.
5. **Popup blocker en descargas (`frontend/src/pages/ProjectDetailPage.tsx:361-368`):** `abrirDescarga` hace `await getUrl()` antes de `window.open(...)`; abrir ventana síncrona o disparar descarga con `<a>`/blob para evitar bloqueo del navegador.
6. **Documentación frontend desactualizada (`frontend/README.md:60-61`):** Actualizar mención vieja de `?token=` (ahora `POST /auth/stream-ticket` + `?ticket=`) y de exportes en navegador (ahora todos vienen de `GET /evaluations/{id}/export/{fmt}`).
7. **Mock adjudicación alternativa (`frontend/src/api/mock/index.ts:642`):** Comparar `proyecto.propuesta_adjudicada_id === prop.id` en lugar de `ev.recomendada_id === prop.id`.
8. **Ampliar pruebas y CI:** Añadir tests Vitest para `session.ts`, `http.ts` (refresh 401 + stream-ticket), `roles.ts`, `files.ts` y `validarRif`; agregar `main` a `on.push.branches` en `.github/workflows/frontend.yml`.

### P2 — Entregables de Cierre del Evento (Equipo)
9. **Actualizar matriz de cumplimiento (`docs/cumplimiento/matriz-cumplimiento.html/.pdf`):** Quedó en corte 15:42 (7/35 CUMPLE) y no refleja PRs `#18`, `#26`, `#35`, `#43`, `#44`.
10. **Completar etapas en espera de `scripts/etapas-entrega.txt`:** `documentacion`, `pruebas-lote`, `evidencias` y `demo` (`docs/demo/`, `docs/evidencias/`).
11. **Ejecución lote oficial FTP + subida final a GitLab:** Correr `python -m app.cli.batch` con el lote oficial del viernes, verificar `salida.json` (`repositorio` GitLab + `commit` real + sin duplicados) y sincronizar hacia GitLab del evento.
12. **Opcional / Deuda conocida:** `asyncpg` en `pyproject.toml` si se activa PostgreSQL/Supabase; estado en memoria del backend exige 1 solo worker Uvicorn; retirar `?token=` legacy cuando no se requiera compatibilidad; refactorizar `ProjectDetailPage.tsx` (1,164L) y N+1 en `httpApi.suppliers.get`.

---

## 7. Prompt de Relevo para Continuar Mañana

```text
Lee únicamente `AGENTS.md` en la raíz del repositorio antes de explorar archivos.
Estamos en el Día 2 del Hackatón Venezuela INNOVA 2026 (rama `javier`).
Con base en la sección 6 de `AGENTS.md`, ayúdame a:
1) Verificar sincronización con `origin/staging`,
2) Corregir los P0/P1 asignados a mi frente (empezando por [indica aquí el ítem]), y
3) Ejecutar `npm run lint && npm run typecheck && npm test && npm run build` (y `pytest` si tocamos backend) respetando las reglas de `scripts/hooks/`.
```
