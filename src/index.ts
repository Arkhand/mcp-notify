#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, runInteractiveSetup, type AppConfig } from "./config.js";
import { createProvider, type NotificationProvider } from "./providers/index.js";
import { log } from "./logger.js";
import { isGloballyMuted } from "./global-mute.js";

const SETUP_FLAG = process.argv.includes("--setup");

/**
 * Resuelve la configuración. Si no existe y estamos en una terminal
 * interactiva, lanza el asistente. Si no, falla con un mensaje claro.
 */
async function resolveConfig(): Promise<AppConfig> {
  let config = SETUP_FLAG ? null : loadConfig();

  if (!config) {
    if (stdinIsInteractive()) {
      config = await runInteractiveSetup();
    } else {
      throw new Error(
        "No hay configuración válida y el servidor no se está ejecutando en una terminal " +
          "interactiva.\n" +
          "Ejecuta una vez en tu terminal:  npm run setup\n" +
          "(con WhatsApp, ese primer arranque también muestra el QR para vincular el dispositivo).",
      );
    }
  }
  return config;
}

function stdinIsInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

async function main(): Promise<void> {
  const config = await resolveConfig();
  log(`Proveedor activo: ${config.provider}`);

  const provider: NotificationProvider = createProvider(config);

  // Arrancamos la inicialización en segundo plano. No la esperamos aquí para
  // no retrasar el handshake MCP; `send()` espera internamente a que el
  // proveedor esté listo. Si init falla, el error se propaga en el primer envío.
  provider.init().catch((err: unknown) => {
    log(`Error inicializando el proveedor: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Si se invocó con --setup desde una terminal, basta con haber escrito el
  // .env (y, en WhatsApp, vinculado vía QR). Mantenemos vivo el proceso un
  // momento para que WhatsApp persista la sesión, luego salimos.
  if (SETUP_FLAG && stdinIsInteractive()) {
    log("Setup completado. Inicializando proveedor para validar/persistir sesión…");
    try {
      await provider.init();
      log("Listo. Ya puedes añadir el servidor a tu cliente MCP.");
    } catch (err) {
      log(`La validación del proveedor falló: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    await provider.shutdown();
    return;
  }

  const server = new McpServer({
    name: "mcp-notify",
    version: "0.1.0",
  });

  server.registerTool(
    "notify_question",
    {
      title: "Notificar pregunta bloqueante",
      description:
        "Envía una notificación (WhatsApp o Telegram, según configuración) cuando Claude " +
        "necesita hacer una pregunta que bloquea el avance del trabajo. Úsalo para avisar " +
        "al usuario de que se requiere su intervención.",
      inputSchema: {
        message: z
          .string()
          .min(1)
          .describe("La pregunta o mensaje a enviar al usuario."),
        context: z
          .string()
          .optional()
          .describe("Contexto breve de en qué estaba trabajando Claude (opcional)."),
      },
    },
    async ({ message, context }) => {
      if (isGloballyMuted(Date.now())) {
        return {
          content: [
            { type: "text" as const, text: "Notificaciones silenciadas globalmente; no se envió nada." },
          ],
        };
      }
      try {
        await provider.send(message, context);
        return {
          content: [
            {
              type: "text" as const,
              text: `Notificación enviada por ${provider.name}.`,
            },
          ],
        };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `No se pudo enviar la notificación por ${provider.name}: ${detail}`,
            },
          ],
        };
      }
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    log(`Recibida señal ${signal}, cerrando…`);
    await provider.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Servidor MCP conectado por stdio. Esperando peticiones…");
}

main().catch((err: unknown) => {
  log(`Error fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
