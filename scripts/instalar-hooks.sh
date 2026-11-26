#!/bin/sh
# Activa los ganchos de git del proyecto (scripts/hooks/) en este clon. Una vez por clon:
#   sh scripts/instalar-hooks.sh
# Desactivar: git config --unset core.hooksPath
set -eu
RAIZ=$(git -C "$(dirname -- "$0")" rev-parse --show-toplevel)
chmod +x "$RAIZ/scripts/hooks/pre-commit" "$RAIZ/scripts/hooks/commit-msg" "$RAIZ/scripts/hooks/pre-push"
git -C "$RAIZ" config core.hooksPath scripts/hooks
printf 'Ganchos activados en %s (core.hooksPath=scripts/hooks): pre-commit, commit-msg y pre-push.\n' "$RAIZ"
NOMBRE=$(git -C "$RAIZ" config user.name || true); CORREO=$(git -C "$RAIZ" config user.email || true)
printf 'Identidad de git: %s <%s>\n' "${NOMBRE:-(sin configurar)}" "${CORREO:-(sin configurar)}"
[ -n "$NOMBRE" ] && [ -n "$CORREO" ] || printf 'Configúrela: git config user.name "Nombre Apellido" y git config user.email "correo de GitLab"\n'
