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

## Instalación y Configuración

```bash
cd backend
cp .env.example .env
# Configurar GEMINI_API_KEY o OPENAI_API_KEY, MASTER_ENCRYPTION_KEY y JWT_SECRET_KEY en .env

uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
```

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

## Roles y Usuarios de Demostración (Seed Automático)

| Rol | Correo | Contraseña | Permisos |
|---|---|---|---|
| `admin` | `admin@evaluador.ve` | `Admin2026!` | Administración total y usuarios |
| `cargador` | `cargador@evaluador.ve` | `Cargador2026!` | Crear proyectos y cargar documentos/propuestas |
| `revisor` | `revisor@evaluador.ve` | `Revisor2026!` | Ejecutar evaluaciones, revisar hallazgos, pasar a comité |
| `aprobador` | `aprobador@evaluador.ve` | `Aprobador2026!` | Adjudicar/cerrar proyectos y sobrescribir tasa BCV |
| `auditor` | `auditor@evaluador.ve` | `Auditor2026!` | Solo lectura, reportes, chat y auditoría |

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
