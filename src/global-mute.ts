/**
 * Shared mute-state location and the global ("everything") mute check, used by both
 * the hook CLI and the MCP server.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

export const STATE_PATH = join(homedir(), ".mcp-notify-state.json");

/** Sentinel `dir` value for a mute that applies to every folder and to the MCP tool. */
export const GLOBAL_DIR = "*";

export function isGloballyMuted(now: number): boolean {
  try {
    if (!existsSync(STATE_PATH)) return false;
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { mutes?: unknown };
    if (!Array.isArray(raw.mutes)) return false;
    return raw.mutes.some((m) => {
      const e = m as { dir?: unknown; until?: unknown };
      return e?.dir === GLOBAL_DIR && (typeof e.until !== "number" || e.until > now);
    });
  } catch {
    return false;
  }
}
