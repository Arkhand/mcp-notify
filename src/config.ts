import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";
import { log } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Ruta del .env en la raíz del proyecto (dist/.. -> raíz, src/.. -> raíz). */
export const ENV_PATH = join(__dirname, "..", ".env");

export type Provider = "whatsapp" | "telegram";

export interface AppConfig {
  provider: Provider;
  whatsapp: { targetNumber: string };
  telegram: { botToken: string; chatId: string };
}

/**
 * Carga la configuración desde variables de entorno (incluyendo .env si
 * existe). Devuelve `null` si no hay un proveedor configurado o si la
 * configuración del proveedor activo está incompleta.
 */
export function loadConfig(): AppConfig | null {
  // No sobrescribe variables ya presentes en el entorno (p. ej. las que
  // inyecta claude_desktop_config.json), sólo rellena las que falten.
  dotenv.config({ path: ENV_PATH });

  const provider = process.env.NOTIFICATION_PROVIDER?.trim().toLowerCase();
  if (provider !== "whatsapp" && provider !== "telegram") {
    return null;
  }

  const config: AppConfig = {
    provider,
    whatsapp: { targetNumber: process.env.WHATSAPP_TARGET_NUMBER?.trim() ?? "" },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
      chatId: process.env.TELEGRAM_CHAT_ID?.trim() ?? "",
    },
  };

  const problems = validateConfig(config);
  if (problems.length > 0) {
    log(`Configuración incompleta para "${provider}": ${problems.join("; ")}`);
    return null;
  }

  return config;
}

/** Devuelve una lista de problemas; vacía si la config es válida. */
export function validateConfig(config: AppConfig): string[] {
  const problems: string[] = [];
  if (config.provider === "whatsapp") {
    if (!config.whatsapp.targetNumber) {
      problems.push("falta WHATSAPP_TARGET_NUMBER");
    } else if (!/^\d{6,15}$/.test(config.whatsapp.targetNumber.replace(/\D/g, ""))) {
      problems.push("WHATSAPP_TARGET_NUMBER no parece un número internacional válido");
    }
  } else {
    if (!config.telegram.botToken) problems.push("falta TELEGRAM_BOT_TOKEN");
    if (!config.telegram.chatId) problems.push("falta TELEGRAM_CHAT_ID");
  }
  return problems;
}

function serializeEnv(config: AppConfig): string {
  return [
    "# Generado por `npm run setup` de mcp-notify",
    `NOTIFICATION_PROVIDER=${config.provider}`,
    "",
    "# WhatsApp (whatsapp-web.js)",
    `WHATSAPP_TARGET_NUMBER=${config.whatsapp.targetNumber}`,
    "",
    "# Telegram (Bot API oficial)",
    `TELEGRAM_BOT_TOKEN=${config.telegram.botToken}`,
    `TELEGRAM_CHAT_ID=${config.telegram.chatId}`,
    "",
  ].join("\n");
}

/**
 * Asistente interactivo de primera ejecución. Pregunta el proveedor y sus
 * datos, escribe el .env y devuelve la configuración resultante.
 *
 * Sólo debe llamarse cuando hay una terminal interactiva (TTY).
 */
export async function runInteractiveSetup(): Promise<AppConfig> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write("\n=== Configuración inicial de mcp-notify ===\n\n");

    let provider: Provider | null = null;
    while (provider === null) {
      const answer = (
        await rl.question("¿Qué proveedor quieres usar? [1] WhatsApp  [2] Telegram: ")
      )
        .trim()
        .toLowerCase();
      if (answer === "1" || answer === "whatsapp") provider = "whatsapp";
      else if (answer === "2" || answer === "telegram") provider = "telegram";
      else stdout.write("Respuesta no válida. Escribe 1 o 2.\n");
    }

    const config: AppConfig = {
      provider,
      whatsapp: { targetNumber: process.env.WHATSAPP_TARGET_NUMBER?.trim() ?? "" },
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
        chatId: process.env.TELEGRAM_CHAT_ID?.trim() ?? "",
      },
    };

    if (provider === "whatsapp") {
      stdout.write(
        "\nIntroduce el número de destino en formato internacional SIN '+' (ej. 34612345678).\n",
      );
      config.whatsapp.targetNumber = (await rl.question("WHATSAPP_TARGET_NUMBER: ")).trim();
    } else {
      stdout.write(
        "\nPega el token que te dio @BotFather y el chat ID (ver README para obtenerlo).\n",
      );
      config.telegram.botToken = (await rl.question("TELEGRAM_BOT_TOKEN: ")).trim();
      config.telegram.chatId = (await rl.question("TELEGRAM_CHAT_ID: ")).trim();
    }

    const problems = validateConfig(config);
    if (problems.length > 0) {
      throw new Error(`Datos incompletos: ${problems.join("; ")}`);
    }

    writeFileSync(ENV_PATH, serializeEnv(config), "utf8");
    stdout.write(`\n✅ Configuración guardada en ${ENV_PATH}\n\n`);

    return config;
  } finally {
    rl.close();
  }
}

export function envFileExists(): boolean {
  return existsSync(ENV_PATH);
}
