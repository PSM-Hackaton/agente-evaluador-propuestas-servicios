# Resumen Técnico y Contexto de Entregas — Backend e IA Local (Enggel Rodríguez)

Documento de contexto consolidado del trabajo realizado en **Backend, Base de Datos, Seguridad e IA Local** para el proyecto **Agente Evaluador de Propuestas de Servicios** (Reto 3 — Hackatón Venezuela INNOVA 2026, Grupo 4 · Sede Chuao).

---

## 1. Contexto General del Sistema

El sistema evalúa de forma autónoma propuestas comerciales heterogéneas (PDF, DOCX, XLSX/XLS, CSV/TSV, imágenes de chats y planillas manuscritas) frente a los requisitos de un proyecto, aplicando:

- **Ingesta multimodal** (texto digital, evaluación de fórmulas Excel, OCR local en memoria con Tesseract y visión local con Ollama para manuscritos/escaneos).
- **Defensa contra inyección de prompts** (`security_guard.py`) y detección de texto oculto antes de evaluar.
- **Auditoría técnica y aritmética exacta** (`Decimal`, tasa oficial BCV en vivo, cálculo de TCO en USD y Bs, y las 7 causales de descarte del enunciado).
- **Contraste autónomo de precios de mercado** mediante API propia (`/api/v1/market`) y búsqueda web libre sin servicios pagos de terceros.
- **Trazabilidad y seguridad institucional:** PostgreSQL 16 con cifrado en reposo AES-256-GCM, TLS 1.2/1.3 en tránsito, autenticación JWT con RBAC de 5 roles y bitácora inmutable `audit_logs`.

---

## 2. Resumen de Trabajo Realizado por Enggel Rodríguez

### A. Base de Datos y Migraciones (`PostgreSQL 16 + Alembic`)
- Migración completa del backend, modelos ORM, pruebas y guías de entorno desde SQLite hacia **PostgreSQL 16** con `asyncpg` y soporte TLS 1.2+ (`DB_SSL_MODE`) — Issues `#5`, `#30`.
- Configuración de migraciones reversibles con Alembic (`0001_initial_schema` y `0002_invitation_codes`) y prueba automatizada de `upgrade`/`downgrade` respetando `TEST_DATABASE_URL` y `TEST_ALEMBIC_DATABASE_URL`.

### B. IA 100 % Local sin Terceros (`Ollama + Tool Calling + Visión`)
- Eliminación completa de dependencias externas de IA (`google-genai` y `Tavily`) para operar 100 % en local con **Ollama** vía API compatible con OpenAI (`http://127.0.0.1:11434/v1`) — Issues `#9`, `#11`, `#52`.
- Integración de **tool calling real** (`verify_arithmetic`, `compute_tco`, `web_search_market_prices`, `check_hardware_compatibility`, `check_supplier_history`, `get_bcv_exchange_rate`) y visión multimodal local para manuscritos.
- Optimización específica para **`qwen3.5:4b`** (`PR #67` / Issue `#65`):
  - `LLM_DISABLE_THINKING=true` enviando `extra_body={"think": False}` con fallback automático ante HTTP 400/422 (sin reintentar errores de red/timeout).
  - Saneamiento lineal O(n) de bloques `<think>...</think>` (incluyendo bloques sin cierre) en `_parse_json_safely`, `generate_text`, `_openai_vision` y `_openai_tool_loop`.
  - Presupuesto local configurable con `LLM_LOCAL_MAX_TOKENS=650` y `LLM_LOCAL_VISION_MAX_TOKENS=900`.
  - Modelo unificado `qwen3.5:4b` para texto, herramientas y visión.

### C. API Propia de Contraste de Mercado
- Creación del módulo y endpoints propios `/api/v1/market` con búsqueda web abierta y citación de fuentes por ítem, eliminando la dependencia de claves externas (`Tavily`) — Issue `#11`.

### D. Autenticación, Registro Público y Códigos de Invitación (`PR #71` / Issue `#70`)
- Modelo `InvitationCode` y migración reversible `0002_invitation_codes.py` (`code_hash` HMAC único con `blind_index`, `code_prefix`, `email` cifrado con `EncryptedText`, `max_uses`, `uses_count`, `expires_at`, `revoked_at`).
- Implementación de los 5 endpoints bajo `/api/v1/auth` sin alterar `POST /auth/register`:
  - `POST /api/v1/auth/invitations` *(admin, `201`, devuelve `code` en claro solo al crear)*.
  - `GET /api/v1/auth/invitations` *(admin, `200`, solo `code_prefix`)*.
  - `DELETE /api/v1/auth/invitations/{invitation_id}` *(admin, `204`, revocación)*.
  - `POST /api/v1/auth/invitations/validate` *(público con rate-limit por IP `429`, `404` inválido/revocado, `410` expirado/agotado)*.
  - `POST /api/v1/auth/signup` *(público con rate-limit por IP `429`, bloqueo transaccional `FOR UPDATE`, auditoría `auth.signup` y respuesta `TokenResponse` `201`)*.

### E. Seguridad, Endurecimiento y Calidad
- **TLS 1.2/1.3 activo** en `app.run` (negociación verificada `TLSv1.3 / TLS_AES_256_GCM_SHA384`) y certificados locales en `backend/certs/` fuera de control de versiones — Issue `#6`.
- **Cifrado en reposo AES-256-GCM** y generación dinámica de claves en pruebas unitarias (sin secretos hardcodeados) — Issue `#46`.
- **Protección XXE** en el parser DOCX mediante `defusedxml` con prueba automatizada de rechazo — Issues `#47`, `#49`.
- **Proxy HTTPS del frontend:** ajuste de `frontend/vite.config.ts` y `frontend/.env.example` hacia `https://localhost:8000` con API real por defecto — Issue `#53`.

### F. Auditoría Técnica, Modo Lote y `salida.json`
- Ajuste de ponderación técnica (procesador, canal de memoria y anclaje de patrones de CPU por marca) y validación del modo lote (`python -m app.cli.batch`) — Issues `#21`, `#40`, `#49`, `#52`.
- Validación final del cierre del Día 2 sobre el lote oficial de las 17:05 — Issue `#76`.

---

## 3. Commits e Issues Principales Integrados en `staging`

| Commit | Issue / PR | Resumen |
| :--- | :--- | :--- |
| `d87f719` / `30c60b4` | `#5`, `#30` | Migración completa a PostgreSQL 16 con `asyncpg`, TLS 1.2+ y guías de configuración |
| `4165805` / `c8d1944` | `#46`, `#47`, `#49` | Endurecimiento XXE con `defusedxml` y claves dinámicas en pruebas de cifrado |
| `70bd8ff` / `77dcbc9` | `#40`, `#52` | Ponderación técnica de CPU/memoria y anclaje de patrones por marca |
| `95aa845` | `#11` | API propia `/api/v1/market` y eliminación de `Tavily` |
| `f51b97b` / `abb5442` | `#6`, `#9`, `#52` | IA local con Ollama, TLS 1.2/1.3 activo y eliminación de `google-genai` |
| `3a3375d` / `4335bb0` / `8d0922b` | `#53`, `#59` | Tests Alembic con `TEST_DATABASE_URL`, `salida.json` validado y proxy HTTPS del frontend |
| `72870d6` | `#65`, `#67` | Soporte optimizado para `qwen3.5:4b` en Ollama (`LLM_DISABLE_THINKING` + `<think>`) |
| `79c9bd8` | `#70`, `#71` | Registro público (`/auth/signup`) y códigos de invitación (`/auth/invitations`) |

---

## 4. Estado Final Verificado (`origin/staging` · `b57fa82`)

- **Pruebas backend (`pytest -q` sobre PostgreSQL 16):** **80 passed, 0 failed**.
- **Linter (`ruff check app tests`):** **All checks passed**.
- **Migraciones Alembic:** `0001_initial_schema` → `0002_invitation_codes` (`upgrade`/`downgrade` limpios).
- **Endpoints en vivo (HTTPS / TLS 1.3):** `/health` (`HTTP 200`), 42 rutas registradas en OpenAPI, login JWT y rutas autenticadas respondiendo `200`.
- **Validación del bot (`simular-bot.py --reto propuesta_servicios`):** **0 hallazgos** y `salida.json` **Formato válido** (lote oficial 17:05, recomendada #1 `Propuesta_376_Soluciones_Tecnologicas_Merida_CA`).
- **GitLab (`propuesta_servicios`):** pipeline `#10947` en rama `terminado` (`69ba5f36`) en estado **`success`**.

---

## 5. Comandos Rápidos para la Demo Local

```bash
# 1. Verificar contenedores locales activos (PostgreSQL 16 + Ollama)
podman ps

# 2. Aplicar migraciones e iniciar Backend HTTPS (TLS 1.3)
cd backend
.venv/bin/alembic upgrade head
.venv/bin/python -m app.run

# 3. Iniciar Frontend (conectado al backend vía proxy HTTPS)
cd frontend
npm run dev
# Abrir http://localhost:5173/ (admin@evaluador.ve / Admin2026!)
```
