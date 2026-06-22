/**
 * Contrato común que deben cumplir todos los proveedores de notificación.
 */
export interface NotificationProvider {
  /** Nombre legible del proveedor (para logs). */
  readonly name: string;

  /**
   * Arranca el proveedor. Para WhatsApp esto inicia el cliente y espera al
   * evento `ready`; para Telegram valida el token contra la API.
   *
   * La promesa devuelta resuelve cuando el proveedor está listo para enviar,
   * o rechaza si la inicialización falla. `send()` espera internamente a esta
   * misma promesa, así que es seguro lanzar `init()` sin `await`.
   */
  init(): Promise<void>;

  /**
   * Envía un mensaje. Debe lanzar (throw) si el envío falla, nunca silenciar
   * el error.
   */
  send(message: string, context?: string): Promise<void>;

  /** Cierra recursos abiertos (navegador de WhatsApp, etc.). */
  shutdown(): Promise<void>;
}
