import type { AppConfig } from "../config.js";
import type { NotificationProvider } from "./types.js";
import { WhatsAppProvider } from "./whatsapp.js";
import { TelegramProvider } from "./telegram.js";

export type { NotificationProvider } from "./types.js";

/** Construye el proveedor de notificaciones según la configuración. */
export function createProvider(config: AppConfig): NotificationProvider {
  switch (config.provider) {
    case "whatsapp":
      return new WhatsAppProvider(config.whatsapp.targetNumber);
    case "telegram":
      return new TelegramProvider(config.telegram.botToken, config.telegram.chatId);
  }
}
