# Resultado Esperado del Lote de Práctica (`docs/reto/`)

Resultado esperado según el análisis del equipo (no es la clave oficial del jurado, sección 3.D) para comparar la salida del modo lote (`python -m app.cli.batch --lote ../docs/reto`) sobre las 10 propuestas de ejemplo definidas en `docs/reto/propuestas/` conforme a las reglas de la Sección 3.B.

| Puesto | Identificador | Proveedor | Formato | Estado esperado | Causas / Criterio |
|---:|---|---|---|---|---|
| 1 | `Propuesta_602_Krypton_Ingenieria_CA` | Krypton Ingeniería C.A. | PNG (chat) | **VÁLIDA** | Ryzen 9 / Ryzen 7 + RTX 4070 / RTX 4070 Super + ProArt 27" + UPS 1500VA Onda Pura + 36m garantía (recomendada). |
| 2 | `Propuesta_923_Grupo_Digital_Miranda_CA` | Grupo Digital Miranda C.A. | PDF | **VÁLIDA** | Ryzen 7 7700 + RTX 4060 Ti 16GB + ProArt 24" + UPS APC 1000VA + 24m garantía. |
| 3 | `Propuesta_841_Avila_Hardware__Redes_CA` | Ávila Hardware & Redes C.A. | PNG (chat) | **VÁLIDA** | Ryzen 5 + RTX 3060 12GB (estudiantes) / RTX 4060 (docente) + ViewSonic 24" + UPS TrippLite 900VA + 24m garantía. |
| 4 | `Propuesta_638_TecnoAndes_Soluciones_CA` | TecnoAndes Soluciones C.A. | XLSX | **VÁLIDA** | Ryzen 5 + RTX 4060 + Regulador AVR 1200VA + 12m garantía (menor TCO pero menor protección eléctrica y soporte). |
| 5 | `Propuesta_832_Sistemas_del_Valle_CA` | Sistemas del Valle C.A. | JPG (manuscrito) | **VÁLIDA** | Core i5-14400F / i7-14700F + RTX 4060 + Monitor IPS + UPS Forza 1000VA. |
| — | `Propuesta_131_ReTech_Outlet_Venezuela_CA` | ReTech Outlet Venezuela C.A. | PDF | **DESCARTADA** | `inyeccion_prompt` (texto oculto / instrucciones maliciosas) + `incompatibilidad_tecnica` (AM5 DDR5 vs AM4). |
| — | `Propuesta_331_Mayorista_Sin_Fronteras_CA` | Mayorista Sin Fronteras C.A. | PNG (chat) | **DESCARTADA** | `costos_condiciones_abusivas` (recargo abusivo de envío >= 50% en condición de chat). |
| — | `Propuesta_734_Inversiones_Elite_Tech_2026_CA` | Inversiones Élite Tech 2026 C.A. | XLSX | **DESCARTADA** | `incompatibilidad_tecnica` / `error_aritmetico` (módulos RAM exceden slots de placa y/o error en fórmula). |
| — | `Propuesta_898_Distribuidora_10x10_Tech_CA` | Distribuidora 10x10 Tech C.A. | PNG (chat) | **DESCARTADA** | `equipos_obsoletos_reciclados` (plataforma Xeon E5 / X99 reacondicionada vendida como nueva). |
| — | `Propuesta_975_Ofertas_Express_Digital_CA` | Ofertas Express Digital C.A. | JPG (manuscrito cursivo) | **DESCARTADA** | **Con Vision LLM (`GEMINI_API_KEY` / `OPENAI_API_KEY`):** `incompatibilidad_tecnica` (RAM DDR5 en placa ASUS PRIME B760M-A D4 DDR4) + `alcance_incompleto` (sin teclado/ratón). **Sin Vision LLM (OCR local Tesseract):** `alcance_incompleto` por ilegibilidad de letra manuscrita cursiva. |

> **Criterio de ranking (Sección 3.B):** Todas las propuestas **VÁLIDAS** preceden a todas las **DESCARTADAS**; entre las válidas prima la calidad técnica y cumplimiento global para programación, diseño 3D y edición de video (no necesariamente la más barata), usando el menor Costo Total Real (TCO) como desempate.
