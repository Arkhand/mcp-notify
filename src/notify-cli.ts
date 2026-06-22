#!/usr/bin/env node
/**
 * CLI de notificación pensada para los HOOKS de Claude Code.
 *
 * Uso:
 *   node dist/notify-cli.js stop           -> "Claude terminó"
 *   node dist/notify-cli.js notification   -> "Claude necesita tu atención"
 *   node dist/notify-cli.js "texto libre"  -> envía ese texto tal cual
 *
 * Lee el JSON del hook por stdin (si lo hay) para enriquecer el contexto.
 * Usa el proveedor activo configurado en el .env (Telegram o WhatsApp).
 */
import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";

interface HookInput {
  message?: string;
  cwd?: string;
  hook_event_name?: string;
}

function safeParse(raw: string): HookInput | null {
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return null;
  }
}

async function readStdinJson(): Promise<HookInput | null> {
  if (process.stdin.isTTY) return null;
  return await new Promise<HookInput | null>((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(safeParse(data)), 800);
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(safeParse(data));
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? "").trim();
  const event = arg.toLowerCase();
  const hook = await readStdinJson();
  const where = hook?.cwd ? ` (${hook.cwd})` : "";

  let message: string;
  let context: string | undefined;

  if (event === "notification") {
    message = "🔔 Claude necesita tu atención";
    context = (hook?.message?.trim() || "Esperando tu respuesta o un permiso.") + where;
  } else if (event === "stop") {
    message = "✅ Claude terminó y quedó a la espera";
    context = `La tarea actual finalizó (sesión IDLE).${where}`;
  } else {
    message = arg || "Aviso de Claude";
    context = where || undefined;
  }

  const config = loadConfig();
  if (!config) {
    process.stderr.write("[notify-cli] No hay configuración válida (.env). Ejecuta `npm run setup`.\n");
    process.exit(1);
  }

  const provider = createProvider(config);
  try {
    await provider.init();
    await provider.send(message, context);
  } catch (err) {
    process.stderr.write(
      `[notify-cli] Error al enviar por ${provider.name}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exitCode = 1;
  } finally {
    await provider.shutdown();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[notify-cli] Error fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
