# Flujo de trabajo en el GitLab del evento — Reto Grupal 3

**Agente Evaluador de Propuestas de Servicios** · Hackatón Venezuela INNOVA 2026

Este documento fija cómo sube el equipo su trabajo al proyecto asignado en el GitLab del hackatón, de acuerdo con el
instructivo de GitLab del evento: commits y pushes frecuentes en ramas de trabajo, validación en `pruebas` e
integración en `desarrollo` (rama principal del proyecto), con un `README.md` con los apartados de la plantilla
del evento en la raíz.

## 1. Roles y reglas del equipo

| Persona | Cuenta de GitHub | Papel en el flujo |
| :--- | :--- | :--- |
| Javier Rodríguez | `JarviScott` | Implementa el frontend |
| Enggel Rodríguez | `metagamingprohd-lang` | Implementa el backend, el agente de IA y el procesamiento de documentos |
| Giovani Marcano | `Giovani2011` | Pruebas y calidad |
| Diego Landaeta | `diego-landaeta` | Orquesta con issues, revisa, corrige y aprueba (Maintainer) |
| Juan Laya | `lya0509` | Orquesta con issues, revisa, corrige y aprueba (Maintainer) |

**Ciclo de cada cambio**

1. Diego o Juan abren un **issue** en GitHub con el requisito citado y el criterio de aceptación, asignado a quien
   lo implementa (backend → Enggel, frontend → Javier, pruebas → Giovani).
2. La persona asignada trabaja en su rama de GitHub (`enggel`, `javier`, …) y abre un **Pull Request hacia
   `staging`**. `staging` y `main` están protegidas con revisores obligatorios en GitHub: solo fusionan con la aprobación de Diego o Juan.
3. Diego o Juan revisan, piden o hacen correcciones y **aprueban**. **Nadie sube a GitLab un cambio que no esté
   aprobado** por Diego o Juan.
4. Aprobado el cambio, **cada integrante sube ese mismo commit con su propia cuenta** de GitLab a su rama de
   trabajo (`enggel`, `javier`) y a `pruebas` (sección 5).
5. Diego o Juan **validan** el commit en `pruebas` (pruebas, build, reglas de commit).
6. Validado, se sube **ese mismo commit** a `desarrollo` con un push normal (avance rápido, **nunca forzado**) y
   se abre el Merge Request correspondiente como **registro** de la integración.

**Reglas**

1. **Cada integrante sube lo suyo con su propia cuenta** de GitLab, a su propia rama de trabajo. Nadie sube
   trabajo de otra persona a su nombre.
2. **Commits pequeños, frecuentes y detallados**: un cambio con sentido por commit, en castellano. Título
   `tipo(ámbito): descripción concreta (#issue)` y **cuerpo obligatorio** con qué se cambió (archivos o módulos),
   por qué (requisito o issue), cómo se verificó (comandos y resultado) y riesgos, si los hay. Ejemplo en la
   sección 5. Push al terminar cada tarea, no al final del día.
3. **Nada entra en `desarrollo` sin la validación de Diego Landaeta o Juan Laya**; se sube solo el commit ya
   aprobado en GitHub y validado en `pruebas`, sin forzar. El Merge Request queda como registro.
4. **Cada commit cumple los requisitos de la competencia**: autor real (nombre completo y correo de GitLab), sin
   secretos ni claves de API, sin archivos generados o locales, sin rastros de herramientas de autoría ni líneas
   de coautoría, y sin romper las pruebas. Los ganchos de `scripts/hooks/` lo comprueban antes de cada commit y
   de cada push.

## 2. Ramas

| Rama | Quién sube | Contenido |
| :--- | :--- | :--- |
| `desarrollo` | Push normal (sin forzar) del commit ya validado por Diego o Juan | Rama principal del proyecto en el evento |
| `pruebas` | Cada integrante, con el commit aprobado en GitHub | Validación previa a `desarrollo` |
| `javier` | Javier Rodríguez | Frontend (`frontend/`) |
| `enggel` | Enggel Rodríguez | Backend, agente de IA y procesamiento de documentos (`backend/`) |

Las ramas de trabajo nacen de `desarrollo` y se actualizan con ella antes de subir
(`git fetch origin && git merge --ff-only origin/desarrollo` o `git rebase origin/desarrollo` antes de que el
commit salga de su rama), para que `pruebas` y `desarrollo` avancen sin forzar.

## 3. Configuración del proyecto en GitLab

- Los *Developers* pueden subir a sus ramas, a `pruebas` y a `desarrollo`, pero **no fusionan Merge Request**.
  Por eso la regla del equipo es que a `desarrollo` solo se sube el commit validado por Diego o Juan.
- `desarrollo` no admite *force push*: si un push es rechazado por no ser avance rápido, se actualiza la rama
  propia y se vuelve a validar; **nunca** se usa `--force`.
- Plantilla del Merge Request de registro: `.gitlab/merge_request_templates/Entrega.md`.

## 4. Primer día: puesta en marcha de cada integrante

```sh
git clone <URL-del-proyecto-en-GitLab> agente-evaluador
cd agente-evaluador
git config user.name "Nombre Apellido"            # nombre completo
git config user.email "correo-de-GitLab"          # el correo con el que entra al GitLab del evento
sh scripts/instalar-hooks.sh                      # activa pre-commit, commit-msg y pre-push
git switch -c <mi-rama> origin/desarrollo         # o git switch <mi-rama> si ya existe
```

Para que el gancho `pre-push` pueda ejecutar las pruebas:

```sh
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && cd ..
cd frontend && npm ci && cd ..
```

**Carga inicial del trabajo ya hecho en GitHub.** Diego Landaeta prepara, sin subir nada, la copia limpia por
etapas con la autoría de cada parte, con las herramientas internas de entrega del repositorio de trabajo
(GitHub), que no se publican en GitLab. Cada integrante revisa que los commits de su rama llevan su nombre y su correo y
**sube su propia rama con su cuenta** (`git push <URL> <su-rama>` desde esa copia); después sigue el ciclo de
`pruebas` y `desarrollo` de la sección 1.

## 5. Durante la jornada

```sh
git fetch origin && git merge --ff-only origin/desarrollo   # traer lo integrado por el resto
# ... trabajo, Pull Request en GitHub y aprobación de Diego o Juan ...
git add <archivos>
git commit                                         # abre el editor: título y cuerpo (ver ejemplo)
git push origin <mi-rama>                          # el pre-push ejecuta las pruebas antes de subir
git push origin <mi-rama>:pruebas                  # mismo commit, para la validación
# Tras la validación de Diego o Juan (push normal, sin --force):
git push origin <commit-validado>:desarrollo
```

Ejemplo de mensaje:

```
feat(carga): validar de 3 a 20 propuestas por proyecto en backend (#22)

Qué: backend/app/api/v1/proposals.py rechaza con 422 la carga y la evaluación fuera del rango 3-20.
Por qué: el enunciado fija entre 3 y 20 propuestas por proyecto (issue #22).
Verificación: pytest 51/51 y ruff limpio; carga de 2 y 21 archivos devuelve 422.
Riesgos: proyectos ya creados con menos de 3 propuestas deben completarse antes de evaluar.
```

Los ganchos **bloquean**:

| Gancho | Bloquea |
| :--- | :--- |
| `pre-commit` | archivos `.env` reales (se permite `.env.example`), llaves y certificados, bases de datos, `node_modules/`, `.venv/`, `dist/`, `backend/data/`; archivos de más de 5 MB; claves de API o tokens reales en las líneas añadidas (`sk-…`, `AIza…`, `ghp_…`, `glpat-…`, `tvly-…`, llaves privadas PEM); nombres de herramientas de autoría o líneas de coautoría en las líneas añadidas; una identidad de git que no sea una persona real |
| `commit-msg` | títulos de menos de 10 caracteres o sin el formato `tipo(ámbito): descripción`; mensajes sin cuerpo (al menos 2 líneas descriptivas tras una línea en blanco); líneas de coautoría y nombres de herramientas de autoría |
| `pre-push` | commits con autor no válido o mensajes no permitidos; fallos de `pytest` en el backend o de `npm run build` en el frontend (con `PREPUSH_SOLO=backend` o `frontend` se limita a una parte) |

La solución es 100 % soberana: **no utiliza ninguna API comercial de IA** (ni envía documentos a la nube); opera en servidores propios (*on-premise*) con motor algorítmico predictivo e inferencia local.
`--no-verify` salta los ganchos; solo se acepta en casos justificados y explicados en el Merge Request. El
`pre-push` prueba el directorio de trabajo: conviene tenerlo limpio (`git status`) antes de subir.

## 6. Validación e integración en `desarrollo`

1. El integrante sube el commit aprobado en GitHub a su rama y a `pruebas`, y avisa en el issue o en el Pull Request.
2. Diego Landaeta o Juan Laya validan en `pruebas`: pruebas del backend y build del frontend, autoría real y
   mensajes con cuerpo.
3. Validado, se sube **el mismo commit** a `desarrollo` con push normal (avance rápido, sin forzar).
4. Se abre el Merge Request de la rama de trabajo hacia `desarrollo` con la plantilla **Entrega** y el enlace al
   Pull Request aprobado en GitHub; queda como registro.

## 7. Entrega final

1. *Code freeze* 4 horas antes de la entrega: desde ese momento solo correcciones aprobadas.
2. Comprobación final de `desarrollo` (con las herramientas internas de entrega, en el repositorio de trabajo
   del equipo) y del `README.md` con los apartados de la plantilla del evento.
3. Si se versiona `salida.json`, se genera con el modo lote desde el clon de GitLab y con `HACKATHON_REPO_PATH`
   igual a la ruta del proyecto en GitLab (la sección 3.C del enunciado indica que GitLab revisa su formato).

## 8. Lista rápida

- [ ] Cada integrante: identidad real configurada (nombre completo y correo de su cuenta de GitLab o su
  correo noreply) y `sh scripts/instalar-hooks.sh` ejecutado en su clon.
- [ ] Commits pequeños, con título `tipo(ámbito): descripción (#issue)` y cuerpo detallado.
- [ ] Solo commits aprobados en GitHub suben a la rama propia y a `pruebas`.
- [ ] A `desarrollo` solo el commit validado por Diego o Juan, con push normal; nunca `--force`.
- [ ] Merge Request de registro hacia `desarrollo` con la plantilla **Entrega**.
