# Preparación y subida de la entrega al GitLab del evento

Herramientas internas (no se publican) para llevar al GitLab del Hackatón 2026 una **copia limpia** del Agente
Evaluador de Propuestas de Servicios, de forma **progresiva**, como pide el instructivo: commits y pushes
frecuentes en las ramas de trabajo, Merge Request diario hacia `avance` y Merge Request final hacia `terminado`.

GitHub (`PSM-Hackaton/agente-evaluador-propuestas-servicios`) sigue siendo el repositorio de trabajo del equipo
(ramas `javier`, `enggel`, `staging`, `main`, issues y PR) y **no se modifica**. A GitLab va solo la versión
limpia, sin el material de `scripts/exclusiones-entrega.txt`.

| Herramienta | Para qué |
| :--- | :--- |
| `scripts/preparar-entrega.sh` | Copia limpia verificada y probada en **un único commit** (`avance`; `terminado` con `--final`). Sirve para revisar la entrega y para la comprobación final. |
| `scripts/subir-por-etapas.sh` | **Día 1**: reconstruye la copia limpia como **7 commits por etapas** (`scripts/etapas-entrega.txt`) con el autor real de cada parte, en las ramas `diego`, `enggel` y `javier`; prepara `avance`. |
| `scripts/sincronizar-gitlab.sh` | **Después**: lleva a la copia de entrega los commits nuevos de GitHub, **uno por commit original** (mismo mensaje, autor corregido si hace falta, hora real). |
| `scripts/entrega-comun.sh` | Funciones compartidas (exportar, excluir, ajustar, verificar, probar, confirmar y subir). |
| `scripts/entrega-herramientas.mjs` | Apoyo en Node.js: exclusiones, enlaces, verificaciones, plantillas `.env.example`, reparto en etapas y copia. |

Requisitos: `sh` POSIX, `git`, **Node.js 22+** y **Python 3.11+**. Las pruebas completas instalan las
dependencias del proyecto (pip y npm) en carpetas temporales, así que necesitan red o cachés. Si `pdftotext`
está instalado, también se revisa el texto de los PDF.

**Ningún script añade remotos ni hace `git push` por su cuenta.** Solo con `--subir` muestran cada
`git push gitlab <rama>` y lo ejecutan si se escribe exactamente `SI`; nunca fuerzan un push ni abren Merge
Request. Los commits llevan siempre la hora real.

## Autoría

El reparto en GitLab sigue quién hizo cada parte:

| Parte | Persona | Rama de GitLab |
| :--- | :--- | :--- |
| `backend/` (FastAPI, agente, ingesta, finanzas, informes, modo lote, pruebas) | Enggel Rodríguez | `enggel` |
| `frontend/` (React + Vite + TypeScript) | Javier Rodríguez | `javier` |
| Estructura, material del reto, `README.md` y `docs/cumplimiento/` | Diego Landaeta | `diego` |

**Problemas detectados en GitHub (26-11-2026)**, que estos scripts no corrigen solos:

- Los 4 commits de la rama `enggel` (`ee57855`, `6e79195`, `33d730b`, `5c49b50`) figuran con autor y committer
  **Diego Landaeta**, no Enggel Rodríguez.
- El commit de la rama `javier` (`9617b59`) figura como `Javier <javier@equipo.local>`: nombre incompleto y un
  correo que no existe.

Por eso las etapas de backend y frontend usan los marcadores `AUTOR_ENGGEL` y `AUTOR_JAVIER`, y hay que indicar
la identidad real con `--autor-enggel` y `--autor-javier` (nombre completo y **el correo con el que cada uno entra
al GitLab del evento**). Los scripts rechazan correos como `@equipo.local`, `@example.com` o `@localhost`.
En la sincronización, `--asignar <commit>=enggel|javier|diego` corrige la rama (y el autor) de un commit cuyo
autor de GitHub no es el real. Antes de usarlo, el equipo debe confirmar quién escribió cada commit.

## Flujo completo

### Antes de empezar (una vez)

1. En el repositorio de GitHub: `git config user.name "Nombre Apellido"` y `git config user.email "correo"` (quien
   ejecuta firma como *committer*; los scripts fallan si falta o parece una cuenta automática).
2. Tener la URL del proyecto en GitLab (botón *Clone*) y comprobar qué ramas existen ya.
3. Tener la rama integrada de GitHub (`staging`, con `javier` + `enggel` + `entrega` fusionadas).
4. Probar sin subir nada:
   `sh scripts/preparar-entrega.sh --ref staging --salida /tmp/revision --permitidos scripts/permitidos-entrega.txt`.

### Día 1: subir lo hecho, por etapas

```sh
# 1) Preparar y revisar (sin --subir no se ejecuta ningún push)
sh scripts/subir-por-etapas.sh --ref staging --salida ../entrega-gitlab \
   --autor-javier "Javier Rodríguez <correo-de-javier>" \
   --autor-enggel "Enggel Rodríguez <correo-de-enggel>" \
   --permitidos scripts/permitidos-entrega.txt

# 2) Subir de verdad, etapa por etapa (pide SI antes de cada push)
sh scripts/subir-por-etapas.sh --ref staging --salida ../entrega-gitlab --forzar \
   --autor-javier "Javier Rodríguez <correo-de-javier>" \
   --autor-enggel "Enggel Rodríguez <correo-de-enggel>" \
   --permitidos scripts/permitidos-entrega.txt --subir --remoto <URL-del-proyecto-en-GitLab>
```

| Etapa | Autor | Rama | Contenido |
| :--- | :--- | :--- | :--- |
| 1 `estructura` | Diego Landaeta | `diego` | `.gitignore`, `backend/.gitkeep`, material del reto (`docs/reto/`) |
| 2 `backend-nucleo` | Enggel Rodríguez | `enggel` | Configuración, cifrado AES-256-GCM, modelos, roles, almacenamiento cifrado, bitácora y sus pruebas |
| 3 `backend-agente` | Enggel Rodríguez | `enggel` | Ingesta multimodal, cliente de IA, auditoría técnica, TCO, BCV, búsqueda de precios y sus pruebas |
| 4 `backend-api` | Enggel Rodríguez | `enggel` | API REST/SSE, informes, modo lote, TLS, prueba e2e, `backend/README.md` y cualquier otro archivo de `backend/` |
| 5 `frontend-base` | Javier Rodríguez | `javier` | Proyecto Vite, cliente de la API, sesión, roles, componentes base |
| 6 `frontend-modulos` | Javier Rodríguez | `javier` | Páginas y componentes de negocio, `frontend/README.md` y el resto de `frontend/` |
| 7 `documentacion` | Diego Landaeta | `diego` | `README.md` de 6 apartados y `docs/cumplimiento/` |

El orden sigue la cronología de GitHub (estructura 11:34, backend desde 13:42, frontend 14:08). Si la rama
integrada trae archivos nuevos fuera de `backend/` y `frontend/`, el plan falla diciendo cuáles quedaron sin
etapa: añádalos a `scripts/etapas-entrega.txt` (formato en su cabecera) y repita sin `--subir`.

Qué hace: genera la copia limpia completa (exporta con `git archive`, excluye, ajusta enlaces, verifica y prueba);
la reparte en etapas; crea un repositorio nuevo en `--salida` y aplica cada etapa como un commit acumulativo,
verificando el árbol antes de cada uno; comprueba que el árbol final es idéntico a la copia limpia; prepara la
rama local `avance` como merge `--no-ff` de las ramas de trabajo y guarda el estado para la sincronización.

**Modelo de ramas.** Historia **lineal** en la rama local `integracion` (no se sube). Cada commit mueve además la
rama de su autor (`diego`, `enggel` o `javier`) hasta él por avance rápido, así las ramas comparten historia y
ningún push necesita forzarse.

**Cierre del día** (en la web de GitLab; el script no lo hace):

1. Si `avance` no existe en GitLab, crearla desde el primer commit (el script imprime el comando exacto).
2. *Code > Merge requests > New merge request*: origen la rama más adelantada (la última del historial),
   destino `avance`, sin *Squash commits*.
3. Comparar el diff con la rama local `avance` y hacer el merge.

### Después: subida continua

```sh
# Ver qué se subiría (no cambia nada)
sh scripts/sincronizar-gitlab.sh --entrega ../entrega-gitlab --hasta staging --plan

# Sincronizar y subir (pide SI antes de cada push)
sh scripts/sincronizar-gitlab.sh --entrega ../entrega-gitlab --hasta staging \
   --autor-javier "Javier Rodríguez <correo>" --autor-enggel "Enggel Rodríguez <correo>" \
   --asignar 1a2b3c4=enggel --permitidos scripts/permitidos-entrega.txt --subir
```

- **Desde dónde**: el último commit sincronizado, guardado en `../entrega-gitlab/.git/entrega-sincronizacion`
  (nunca se versiona). Se puede forzar con `--desde <ref>`.
- **Un commit por commit original**, recorriendo la historia principal de GitHub (primer padre); un merge (p. ej.
  el de un PR hacia `staging`) aplica primero los commits de la rama integrada, uno por uno.
- **Rama y autor**: `--asignar` si se indicó; si no, por el autor de GitHub (`javier`/`JarviScott` → `javier`,
  `enggel` → `enggel`, el resto → `diego`). Con `--autor-javier`/`--autor-enggel` se firma con la identidad real.
  El modo `--plan` muestra la rama que tomaría cada commit.
- **Antes de cada commit**: verificaciones completas (incluido el README) y todas las pruebas; si algo falla, se
  deshace el cambio y no se confirma nada.

### Entrega final

1. Tras el *code freeze*, última sincronización y Merge Request hacia `avance`.
2. `sh scripts/preparar-entrega.sh --ref staging --final --salida /tmp/final --permitidos scripts/permitidos-entrega.txt`
   debe terminar sin errores y su árbol debe coincidir con el de la copia de entrega
   (`git -C ../entrega-gitlab rev-parse integracion^{tree}` frente a `git -C /tmp/final rev-parse avance^{tree}`).
3. Si el equipo decide versionar `salida.json` en la raíz (GitLab revisa su formato en cada commit, sección 3.C
   del enunciado), generarlo con el modo lote **desde el clon de GitLab** y con `HACKATHON_REPO_PATH` definido.
4. En GitLab: Merge Request de `avance` hacia `terminado`.

### Si GitLab ya tiene historial

Si el proyecto del evento trae commits propios (p. ej. un README inicial) en la rama a la que se sube, el push
será rechazado por historias distintas. **No use `--force`.** Opciones:

- Subida por etapas: empujar a las ramas de trabajo nuevas (`diego`, `enggel`, `javier`) y unirlas a `avance`
  por Merge Request (si hay conflictos, resolverlos en el propio Merge Request).
- Copia de un solo commit:

```sh
git fetch gitlab
git switch -c trabajo-AAAA-MM-DD gitlab/avance   # parte de lo ya publicado en avance
git read-tree -u --reset avance                  # deja exactamente el contenido de la entrega nueva
git commit -m "Avance del día AAAA-MM-DD"
git push gitlab trabajo-AAAA-MM-DD               # luego, Merge Request hacia avance en GitLab
```

## Pruebas que se ejecutan (`PRUEBAS`)

| Valor | Backend | Frontend |
| :--- | :--- | :--- |
| `completas` (por defecto) | `python3 -m compileall`; entorno virtual nuevo, `pip install -e ".[dev]"` y `pytest` | JSON de `package.json`/`tsconfig.json`; `npm ci` y `npm run build` (`tsc --noEmit` + `vite build`) |
| `rapidas` | solo `compileall` | solo el JSON |
| `ninguna` | nada (solo para inspeccionar; nunca para subir) | nada |

En todos los casos (salvo `ninguna`) se comprueba que existen `backend/.env.example` y `frontend/.env.example`
y que sus variables de claves y secretos van vacías o con `CHANGE_ME`. Ejemplo: `PRUEBAS=rapidas sh scripts/...`.

## Verificaciones de limpieza

La copia falla si contiene: rastros de herramientas de autoría o líneas de coautoría (los proveedores de IA que
usa la aplicación, como Gemini u OpenAI, **sí** pueden aparecer: son funcionalidad del producto); rutas locales
`/home/`; tokens de GitHub/GitLab y similares o llaves privadas PEM; archivos sensibles por nombre (`.env`,
llaves, certificados, bases de datos, `node_modules/`, `.venv/`, `__pycache__/`, `dist/`, `*.enc`,
`backend/data/`, `.claude/`); archivos de más de 5 MB; o un `README.md` sin los 6 apartados del instructivo como
títulos `## N. Nombre`, en orden. Los hallazgos legítimos que no se puedan corregir en el repositorio se anotan
en `scripts/permitidos-entrega.txt` (`marcas|rutas|secretos <ruta>`); hoy está vacío.

## Qué se excluye

Lista comentada en `scripts/exclusiones-entrega.txt`: el plan interno `docs/PLAN_DE_TRABAJO.md`; estas
herramientas; `.claude/`, `.vscode/`, `.idea/`; `.env` reales (salvo `.env.example`); entornos y cachés de
Python; `node_modules/`, `dist/`, `build/`; la base SQLite y el almacenamiento cifrado (`backend/data/`, `*.db`,
`*.enc`); resultados locales; certificados y llaves (`certs/`, `*.pem`, `*.key`, `*.crt`…); registros y basura
del sistema. `salida.json` en la raíz **no** se excluye (ver «Entrega final»).

## Pruebas de los scripts sin GitLab

```sh
git init --bare /tmp/gitlab-falso.git
yes SI | sh scripts/subir-por-etapas.sh --ref staging --salida /tmp/entrega-prueba \
   --autor-javier "Javier Rodríguez <javier@correo-real>" --autor-enggel "Enggel Rodríguez <enggel@correo-real>" \
   --subir --remoto /tmp/gitlab-falso.git
git -C /tmp/gitlab-falso.git for-each-ref refs/heads    # ramas "subidas"
```

Cualquier respuesta distinta de `SI` (o el fin de la entrada) omite ese push y el script continúa.

## Lista de comprobación del instructivo de GitLab

- [ ] Sesión iniciada en GitLab con el correo de registro y contraseña temporal cambiada por una robusta.
- [ ] Proyecto asignado localizado y su URL a mano; cada persona sube con su propia cuenta.
- [ ] Identidades reales confirmadas para Javier y Enggel (nombre completo y correo de GitLab).
- [ ] `javier` y `enggel` integradas en `staging` en GitHub (PR revisados) y `preparar-entrega.sh` en verde.
- [ ] Ramas de trabajo (`diego`, `enggel`, `javier`), `avance` (merge diario) y `terminado` (merge final).
- [ ] Día 1: `subir-por-etapas.sh` sin `--subir`, revisión del plan; después con `--subir`.
- [ ] Al final de cada día: Merge Request hacia `avance`, sin *Squash commits*.
- [ ] Code freeze 4 horas antes de la entrega.
- [ ] `README.md` con los 6 apartados antes del merge a `terminado` (pasos «a confirmar» ya confirmados).
- [ ] Merge Request final de `avance` hacia `terminado`.
