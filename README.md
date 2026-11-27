# Agente Evaluador de Propuestas de Servicios

**Reto Grupal 3** (IA, Desarrollo de Software y Ciberseguridad) del Hackatón Venezuela INNOVA 2026.

**Agente Evaluador de Propuestas de Servicios**: un agente de inteligencia artificial autónomo, con interfaz web,
que audita propuestas económicas de proveedores frente a un documento de proyecto y emite un dictamen de
factibilidad financiera.

## Participantes

| Nombre completo | Cédula | Rol |
| :--- | :--- | :--- |
| Javier Rodríguez | C.I. 30.722.161 | Frontend y experiencia de usuario |
| Enggel Rodríguez | C.I. 32.821.429 | Backend, agente de IA y procesamiento de documentos |
| Diego Landaeta | C.I. 30.613.562 | Revisión técnica, seguridad e integración |
| Juan Laya | C.I. 31.902.000 | Arquitectura y coordinación técnica |
| Giovani Marcano | C.I. 31.920.153 | Pruebas y calidad |

## Descripción del proyecto

Las instituciones que compran bienes o servicios reciben muchas propuestas en formatos distintos: PDF de
oficina, fotos de presupuestos hechos a mano, hojas de cálculo y capturas de chats con el proveedor. Revisarlas
a mano es lento, y es fácil que se escapen errores de cálculo, costos escondidos en la letra pequeña (fletes,
recargos, seguros) o precios muy por encima del mercado.

El agente recibe el **documento del proyecto** (requerimiento, ubicación de ejecución y presupuesto referencial)
y entre **3 y 20 propuestas**. Con cada una:

1. **Lee el documento** sea cual sea su formato: texto de PDF digitales (incluido el texto oculto), OCR local con
   Tesseract o visión de un modelo de IA por API para imágenes, escaneos y manuscritos, y lectura de fórmulas y
   valores de XLSX.
2. **Audita la propuesta**: comprueba cantidad × precio unitario y la suma de subtotales con aritmética decimal
   exacta; revisa que cubra el alcance del proyecto y que los componentes sean compatibles entre sí y tengan
   capacidad suficiente; detecta equipos obsoletos o reacondicionados, garantías válidas solo fuera del país,
   software de prueba y condiciones abusivas.
3. **Calcula el costo total real (TCO)**: suma los fletes, recargos e impuestos que aparecen en las notas y
   convierte todos los montos a una sola moneda con la tasa oficial del BCV.
4. **Contrasta precios con el mercado** mediante búsqueda web, para detectar sobreprecios.
5. **Detecta instrucciones ocultas** dirigidas al sistema de IA (inyección de *prompt*) y descarta la propuesta.
6. **Emite el informe**: propuesta recomendada, tabla comparativa entre lo declarado y el costo ajustado, y
   dictamen de descarte. Se puede exportar a PDF, Markdown, Excel y CSV. En modo lote escribe `salida.json`.

Durante la evaluación la interfaz muestra en vivo cada acción del agente (lectura, cálculos, consultas web). La
plataforma añade gestión de proyectos por estados, usuarios con roles, revisión humana con bitácora, un
directorio de proveedores con alertas y un chat que responde solo con lo que dicen los documentos cargados.

**Arquitectura**

```
Navegador (React + Vite + TypeScript)
   │  HTTPS (TLS 1.2/1.3 directo con `TLS_ENABLED=true` o proxy `backend/nginx/tls.conf`)
   ▼
API REST + SSE (Python, FastAPI)  ──►  IA 100 % local vía API compatible OpenAI (Ollama: `qwen2.5:3b` + `qwen2.5vl:3b`)
   │                                ──►  API propia de contraste web de precios (`/api/v1/market`, sin claves externas)
   │                                ──►  tasa oficial BCV
   ▼
PostgreSQL 16 (TLS 1.2+ y campos sensibles cifrados) + almacenamiento cifrado con AES-256-GCM
```

**Estructura del repositorio**

```
backend/    API, orquestador del agente, ingesta de documentos, finanzas, informes, modo lote y pruebas
frontend/   Interfaz web (React + Vite + TypeScript + TailwindCSS)
docs/reto/  Enunciado, documento del proyecto de ejemplo y 10 propuestas en PDF, PNG, JPG y XLSX
docs/cumplimiento/  Matriz de cumplimiento de los requisitos del reto (HTML y PDF)
```

Más detalle en [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md) y la
[matriz de cumplimiento](docs/cumplimiento/matriz-cumplimiento.html).

## Alcance

### Funcionalidades incluidas

- **Ingesta multimodal**: PDF digital y escaneado, JPG y PNG (manuscritos y capturas de chat), XLSX/XLS, CSV,
  DOCX y TXT. Usa visión del modelo de IA si hay clave de API y OCR local (Tesseract) como respaldo.
- **Auditoría y TCO**: verificación aritmética, alcance, compatibilidad técnica, capacidad de fuente y UPS,
  obsolescencia, garantía, software de prueba, recargos de envío y costos en notas o letra pequeña.
- **Contraste con el mercado** mediante búsqueda web de precios unitarios.
- **Defensa contra inyección de instrucciones**: el texto de los documentos se trata como datos y nunca como
  órdenes; se revisan también el texto oculto en PDF, DOCX y XLSX.
- **Interfaz web**: carga del proyecto, carga masiva de propuestas, botón «Evaluar Propuestas de Servicios»,
  trazabilidad en vivo, informe con propuesta recomendada, tabla comparativa y dictamen de descarte.
- **Plataforma (2.E)**: historial de proyectos por estados (en recepción → en evaluación → en revisión del
  comité → adjudicado/cerrado); inicio de sesión con roles (carga, revisión, aprobación, auditoría de solo
  lectura y administración); revisión humana con registro automático de quién hizo qué y cuándo; directorio de
  proveedores con historial y alertas; normalización USD/Bs a la tasa BCV con IVA y desglose paso a paso;
  exportación a PDF, Markdown, Excel y CSV; chat sobre los documentos del proyecto.
- **Seguridad (2.F)**: cifrado AES-256-GCM de los documentos guardados y de los campos sensibles de la base de
  datos; plantilla de proxy TLS 1.2/1.3; contraseñas con scrypt; JWT; control de acceso por rol en la API.
- **Modo lote (sección 3)**: `python -m app.cli.batch` procesa una carpeta `lote/` y escribe `salida.json` con
  el ranking (válidas de mejor a peor y descartadas al final).

### Integraciones

- **Segundo factor de autenticación (opcional, previsto)**: el *Servicio Soberano de Autenticación Multifactorial
  basado en Tiempo (TOTP)* del Reto Grupal 1, del mismo equipo, está pensado para integrarse con esta plataforma
  como una aplicación cliente: el evaluador se enrola una vez con su app autenticadora y, tras el usuario y la
  contraseña, el backend verifica el código de 6 dígitos contra ese servicio por HTTPS. El servicio publica
  para ello una API REST y un SDK. **Esta integración todavía no está implementada en este repositorio**: el
  inicio de sesión actual es usuario, contraseña y JWT.

### Límites y decisiones técnicas de esta versión

El estado verificado de cada requisito está en la
[matriz de cumplimiento](docs/cumplimiento/matriz-cumplimiento.html). Puntos clave:

- **Integración frontend ↔ backend completada:** el frontend utiliza la API real `/api/v1` por defecto (el modo simulado solo se activa explícitamente con `VITE_USE_MOCK=true`) y las 40 rutas de contrato están verificadas contra el esquema OpenAPI del backend.
- **IA 100 % local (sin envío de documentos a servicios externos):** el agente opera conectado por API local compatible con OpenAI (**Ollama `v0.40.18`** en `http://127.0.0.1:11434/v1`) usando **`qwen2.5:3b`** (razonamiento y *tool calling* nativo) y **`qwen2.5vl:3b`** (visión multimodal para manuscritos y escaneos). Como respaldo determinista (y para el modo lote rápido de 15 s sobre CPU), soporta `LLM_PROVIDER=heuristic` con OCR local Tesseract de doble pasada.
- **Contraste de mercado sin claves de terceros:** la API interna `/api/v1/market` realiza búsqueda web directa mediante `ddgs` (sin servicios de IA externos) y emplea el catálogo local únicamente como respaldo explícito (`baseline_fallback_only`) cuando la red no devuelve precios en fragmentos.
- **TLS 1.2/1.3 y cifrado en reposo:** el backend sirve HTTPS directo con `TLS_ENABLED=true` (verificado con TLSv1.3 `TLS_AES_256_GCM_SHA384` y rechazo de TLS 1.1) o detrás de `backend/nginx/tls.conf`, y cifra archivos en disco y columnas sensibles en PostgreSQL 16 con **AES-256-GCM** (`enc:v1:...`), dejando únicamente índices ciegos HMAC-SHA256 para búsquedas exactas.
- Los usuarios de demostración se crean con credenciales locales (ver `backend/README.md`) que deben rotarse fuera de una demostración.

## Requerimientos del sistema

### Lenguajes, versiones y dependencias

| Componente | Requisito |
| :--- | :--- |
| Backend | **Python 3.11 o superior** (`requires-python = ">=3.11"` en `backend/pyproject.toml`). Dependencias: FastAPI, Uvicorn, SQLAlchemy 2 asíncrono con `asyncpg`, Alembic, Pydantic 2, cryptography, PyJWT, httpx, PyMuPDF, pypdf, openpyxl, xlrd, Pillow, pytesseract, ReportLab, ddgs, openai (cliente local para Ollama/llama.cpp), sse-starlette, defusedxml. Desarrollo: pytest, pytest-asyncio, ruff. |
| Base de datos | **PostgreSQL 16** (local, contenedor o gestionado con TLS 1.2+). |
| OCR local | Programa **Tesseract** con el idioma español (`tesseract-ocr` y `tesseract-ocr-spa` en Debian/Ubuntu). Sin él, las imágenes solo se leen con la visión del modelo de IA. |
| Frontend | **Node.js 20.19+ o 22.12+** y npm (requisito de Vite 7; el proyecto aún no fija la versión con `engines`). Dependencias: React 18, React Router 7, TanStack Query 5, Vite 7, TypeScript 5, TailwindCSS 3. |
| Herramientas | git (el modo lote obtiene el commit con `git rev-parse HEAD`); `uv` o `pip` para instalar el backend; `openssl` para generar certificados TLS locales. |

### Servicios e infraestructura local

| Servicio | Uso | ¿Obligatorio? |
| :--- | :--- | :--- |
| **IA Local vía Ollama (`v0.40.18`)** en `http://127.0.0.1:11434/v1` — modelos **`qwen2.5:3b`** (texto y *tool calling*) y **`qwen2.5vl:3b`** (visión de manuscritos y escaneos) | Razonamiento agéntico, *tool calling*, visión multimodal y chat documental sin enviar datos a terceros | Recomendado (local, sin claves externas). Respaldo rápido: `LLM_PROVIDER=heuristic`. |
| Búsqueda web autónoma: API interna `/api/v1/market` (paquete `ddgs`, sin API key de terceros) | Precios de mercado | Sí, con acceso a internet. Se desactiva con `WEB_SEARCH_ENABLED=false`. |
| Tasa oficial **BCV** (`ve.dolarapi.com` y, como respaldo, `bcv.org.ve`) | Conversión USD/Bs | No: si falla, usa `BCV_FALLBACK_RATE`. |

### Variables de entorno del backend (`backend/.env`, plantilla `backend/.env.example`)

| Variable | Propósito |
| :--- | :--- |
| `APP_NAME`, `APP_ENV`, `DEBUG` | Nombre, entorno (`development`) y modo de depuración (recarga automática). |
| `HOST`, `PORT` | Dirección y puerto del servidor (`0.0.0.0:8000`). |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por comas. |
| `DATABASE_URL`, `DB_SSL_MODE` | Cadena de conexión PostgreSQL (`postgresql+asyncpg://...`) y modo TLS 1.2+ (`prefer`, `require`, `verify-full`). |
| `STORAGE_DIR` | Carpeta de documentos cifrados (`./data/storage`). |
| `MASTER_ENCRYPTION_KEY` | Clave AES-256 (32 bytes en base64 URL-safe). **Obligatorio cambiarla.** |
| `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS` | Firma y duración de las sesiones. **Cambiar el secreto.** |
| `TLS_ENABLED`, `TLS_CERT_FILE`, `TLS_KEY_FILE` | HTTPS directo en Uvicorn con el certificado indicado. |
| `LLM_PROVIDER`, `LLM_TIMEOUT_SECONDS` | `openai` para la API local de Ollama (`LLM_TIMEOUT_SECONDS=120`), o `heuristic` para modo determinista rápido. |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | Endpoint local de Ollama (`http://127.0.0.1:11434/v1`) y valor local de relleno (`local`; nunca sale a internet). |
| `OPENAI_MODEL`, `OPENAI_VISION_MODEL` | Modelos locales: `qwen2.5:3b` (texto + *tool calling*) y `qwen2.5vl:3b` (visión). |
| `WEB_SEARCH_ENABLED` | Activa la búsqueda autónoma de precios en internet sin claves externas. |
| `BCV_FALLBACK_RATE`, `DEFAULT_IVA_RATE` | Tasa de respaldo (Bs por USD) e IVA (0,16). |
| `ABUSIVE_SURCHARGE_PCT_THRESHOLD` | Recargo (flete, envío) sobre el subtotal, en %, a partir del cual se considera abusivo (`50`). |
| `MAX_UPLOAD_SIZE_MB` | Tamaño máximo por archivo subido (`25`). |
| `HACKATHON_REPO_PATH`, `TIMEZONE_OFFSET` | Campo `repositorio` de `salida.json` (ruta en el GitLab del evento) y zona horaria (`-04:00`). |

### Variables de entorno del frontend (`frontend/.env`, plantilla `frontend/.env.example`)

| Variable | Propósito |
| :--- | :--- |
| `VITE_USE_MOCK` | `true`: modo demostración en el navegador, sin backend. `false`: usa la API real. |
| `VITE_API_URL` | Prefijo de la API para el navegador (`/api/v1`, servido por el proxy de Vite). |
| `BACKEND_URL` | Destino del proxy de Vite en desarrollo (`http://localhost:8000`). |
| `VITE_TLS_CERT`, `VITE_TLS_KEY` | Rutas locales opcionales a certificado y clave para servir `npm run dev` por HTTPS (TLS 1.2+). |

## Paso a paso de instalación / despliegue

> Los pasos siguen los README de cada componente y están comprobados sobre `staging` con el frontend y el backend
> integrados (modo real del frontend y TLS 1.2/1.3).

### Paso 1. Clonar

```sh
git clone <URL-del-repositorio> agente-evaluador-propuestas-servicios
cd agente-evaluador-propuestas-servicios
```

### Paso 2. IA local (Ollama) y PostgreSQL 16

```sh
# 1. Levantar Ollama local (v0.40.18+) y descargar los modelos de texto y visión
podman run -d --name evaluador-ollama \
  -p 127.0.0.1:11434:11434 \
  -v evaluador-ollama-models:/root/.ollama \
  docker.io/ollama/ollama:latest
podman exec evaluador-ollama ollama pull qwen2.5:3b      # 1.9 GB — texto y tool calling
podman exec evaluador-ollama ollama pull qwen2.5vl:3b    # 3.2 GB — visión multimodal (manuscritos/escaneos)

# 2. Levantar PostgreSQL 16 local
podman run -d --name evaluador-postgres \
  -e POSTGRES_USER=postgres -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=evaluador_propuestas \
  -p 127.0.0.1:5432:5432 docker.io/library/postgres:16-alpine
```

### Paso 3. Backend (con TLS 1.2/1.3)

```sh
# Tesseract para OCR de respaldo (Debian/Ubuntu)
sudo apt install tesseract-ocr tesseract-ocr-spa

cd backend
cp .env.example .env
# Generar claves propias para MASTER_ENCRYPTION_KEY y JWT_SECRET_KEY (32 bytes):
python3 -c "import os, base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
# Generar certificados TLS 1.2/1.3 locales:
./scripts/generate_tls_certs.sh ./certs

# Entorno e instalación
uv venv && source .venv/bin/activate && uv pip install -e ".[dev]"
# Aplicar migraciones Alembic en PostgreSQL 16
alembic upgrade head
# Iniciar backend HTTPS (TLS 1.2/1.3) conectado a Ollama local:
python -m app.run
```

### Paso 4. Frontend

```sh
cd frontend
npm install
cp .env.example .env
npm run dev          # usa la API real /api/v1 por defecto (modo simulado solo con VITE_USE_MOCK=true)
npm run build        # verificación de TypeScript y compilación de producción en dist/
```

### Paso 4. Modo lote: `salida.json` (sección 3 del enunciado)

```sh
cd backend
source .venv/bin/activate
# <lote> contiene proyecto.pdf y la carpeta propuestas/
HACKATHON_REPO_PATH="<ruta-del-repositorio-en-GitLab>" \
  python -m app.cli.batch --lote <lote> --output ../salida.json --verbose
```

Opciones: `--no-web-search` (sin búsqueda web) y `--bcv-rate <tasa>` (tasa fija). El programa valida el archivo
antes de terminar. Con los datos de ejemplo: `--lote ../docs/reto`.

### Paso 5. Despliegue con TLS 1.2/1.3

```sh
cd backend
./scripts/generate_tls_certs.sh ./certs        # certificado local autofirmado
TLS_ENABLED=true python -m app.run             # HTTPS directo en Uvicorn
```

En producción, servir el frontend compilado (`frontend/dist/`) y el backend detrás de Nginx con la plantilla
`backend/nginx/tls.conf` (`ssl_protocols TLSv1.2 TLSv1.3`), y ajustar `CORS_ORIGINS` al dominio público.

### Paso 6. Contribuir

Antes del primer commit en un clon nuevo, activar los ganchos de git del proyecto (bloquean secretos, archivos
`.env`, archivos de más de 5 MB y mensajes no válidos, y ejecutan las pruebas antes de cada push):

```sh
sh scripts/instalar-hooks.sh
```

El flujo de ramas, revisiones y Merge Request del equipo está en
[docs/entrega/flujo-gitlab.md](docs/entrega/flujo-gitlab.md).
