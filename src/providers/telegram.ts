import type { NotificationProvider } from "./types.js";
import { log } from "../logger.js";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * Proveedor basado en la Bot API oficial de Telegram.
 * No requiere dependencias externas: usa `fetch` (Node >= 18).
 */
export class TelegramProvider implements NotificationProvider {
  readonly name = "telegram";

  private ready: Promise<void> | null = null;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  private apiUrl(method: string): string {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  init(): Promise<void> {
    this.ready = (async () => {
      const res = await fetch(this.apiUrl("getMe"));
      const data = (await res.json()) as TelegramApiResponse<{ username: string }>;
      if (!data.ok || !data.result) {
        throw new Error(
          `No se pudo validar el bot de Telegram (¿TELEGRAM_BOT_TOKEN correcto?): ${
            data.description ?? `HTTP ${res.status}`
          }`,
        );
      }
      log(`Telegram listo — bot @${data.result.username}`);
    })();
    return this.ready;
  }

  async send(message: string, context?: string): Promise<void> {
    if (!this.ready) {
      throw new Error("El proveedor de Telegram no se ha inicializado (llama a init()).");
    }
    // Propaga cualquier error de inicialización.
    await this.ready;

    const text = context ? `${message}\n\n📝 Contexto: ${context}` : message;

    const res = await fetch(this.apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    const data = (await res.json()) as TelegramApiResponse<unknown>;
    if (!data.ok) {
      throw new Error(
        `Telegram rechazó el mensaje (HTTP ${res.status}): ${
          data.description ?? "error desconocido"
        }`,
      );
    }
  }

  async shutdown(): Promise<void> {
    // Nada que cerrar: las peticiones son sin estado.
  }
}
