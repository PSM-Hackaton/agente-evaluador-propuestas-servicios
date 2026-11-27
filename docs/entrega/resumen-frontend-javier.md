# Resumen Técnico y Contexto de Entregas — Frontend y UX (Javier Rodríguez)

Documento de contexto consolidado del trabajo realizado en **Frontend, Interfaz Institucional, Seguridad de Cliente e Integración E2E** para el proyecto **Agente Evaluador de Propuestas de Servicios** (Reto 3 — Hackatón Venezuela INNOVA 2026, Grupo 4 · Sede Chuao).

---

## 1. Contexto General del Frontend

La interfaz web es una SPA en **React 18 + TypeScript 5.6 (strict) + Vite 7 + TanStack Query 5 + React Router 7 + Tailwind CSS 3.4** conectada por defecto a la API real `/api/v1` (`VITE_USE_MOCK=false`, con modo demostración opcional bajo `VITE_USE_MOCK=true`), que ofrece:

- **Gestión de proyectos y propuestas multimodales** (carga masiva de 3 a 20 propuestas en PDF, DOCX, XLSX/XLS, CSV, imágenes manuscritas y capturas de chat; subida/reemplazo del documento del proyecto).
- **Ejecución del agente en 1 clic con trazabilidad en vivo (SSE)** mediante tickets efímeros (`POST /auth/stream-ticket`), sin exponer tokens en URLs.
- **Informe ejecutivo, comparativa USD/Bs (BCV) y exportes oficiales** en PDF, Markdown, CSV, Excel y `salida.json`.
- **Revisión humana del comité, adjudicación alternativa y control de acceso RBAC (5 roles)** con bitácora de auditoría y directorio de proveedores con alertas.
- **Chat fundamentado sobre documentos del proyecto** con selector de adjuntos (`proyecto.pdf` o propuestas) y visualización de citas.

---

## 2. Resumen de Trabajo Realizado por Javier Rodríguez

### A. Integración API Real, Exportes, Historial y Límite de Propuestas (Issues `#4`, `#13`, `#22`)
- Unificación de descargas y exportes oficiales desde el backend (`pdf`, `markdown`, `csv`, `xlsx`, `salida-json`) respetando `Content-Disposition` y abriendo descargas seguras con tickets efímeros.
- Selector de ejecuciones históricas por proyecto (`GET /projects/{id}/evaluations`) en las pestañas **Trazabilidad** e **Informe**.
- Validación estricta de **3 a 20 propuestas** en carga masiva (`FileDropzone`) con bloqueo del botón de evaluación fuera de rango.

### B. Proveedores, Tasa BCV, Adjudicación Alternativa y Evaluación Directa (Issues `#14`, `#15`, `#16`, `Chat-1`)
- CRUD completo de proveedores (`POST /suppliers`, `PATCH /suppliers/{id}`, validación de RIF) y resolución de alertas desde `SuppliersPage` y `SupplierDetailPage`.
- Diálogo interactivo de tasa BCV en la cabecera (`AppLayout`) con historial y anulación manual (`bcv.fijar`), más conmutador global **USD / Bs.** en tabla comparativa y desglose TCO.
- Adjudicación alternativa (`decision: overridden` con justificación obligatoria), notas por propuesta y cabecera «Adjudicado a…».
- **Evaluación directa en 1 clic:** el botón «Evaluar Propuestas de Servicios» inicia inmediatamente con los parámetros estándar (búsqueda web activa, tasa BCV vigente e IVA de referencia 16 % aplicado solo a ofertas «+ IVA»), moviendo los ajustes opcionales al botón secundario **«Opciones»**.

### C. Autenticación, Registro Público, Invitaciones y Modo Oscuro Neutro (Issues `#57`, `#70`, PRs `#69`, `#72`)
- Paleta oscura neutra institucional (`Claro` ↔ `Oscuro`) con accesibilidad (`aria-pressed`, contraste verificado) y eliminación de acentos residuales.
- Acceso por usuario o correo electrónico, alternador de visibilidad de contraseña, registro público (`/auth/signup`), gestión de códigos de invitación (`/auth/invitations`) y botones de acceso rápido para demostración.

### D. Chat sobre Documentos con Adjuntos y Citas (Issue `Chat-2`)
- Botón 📎 en `ProjectChat` para adjuntar `proyecto.pdf` (`project_document`) o cualquier propuesta cargada en el proyecto con chips removibles antes de enviar.
- Extensión del contrato `chat.send(projectId, contenido, documentIds?)` en `types.ts`, `http.ts` y adaptador `mock/index.ts`, más mapeo y renderizado de `citations` (`citas`) debajo de cada respuesta del asistente.

### E. Seguridad de Cliente, Calidad y CI (Issues `#17`, `#23`, `#45`, `#48`, `#49`, `#75`)
- **Tokens y sesión segura:** almacenamiento en `sessionStorage`, auto-refresh *single-flight* en `401` (`POST /auth/refresh`) y tickets efímeros para SSE/descargas.
- **Protección SSRF (Issue `#45`):** `parseApiBase()` y `buildApiUrl()` en `frontend/src/api/http.ts` validan protocolo HTTP/HTTPS, bloquean traversal (`..`) y caracteres de control, y rechazan URLs fuera del origen permitido.
- **Endurecimiento de Mocks (Issue `#48`):** 0 usos de `Math.random` y comparaciones de credenciales/tokens en tiempo constante (`constantTimeEqual`) en `frontend/src/api/mock/index.ts`.
- **Cero vulnerabilidades (`npm audit`):** `0 vulnerabilities` (Issue `#49`).
- **CI y pruebas automatizadas:** `.github/workflows/frontend.yml`, ESLint 9 (`react-hooks`, `jsx-a11y`), TypeScript strict y **42 pruebas Vitest en verde** (7 archivos de prueba).

---

## 3. Commits e Issues Principales Integrados en `staging` y en Revisión

| Commit | Issue / PR | Resumen |
| :--- | :--- | :--- |
| `c12accd` | `#4`, `#13`–`#17`, `#22`, `#23` (`PR #43`) | Exportes unificados, historial, proveedores, BCV, adjudicación alternativa, tickets efímeros, Vitest y ESLint |
| `66635a3` | `#45`, `#48`, `#49`, `#30` (`PR #51`) | Cierre SSRF en `http.ts`, `constantTimeEqual` en mocks, `npm audit` 0 CVE y pruebas |
| `bbcf0a4` | `#57` (`PR #69`) | Paleta oscura neutra institucional |
| `19935bd` | `#57`, `#70` (`PR #72`) | Login por usuario/correo, registro público, invitaciones, acceso rápido, evaluación directa en 1 clic y chat ampliado |
| `ab9d51c` | `Chat-2` | Botón 📎 de documentos adjuntos, contrato `document_ids` y renderizado de citas en `ProjectChat` |
| `dbde4da` | `#75`, `#79` | Tablero de issues del Día 2, evidencias E2E y resumen técnico de cierre en `README.md` y `docs/entrega/` |

---

## 4. Estado Final Verificado (`origin/staging` · `b57fa82` + `javier`)

- **Rama sincronizada:** `javier` rebaseada limpiamente sobre `origin/staging` (`b57fa82`, lote oficial 17:05).
- **Linter (`npm run lint`):** **0 errores, 0 advertencias**.
- **Typecheck (`npm run typecheck`):** **0 errores** (`tsc --noEmit`).
- **Pruebas unitarias (`npm test`):** **7 archivos / 42 passed, 0 failed** (Vitest).
- **Build de producción (`npm run build`):** **`vite build` exitoso** (`1.97 s`).
- **Auditoría de dependencias (`npm audit --audit-level=low`):** **0 vulnerabilidades**.
- **Prueba E2E en navegador real (`http://localhost:5173` contra backend real `VITE_USE_MOCK=false` en `:8000`):**
  - Login por acceso rápido (`/login`): **PASS**.
  - Dashboard (`/`): tasa BCV en cabecera, listado de proyectos y cambio de tema `Claro` ↔ `Oscuro`: **PASS**.
  - Detalle de proyecto (`Propuestas` / `Informe` / `Chat`): botón directo «Evaluar Propuestas de Servicios» + «Opciones», propuesta recomendada `#1`, tabla comparativa, descargas verificadas de CSV y `salida.json`, y consulta en el chat adjuntando documento con respuesta HTTP 200 y citas visibles: **PASS**.
  - **Errores de consola y respuestas HTTP ≥ 400:** **0**.

---

## 5. Comandos Rápidos para Verificación y Demo Local

```bash
cd frontend
npm ci

# Suite completa de calidad y seguridad
npm run lint && npm run typecheck && npm test && npm run build && npm audit --audit-level=low

# Servidor de desarrollo conectado al backend real (VITE_USE_MOCK=false)
npm run dev
# Abrir http://localhost:5173/ (admin@evaluador.ve / Admin2026!)
```
