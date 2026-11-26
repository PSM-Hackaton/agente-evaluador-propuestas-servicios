#!/bin/sh
# Prueba del gancho commit-msg: casos que debe aceptar y rechazar. Uso: sh scripts/hooks/probar-commit-msg.sh
set -u
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FALLOS=0; N=0

caso() { # $1 = acepta|rechaza, $2 = descripción, $3 = mensaje
  N=$((N + 1))
  printf '%s\n' "$3" > "$TMP/msg"
  if sh "$DIR/commit-msg" "$TMP/msg" 2>/dev/null; then r=acepta; else r=rechaza; fi
  if [ "$r" = "$1" ]; then printf 'ok   %s\n' "$2"; else printf 'FALLA %s (esperado: %s, obtenido: %s)\n' "$2" "$1" "$r"; FALLOS=$((FALLOS + 1)); fi
}

caso acepta 'título con formato y cuerpo de 2 líneas' 'feat(lote): repositorio de GitLab en salida.json (#21)

Qué: salida_json.py normaliza la ruta grupo/proyecto de GitLab.
Verificación: pytest 51/51 y ruff limpio en el backend.'
caso acepta 'sin ámbito, cuerpo de 4 líneas y comentarios de git' 'docs: README con la plantilla del evento (#30)

Qué: títulos exactos de la plantilla del evento en README.md.
Por qué: instructivo de GitLab del evento, apartados del README.
Verificación: verificador de la entrega en verde sobre la copia.
Riesgos: ninguno, solo documentación del repositorio.
# Por favor ingresa el mensaje del commit'
caso acepta 'merge generado por git' "Merge branch 'staging' into enggel"
caso acepta 'fixup de rebase' 'fixup! feat(lote): repositorio de GitLab'
caso rechaza 'solo título' 'fix(backend): resolver issues #5, #21 y #22 de revisión'
caso rechaza 'cuerpo de una sola línea' 'fix(api): validar la propuesta adjudicada (#3)

Valida que la propuesta pertenezca al proyecto.'
caso rechaza 'cuerpo con líneas demasiado cortas' 'fix(api): validar la propuesta adjudicada (#3)

ok
listo'
caso rechaza 'sin línea en blanco tras el título' 'fix(api): validar la propuesta adjudicada (#3)
Valida que la propuesta pertenezca al proyecto.
Pruebas: pytest en verde en el backend completo.'
caso rechaza 'título sin tipo(ámbito)' 'Arreglos varios del backend y del lote

Qué: se corrigen varios detalles del backend y del lote.
Verificación: pytest en verde en el backend completo.'
caso rechaza 'título demasiado corto' 'fix: x

Qué: se corrigen varios detalles del backend y del lote.
Verificación: pytest en verde en el backend completo.'
caso rechaza 'línea de coautoría' "feat(lote): repositorio de GitLab (#21)

Qué: salida_json.py normaliza la ruta grupo/proyecto de GitLab.
Verificación: pytest 51/51 y ruff limpio en el backend.
Co-$(printf 'Authored')-By: Alguien <a@b.c>"

printf '\n%s casos, %s fallos\n' "$N" "$FALLOS"
[ "$FALLOS" -eq 0 ]
