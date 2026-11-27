#!/bin/sh
# SUBIDA PROGRESIVA (día 1): reconstruye la copia limpia como una serie de commits por etapas.
#
#   1. Genera y verifica la copia limpia completa (mismas funciones que preparar-entrega.sh:
#      exportar, excluir, ajustar enlaces, verificar y probar).
#   2. Reparte sus archivos en las etapas de scripts/etapas-entrega.txt (ninguno sin etapa).
#   3. Crea en la carpeta de salida un repositorio git nuevo y aplica cada etapa como un commit
#      con su autor y su mensaje (hora real), verificando el árbol antes de cada commit.
#   4. Modelo de ramas: historia LINEAL en la rama local "integracion" (nunca se sube). Cada commit
#      mueve además la rama de trabajo de su autor (diego, javier o enggel) hasta él, por avance rápido;
#      es lo mismo que si cada persona actualizara su rama con la de los compañeros antes de su commit.
#      Así ningún push necesita forzarse y ambas ramas comparten historia.
#   5. Con --subir, tras cada commit muestra "git push gitlab <rama>" y lo ejecuta solo si se
#      escribe SI. Sin --subir solo prepara el repositorio y muestra el plan de subida.
#   6. Prepara la rama "avance" como merge (--no-ff) de las ramas de trabajo, deja el estado para
#      sincronizar-gitlab.sh e imprime cómo abrir los Merge Request en GitLab (no los abre).
#
# MODELO DEL EVENTO (--sobre-gitlab DIR): en vez de un repositorio nuevo, usa un clon del proyecto del
# GitLab del evento y construye las etapas ENCIMA de gitlab/desarrollo (commit del organizador y lo ya
# fusionado), sin reescribir historia: rama local "integracion" desde la base, un commit por etapa con
# autor y quien confirma = la persona de la etapa (su identidad de GitLab) y la rama personal del autor
# (javier, enggel) movida por avance rápido. Las etapas con "estado espera" no se confirman. No prepara
# avance: imprime los push y los Merge Request hacia desarrollo (remove_source_branch=false), que en este
# proyecto fusionan los organizadores (Maintainers).
#
# Cada commit lleva un mensaje DETALLADO: título y cuerpo de etapas-entrega.txt, «Pruebas ejecutadas: ...»
# con el resultado real y «Refs #n» / «Closes #n» de los issues de GitLab de la etapa.
#
# Uso: sh scripts/subir-por-etapas.sh --autor-javier "N <c>" --autor-enggel "N <c>" [opciones]
# Requisitos: sh POSIX, git, Node.js 22+ y Python 3.11+ (ver scripts/README-entrega.md).

set -eu

uso() {
  cat <<'FIN'
Uso: sh scripts/subir-por-etapas.sh --autor-javier "N <c>" --autor-enggel "N <c>" [opciones]

  --autor-javier "N <c>"  autor de las etapas del frontend (obligatorio: sustituye AUTOR_JAVIER)
  --autor-enggel "N <c>"  autor de las etapas del backend (obligatorio: sustituye AUTOR_ENGGEL)
                        Use el nombre completo y el correo con el que cada persona entra al GitLab del evento.
  --ref REF             referencia git a entregar. Por defecto: HEAD
  --salida DIR          carpeta del repositorio de la entrega (vacía o inexistente).
                        Por defecto: ../entrega-gitlab respecto a la raíz del repositorio
  --forzar              borra la carpeta de salida si es una entrega anterior
  --permitidos ARCH     lista de hallazgos aceptados (como en preparar-entrega.sh)
  --subir               tras cada commit, ofrece "git push gitlab <rama>" (requiere --remoto)
  --remoto URL          configura el remoto "gitlab" del repositorio de la entrega con esa URL
  --sobre-gitlab DIR    modelo del evento: construye las etapas en el clon DIR del proyecto de GitLab
                        (remoto "gitlab" actualizado, sin credenciales, sin cambios) encima de --base
  --base REF            base en el clon (con --sobre-gitlab). Por defecto: gitlab/desarrollo
  --proyecto ID         id numérico del proyecto en GitLab, para mostrar los Merge Request por la API
  -h, --help            muestra esta ayuda

Variable PRUEBAS=completas (por defecto: pytest y build del frontend) | rapidas (solo sintaxis).
La confirmación de cada push se lee de la entrada estándar: solo "SI" (en mayúsculas) sube.
Nunca fuerza un push ni abre Merge Request.
FIN
}

DIR_SCRIPT=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=scripts/entrega-comun.sh
. "$DIR_SCRIPT/entrega-comun.sh"

# ------------------------------------------------------------------ argumentos

REF=HEAD
SALIDA=
FORZAR=0
PERMITIDOS=
SUBIR=0
REMOTO=
AUTOR_JAVIER=
AUTOR_ENGGEL=
SOBRE_GITLAB=
BASE_REF=gitlab/desarrollo
PROYECTO=
while [ $# -gt 0 ]; do
  case "$1" in
    --autor-javier) [ $# -ge 2 ] || falla 'falta el valor de --autor-javier'; AUTOR_JAVIER=$2; shift 2 ;;
    --autor-enggel) [ $# -ge 2 ] || falla 'falta el valor de --autor-enggel'; AUTOR_ENGGEL=$2; shift 2 ;;
    --ref) [ $# -ge 2 ] || falla 'falta el valor de --ref'; REF=$2; shift 2 ;;
    --salida) [ $# -ge 2 ] || falla 'falta el valor de --salida'; SALIDA=$2; shift 2 ;;
    --forzar) FORZAR=1; shift ;;
    --permitidos) [ $# -ge 2 ] || falla 'falta el valor de --permitidos'; PERMITIDOS=$2; shift 2 ;;
    --subir) SUBIR=1; shift ;;
    --remoto) [ $# -ge 2 ] || falla 'falta el valor de --remoto'; REMOTO=$2; shift 2 ;;
    --sobre-gitlab) [ $# -ge 2 ] || falla 'falta el valor de --sobre-gitlab'; SOBRE_GITLAB=$2; shift 2 ;;
    --base) [ $# -ge 2 ] || falla 'falta el valor de --base'; BASE_REF=$2; shift 2 ;;
    --proyecto) [ $# -ge 2 ] || falla 'falta el valor de --proyecto'; PROYECTO=$2; shift 2 ;;
    -h|--help) uso; exit 0 ;;
    *) uso >&2; falla "opción desconocida: $1" ;;
  esac
done
if [ -n "$SOBRE_GITLAB" ]; then
  [ -z "$SALIDA" ] || falla '--sobre-gitlab y --salida no se combinan: la salida es el clon de GitLab'
  [ -z "$REMOTO" ] || falla 'con --sobre-gitlab se usa el remoto "gitlab" del clon; no indique --remoto'
  [ -d "$SOBRE_GITLAB" ] || falla "no existe la carpeta del clon: $SOBRE_GITLAB"
  SALIDA=$(CDPATH='' cd -- "$SOBRE_GITLAB" && pwd)
  case "$PROYECTO" in *[!0-9]*) falla "--proyecto debe ser numérico: $PROYECTO" ;; esac
else
  [ "$SUBIR" -eq 0 ] || [ -n "$REMOTO" ] || falla '--subir requiere --remoto URL (la dirección del proyecto en el GitLab del evento)'
fi

# ------------------------------------------------------------------ entorno

entrega_entorno
[ -f "$ETAPAS" ] || falla "no existe $ETAPAS"
for M in JAVIER ENGGEL; do
  eval "VALOR=\${AUTOR_$M}"
  if [ -z "$VALOR" ] && grep -Eq "^[[:space:]]*autor[[:space:]]+AUTOR_$M[[:space:]]*\$" "$ETAPAS"; then
    falla "hay etapas con autor AUTOR_$M: indique la identidad con --autor-$(printf '%s' "$M" | tr 'A-Z' 'a-z') \"Nombre Apellido <correo>\""
  fi
  CORREO_M=$(printf '%s\n' "$VALOR" | sed -n 's/.*<\(.*\)>.*/\1/p')
  NOMBRE_M=$(printf '%s\n' "$VALOR" | sed -n 's/^\(.*[^ ]\) *<.*$/\1/p')
  [ -z "$VALOR" ] || entrega_identidad_valida "$NOMBRE_M" "$CORREO_M" \
    || falla "--autor-$(printf '%s' "$M" | tr 'A-Z' 'a-z') no es una identidad válida para la entrega: $VALOR (use un correo real)"
done
entrega_permitidos
[ -n "$SALIDA" ] || SALIDA="$RAIZ/../entrega-gitlab"
SALIDA=$(entrega_absoluta "$SALIDA")
entrega_validar_salida "$SALIDA"
entrega_autor_repositorio
COMMIT=$(entrega_commit "$REF") || exit 1
COMMIT_CORTO=$(git -C "$RAIZ" rev-parse --short "$COMMIT")
entrega_temporales subir-por-etapas

printf 'Subida progresiva por etapas\n'
printf '  Repositorio: %s\n' "$RAIZ"
printf '  Referencia:  %s (%s)\n' "$REF" "$COMMIT_CORTO"
printf '  Salida:      %s\n' "$SALIDA"
printf '  Ejecuta:     %s <%s> (confirma los commits; el autor es el de cada etapa)\n' "$AUTOR_NOMBRE" "$AUTOR_CORREO"
if [ "$SUBIR" -eq 1 ]; then
  printf '  Modo:        --subir: se pedirá SI antes de cada push a %s\n' "$REMOTO"
else
  printf '  Modo:        solo preparar (sin --subir no se ejecuta ningún push)\n'
fi
if [ "$REF" = HEAD ] && [ -n "$(git -C "$RAIZ" status --porcelain --untracked-files=no)" ]; then
  printf '  AVISO: hay cambios sin commit en el repositorio; solo se incluye lo confirmado en %s.\n' "$COMMIT_CORTO"
fi

# ------------------------------------------------------------------ 1. copia limpia completa

titulo '1. Copia limpia completa (exportar, excluir, ajustar, verificar y probar)'
LIMPIA="$TMP/limpia"
mkdir -p "$LIMPIA"
entrega_copia_limpia "$COMMIT" "$LIMPIA"
printf '  %s archivos en la copia limpia (%s excluidos)\n' \
  "$(find "$LIMPIA" -type f | wc -l | tr -d ' ')" "$(wc -l < "$LIMPIA.excluidos" | tr -d ' ')"
grep -E 'AVISO|CORREGIDO' "$LIMPIA.registro" || true
entrega_verificar "$LIMPIA" || falla 'la copia limpia no pasa las verificaciones; corrija el repositorio de trabajo'
entrega_probar "$LIMPIA" "$TMP/pruebas" > "$TMP/pruebas-limpia.log" \
  || { cat "$TMP/pruebas-limpia.log"; falla "$FALLOS_PRUEBAS comprobación(es) de pruebas fallaron sobre la copia limpia"; }
cat "$TMP/pruebas-limpia.log"
RESUMEN_PRUEBAS="copia limpia completa (PRUEBAS=$PRUEBAS) en verde: $(entrega_resumen_pruebas "$TMP/pruebas-limpia.log")"

# ------------------------------------------------------------------ 2. plan de etapas

titulo '2. Plan de etapas (scripts/etapas-entrega.txt)'
PLAN="$TMP/plan"
mkdir -p "$PLAN"
set --
[ -z "$AUTOR_JAVIER" ] || set -- "$@" --autor-javier "$AUTOR_JAVIER"
[ -z "$AUTOR_ENGGEL" ] || set -- "$@" --autor-enggel "$AUTOR_ENGGEL"
node "$HERRAMIENTAS" etapas "$LIMPIA" "$ETAPAS" "$EXCLUSIONES" "$PLAN" "$@" || falla 'el plan de etapas no es válido'
N_ETAPAS=$(wc -l < "$PLAN/plan.tsv" | tr -d ' ')

# ------------------------------------------------------------------ 3. repositorio y commits

TAB=$(printf '\t')
if [ -n "$SOBRE_GITLAB" ]; then
  titulo "3. Clon de GitLab ($SALIDA): $N_ETAPAS commits por etapas encima de $BASE_REF"
  [ "$(git -C "$SALIDA" rev-parse --show-toplevel 2>/dev/null)" = "$SALIDA" ] || falla "$SALIDA no es la raíz de un repositorio git"
  [ "$SALIDA" != "$RAIZ" ] || falla '--sobre-gitlab debe ser el clon de GitLab, no el repositorio de trabajo'
  URL_GITLAB=$(git -C "$SALIDA" remote get-url gitlab 2>/dev/null) || falla 'el clon no tiene el remoto "gitlab"'
  case "$URL_GITLAB" in *://*@*) falla 'el remoto "gitlab" lleva credenciales en la URL; quítelas (git remote set-url gitlab <URL limpia>)' ;; esac
  [ -z "$(git -C "$SALIDA" status --porcelain --ignored)" ] || falla "el clon tiene cambios o archivos sin versionar (¿una preparación anterior que falló?); revíselos y déjelo limpio: git -C \"$SALIDA\" status --ignored"
  BASE=$(git -C "$SALIDA" rev-parse --verify --quiet "$BASE_REF^{commit}") || falla "no existe $BASE_REF en el clon (git -C \"$SALIDA\" fetch gitlab)"
  for R in $(cut -f3 "$PLAN/plan.tsv" | sort -u); do
    if git -C "$SALIDA" rev-parse --verify --quiet "refs/remotes/gitlab/$R" >/dev/null; then
      git -C "$SALIDA" merge-base --is-ancestor "gitlab/$R" "$BASE" \
        || falla "gitlab/$R tiene commits que la base $BASE_REF no contiene: el push no sería de avance rápido. Fusione antes desarrollo y $R o use --base gitlab/$R"
    else
      printf '  AVISO  la rama %s no existe aún en GitLab: el primer push la creará\n' "$R"
    fi
    if git -C "$SALIDA" rev-parse --verify --quiet "refs/heads/$R" >/dev/null \
      && ! git -C "$SALIDA" merge-base --is-ancestor "$R" "$BASE"; then
      [ "$FORZAR" -eq 1 ] || falla "la rama local $R tiene commits que no están en la base (¿preparación anterior?); use --forzar para rehacerla"
    fi
  done
  if git -C "$SALIDA" rev-parse --verify --quiet refs/heads/integracion >/dev/null; then
    [ "$FORZAR" -eq 1 ] || falla 'la rama local integracion ya existe en el clon (use --forzar para rehacerla)'
  fi
  entrega_git "$SALIDA" switch --quiet --force-create integracion "$BASE"
  printf '  Base: %s = %s\n' "$BASE_REF" "$(git -C "$SALIDA" log -1 --format='%h %an: %s' "$BASE")"
else
  titulo "3. Repositorio de la entrega y $N_ETAPAS commits por etapas"
  entrega_preparar_salida "$SALIDA" "$FORZAR"
  git init --quiet --template= -b integracion "$SALIDA"
  git -C "$SALIDA" config user.name "$AUTOR_NOMBRE"
  git -C "$SALIDA" config user.email "$AUTOR_CORREO"
  [ -z "$REMOTO" ] || git -C "$SALIDA" remote add gitlab "$REMOTO"
  BASE=
fi

SUBIDAS=
OMITIDAS=
ORDEN_RAMAS=
exec 3<&0
while IFS="$TAB" read -r N ID RAMA NOMBRE CORREO N_ARCH MENSAJE; do
  printf '\n  -- Etapa %s/%s: %s (%s, rama %s, %s archivos)\n' "$N" "$N_ETAPAS" "$ID" "$NOMBRE" "$RAMA" "$N_ARCH"
  node "$HERRAMIENTAS" copiar "$LIMPIA" "$PLAN/etapa-$N.lista" "$SALIDA" || falla "no se pudieron copiar los archivos de la etapa $ID"
  # El README con los apartados de la plantilla del evento entra en una etapa concreta; antes de ella no se exige.
  OPCION_README=--sin-readme
  [ -f "$SALIDA/README.md" ] && OPCION_README=
  entrega_verificar "$SALIDA" "$OPCION_README" > "$TMP/verificacion.log" \
    || { cat "$TMP/verificacion.log"; falla "la etapa $ID no pasa las verificaciones"; }
  printf '  Verificaciones: OK%s\n' "$([ -n "$OPCION_README" ] && printf ' (README aún no incorporado)' || true)"
  entrega_git "$SALIDA" add --all --force .
  if entrega_git "$SALIDA" diff --cached --quiet; then falla "la etapa $ID no añade cambios"; fi
  # Modelo del evento: además de la copia completa, se prueba el árbol de ESTA etapa (base + etapas hasta
  # aquí), sobre una copia; el resultado va en el cuerpo del commit.
  RESUMEN_ETAPA=$RESUMEN_PRUEBAS
  if [ -n "$SOBRE_GITLAB" ]; then
    entrega_probar "$SALIDA" "$TMP/pruebas-etapa" > "$TMP/pruebas-etapa.log" \
      || { cat "$TMP/pruebas-etapa.log"; falla "las pruebas del árbol de la etapa $ID fallan"; }
    sed 's/^/  /' "$TMP/pruebas-etapa.log"
    RESUMEN_ETAPA="árbol de la etapa (base + etapas 1-$N, PRUEBAS=$PRUEBAS) en verde: $(entrega_resumen_pruebas "$TMP/pruebas-etapa.log")"
  fi
  # Commit detallado: título y cuerpo de etapas-entrega.txt, pruebas ejecutadas y «Refs/Closes #n».
  # En el modelo del evento confirma la propia persona de la etapa (es quien sube su rama).
  if [ -n "$SOBRE_GITLAB" ]; then CONFIRMA_NOMBRE=$NOMBRE; CONFIRMA_CORREO=$CORREO; fi
  entrega_confirmar_commit "$SALIDA" "$(entrega_mensaje_etapa "$PLAN/etapa-$N.mensaje" "$RESUMEN_ETAPA" "$PLAN/etapa-$N.issues")" "$NOMBRE" "$CORREO"
  CONFIRMA_NOMBRE=; CONFIRMA_CORREO=
  entrega_git "$SALIDA" branch --force "$RAMA" HEAD
  # Orden en que cada rama recibió su último commit (para preparar avance).
  ORDEN_RAMAS="$(printf '%s\n' $ORDEN_RAMAS | grep -vx "$RAMA" || true) $RAMA"
  printf '  Commit: %s  ->  rama %s\n' "$(git -C "$SALIDA" log -1 --format='%h  %an <%ae>  %s' HEAD)" "$RAMA"
  if [ "$SUBIR" -eq 1 ]; then
    # La respuesta se lee del descriptor 3 (entrada estándar original): la del bucle es el plan.
    entrega_subir_rama "$SALIDA" "$RAMA" <&3 \
      || falla "falló git push gitlab $RAMA; revise el remoto (no se fuerza nunca)"
  else
    printf '  Se subiría con: git push gitlab %s   (solo con --subir)\n' "$RAMA"
  fi
done < "$PLAN/plan.tsv"

# ------------------------------------------------------------------ 4. comprobaciones

titulo '4. Comprobaciones del repositorio'
N_COMMITS=$(git -C "$SALIDA" rev-list --count ${BASE:+"$BASE"..}integracion)
[ "$N_COMMITS" -eq "$N_ETAPAS" ] || falla "se esperaban $N_ETAPAS commits y hay $N_COMMITS"
entrega_historial_valido "$SALIDA" ${BASE:+"$BASE"..}integracion || falla 'algún commit contiene autoría o texto no permitido'
[ -z "$(git -C "$SALIDA" status --porcelain)" ] || falla 'el repositorio de la entrega quedó con cambios sin confirmar'
# Árbol final esperado: la base (si la hay) + todos los archivos de la copia limpia salvo los de etapas en
# espera. Se compara como árbol git (contenido y permisos).
ESPERADO="$TMP/esperado"; mkdir -p "$ESPERADO"
[ -z "$BASE" ] || git -C "$SALIDA" archive --format=tar "$BASE" | tar -x -f - -C "$ESPERADO"
(cd "$LIMPIA" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) > "$TMP/todos.lista"
LC_ALL=C sort "$PLAN/espera.lista" | grep . > "$TMP/espera.lista" || true
LC_ALL=C comm -23 "$TMP/todos.lista" "$TMP/espera.lista" > "$TMP/subidos.lista"
node "$HERRAMIENTAS" copiar "$LIMPIA" "$TMP/subidos.lista" "$ESPERADO" || falla 'no se pudo preparar el árbol esperado'
DIR_GIT=$(git -C "$SALIDA" rev-parse --absolute-git-dir)
ARBOL_ESPERADO=$(GIT_INDEX_FILE="$TMP/indice" git --git-dir="$DIR_GIT" --work-tree="$ESPERADO" -C "$ESPERADO" add --all --force . \
  && GIT_INDEX_FILE="$TMP/indice" git --git-dir="$DIR_GIT" write-tree)
[ "$ARBOL_ESPERADO" = "$(git -C "$SALIDA" rev-parse 'integracion^{tree}')" ] \
  || falla 'el árbol final no coincide con el esperado (base + copia limpia sin las etapas en espera)'
printf '  OK     %s commits; árbol final = %scopia limpia%s (%s archivos)\n' "$N_COMMITS" \
  "$([ -n "$BASE" ] && printf 'base + ' || true)" \
  "$([ -s "$TMP/espera.lista" ] && printf ' sin %s archivo(s) en espera' "$(wc -l < "$TMP/espera.lista" | tr -d ' ')" || true)" \
  "$(git -C "$SALIDA" ls-files | wc -l | tr -d ' ')"
if [ -s "$PLAN/espera.tsv" ]; then
  printf '  Etapas en espera (no se suben todavía):\n'
  while IFS="$TAB" read -r EID ERAMA EAUTOR EN EMENSAJE; do
    printf '    - %s (rama %s, %s, %s archivo(s)): %s\n' "$EID" "$ERAMA" "$EAUTOR" "$EN" "$EMENSAJE"
  done < "$PLAN/espera.tsv"
fi

if [ -n "$SOBRE_GITLAB" ]; then
  titulo 'Historial preparado sobre GitLab'
  git -C "$SALIDA" log --reverse --format='  %h  %<(18,trunc)%an  %s' "$BASE..integracion"
  printf '\n  Ramas locales: %s\n' "$(for R in $ORDEN_RAMAS; do printf '%s=%s ' "$R" "$(git -C "$SALIDA" rev-parse --short "$R")"; done)"
  titulo 'Siguientes pasos (NO se ha ejecutado nada de esto)'
  printf '\n  Cada persona sube SU etapa con su cuenta (avance rápido, nunca --force), UNA A UNA y en este orden.\n'
  printf '  Antes de subir una etapa de otra persona, el Merge Request de la anterior debe estar fusionado en\n'
  printf '  desarrollo; si no, ese Merge Request arrastraría también los commits del compañero.\n'
  K=0
  for C in $(git -C "$SALIDA" rev-list --reverse "$BASE..integracion"); do
    K=$((K + 1))
    R=$(sed -n "${K}p" "$PLAN/plan.tsv" | cut -f3)
    printf '    %s. %-18s git -C "%s" push gitlab %s:refs/heads/%s\n' "$K" "$(git -C "$SALIDA" log -1 --format=%an "$C")" "$SALIDA" "$(git -C "$SALIDA" rev-parse --short=12 "$C")" "$R"
  done
  printf '\n  Merge Request de cada rama hacia desarrollo, con remove_source_branch=false (el proyecto borra la\n'
  printf '  rama de origen al fusionar si no se indica) y sin squash. El merge lo hacen los organizadores.\n'
  for R in $ORDEN_RAMAS; do
    cat <<FIN
    curl --fail-with-body -sS -X POST "$(printf '%s' "$URL_GITLAB" | sed -E 's#^(https?://[^/]+)/.*#\1#')/api/v4/projects/${PROYECTO:-<id>}/merge_requests" \\
      -H "PRIVATE-TOKEN: \$GITLAB_TOKEN" \\
      --data-urlencode "source_branch=$R" --data-urlencode "target_branch=desarrollo" \\
      --data-urlencode "title=<Etapa ... de $R>" --data-urlencode "description=<cuerpo y Closes #n>" \\
      --data-urlencode "remove_source_branch=false" --data-urlencode "squash=false"
FIN
  done
  printf '\n  La rama local "integracion" es solo de trabajo: no la suba.\n'
  exit 0
fi

# ------------------------------------------------------------------ 5. avance

titulo '5. Rama avance (merge de las ramas de trabajo)'
set -- $ORDEN_RAMAS
PRIMERA=$1
entrega_git "$SALIDA" branch avance "$PRIMERA"
if [ $# -gt 1 ]; then
  shift
  entrega_git "$SALIDA" switch --quiet avance
  for OTRA in "$@"; do
    GIT_AUTHOR_NAME=$AUTOR_NOMBRE GIT_AUTHOR_EMAIL=$AUTOR_CORREO \
    GIT_COMMITTER_NAME=$AUTOR_NOMBRE GIT_COMMITTER_EMAIL=$AUTOR_CORREO \
      entrega_git "$SALIDA" merge --quiet --no-ff --no-edit \
        -m "Cierre del día: integrar la rama $OTRA en avance" "$OTRA"
  done
  entrega_git "$SALIDA" switch --quiet integracion
fi
entrega_git "$SALIDA" diff --quiet avance integracion -- || falla 'avance no contiene todo lo de las ramas de trabajo'
for R in $ORDEN_RAMAS; do
  git -C "$SALIDA" merge-base --is-ancestor "$R" avance || falla "avance no contiene la rama $R"
done
printf '  OK     avance = %s (contiene %s; mismo árbol que la copia limpia)\n' \
  "$(git -C "$SALIDA" log -1 --format='%h %s' avance)" "$(echo $ORDEN_RAMAS | sed 's/ / y /g')"
entrega_guardar_estado "$SALIDA" "$COMMIT"
printf '  Estado para sincronizar-gitlab.sh: ultimo=%s (en %s)\n' "$COMMIT_CORTO" "$(entrega_archivo_estado "$SALIDA")"

# ------------------------------------------------------------------ resumen e instrucciones

titulo 'Historial preparado'
git -C "$SALIDA" log --reverse --format='  %h  %<(16,trunc)%an  %s' integracion
printf '\n  Ramas: %s\n' "$(git -C "$SALIDA" for-each-ref --format='%(refname:short)=%(objectname:short)' refs/heads | tr '\n' ' ')"

if [ "$SUBIR" -eq 1 ]; then
  printf '  Subidas: %s\n' "${SUBIDAS:-ninguna}"
  [ -z "$OMITIDAS" ] || printf '  Omitidas (no se subieron): %s\n' "$OMITIDAS"
fi

titulo 'Siguientes pasos (NO se ha ejecutado nada de esto)'
if [ "$SUBIR" -eq 0 ]; then
  cat <<FIN

  Para subir las etapas de una en una, repita con --subir y la URL del proyecto:
    sh scripts/subir-por-etapas.sh --autor-javier "<Nombre> <correo>" --autor-enggel "<Nombre> <correo>" \\
       --forzar --subir --remoto <URL>
  o, en esta carpeta, empuje cada rama tras revisar el historial:
    cd "$SALIDA"
    git remote add gitlab <URL>
FIN
  for R in $ORDEN_RAMAS; do printf '    git push gitlab %s\n' "$R"; done
fi
cat <<FIN

  Cierre del día (Merge Request diario hacia avance), en la web de GitLab:
    1. Si la rama avance no existe aún en GitLab, créela desde el primer commit:
         git -C "$SALIDA" push gitlab $(git -C "$SALIDA" rev-list --max-parents=0 integracion | cut -c1-12):refs/heads/avance
    2. Code > Merge requests > New merge request.
FIN
for R in $ORDEN_RAMAS; do
  printf '         Origen: %s  ->  Destino: avance   (título: "Cierre del día: rama %s")\n' "$R" "$R"
done
cat <<FIN
       Como las ramas comparten historia, basta el Merge Request de la rama más adelantada
       (la última de la lista); los de las otras quedarán sin cambios y se pueden cerrar.
    3. Revise que el diff coincide con lo preparado aquí (la rama local avance muestra el resultado)
       y haga el merge. No marque "Squash commits": se perdería el historial por etapas.
  La rama local "integracion" es solo de trabajo: no la suba.
  Días siguientes: sh scripts/sincronizar-gitlab.sh --entrega "$SALIDA" --hasta <rama de GitHub>
FIN
