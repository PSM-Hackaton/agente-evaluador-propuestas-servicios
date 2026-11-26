# Agente Evaluador de Propuestas de Servicios

**Reto Grupal 3** (IA, Desarrollo de Software y Ciberseguridad) del Hackatón Venezuela INNOVA 2026.

## 1. Nombre del proyecto

**Agente Evaluador de Propuestas de Servicios**: un agente de inteligencia artificial autónomo, con interfaz web,
que audita propuestas económicas de proveedores frente a un documento de proyecto y emite un dictamen de
factibilidad financiera.

## 2. Participantes

| Nombre completo | Cédula | Rol |
| :--- | :--- | :--- |
| Javier Rodríguez | C.I. 30.722.161 | Frontend y experiencia de usuario |
| Enggel Rodríguez | C.I. 32.821.429 | Backend, agente de IA y procesamiento de documentos |
| Diego Landaeta | C.I. 30.613.562 | Revisión técnica, seguridad e integración |
| Juan Laya | C.I. 31.902.000 | Arquitectura y coordinación técnica |
| Giovani Marcano | C.I. 31.920.153 | Pruebas y calidad |

## 3. Descripción del proyecto

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
   │  HTTPS (TLS 1.2/1.3 con el proxy de backend/nginx/tls.conf)
   ▼
API REST + SSE (Python, FastAPI)  ──►  modelo de IA por API (Gemini u OpenAI compatible)
   │                                ──►  búsqueda web de precios (DuckDuckGo o Tavily)
   │                                ──►  tasa oficial BCV
   ▼
SQLite (campos sensibles cifrados) + almacenamiento de documentos cifrado con AES-256-GCM
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

## 4. Alcance

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

### Límites de esta versión

El estado verificado de cada requisito está en la
[matriz de cumplimiento](docs/cumplimiento/matriz-cumplimiento.html). Los límites principales:

- **Integración en curso**: el frontend y el backend se integran en `staging` mediante los Pull Request #26
  (frontend, adaptado al contrato `/api/v1`) y #18 (backend); la prueba de extremo a extremo está pendiente. Por
  defecto el frontend funciona en **modo demostración** (`VITE_USE_MOCK=true`), con datos simulados en el navegador.
- **Sin clave de API** el agente funciona en modo heurístico (reglas y OCR local), que lee peor los manuscritos y
  escaneos. Las reglas de auditoría técnica están afinadas para el caso del laboratorio de computación del reto.
- La búsqueda de precios lee los títulos y fragmentos de los resultados (no navega por las páginas) y se apoya
  en un catálogo de referencia cuando no encuentra precios.
- **TLS**: el servidor de desarrollo del frontend usa HTTP y el backend tiene TLS desactivado por defecto; el
  cifrado en tránsito de extremo a extremo requiere el proxy `backend/nginx/tls.conf` o `TLS_ENABLED=true`.
- La base SQLite como archivo no está cifrada: solo lo están sus campos sensibles.
- Los usuarios de demostración se crean con contraseñas conocidas (ver `backend/README.md`); deben cambiarse
  fuera de una demostración.

## 5. Requerimientos del sistema

### Lenguajes, versiones y dependencias

| Componente | Requisito |
| :--- | :--- |
| Backend | **Python 3.11 o superior** (`requires-python = ">=3.11"` en `backend/pyproject.toml`). Dependencias: FastAPI, Uvicorn, SQLAlchemy 2 asíncrono con aiosqlite, Pydantic 2, cryptography, PyJWT, httpx, PyMuPDF, pypdf, openpyxl, xlrd, Pillow, pytesseract, ReportLab, ddgs, google-genai, openai, sse-starlette. Desarrollo: pytest, pytest-asyncio, ruff. |
| OCR local | Programa **Tesseract** con el idioma español (`tesseract-ocr` y `tesseract-ocr-spa` en Debian/Ubuntu). Sin él, las imágenes solo se leen con la visión del modelo de IA. |
| Frontend | **Node.js 20.19+ o 22.12+** y npm (requisito de Vite 7; el proyecto aún no fija la versión con `engines`). Dependencias: React 18, React Router 7, TanStack Query 5, Vite 7, TypeScript 5, TailwindCSS 3. |
| Herramientas | git (el modo lote obtiene el commit con `git rev-parse HEAD`); `uv` o `pip` para instalar el backend; `openssl` para generar certificados TLS locales. |

### Servicios externos

| Servicio | Uso | ¿Obligatorio? |
| :--- | :--- | :--- |
| Modelo de IA por API: **Google Gemini** (`gemini-2.5-flash` por defecto) u **OpenAI o compatible** (`gpt-4o-mini` por defecto; también OpenRouter, Groq u Ollama con `OPENAI_BASE_URL`) | Visión de imágenes y escaneos, extracción estructurada, desempate del ranking y chat | Recomendado. Sin clave, modo heurístico. |
| Búsqueda web: **DuckDuckGo** (paquete `ddgs`, sin clave) o **Tavily** (con `TAVILY_API_KEY`) | Precios de mercado | Sí, con acceso a internet. Se desactiva con `WEB_SEARCH_ENABLED=false`. |
| Tasa oficial **BCV** (`ve.dolarapi.com` y, como respaldo, `bcv.org.ve`) | Conversión USD/Bs | No: si falla, usa `BCV_FALLBACK_RATE`. |

### Variables de entorno del backend (`backend/.env`, plantilla `backend/.env.example`)

| Variable | Propósito |
| :--- | :--- |
| `APP_NAME`, `APP_ENV`, `DEBUG` | Nombre, entorno (`development`) y modo de depuración (recarga automática). |
| `HOST`, `PORT` | Dirección y puerto del servidor (`0.0.0.0:8000`). |
| `CORS_ORIGINS` | Orígenes del frontend permitidos, separados por comas. |
| `DATABASE_URL` | Base de datos (`sqlite+aiosqlite:///./data/evaluador.db`; admite PostgreSQL). |
| `STORAGE_DIR` | Carpeta de documentos cifrados (`./data/storage`). |
| `MASTER_ENCRYPTION_KEY` | Clave AES-256 (32 bytes en base64 URL-safe). **Obligatorio cambiarla.** |
| `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS` | Firma y duración de las sesiones. **Cambiar el secreto.** |
| `TLS_ENABLED`, `TLS_CERT_FILE`, `TLS_KEY_FILE` | HTTPS directo en Uvicorn con el certificado indicado. |
| `LLM_PROVIDER` | `auto` (elige según la clave disponible o usa el modo heurístico), `gemini` u `openai`. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_VISION_MODEL` | Credencial y modelos de Google Gemini. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_VISION_MODEL` | Credencial, URL y modelos de OpenAI o de una API compatible. |
| `WEB_SEARCH_ENABLED`, `TAVILY_API_KEY` | Activa la búsqueda de precios; Tavily es opcional. |
| `BCV_FALLBACK_RATE`, `DEFAULT_IVA_RATE` | Tasa de respaldo (Bs por USD) e IVA (0,16). |
| `HACKATHON_REPO_PATH`, `TIMEZONE_OFFSET` | Campo `repositorio` de `salida.json` (ruta en el GitLab del evento) y zona horaria (`-04:00`). |

### Variables de entorno del frontend (`frontend/.env`, plantilla `frontend/.env.example`)

| Variable | Propósito |
| :--- | :--- |
| `VITE_USE_MOCK` | `true`: modo demostración en el navegador, sin backend. `false`: usa la API real. |
| `VITE_API_URL` | Prefijo de la API para el navegador (`/api/v1`, servido por el proxy de Vite). |
| `BACKEND_URL` | Destino del proxy de Vite en desarrollo (`http://localhost:8000`). |

## 6. Instalación y despliegue

> Los pasos siguen los README de cada componente. Los marcados **(a confirmar tras la integración)** dependen de
> unir las ramas del frontend y del backend en `staging` y se revisarán entonces.

### 6.1 Clonar

```sh
git clone <URL-del-repositorio> agente-evaluador-propuestas-servicios
cd agente-evaluador-propuestas-servicios
```

### 6.2 Backend

```sh
# Tesseract para el OCR local (Debian/Ubuntu)
sudo apt install tesseract-ocr tesseract-ocr-spa

cd backend
cp .env.example .env
# Editar .env: MASTER_ENCRYPTION_KEY, JWT_SECRET_KEY y, si se usa IA por API, GEMINI_API_KEY u OPENAI_API_KEY.
# Clave AES-256 nueva:
python3 -c "import os, base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"

# Entorno e instalación (con uv, como en backend/README.md)
uv venv
source .venv/bin/activate
uv pip install -e ".[dev]"
# Alternativa sin uv: python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"

# Servidor de desarrollo: http://localhost:8000 (documentación de la API en /docs)
python -m app.run

# Pruebas automatizadas
pytest -v
```

Al arrancar se crean la base de datos y un usuario de demostración por cada rol (correos y contraseñas en
`backend/README.md`).

### 6.3 Frontend

```sh
cd frontend
npm install
cp .env.example .env
npm run dev          # http://localhost:5173
npm run build        # verificación de TypeScript y compilación de producción en dist/
```

Con `VITE_USE_MOCK=true` (valor por defecto) la interfaz funciona sola, con datos de demostración.
Para usar el backend real **(a confirmar tras la integración)**: en `frontend/.env`, `VITE_USE_MOCK=false`,
`VITE_API_URL=/api/v1` y `BACKEND_URL=http://localhost:8000`; con el backend en marcha, `npm run dev`.

### 6.4 Modo lote: `salida.json` (sección 3 del enunciado)

```sh
cd backend
source .venv/bin/activate
# <lote> contiene proyecto.pdf y la carpeta propuestas/
HACKATHON_REPO_PATH="<ruta-del-repositorio-en-GitLab>" \
  python -m app.cli.batch --lote <lote> --output ../salida.json --verbose
```

Opciones: `--no-web-search` (sin búsqueda web) y `--bcv-rate <tasa>` (tasa fija). El programa valida el archivo
antes de terminar. Con los datos de ejemplo: `--lote ../docs/reto`.

### 6.5 Despliegue con TLS 1.2/1.3 **(a confirmar tras la integración)**

```sh
cd backend
./scripts/generate_tls_certs.sh ./certs        # certificado local autofirmado
TLS_ENABLED=true python -m app.run             # HTTPS directo en Uvicorn
```

En producción, servir el frontend compilado (`frontend/dist/`) y el backend detrás de Nginx con la plantilla
`backend/nginx/tls.conf` (`ssl_protocols TLSv1.2 TLSv1.3`), y ajustar `CORS_ORIGINS` al dominio público.

### 6.6 Contribuir

Antes del primer commit en un clon nuevo, activar los ganchos de git del proyecto (bloquean secretos, archivos
`.env`, archivos de más de 5 MB y mensajes no válidos, y ejecutan las pruebas antes de cada push):

```sh
sh scripts/instalar-hooks.sh
```

El flujo de ramas, revisiones y Merge Request del equipo está en
[docs/entrega/flujo-gitlab.md](docs/entrega/flujo-gitlab.md).
