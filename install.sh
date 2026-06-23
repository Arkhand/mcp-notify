#!/usr/bin/env bash
# mcp-notify installer
# Uso: bash <(curl -fsSL https://raw.githubusercontent.com/Arkhand/mcp-notify/main/install.sh)
set -euo pipefail

REPO_URL="https://github.com/Arkhand/mcp-notify.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/tools/mcp-notify}"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1;34m'; N='\033[0m'

echo -e "${B}"
echo "╔══════════════════════════════╗"
echo "║    mcp-notify  installer     ║"
echo "╚══════════════════════════════╝"
echo -e "${N}"

# ── 1. Node >= 18 ──────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${R}✗ Node.js no encontrado. Instalá Node >= 18 primero.${N}"; exit 1
fi
NODE_MAJOR=$(node -e "console.log(parseInt(process.version.slice(1)))")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo -e "${R}✗ Necesitás Node.js >= 18. Actual: $(node -v)${N}"; exit 1
fi
echo -e "${G}✓ Node.js $(node -v)${N}"

# ── 2. Detectar proveedores disponibles ───────────────────────────────────────
echo "🔍 Detectando proveedores disponibles..."

HAS_TELEGRAM=false
HAS_WHATSAPP=false

# Telegram: chequear acceso a la API
if curl -s --connect-timeout 5 --max-time 8 "https://api.telegram.org/" -o /dev/null 2>/dev/null; then
  HAS_TELEGRAM=true
  echo -e "   ${G}✓ Telegram${N}  (api.telegram.org accesible)"
else
  echo -e "   ${Y}✗ Telegram${N}  (no se puede llegar a api.telegram.org)"
fi

# WhatsApp: chequear Chrome/Chromium
CHROME_PATH=""
for bin in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$bin" &>/dev/null; then
    CHROME_PATH=$(command -v "$bin")
    break
  fi
done
# También buscar en rutas comunes (macOS, snap, etc.)
if [[ -z "$CHROME_PATH" ]]; then
  for path in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/usr/bin/chromium-browser" \
    "/snap/bin/chromium"; do
    if [[ -x "$path" ]]; then
      CHROME_PATH="$path"
      break
    fi
  done
fi

if [[ -n "$CHROME_PATH" ]]; then
  HAS_WHATSAPP=true
  echo -e "   ${G}✓ WhatsApp${N}  (Chrome encontrado: $CHROME_PATH)"
else
  echo -e "   ${Y}✗ WhatsApp${N}  (Chrome/Chromium no encontrado)"
fi

# Validar que haya al menos uno
if [[ "$HAS_TELEGRAM" == "false" && "$HAS_WHATSAPP" == "false" ]]; then
  echo ""
  echo -e "${R}✗ No hay ningún proveedor disponible:${N}"
  echo "  - Telegram requiere acceso a api.telegram.org (HTTPS saliente)"
  echo "  - WhatsApp requiere Chrome o Chromium instalado"
  exit 1
fi

# ── 3. Elegir proveedor ───────────────────────────────────────────────────────
echo ""
PROVIDER=""
if [[ "$HAS_TELEGRAM" == "true" && "$HAS_WHATSAPP" == "true" ]]; then
  echo -e "${B}Ambos proveedores están disponibles. ¿Cuál querés usar?${N}"
  echo "  1) Telegram  (recomendado — más estable, sin QR)"
  echo "  2) WhatsApp  (requiere escanear QR la primera vez)"
  echo ""
  read -r -p "Elegí [1/2]: " choice
  case "$choice" in
    2) PROVIDER="whatsapp" ;;
    *) PROVIDER="telegram" ;;
  esac
elif [[ "$HAS_TELEGRAM" == "true" ]]; then
  PROVIDER="telegram"
  echo -e "Usando ${G}Telegram${N} (único proveedor disponible)."
else
  PROVIDER="whatsapp"
  echo -e "Usando ${G}WhatsApp${N} (único proveedor disponible)."
fi

# ── 4. Clonar o actualizar ─────────────────────────────────────────────────────
echo ""
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo -e "${Y}↑  Actualizando instalación existente en $INSTALL_DIR ...${N}"
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "⬇  Clonando en $INSTALL_DIR ..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── 5. Dependencias ────────────────────────────────────────────────────────────
echo "📦 Instalando dependencias..."
if [[ "$PROVIDER" == "telegram" ]]; then
  PUPPETEER_SKIP_DOWNLOAD=true npm install --silent
else
  npm install --silent
fi
echo -e "${G}✓ Dependencias OK${N}"

# ── 6. Build ───────────────────────────────────────────────────────────────────
echo "🔨 Compilando TypeScript..."
npm run build --silent
echo -e "${G}✓ Build OK${N}"

# ── 7. Configurar .env ────────────────────────────────────────────────────────
echo ""
SKIP_ENV=false
if [[ -f ".env" ]]; then
  echo -e "${Y}⚠  .env ya existe.${N}"
  read -r -p "   ¿Reemplazarlo con nueva configuración? [y/N] " replace_env
  [[ "${replace_env,,}" != "y" ]] && SKIP_ENV=true && echo "   Manteniendo .env existente."
fi

if [[ "$SKIP_ENV" == "false" ]]; then
  if [[ "$PROVIDER" == "telegram" ]]; then
    echo -e "${B}── Configuración de Telegram ──────────────────────${N}"
    echo ""
    echo "   1) TOKEN del bot: lo da @BotFather al crear el bot."
    echo "      Formato: 123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    echo ""
    read -r -p "   Token del bot: " BOT_TOKEN

    echo ""
    echo "   2) CHAT ID: es tu ID numérico personal (no el nombre del bot)."
    echo "      Para obtenerlo: mandá cualquier mensaje a tu bot y abrí en el"
    echo "      navegador → https://api.telegram.org/bot<TOKEN>/getUpdates"
    echo "      Buscá: \"chat\":{\"id\":<NÚMERO>}  ← ese número es el Chat ID"
    echo ""
    CHAT_ID=""
    while [[ ! "$CHAT_ID" =~ ^-?[0-9]+$ ]]; do
      read -r -p "   Chat ID (número): " CHAT_ID
      if [[ ! "$CHAT_ID" =~ ^-?[0-9]+$ ]]; then
        echo -e "   ${R}✗ El Chat ID debe ser un número (ej: 7052630840). Intentá de nuevo.${N}"
      fi
    done
    cat > .env <<EOF
NOTIFICATION_PROVIDER=telegram
TELEGRAM_BOT_TOKEN=${BOT_TOKEN}
TELEGRAM_CHAT_ID=${CHAT_ID}
EOF
  else
    echo -e "${B}── Configuración de WhatsApp ───────────────────────${N}"
    echo "   Necesitás el número de teléfono destino (formato internacional, sin +)."
    echo "   Ejemplo: para +54 11 6450 9135 → 5491164509135"
    echo ""
    read -r -p "   Número destino (sin +): " WA_NUMBER
    ENV_EXTRA=""
    if [[ -n "$CHROME_PATH" ]]; then
      ENV_EXTRA="PUPPETEER_EXECUTABLE_PATH=${CHROME_PATH}"
    fi
    cat > .env <<EOF
NOTIFICATION_PROVIDER=whatsapp
WHATSAPP_TARGET_NUMBER=${WA_NUMBER}
${ENV_EXTRA}
EOF
  fi
  echo -e "${G}✓ .env creado${N}"
fi

# ── 8. Test de conexión ───────────────────────────────────────────────────────
echo ""
if [[ "$PROVIDER" == "telegram" ]]; then
  echo "📡 Probando conexión con Telegram..."
  TEST_OUT=$(printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notify_question","arguments":{"message":"✅ mcp-notify instalado y funcionando"}}}' \
    | node dist/index.js 2>/dev/null | grep '"id":2' || true)

  if echo "$TEST_OUT" | grep -q '"isError":true'; then
    echo -e "${R}✗ Error al enviar. Verificá el token y Chat ID en .env${N}"
    exit 1
  elif [[ -n "$TEST_OUT" ]]; then
    echo -e "${G}✓ Mensaje enviado — revisá Telegram${N}"
  else
    echo -e "${Y}?  Sin respuesta clara — verificá .env a mano${N}"
  fi
else
  echo -e "${Y}WhatsApp: el QR se muestra la primera vez que iniciás el servidor.${N}"
  echo "   Ejecutá esto en una terminal para vincularlo:"
  echo ""
  echo "     cd $INSTALL_DIR && npm run setup"
  echo ""
  echo "   Luego escaneá el QR con WhatsApp → Dispositivos vinculados."
fi

# ── 9. Registrar en Claude Code ───────────────────────────────────────────────
echo ""
if command -v claude &>/dev/null; then
  echo "🔗 Registrando MCP en Claude Code..."
  claude mcp remove notify -s user 2>/dev/null || true
  claude mcp add notify -s user -- node "$INSTALL_DIR/dist/index.js"
  echo -e "${G}✓ MCP 'notify' registrado (scope: user)${N}"
else
  echo -e "${Y}⚠  claude CLI no encontrado — registrá el MCP manualmente:${N}"
  echo "   claude mcp add notify -s user -- node $INSTALL_DIR/dist/index.js"
fi

# ── 10. Hooks (opcional) ───────────────────────────────────────────────────────
echo ""
echo -e "${B}── Hooks automáticos ──────────────────────────────${N}"
echo "   Los hooks hacen que Claude te avise sin que tengas que pedírselo:"
echo ""
echo "   • Stop         → te notifica cuando Claude termina un turno (quedó"
echo "                    esperando tu respuesta). Útil para saber que ya"
echo "                    podés volver a mirar la terminal."
echo ""
echo "   • Notification → te notifica cuando Claude necesita que respondas"
echo "                    algo para poder seguir (pregunta bloqueante)."
echo ""
echo "   Para silenciar las notificaciones por carpeta/proyecto usá los"
echo "   comandos de Claude Code: /notify-off, /notify-off-1h, /notify-off-2h,"
echo "   /notify-off-4h  y  /notify-on  para reactivar."
echo ""
read -r -p "¿Configurar hooks? [y/N] " setup_hooks
if [[ "${setup_hooks,,}" == "y" ]]; then
  HOOKS_FILE="$HOME/.claude/settings.json"
  mkdir -p "$HOME/.claude"
  [[ ! -f "$HOOKS_FILE" ]] && echo '{}' > "$HOOKS_FILE"

  if command -v jq &>/dev/null; then
    HOOK_STOP='{"matcher":"","hooks":[{"type":"command","command":"node","args":["'"$INSTALL_DIR"'/dist/notify-cli.js","stop"],"async":true,"timeout":20,"statusMessage":"Avisando por Telegram (fin de tarea)…"}]}'
    HOOK_NOTIF='{"matcher":"","hooks":[{"type":"command","command":"node","args":["'"$INSTALL_DIR"'/dist/notify-cli.js","notification"],"async":true,"timeout":20,"statusMessage":"Avisando por Telegram (atención requerida)…"}]}'
    jq \
      --argjson stop "$HOOK_STOP" \
      --argjson notif "$HOOK_NOTIF" \
      '.hooks = (.hooks // {}) | .hooks.Stop = (.hooks.Stop // []) + [$stop] | .hooks.Notification = (.hooks.Notification // []) + [$notif]' \
      "$HOOKS_FILE" > "$HOOKS_FILE.tmp" && mv "$HOOKS_FILE.tmp" "$HOOKS_FILE"
    echo -e "${G}✓ Hooks configurados en $HOOKS_FILE${N}"
  else
    echo -e "${Y}jq no encontrado — agregá esto en ~/.claude/settings.json bajo \"hooks\":${N}"
    cat <<HOOKJSON

  "Stop": [{"matcher":"","hooks":[{"type":"command","command":"node","args":["$INSTALL_DIR/dist/notify-cli.js","stop"],"async":true,"timeout":20}]}],
  "Notification": [{"matcher":"","hooks":[{"type":"command","command":"node","args":["$INSTALL_DIR/dist/notify-cli.js","notification"],"async":true,"timeout":20}]}]

HOOKJSON
  fi
fi

# ── Resumen final ──────────────────────────────────────────────────────────────
echo ""
echo -e "${G}══════════════════════════════════════${N}"
echo -e "${G}  ✅  mcp-notify listo para usar      ${N}"
echo -e "${G}══════════════════════════════════════${N}"
echo ""
echo "  Proveedor : $PROVIDER"
echo "  Ubicación : $INSTALL_DIR"
echo "  Tool MCP  : notify_question"
if [[ "$PROVIDER" == "whatsapp" ]]; then
  echo ""
  echo -e "  ${Y}⚠  Recordá vincular WhatsApp ejecutando: npm run setup${N}"
fi
echo ""
echo "  Reiniciá Claude Code para que tome el MCP."
echo ""
