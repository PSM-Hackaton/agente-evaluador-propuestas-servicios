# Resultado Esperado del Lote de Práctica (`docs/reto/`)

Resultado esperado según el análisis del equipo (no es la clave oficial del jurado, sección 3.D) para comparar la salida del modo lote (`python -m app.cli.batch --lote ../docs/reto`) sobre las 10 propuestas de ejemplo definidas en `docs/reto/propuestas/` conforme a las reglas de la Sección 3.B.

| Puesto | Identificador | Proveedor | Formato | Estado esperado | Causas / Criterio |
|---:|---|---|---|---|---|
| 1 | `Propuesta_602_Krypton_Ingenieria_CA` | Krypton Ingeniería C.A. | PNG (chat) | **VÁLIDA** | Intel Core i7-13700F (estudiantes) / Core i7-14700K (docente) + RTX 4070 12GB / RTX 4070 Super 12GB + LG UltraGear 27GN800-B 27" QHD + UPS CyberPower 1500VA Onda Pura + Pop!_OS 24.04 LTS + garantía 24 meses (recomendada). |
| 2 | `Propuesta_923_Grupo_Digital_Miranda_CA` | Grupo Digital Miranda C.A. | PDF | **VÁLIDA** | Ryzen 7 7700 + RTX 4060 Ti 16GB + ProArt 24" + UPS APC 1000VA + 24m garantía. |
| 3 | `Propuesta_841_Avila_Hardware__Redes_CA` | Ávila Hardware & Redes C.A. | PNG (chat) | **VÁLIDA** | Ryzen 5 7600X + RTX 3060 12GB (estudiantes) / Ryzen 7 7700X + RTX 4060 8GB (docente) + LG 24" IPS + UPS Interactivo APC Back-UPS 1000VA/600W + Linux Mint 22 + garantía 24 meses. |
| 4 | `Propuesta_832_Sistemas_del_Valle_CA` | Sistemas del Valle C.A. | JPG (manuscrito) | **VÁLIDA** | Core i5-14400F / Core i7-14700F + 16GB/32GB DDR5 + RX 7600 8GB + Monitor Samsung 24" IPS + Supresor Tripp Lite Isobar + AVR + Fedora 40 + garantía 18 meses. |
| 5 | `Propuesta_638_TecnoAndes_Soluciones_CA` | TecnoAndes Soluciones C.A. | XLSX | **VÁLIDA** | Ryzen 5 7600 + 16GB DDR5 (1x16GB single-channel) + RTX 4060 8GB (estudiantes) / Ryzen 7 7700 + 32GB + RTX 4060 (docente) + Regulador AVR 1200VA + Ubuntu 24.04 + garantía 12 meses (menor TCO, opción de entrada). |
| — | `Propuesta_131_ReTech_Outlet_Venezuela_CA` | ReTech Outlet Venezuela C.A. | PDF | **DESCARTADA** | `inyeccion_prompt` (texto oculto / instrucciones maliciosas) + `incompatibilidad_tecnica` (AM5 DDR5 vs AM4). |
| — | `Propuesta_331_Mayorista_Sin_Fronteras_CA` | Mayorista Sin Fronteras C.A. | PNG (chat) | **DESCARTADA** | `costos_condiciones_abusivas` (software de evaluación Windows 11 Pro que vence a los 30 días y exige compra de licencias por $6,600/año; envío declarado $160.00). |
| — | `Propuesta_734_Inversiones_Elite_Tech_2026_CA` | Inversiones Élite Tech 2026 C.A. | XLSX | **DESCARTADA** | `incompatibilidad_tecnica` / `error_aritmetico` (módulos RAM exceden slots de placa y/o error en fórmula). |
| — | `Propuesta_898_Distribuidora_10x10_Tech_CA` | Distribuidora 10x10 Tech C.A. | PNG (chat) | **DESCARTADA** | `equipos_obsoletos_reciclados` (plataforma Xeon E5 / X99 reacondicionada vendida como nueva). |
| — | `Propuesta_975_Ofertas_Express_Digital_CA` | Ofertas Express Digital C.A. | JPG (manuscrito cursivo) | **DESCARTADA** | **Con Vision LLM (`GEMINI_API_KEY` / `OPENAI_API_KEY`):** `incompatibilidad_tecnica` (RAM DDR5 en placa ASUS PRIME B760M-A D4 DDR4) + `alcance_incompleto` (sin teclado/ratón). **Sin Vision LLM (OCR local Tesseract):** `alcance_incompleto` por ilegibilidad de letra manuscrita cursiva. |

> **Criterio de ranking (Sección 3.B):** Todas las propuestas **VÁLIDAS** preceden a todas las **DESCARTADAS**; entre las válidas prima la calidad técnica y cumplimiento global para programación, diseño 3D y edición de video (no necesariamente la más barata), usando el menor Costo Total Real (TCO) como desempate.

## Criterio técnico general de ponderación (Sección 3.B)

La rúbrica del evaluador técnico (`backend/app/services/agent/technical_audit.py`) es agnóstica de marcas y asigna hasta **100 puntos** según cuatro ejes del enunciado (ponderando **80 % estación de estudiantes** y **20 % estación docente**):

| Dimensión | Rango | Fundamento técnico (Sección 3.B — programación, 3D y edición de video) |
|---|---|---|
| **GPU + CPU** | 19.0 – 44.5 | GPU (18.0–39.5) prioriza VRAM (12–16 GB vs 8 GB) y aceleración CUDA/HIP para modelado/renderizado 3D y video; RTX 4060 (29.0) aventaja en +2.0 pts a RX 7600 (27.0) por soporte CUDA/OptiX sin penalizar en exceso GPU de 8 GB equivalentes. CPU (+1.0 a +5.0) pondera núcleos/hilos para compilación paralela y renderizado (`i9`/`R9` 12–24C > `i7`/`R7` 8–20C > `i5` 13.ª/14.ª gen 10–14C > `R5`/`i5-12` 6C). |
| **RAM y Almacenamiento** | 7.0 – 20.0 | Capacidad RAM (7.0–12.0: 16/32/64 GB) y NVMe (3.0–8.0: <1 TB / 1 TB / 2 TB). Configuraciones *single-channel* (`1xN GB`) reciben **-1.0 pt** por reducir a la mitad el ancho de banda de memoria en compilación y líneas de tiempo de video. |
| **Monitores y Periféricos** | 6.0 – 15.0 | Prioriza resolución QHD/4K y fidelidad de color (`100% sRGB` calibrado) para diseño 3D y edición, seguidos de periféricos mecánicos/ergonómicos frente a kits básicos FHD. |
| **Protección Eléctrica** | 3.0 – 13.0 | UPS de onda senoidal pura (13.0) > UPS interactivo 1200VA+ (11.5) > UPS interactivo estándar (10.0) > supresor de picos + AVR (7.5) > regulador AVR simple (6.5), garantizando continuidad ante fallos eléctricos. |
| **Garantía y Soporte** | 6.0 – 12.0 | Cobertura ≥ 24 meses (10.0, +2.0 con mantenimiento preventivo/soporte 24h) > 18 meses (8.0) > 12 meses (6.0), asegurando sostenibilidad operativa del laboratorio. |
