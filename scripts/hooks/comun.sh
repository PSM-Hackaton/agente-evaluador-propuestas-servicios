# Funciones compartidas por los ganchos de git del proyecto (sh POSIX). No se ejecuta: lo cargan
# pre-commit, commit-msg y pre-push. Instalación: sh scripts/instalar-hooks.sh
#
# Los patrones de nombres de herramientas se escriben con clases de caracteres (p. ej. "cl[a]ude") para
# que este archivo no contenga las palabras que él mismo prohíbe. Los proveedores de IA que usa la
# aplicación (Gemini, OpenAI) NO se bloquean: son funcionalidad del producto.

# Herramientas de autoría y líneas de coautoría (mensajes y contenido).
PATRON_HERRAMIENTAS='cl[a]ude|anthr[o]pic|ch[a]tgpt|c[o]pilot|c[o]-authored-by|gen[e]rated with|cur[s]or\.sh'

# Claves de API y tokens reales (contenido añadido).
PATRON_SECRETOS='sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}|tvly-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'

# Archivos que nunca se versionan (rutas del índice).
PATRON_ARCHIVOS='(^|/)\.env$|(^|/)\.env\.[^/]+$|(^|/)[^/]+\.env$|\.(pem|key|crt|p12|pfx|jks|db|db-wal|db-shm|sqlite|sqlite3|enc)$|(^|/)(node_modules|\.venv|venv|__pycache__|dist|certs)(/|$)|^backend/data/|(^|/)\.cl[a]ude/|(^|/)id_(rsa|ecdsa|ed25519)'
PERMITIDOS_ARCHIVOS='(^|/)\.env\.example$'

# Correos que no son de una persona real.
PATRON_CORREO_FALSO='@[^@]*\.(local|localdomain|invalid|example|test)$|@example\.(com|org|net)$|@localhost$|noreply|\[bot\]'

LIMITE_BYTES=5242880   # 5 MB

hook_error() { printf '\n[%s] BLOQUEADO: %s\n' "$NOMBRE_HOOK" "$1" >&2; }
hook_aviso() { printf '[%s] %s\n' "$NOMBRE_HOOK" "$1" >&2; }

# Comprueba la identidad configurada ("nombre" y "correo"): persona real, sin cuentas automáticas.
hook_identidad() {
  if [ -z "$1" ] || [ -z "$2" ]; then
    hook_error 'configure su identidad: git config user.name "Nombre Apellido" y git config user.email "correo"'
    return 1
  fi
  if printf '%s\n' "$2" | grep -Eiq "$PATRON_CORREO_FALSO" || printf '%s %s\n' "$1" "$2" | grep -Eiq "$PATRON_HERRAMIENTAS"; then
    hook_error "la identidad «$1 <$2>» no parece una persona del equipo (use su correo real de GitLab)"
    return 1
  fi
}
