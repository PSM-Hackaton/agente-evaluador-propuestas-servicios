# Flujo de trabajo en el GitLab del evento — Reto Grupal 3

**Agente Evaluador de Propuestas de Servicios** · Hackatón Venezuela INNOVA 2026

Este documento fija cómo sube el equipo su trabajo al proyecto asignado en el GitLab del hackatón, de acuerdo con el
instructivo de GitLab del evento: commits y pushes frecuentes en ramas de trabajo, Merge Request diario hacia
`avance` y Merge Request final hacia `terminado`, con un `README.md` de 6 apartados en la raíz.

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
   `staging`**. `staging` y `main` están protegidas con CODEOWNERS: solo fusionan con la aprobación de Diego o Juan.
3. Diego o Juan revisan, piden o hacen correcciones y **aprueban**. **Nadie sube a GitLab un cambio que no esté
   aprobado** por Diego o Juan.
4. Aprobado el cambio, **cada integrante lo sube con su propia cuenta** de GitLab a su rama de trabajo (sección 5).

**Reglas**

1. **Cada integrante sube lo suyo con su propia cuenta** de GitLab, a su propia rama de trabajo. Nadie sube
   trabajo de otra persona a su nombre.
2. **Commits pequeños y frecuentes**: un cambio con sentido por commit, con un mensaje en castellano que diga qué
   cambia. Push al terminar cada tarea, no al final del día.
3. **Cada Merge Request hacia `avance` o `terminado` lo aprueba Diego Landaeta o Juan Laya** (Maintainers). Quien
   abre el Merge Request no lo aprueba.
4. **Cada commit cumple los requisitos de la competencia**: autor real (nombre completo y correo de GitLab), sin
   secretos ni claves de API, sin archivos generados o locales, sin rastros de herramientas de autoría ni líneas
   de coautoría, y sin romper las pruebas. Los ganchos de `scripts/hooks/` lo comprueban antes de cada commit y
   de cada push.

## 2. Ramas

| Rama | Quién sube | Contenido |
| :--- | :--- | :--- |
| `javier` | Javier Rodríguez | Frontend (`frontend/`) |
| `enggel` | Enggel Rodríguez | Backend, agente de IA y procesamiento de documentos (`backend/`) |
| `diego` | Diego Landaeta | Integración, seguridad, documentación de entrega (`README.md`, `docs/`) |
| `laya` | Juan Laya | Arquitectura y coordinación técnica (si aporta cambios) |
| `giovani` | Giovani Marcano | Pruebas y calidad (si aporta cambios) |
| `avance` | Solo por Merge Request | Integración diaria; se actualiza al cierre de cada día |
| `terminado` | Solo por Merge Request | Entrega final; recibe `avance` tras el *code freeze* |

Las ramas de trabajo nacen de `avance` y se actualizan con ella antes de cada Merge Request
(`git fetch origin && git merge origin/avance`), para que los conflictos se resuelvan en la rama de quien los
provoca y no en el Merge Request.

## 3. Configuración del proyecto en GitLab (la hace un Maintainer, una vez)

En *Settings > Repository > Protected branches*:

| Rama | Allowed to merge | Allowed to push and merge | Allowed to force push |
| :--- | :--- | :--- | :--- |
| `avance` | Maintainers | No one | No |
| `terminado` | Maintainers | No one | No |

- **Maintainers del proyecto: solo Diego Landaeta y Juan Laya** (*Manage > Members*). El resto del equipo,
  *Developer*: pueden subir a sus ramas de trabajo, pero no fusionar en `avance` ni en `terminado`.
- *Settings > Merge requests*: método de merge **Merge commit**; *Squash commits when merging*: **Do not allow**
  (se conserva el historial por persona); activar *Pipelines must succeed* si el evento publica un pipeline y
  *All threads must be resolved*.
- *Settings > Merge requests > Merge request approvals* (si la instancia lo permite): 1 aprobación obligatoria,
  aprobadores Diego Landaeta y Juan Laya, y *Prevent approval by author*.
- Plantilla por defecto: `.gitlab/merge_request_templates/Entrega.md` (se elige como *Description template* al
  abrir el Merge Request).

Si las ramas `avance` o `terminado` no existen aún, un Maintainer las crea desde el primer commit subido
(`git push origin <commit>:refs/heads/avance`) antes de protegerlas.

## 4. Primer día: puesta en marcha de cada integrante

```sh
git clone <URL-del-proyecto-en-GitLab> agente-evaluador
cd agente-evaluador
git config user.name "Nombre Apellido"            # nombre completo
git config user.email "correo-de-GitLab"          # el correo con el que entra al GitLab del evento
sh scripts/instalar-hooks.sh                      # activa pre-commit, commit-msg y pre-push
git switch -c <mi-rama> origin/avance             # o git switch <mi-rama> si ya existe
```

Para que el gancho `pre-push` pueda ejecutar las pruebas:

```sh
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && cd ..
cd frontend && npm ci && cd ..
```

**Carga inicial del trabajo ya hecho en GitHub.** Diego Landaeta prepara, sin subir nada, la copia limpia por
etapas con la autoría de cada parte, con las herramientas internas de entrega del repositorio de trabajo
(GitHub), que no se publican en GitLab. Cada integrante revisa que los commits de su rama llevan su nombre y su correo y
**sube su propia rama con su cuenta** (`git push <URL> <su-rama>` desde esa copia); después, Merge Request hacia
`avance` aprobado por Diego o Juan.

## 5. Durante la jornada

```sh
git fetch origin && git merge origin/avance       # traer lo integrado por el resto
# ... trabajo ...
git add <archivos>
git commit -m "Backend: validar de 3 a 20 propuestas en la carga masiva"
git push origin <mi-rama>                          # el pre-push ejecuta las pruebas antes de subir
```

Los ganchos **bloquean**:

| Gancho | Bloquea |
| :--- | :--- |
| `pre-commit` | archivos `.env` reales (se permite `.env.example`), llaves y certificados, bases de datos, `node_modules/`, `.venv/`, `dist/`, `backend/data/`; archivos de más de 5 MB; claves de API o tokens reales en las líneas añadidas (`sk-…`, `AIza…`, `ghp_…`, `glpat-…`, `tvly-…`, llaves privadas PEM); nombres de herramientas de autoría o líneas de coautoría en las líneas añadidas; una identidad de git que no sea una persona real |
| `commit-msg` | mensajes vacíos o de menos de 10 caracteres, líneas de coautoría y nombres de herramientas de autoría |
| `pre-push` | commits con autor no válido o mensajes no permitidos; fallos de `pytest` en el backend o de `npm run build` en el frontend (con `PREPUSH_SOLO=backend` o `frontend` se limita a una parte) |

Los proveedores de IA que usa la aplicación (Gemini, OpenAI) **no** se bloquean: son parte del producto.
`--no-verify` salta los ganchos; solo se acepta en casos justificados y explicados en el Merge Request. El
`pre-push` prueba el directorio de trabajo: conviene tenerlo limpio (`git status`) antes de subir.

## 6. Cierre de cada día: Merge Request hacia `avance`

1. Actualizar la rama con `avance`, pasar las pruebas y subir.
2. *Code > Merge requests > New merge request*: origen `<mi-rama>`, destino `avance`, plantilla **Entrega**.
3. Completar la lista de comprobación y enlazar el issue.
4. Diego Landaeta o Juan Laya revisan el diff y la lista y hacen el merge (sin *squash*).

## 7. Entrega final: `avance` → `terminado`

1. *Code freeze* 4 horas antes de la entrega: desde ese momento solo correcciones aprobadas.
2. Último Merge Request de cada rama de trabajo hacia `avance`.
3. Comprobación final de la versión limpia (con las herramientas internas de entrega, en el repositorio de
   trabajo del equipo) y del `README.md` de 6 apartados.
4. Si se versiona `salida.json`, se genera con el modo lote desde el clon de GitLab y con `HACKATHON_REPO_PATH`
   igual a la ruta del proyecto en GitLab (la sección 3.C del enunciado indica que GitLab revisa su formato).
5. Merge Request de `avance` hacia `terminado`, aprobado por Diego Landaeta o Juan Laya.

## 8. Lista rápida

- [ ] Maintainers: solo Diego Landaeta y Juan Laya; ramas `avance` y `terminado` protegidas (merge solo Maintainers, nadie hace push directo, sin *force push*).
- [ ] Cada integrante: identidad real configurada y `sh scripts/instalar-hooks.sh` ejecutado en su clon.
- [ ] Commits pequeños, push frecuente a la rama propia.
- [ ] Merge Request diario hacia `avance` con la plantilla **Entrega**, aprobado por un Maintainer.
- [ ] Code freeze, Merge Request final hacia `terminado` con el README de 6 apartados.
