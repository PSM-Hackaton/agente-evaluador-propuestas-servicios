# Verificación final de la entrega · 27-11-2026

Agente Evaluador de Propuestas de Servicios · Reto Grupal 3 · Hackatón 2026

Registro de las pruebas ejecutadas el 27-11-2026 sobre la versión que se entrega: backend con PostgreSQL 16,
TLS 1.3 y cifrado AES-256-GCM, y frontend contra la API real.

## 1. Resumen

| # | Prueba | Resultado |
| :-: | :--- | :--- |
| 1 | Pruebas del backend (`pytest`, PostgreSQL 16) | **62 / 62** |
| 2 | Pruebas del frontend (Vitest) y tipos (`tsc --noEmit`) | **35 / 35** · sin errores de tipos |
| 3 | Dependencias del frontend (`npm audit --omit=dev`) | 0 vulnerabilidades |
| 4 | Modo lote (`python -m app.cli.batch --lote ../docs/reto`) | `salida.json` válido · 10 procesadas · 15 s |
| 5 | Backend en marcha con TLS | `/health`: PostgreSQL conectado, AES-256-GCM, `tls_enabled: true`; negociación **TLSv1.3** `TLS_AES_256_GCM_SHA384` |
| 6 | Recorrido de extremo a extremo por la API real | **28 / 28** comprobaciones |
| 7 | Frontend (`npm run dev`) contra el backend TLS | Interfaz servida y proxy `/api/v1` hacia el backend operativo |

## 2. Recorrido de extremo a extremo (API real, backend con TLS)

| Módulo | Comprobación | Resultado |
| :--- | :--- | :--- |
| Autenticación y roles | Inicio de sesión de los 5 roles (administrador, carga, revisor, aprobador, auditor) | OK |
| Control de acceso | El auditor no puede crear proyectos | OK (HTTP 403) |
| Proyectos | Alta del proyecto y carga de `proyecto.pdf` | OK |
| Ingesta multimodal | Carga masiva de las 10 propuestas (PDF, PNG, JPG y XLSX) | OK · 10 propuestas |
| Agente evaluador | «Evaluar propuestas» sobre las 10 | OK · 14,9 s · estado `completed` |
| Informe | 5 válidas en orden y 5 descartadas con su causa | OK (ver tabla 3) |
| Exportación | PDF, Markdown, CSV, Excel (XLSX) y JSON | OK · los 5 formatos |
| Historial | Ejecuciones anteriores del proyecto | OK |
| Revisión humana | Revisión registrada por el rol revisor | OK |
| Normalización financiera | Tasa BCV oficial en vivo y tasa manual del comité | OK |
| Proveedores | Directorio y alta de proveedor | OK |
| Chat | Pregunta sobre los documentos y la evaluación | OK |
| Auditoría | Bitácora de acciones | OK |
| Panel | Estadísticas del tablero | OK |

## 3. Resultado de la evaluación del lote

| Puesto | Propuesta | Dictamen |
| :-: | :--- | :--- |
| 1 | 602 · Krypton Ingeniería C.A. | Válida · recomendada |
| 2 | 923 · Grupo Digital Miranda C.A. | Válida |
| 3 | 841 · Ávila Hardware & Redes C.A. | Válida |
| 4 | 832 · Sistemas del Valle C.A. | Válida |
| 5 | 638 · TecnoAndes Soluciones C.A. | Válida |
| — | 131 · ReTech Outlet Venezuela C.A. | Descartada: inyección de instrucciones |
| — | 331 · Mayorista Sin Fronteras C.A. | Descartada: costos o condiciones abusivas |
| — | 734 · Inversiones Élite Tech 2026 C.A. | Descartada: incompatibilidad técnica |
| — | 898 · Distribuidora 10x10 Tech C.A. | Descartada: equipos obsoletos o reciclados |
| — | 975 · Ofertas Express Digital C.A. | Descartada: alcance incompleto |

El mismo orden figura en `salida.json` (raíz del repositorio), generado por el modo lote.

## 4. Entorno de la prueba

- PostgreSQL 16 local; `DATABASE_URL` sin contraseña en la URL (la clave, si existe, en `PGPASSWORD`).
- Backend `python -m app.run` con `TLS_ENABLED=true` y certificados de `scripts/generate_tls_certs.sh`;
  claves propias para `MASTER_ENCRYPTION_KEY` y `JWT_SECRET_KEY`.
- Agente en `LLM_PROVIDER=heuristic` con OCR local (Tesseract) en esta máquina de pruebas. En la máquina de la
  demostración se usa la IA local por API compatible con OpenAI (Ollama, `qwen2.5:3b` y `qwen2.5vl:3b`).
- Frontend `npm run dev` con `BACKEND_URL=https://localhost:8000` (API real por defecto).

## 5. Cómo repetir esta verificación

Seguir el `README.md` (Pasos 1 a 7) sobre un clon limpio. El orden de la tabla 3 y el formato de `salida.json`
deben coincidir; un orden distinto indica un cambio en las reglas del agente.
