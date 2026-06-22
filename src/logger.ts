/**
 * En un servidor MCP por stdio, **stdout está reservado** para el protocolo
 * JSON-RPC. Cualquier log debe ir a stderr o romperá la comunicación con el
 * cliente. Usa siempre esta función en lugar de `console.log`.
 */
export function log(...args: unknown[]): void {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  process.stderr.write(`[mcp-notify] ${line}\n`);
}
