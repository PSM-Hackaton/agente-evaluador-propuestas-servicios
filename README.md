# agente-evaluador-propuestas-servicios

**Reto Grupal — Agente Evaluador de Propuestas de Servicios** (Hackatón Venezuela INNOVA 2026)
IA, Desarrollo de Software y Ciberseguridad.

Agente de IA autónomo con interfaz web. Recibe un documento de proyecto (términos de referencia) y entre 3 y 20 o más propuestas de proveedores, las audita y emite un dictamen financiero que recomienda la propuesta más factible y eficiente.

## Requisitos clave
- **Ingesta multimodal**: PDF digitales, escaneos con ruido, presupuestos manuscritos, XLSX y capturas PNG de chats (OCR o visión vía API).
- **Razonamiento agéntico (TCO)**: detección de costos ocultos en la letra pequeña (fletes, recargos, seguros) y verificación aritmética con tool calling (cantidad × precio unitario, subtotales y total). Se descartan las propuestas incompletas o con errores de cálculo.
- **Contraste con el mercado**: búsqueda web autónoma de precios para detectar sobrecostos.
- **UI e informe**: carga del proyecto y carga masiva de propuestas, botón "Evaluar Propuestas de Servicios" con trazabilidad del agente, propuesta recomendada, tabla comparativa (montos declarados frente a costos ajustados) y dictamen de descarte. Exportable a PDF, Markdown y CSV/Excel.
- **Plataforma**: historial de proyectos y estados del proceso; roles (carga, revisión, aprobación y auditoría) con registro de cambios; directorio e historial de proveedores con alertas; normalización USD/Bs a la tasa BCV con IVA; chat sobre los documentos cargados.
- **Seguridad**: TLS 1.2/1.3 de extremo a extremo y confidencialidad de los documentos.

## Material del reto
`docs/reto/` contiene:
- `IA_RETO_GRUPAL_PROPUESTA_DE_SERVICIOS_enunciado_.pdf`: enunciado del reto.
- `proyecto.pdf`: caso de prueba, la dotación de un laboratorio de computación con 11 equipos (La Hoyada, Caracas).
- `propuestas/`: 10 propuestas de ejemplo en PDF, PNG, JPG y XLSX.

## Estructura
```
backend/   Orquestador del agente, herramientas y API
frontend/  Interfaz web
docs/      Documentación y material del reto
```
