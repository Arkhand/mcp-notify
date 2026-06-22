#!/usr/bin/env node
/**
 * CLI de notificación para los HOOKS de Claude Code, con silenciado por carpeta.
 *
 * Eventos (los disparan los hooks, leen el JSON del hook por stdin):
 *   node dist/notify-cli.js stop           -> "Claude terminó"
 *   node dist/notify-cli.js notification   -> "Claude necesita tu atención"
 *   node dist/notify-cli.js "texto libre"  -> envía ese texto tal cual
 *
 * Gestión del silenciado (las usan los slash commands /notify-off /notify-on /notify-status):
 *   node dist/notify-cli.js mute   [carpeta]   -> silencia esa carpeta (por defecto la actual)
 *   node dist/notify-cli.js unmute [carpeta]   -> reactiva esa carpeta
 *   node dist/notify-cli.js status [carpeta]   -> muestra el estado
 *
 * Las notificaciones vienen ACTIVAS por defecto; sólo se silencian las carpetas
 * que estén en el archivo de estado (~/.mcp-notify-state.json).
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";

const STATE_PATH = join(homedir(), ".mcp-notify-state.json");

interface State {
  mutedDirs: string[];
}

interface HookInput {
  message?: string;
  cwd?: string;
}

function normalizeDir(dir: string): string {
  let d = resolve(dir).replace(/[\\/]+$/, "");
  if (process.platform === "win32") d = d.toLowerCase();
  return d;
}

function loadState(): State {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as Partial<State>;
      if (Array.isArray(raw.mutedDirs)) {
        return { mutedDirs: raw.mutedDirs.filter((d): d is string => typeof d === "string") };
      }
    }
  } catch {
    /* estado corrupto o inexistente: tratamos como vacío */
  }
  return { mutedDirs: [] };
}

function saveState(state: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function isMuted(dir: string): boolean {
  const target = normalizeDir(dir);
  return loadState().mutedDirs.some((d) => normalizeDir(d) === target);
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

function handleManagementCommand(event: string): void {
  const target = process.argv[3] ?? process.cwd();
  const dir = normalizeDir(target);
  const state = loadState();

  if (event === "mute") {
    if (!state.mutedDirs.some((d) => normalizeDir(d) === dir)) {
      state.mutedDirs.push(dir);
      saveState(state);
    }
    process.stdout.write(`🔕 Notificaciones SILENCIADAS para esta carpeta:\n   ${dir}\n`);
  } else if (event === "unmute") {
    const before = state.mutedDirs.length;
    state.mutedDirs = state.mutedDirs.filter((d) => normalizeDir(d) !== dir);
    saveState(state);
    const changed = before !== state.mutedDirs.length;
    process.stdout.write(
      `🔔 Notificaciones ACTIVADAS para esta carpeta${changed ? "" : " (ya estaban activas)"}:\n   ${dir}\n`,
    );
  } else {
    // status
    process.stdout.write(
      `Estado de esta carpeta: ${isMuted(target) ? "🔕 silenciada" : "🔔 activa (por defecto)"}\n   ${dir}\n`,
    );
    if (state.mutedDirs.length > 0) {
      process.stdout.write(`\nCarpetas silenciadas:\n${state.mutedDirs.map((d) => `   - ${d}`).join("\n")}\n`);
    } else {
      process.stdout.write(`\nNo hay ninguna carpeta silenciada.\n`);
    }
  }
}

async function sendNotification(event: string, arg: string, hook: HookInput | null): Promise<void> {
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
      `[notify-cli] Error al enviar por ${provider.name}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  } finally {
    await provider.shutdown();
  }
}

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? "").trim();
  const event = arg.toLowerCase();

  // Subcomandos de gestión (no envían nada, no leen stdin).
  if (event === "mute" || event === "unmute" || event === "status") {
    handleManagementCommand(event);
    return;
  }

  const hook = await readStdinJson();
  const projectDir = hook?.cwd && hook.cwd.trim() ? hook.cwd : process.cwd();

  // Si la carpeta está silenciada, no enviamos (salida limpia).
  if ((event === "stop" || event === "notification") && isMuted(projectDir)) {
    return;
  }

  await sendNotification(event, arg, hook);
}

main().catch((err: unknown) => {
  process.stderr.write(`[notify-cli] Error fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
