import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import wweb from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import type { NotificationProvider } from "./types.js";
import { log } from "../logger.js";

const { Client, LocalAuth } = wweb;

const __dirname = dirname(fileURLToPath(import.meta.url));
// La sesión persistente se guarda en la raíz del proyecto (dist/.. -> raíz).
const AUTH_PATH = join(__dirname, "..", "..", ".wwebjs_auth");

/**
 * Proveedor basado en whatsapp-web.js con sesión persistente (LocalAuth),
 * de modo que el QR sólo hay que escanearlo la primera vez.
 */
export class WhatsAppProvider implements NotificationProvider {
  readonly name = "whatsapp";

  private client: InstanceType<typeof Client> | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly targetNumber: string) {}

  /** Convierte un número internacional en el chatId de whatsapp-web.js. */
  private get chatId(): string {
    const digits = this.targetNumber.replace(/\D/g, "");
    return `${digits}@c.us`;
  }

  init(): Promise<void> {
    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    // Permite apuntar a un Chrome/Chromium ya instalado en vez del que
    // descarga Puppeteer (útil si esa descarga falla). Se configura con
    // PUPPETEER_EXECUTABLE_PATH en el .env.
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
      puppeteer: {
        // --no-sandbox ayuda en entornos headless/CI; inofensivo en escritorio.
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        ...(executablePath ? { executablePath } : {}),
      },
    });
    this.client = client;

    client.on("qr", (qr: string) => {
      log("Escanea este QR con WhatsApp (Dispositivos vinculados → Vincular dispositivo):");
      // IMPORTANTE: el QR se imprime en stderr para no contaminar el canal
      // JSON-RPC (stdout). Sólo aparece en el primer arranque.
      qrcode.generate(qr, { small: true }, (code: string) => {
        process.stderr.write(`\n${code}\n`);
      });
      // Persistimos también la cadena cruda para poder regenerar el QR como
      // imagen si hiciera falta (se ignora cualquier error de escritura).
      if (process.env.MCP_NOTIFY_QR_FILE) {
        try {
          writeFileSync(process.env.MCP_NOTIFY_QR_FILE, qr, "utf8");
        } catch {
          /* no crítico */
        }
      }
    });

    client.once("ready", () => {
      log("WhatsApp listo — sesión vinculada.");
      resolveReady();
    });

    client.on("auth_failure", (msg: string) => {
      rejectReady(new Error(`Fallo de autenticación de WhatsApp: ${msg}`));
    });

    client.initialize().catch((err: unknown) => {
      rejectReady(err instanceof Error ? err : new Error(String(err)));
    });

    return this.ready;
  }

  async send(message: string, context?: string): Promise<void> {
    if (!this.client || !this.ready) {
      throw new Error("El proveedor de WhatsApp no se ha inicializado (llama a init()).");
    }
    // Espera a que la sesión esté lista (o propaga el error de init).
    await this.ready;

    const text = context ? `${message}\n\n_📝 Contexto: ${context}_` : message;

    const numberId = await this.client.getNumberId(this.chatId);
    if (!numberId) {
      throw new Error(
        `El número ${this.targetNumber} no está registrado en WhatsApp o el formato es incorrecto ` +
          `(usa el formato internacional sin "+", p. ej. 34612345678).`,
      );
    }

    await this.client.sendMessage(numberId._serialized, text);
  }

  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.destroy().catch(() => {
        /* nada que hacer si ya está cerrado */
      });
      this.client = null;
    }
  }
}
