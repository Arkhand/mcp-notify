# mcp-notify

Servidor [MCP](https://modelcontextprotocol.io) que **envía una notificación cuando Claude necesita hacerte una pregunta bloqueante**, para que no tengas que estar mirando la terminal.

Expone un único tool, `notify_question`, y soporta dos proveedores de notificación:

- **WhatsApp** — vía [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js) (con sesión persistente, escaneas el QR una sola vez).
- **Telegram** — vía la [Bot API oficial](https://core.telegram.org/bots/api).

---

## El tool: `notify_question`

| Parámetro | Tipo              | Descripción                                              |
| --------- | ----------------- | -------------------------------------------------------- |
| `message` | `string`          | La pregunta o mensaje a enviar.                          |
| `context` | `string` (opcional) | Contexto breve de en qué estaba trabajando Claude.     |

Si el envío falla, el tool **devuelve el error** (con `isError: true`) en lugar de silenciarlo.

---

## Requisitos

- **Node.js >= 18.17** (usa `fetch` nativo).
- Para WhatsApp, `whatsapp-web.js` descarga Chromium vía Puppeteer en `npm install`.

---

## Instalación

```bash
npm install
npm run build
```

---

## Configuración

La config vive en un archivo `.env` (separado del código). Tienes `.env.example` como plantilla.

Variable                 | Para qué sirve
------------------------ | --------------------------------------------------
`NOTIFICATION_PROVIDER`  | Proveedor activo: `whatsapp` o `telegram`.
`WHATSAPP_TARGET_NUMBER` | Número destino, formato internacional **sin `+`** (ej. `34612345678`).
`TELEGRAM_BOT_TOKEN`     | Token del bot que da @BotFather.
`TELEGRAM_CHAT_ID`       | ID del chat de destino.

### Primera ejecución (asistente interactivo)

Si no existe `.env`, al arrancar **en una terminal** el servidor te pregunta qué proveedor quieres y lo crea por ti:

```bash
npm run setup
```

> ⚠️ El asistente y el QR de WhatsApp **sólo funcionan en una terminal interactiva**. Cuando Claude lanza el servidor lo hace por *stdio* (ese canal está reservado al protocolo), así que **ejecuta `npm run setup` una vez a mano antes** de añadirlo a Claude. Si el servidor arranca sin configuración y sin terminal, devuelve un error claro pidiéndote que lo hagas.

---

## Proveedor: WhatsApp

1. En `.env`: `NOTIFICATION_PROVIDER=whatsapp` y `WHATSAPP_TARGET_NUMBER=<tu número>`.
2. Ejecuta `npm run setup` (o `npm run dev`). La **primera vez** aparece un **QR en la terminal**.
3. En tu móvil: **WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo** y escanea el QR.
4. La sesión queda guardada en `.wwebjs_auth/` (gitignored). En los siguientes arranques ya no pide QR.

El número de destino es a quién se le envían las notificaciones (puede ser tu propio número).

---

## Proveedor: Telegram

### 1. Crear el bot con BotFather

1. Abre Telegram y habla con [`@BotFather`](https://t.me/BotFather).
2. Envía `/newbot` y sigue las instrucciones (nombre y *username* terminado en `bot`).
3. BotFather te da un **token** tipo `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` → es tu `TELEGRAM_BOT_TOKEN`.

### 2. Obtener el `TELEGRAM_CHAT_ID`

1. **Abre un chat con tu bot** (búscalo por su username) y envíale cualquier mensaje (ej. `hola`). Esto es necesario: un bot no puede escribirte primero.
2. Abre en el navegador (sustituye `<TOKEN>`):

   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```

3. Busca en la respuesta `"chat":{"id":<NÚMERO>...}`. Ese número es tu `TELEGRAM_CHAT_ID`.
   - Para un chat personal es un entero positivo.
   - Para un grupo suele ser negativo (ej. `-1001234567890`); añade el bot al grupo primero.

### 3. Rellenar `.env`

```env
NOTIFICATION_PROVIDER=telegram
TELEGRAM_BOT_TOKEN=123456789:AAE...
TELEGRAM_CHAT_ID=987654321
```

---

## Scripts

Script           | Acción
---------------- | ------------------------------------------------
`npm run build`  | Compila TypeScript a `dist/`.
`npm run dev`    | Ejecuta en desarrollo con `tsx` (sin compilar).
`npm run start`  | Ejecuta lo compilado (`dist/index.js`).
`npm run setup`  | Asistente de configuración + vinculación inicial.

---

## Añadirlo a Claude

> Primero ejecuta `npm run build` y, una vez, `npm run setup` (escanea el QR si usas WhatsApp).

### Claude Desktop — `claude_desktop_config.json`

Ubicación del archivo:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Añade el servidor bajo `mcpServers` (ajusta la ruta absoluta; en Windows usa **dobles barras invertidas**):

```json
{
  "mcpServers": {
    "notify": {
      "command": "node",
      "args": ["C:\\Users\\musia\\Desktop\\mcp-notify\\dist\\index.js"]
    }
  }
}
```

> El servidor lee su `.env` de la raíz del proyecto, así que no necesitas pasar variables aquí. Si prefieres inyectarlas, puedes añadir un bloque `"env": { "NOTIFICATION_PROVIDER": "telegram", ... }` (tienen prioridad sobre el `.env`).

Reinicia Claude Desktop. El tool `notify_question` aparecerá disponible.

### Claude Code (CLI)

```bash
claude mcp add notify -- node "C:\Users\musia\Desktop\mcp-notify\dist\index.js"
```

Comprueba con `claude mcp list` que aparece `notify`.

---

## Cómo lo usa Claude

Pídele algo como: *"cuando necesites confirmación para seguir, avísame con notify_question"*. Cuando llegue a un punto bloqueante, Claude llamará al tool y recibirás el mensaje en WhatsApp/Telegram.

---

## Avisos automáticos en Claude Code (hooks)

Para que el aviso sea **automático y garantizado** (no dependa de que el modelo llame al tool), Claude Code usa *hooks* en `~/.claude/settings.json` que ejecutan `dist/notify-cli.js`:

- **`Notification`** → `notify-cli.js notification` → avisa cuando Claude espera tu respuesta o un permiso.
- **`Stop`** → `notify-cli.js stop` → avisa cuando Claude termina un turno (queda IDLE). Ojo: dispara al final de **cada** turno.

> Claude Desktop (app de chat) **no** soporta hooks; ahí sólo está disponible el tool `notify_question` vía MCP.

### Silenciar por carpeta (activo por defecto)

Las notificaciones vienen **activas por defecto**. Para silenciarlas en una carpeta/proyecto concreto hay tres slash commands de usuario (`~/.claude/commands/`):

| Comando | Acción |
| ------- | ------ |
| `/notify-off`     | Silencia la carpeta actual **sin límite** |
| `/notify-off-1h`  | Silencia la carpeta actual **1 hora** (se reactiva sola) |
| `/notify-off-2h`  | Silencia la carpeta actual **2 horas** (se reactiva sola) |
| `/notify-off-4h`  | Silencia la carpeta actual **4 horas** (se reactiva sola) |
| `/notify-on`      | Reactiva la carpeta actual |
| `/notify-status`  | Muestra el estado y la lista de carpetas silenciadas |

El estado se guarda en `~/.mcp-notify-state.json` (`{ "mutes": [{ "dir", "until" }] }`; `until` = epoch ms o `null` para permanente). Los silencios temporales se auto-reactivan: el hook comprueba la hora en cada disparo, sin temporizadores. `notify-cli.js` también acepta `mute` / `mute-min <min>` / `unmute` / `status [carpeta]` por línea de comandos.

---

## Notas de seguridad

- El `.env` y la sesión de WhatsApp (`.wwebjs_auth/`) **nunca se commitean** (están en `.gitignore`).
- El token de Telegram da control total del bot: trátalo como una contraseña. Si se filtra, revócalo con `/revoke` en BotFather.
