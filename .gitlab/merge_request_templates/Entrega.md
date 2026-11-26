## Qué entrega este Merge Request

<!-- Una o dos frases: qué cambia y por qué. -->

- **Rama de origen → destino:** `javier` / `enggel` / `diego` → `avance` (cierre del día) · `avance` → `terminado` (entrega final)
- **Issue relacionado:** Closes #
- **Aprobación previa:** Pull Request de GitHub hacia `staging` aprobado por Diego Landaeta o Juan Laya: #
- **Parte del enunciado que cubre:** <!-- p. ej. 2.D.3 trazabilidad, 2.E.4 normalización BCV, 3.C salida.json -->

## Lista de comprobación (obligatoria)

Quien abre el Merge Request marca cada punto; quien lo aprueba (Diego Landaeta o Juan Laya) lo comprueba.

### Documentación
- [ ] `README.md` en la raíz con la plantilla del evento, en orden: `# <título>` · `## Participantes` (nombre completo y rol) · `## Descripción del proyecto` · `## Alcance` · `## Requerimientos del sistema` · `## Paso a paso de instalación / despliegue`.
- [ ] Si cambia la instalación, las variables de entorno o los comandos, el README y el `.env.example` correspondiente están actualizados.

### Pruebas en verde
- [ ] Backend: `cd backend && pytest` sin fallos (pegar la última línea: `N passed`).
- [ ] Frontend: `cd frontend && npm run build` sin errores (TypeScript + Vite).
- [ ] Si se tocó el modo lote: `python -m app.cli.batch --lote ../docs/reto --output ../salida.json` termina y valida `salida.json`.

### Seguridad
- [ ] Sin secretos: ningún `.env`, clave de API (Gemini, OpenAI, Tavily), token, `MASTER_ENCRYPTION_KEY`, `JWT_SECRET_KEY` ni contraseña real en el diff.
- [ ] Sin llaves ni certificados (`*.pem`, `*.key`, `*.crt`), bases de datos (`*.db`), `backend/data/`, `node_modules/`, `.venv/` ni `dist/`.
- [ ] Ningún archivo de más de 5 MB.

### Autoría y requisitos de la competencia
- [ ] Todo lo que sube este Merge Request fue **aprobado antes** por Diego Landaeta o Juan Laya (Pull Request de GitHub enlazado arriba).
- [ ] Todos los commits son de la persona que hizo el trabajo, con su nombre completo y su correo de GitLab (nada de correos `@*.local`, cuentas automáticas ni identidades de otra persona).
- [ ] Sin rastros de herramientas de autoría ni líneas de coautoría en commits, código o documentos.
- [ ] Los ganchos del proyecto están activos en mi clon (`sh scripts/instalar-hooks.sh`) y no usé `--no-verify` (si lo usé, explico aquí por qué).
- [ ] Commits pequeños, con mensajes en castellano que dicen qué cambia.
- [ ] Sin *Squash commits* al hacer el merge (se conserva el historial por persona).

## Evidencia

<!-- Capturas, salida de las pruebas o enlace a la demo. -->
