# Backend — Agente Evaluador de Propuestas de Servicios

Backend completo en **Python + FastAPI + SQLAlchemy (async)** diseñado para cumplir el 100% de las especificaciones técnicas, funcionales y de ciberseguridad del **Reto Grupal — Hackatón Venezuela INNOVA 2026**.

## Arquitectura del Proyecto

```
backend/
├── app/
│   ├── main.py                         # FastAPI app, CORS, headers de seguridad, lifespan
│   ├── run.py                          # Servidor Uvicorn con soporte TLS 1.2 / TLS 1.3
│   ├── core/
│   │   ├── config.py                   # Configuración Pydantic Settings (.env)
│   │   ├── crypto.py                   # Cifrado autenticado AES-256-GCM en reposo
│   │   ├── security.py                 # scrypt password hashing, JWT y RBAC (5 roles)
│   │   └── logging.py
│   ├── db/
│   │   ├── base.py                     # Motor async SQLAlchemy + columnas EncryptedText / EncryptedJSON
│   │   ├── models.py                   # Modelos ORM completos (proyectos, propuestas, proveedores, evaluaciones, trazas, revisiones, auditoría, chat, BCV)
│   │   └── seed.py                     # Usuarios iniciales para todos los roles
│   ├── schemas/                        # Esquemas Pydantic v2 (auth, project, domain)
│   ├── services/
│   │   ├── storage/encrypted_storage.py # Almacenamiento en disco cifrado con AES-256-GCM y borrado seguro
│   │   ├── ingestion/                  # Ingesta multimodal (PDF, Word .docx, Excel .xlsx/.xlsm/.xls, CSV/TSV, Imágenes JPG/PNG/WEBP/TIFF + OCR/Vision, TXT/MD)
│   │   ├── llm/client.py               # Cliente unificado multimodal (Google Gemini y OpenAI-compatible)
│   │   ├── finance/                    # Tasa oficial BCV (TLS 1.2+) y motor TCO aritmético con Decimal
│   │   ├── market/search.py            # Contraste autónomo de precios en internet (Tavily / DuckDuckGo)
│   │   ├── agent/
│   │   │   ├── security_guard.py       # Detección de Prompt Injection y sanitización de datos no confiables
│   │   │   ├── technical_audit.py      # Auditoría determinista de las 7 causales de descarte (Sección 3.B)
│   │   │   ├── tools.py                # Registro de herramientas del agente (tool calling)
│   │   │   ├── orchestrator.py         # Orquestador autónomo paso a paso con streaming SSE
│   │   │   └── chat_service.py         # Chat en lenguaje natural fundamentado únicamente en documentos cargados
│   │   ├── reports/
│   │   │   ├── exporter.py             # Exportadores: PDF ejecutivo (ReportLab), Markdown, Excel (.xlsx) y CSV
│   │   │   └── salida_json.py          # Generador y validador estricto de salida.json (Sección 3.C)
│   │   └── audit/service.py            # Registro inmutable de auditoría
│   ├── api/
│   │   ├── deps.py                     # Dependencias JWT y guardias RBAC
│   │   └── v1/                         # Routers: auth, projects, proposals, evaluations, suppliers, finance, chat, audit, batch
│   └── cli/
│       └── batch.py                    # CLI modo lote (`python -m app.cli.batch`)
├── scripts/generate_tls_certs.sh       # Generador de certificados TLS locales
├── nginx/tls.conf                      # Plantilla Nginx TLS 1.2 / 1.3 para producción
└── tests/                              # Suite pytest unitaria e integración E2E
```

## Prerrequisitos del Sistema y Dependencias

- **Python** `>= 3.11` (`python3 --version`)
- **Tesseract OCR** con paquete de idioma español/inglés para OCR local en memoria (sin crear archivos temporales en disco):
  ```bash
  sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng openssl
  ```
- **uv** o `pip` para entorno virtual Python.

## Instalación, Migraciones y Configuración

```bash
cd backend
cp .env.example .env
# Configurar GEMINI_API_KEY o OPENAI_API_KEY, MASTER_ENCRYPTION_KEY, JWT_SECRET_KEY y MAX_UPLOAD_SIZE_MB en .env

uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"

# Aplicar esquema inicial (SQLite por defecto o PostgreSQL/Supabase según DATABASE_URL)
alembic upgrade head
```

> **TLS 1.2 / TLS 1.3 en Tránsito:** `app/run.py` construye explícitamente un `ssl.SSLContext` con `minimum_version = TLSv1_2`, rechazando TLS 1.0/1.1. En Nginx (`nginx/tls.conf`), se habilita `proxy_ssl_verify on` hacia el certificado del backend.
>
> **Regla de Carga Masiva:** Cada proyecto admite **entre 3 y 20 propuestas** (`422 Unprocessable Content` fuera de rango) con límite individual configurable vía `MAX_UPLOAD_SIZE_MB` (25 MB por defecto).
>
> **Streaming SSE y Descargas sin JWT en URL:** El cliente autenticado solicita un ticket efímero de un solo uso (60 s) vía `POST /api/v1/auth/stream-ticket` y lo envía como `?ticket=...` en `GET /evaluations/{id}/stream` o descargas directas (alternativamente mediante cookie `HttpOnly` `access_token`). Los tickets (`_STREAM_TICKETS`) se almacenan en memoria del proceso, por lo que esta configuración requiere ejecutar Uvicorn con **un único worker** (para varios workers se requeriría almacenamiento compartido en Redis/BD). El parámetro `?token=` se conserva temporalmente por retrocompatibilidad y se retirará cuando el frontend migre completamente a `?ticket=` (#17 / #23).

## Ejecución del Servidor (HTTP o HTTPS TLS 1.2/1.3)

### Desarrollo local
```bash
source .venv/bin/activate
python -m app.run
# Documentación interactiva Swagger UI: http://localhost:8000/docs
```

### Con TLS 1.2 / 1.3 habilitado
```bash
./scripts/generate_tls_certs.sh ./certs
TLS_ENABLED=true python -m app.run
```

## Modo Lote (`salida.json` — Sección 3.C)

```bash
source .venv/bin/activate
python -m app.cli.batch --lote ../docs/reto --output ../salida.json --verbose
```

## Roles y Usuarios de Demostración (Seed Local de Desarrollo)

> **Seguridad:** Por buena práctica, las contraseñas de desarrollo no se publican en documentación; consulta [app/db/seed.py](app/db/seed.py) únicamente para entornos locales de prueba y cámbialas antes de cualquier despliegue en `staging` o `production`.

| Rol | Correo | Permisos |
|---|---|---|
| `admin` | `admin@evaluador.ve` | Administración total y gestión de usuarios |
| `cargador` | `cargador@evaluador.ve` | Crear proyectos y cargar documentos/propuestas (3–20) |
| `revisor` | `revisor@evaluador.ve` | Ejecutar evaluaciones, revisar hallazgos y enviar a comité |
| `aprobador` | `aprobador@evaluador.ve` | Adjudicar/cerrar proyectos y sobrescribir tasa BCV |
| `auditor` | `auditor@evaluador.ve` | Solo lectura, reportes, chat documental y bitácora |

## Endpoints Principales (`/api/v1`)

- **Auth & Roles**: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `GET /auth/me`, `GET /auth/users`, `PATCH /auth/users/{id}`
- **Dashboard & Seguridad**: `GET /dashboard/stats` (conteos por estado, alertas, inyecciones bloqueadas, tasa BCV, estado AES-256/TLS)
- **Proyectos & Flujo**: `POST /projects`, `GET /projects`, `GET /projects/{id}`, `POST /projects/{id}/document`, `GET /projects/{id}/document/download`, `POST /projects/{id}/status`, `GET /projects/{id}/evaluations`
- **Propuestas (Carga Masiva)**: `POST /projects/{id}/proposals`, `GET /projects/{id}/proposals`, `GET /proposals/{id}`, `GET /proposals/{id}/download` (acepta header Bearer o `?token=`), `DELETE /proposals/{id}`
- **Evaluación Agéntica & Reportes**: `POST /projects/{id}/evaluate`, `GET /evaluations/{id}`, `GET /evaluations/{id}/stream` (SSE compatible con `EventSource` vía `?token=`), `POST /evaluations/{id}/reviews`, `GET /evaluations/{id}/export/{pdf|markdown|xlsx|csv|salida-json}`
- **Proveedores & Alertas**: `GET /suppliers`, `POST /suppliers`, `GET /suppliers/{id}`, `PATCH /suppliers/{id}`, `POST /suppliers/alerts/{alert_id}/resolve`
- **Finanzas & BCV**: `GET /finance/bcv-rate`, `POST /finance/bcv-rate/override`, `GET /finance/bcv-rate/history`, `POST /finance/tco-preview`
- **Chat Documental**: `POST /projects/{id}/chat`, `GET /projects/{id}/chat`, `DELETE /projects/{id}/chat`
- **Auditoría**: `GET /audit-logs`
- **Modo Lote**: `POST /batch/run`, `POST /batch/validate-salida`

## Pruebas Automatizadas

```bash
source .venv/bin/activate
pytest -v
```

## Seguridad en Reposo, Rotación de Claves y Criterio TCO

- **Separación de subclaves (HKDF-SHA256):** A partir de `MASTER_ENCRYPTION_KEY`, el sistema deriva subclaves criptográficas independientes para almacenamiento en disco (`storage`), columnas de base de datos (`db_fields`) e índices ciegos HMAC-SHA256 (`blind_index`).
- **Base de datos cifrada:** Todas las columnas sensibles (proveedores, RIF, ubicaciones, correos, nombres de archivo, montos declarados/TCO, puntajes, dictámenes y auditoría) se almacenan cifradas con **AES-256-GCM** (`enc:v1:...`), manteniendo únicamente hashes HMAC para búsquedas exactas. Para PostgreSQL remoto en producción, configurar `DATABASE_URL` con `?sslmode=verify-full` y disco cifrado.
- **Rotación de claves:** Configurar `PREVIOUS_ENCRYPTION_KEY` temporalmente con la clave anterior al rotar `MASTER_ENCRYPTION_KEY` para descifrar registros previos sin interrupción.
- **Criterio de recargos de envío (`ABUSIVE_SURCHARGE_PCT_THRESHOLD=50.0`):** Recargos ocultos `< 50 %` (como el ejemplo `+45 %` de la Sección 2.D) se consolidan en el Costo Total Real (TCO) desplazando la propuesta en el ranking; recargos `>= 50 %` (Sección 2.B) causan descarte por `costos_condiciones_abusivas`.
- **Política de antecedentes de proveedor:** Todos los descartes previos registrados en `SupplierAlert` (fecha, proyecto y causa) se incorporan al dictamen del informe y a la ficha de la propuesta. Cuando existe una alerta previa no resuelta de manipulación (`inyeccion_prompt`) y la nueva oferta es técnicamente válida, se aplica automáticamente una penalización de confianza de **-10.0 pts** sobre el puntaje técnico (sin descartar injustamente ofertas legítimas posteriores) y se advierte al comité aprobador.
