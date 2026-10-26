#!/usr/bin/env node
/**
 * CLI de notificación para los HOOKS de Claude Code, con silenciado por carpeta
 * (permanente o temporal con auto-reactivación).
 *
 * Eventos (los disparan los hooks, leen el JSON del hook por stdin):
 *   node dist/notify-cli.js stop           -> "Claude terminó"
 *   node dist/notify-cli.js notification   -> "Claude necesita tu atención"
 *   node dist/notify-cli.js "texto libre"  -> envía ese texto tal cual
 *
 * Gestión del silenciado (las usan los slash commands):
 *   node dist/notify-cli.js mute             [carpeta]   -> silencia indefinidamente
 *   node dist/notify-cli.js mute-min <min>   [carpeta]   -> silencia <min> minutos (se reactiva solo)
 *   node dist/notify-cli.js unmute           [carpeta]   -> reactiva
 *   node dist/notify-cli.js status           [carpeta]   -> muestra el estado
 *
 * Passing `--all` as the folder mutes everything (every folder and the MCP tool);
 * `unmute --all` clears every mute, global and per-folder.
 *
 * Activo por defecto; sólo se silencian las carpetas del estado (~/.mcp-notify-state.json).
 */
import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";
import { STATE_PATH, GLOBAL_DIR } from "./global-mute.js";

/** until: null = permanente; número = epoch ms hasta el que está silenciado. */
interface MuteEntry {
  dir: string;
  until: number | null;
}
interface State {
  mutes: MuteEntry[];
}

interface HookInput {
  message?: string;
  cwd?: string;
}

function normalizeDir(dir: string): string {
  if (dir === "--all" || dir === GLOBAL_DIR) return GLOBAL_DIR;
  let d = resolve(dir).replace(/[\\/]+$/, "");
  if (process.platform === "win32") d = d.toLowerCase();
  return d;
}

interface LegacyState {
  mutedDirs?: unknown;
  mutes?: unknown;
}

function loadState(): State {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, "utf8")) as LegacyState;
      if (Array.isArray(raw.mutes)) {
        const mutes = (raw.mutes as unknown[])
          .filter((m): m is MuteEntry => !!m && typeof (m as MuteEntry).dir === "string")
          .map((m) => ({ dir: m.dir, until: typeof m.until === "number" ? m.until : null }));
        return { mutes };
      }
      // Migración del formato antiguo { mutedDirs: string[] }.
      if (Array.isArray(raw.mutedDirs)) {
        const mutes = (raw.mutedDirs as unknown[])
          .filter((d): d is string => typeof d === "string")
          .map((d) => ({ dir: d, until: null as number | null }));
        return { mutes };
      }
    }
  } catch {
    /* estado corrupto o inexistente: vacío */
  }
  return { mutes: [] };
}

/** Elimina las entradas temporales ya vencidas. */
function pruneExpired(state: State, now: number): State {
  return { mutes: state.mutes.filter((m) => m.until === null || m.until > now) };
}

function saveState(state: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function activeMuteFor(dir: string, now: number): MuteEntry | undefined {
  const target = normalizeDir(dir);
  return loadState().mutes.find(
    (m) =>
      (m.dir === GLOBAL_DIR || normalizeDir(m.dir) === target) &&
      (m.until === null || m.until > now),
  );
}

function describeDir(dir: string): string {
  return dir === GLOBAL_DIR ? "TODAS las carpetas (global)" : dir;
}

function formatRemaining(until: number, now: number): string {
  const mins = Math.max(0, Math.round((until - now) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
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
  return await new Promise<HookInput | null>((resolveStdin) => {
    let data = "";
    const timer = setTimeout(() => resolveStdin(safeParse(data)), 800);
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolveStdin(safeParse(data));
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolveStdin(null);
    });
  });
}

function handleManagementCommand(event: string): void {
  const now = Date.now();

  if (event === "mute-min") {
    const minutes = Number.parseInt(process.argv[3] ?? "", 10);
    const target = process.argv[4] ?? process.cwd();
    const dir = normalizeDir(target);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      process.stderr.write("[notify-cli] mute-min requiere un número de minutos > 0.\n");
      process.exit(1);
    }
    const until = now + minutes * 60000;
    const state = pruneExpired(loadState(), now);
    state.mutes = state.mutes.filter((m) => normalizeDir(m.dir) !== dir);
    state.mutes.push({ dir, until });
    saveState(state);
    process.stdout.write(
      `🔕 Notificaciones SILENCIADAS por ${formatRemaining(until, now)} (se reactivan solas) en:\n   ${describeDir(dir)}\n`,
    );
    return;
  }

  const target = process.argv[3] ?? process.cwd();
  const dir = normalizeDir(target);
  const state = pruneExpired(loadState(), now);

  if (event === "mute") {
    state.mutes = state.mutes.filter((m) => normalizeDir(m.dir) !== dir);
    state.mutes.push({ dir, until: null });
    saveState(state);
    process.stdout.write(`🔕 Notificaciones SILENCIADAS (sin límite) en:\n   ${describeDir(dir)}\n`);
  } else if (event === "unmute") {
    const before = state.mutes.length;
    state.mutes =
      dir === GLOBAL_DIR ? [] : state.mutes.filter((m) => normalizeDir(m.dir) !== dir);
    saveState(state);
    const changed = before !== state.mutes.length;
    process.stdout.write(
      `🔔 Notificaciones ACTIVADAS${changed ? "" : " (ya estaban activas)"} en:\n   ${describeDir(dir)}\n`,
    );
  } else {
    // status
    const mine =
      state.mutes.find((m) => m.dir === GLOBAL_DIR) ??
      state.mutes.find((m) => normalizeDir(m.dir) === dir);
    const scope = mine?.dir === GLOBAL_DIR ? " por silencio global" : "";
    const label = !mine
      ? "🔔 activa (por defecto)"
      : mine.until === null
        ? `🔕 silenciada${scope} (sin límite)`
        : `🔕 silenciada${scope} (vuelve en ${formatRemaining(mine.until, now)})`;
    process.stdout.write(`Estado de esta carpeta: ${label}\n   ${dir}\n`);
    saveState(state); // de paso limpia vencidas
    if (state.mutes.length > 0) {
      const lines = state.mutes.map((m) => {
        const extra = m.until === null ? "sin límite" : `vuelve en ${formatRemaining(m.until, now)}`;
        return `   - ${describeDir(m.dir)} (${extra})`;
      });
      process.stdout.write(`\nCarpetas silenciadas:\n${lines.join("\n")}\n`);
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

  if (event === "mute" || event === "mute-min" || event === "unmute" || event === "status") {
    handleManagementCommand(event);
    return;
  }

  const hook = await readStdinJson();
  const projectDir = hook?.cwd && hook.cwd.trim() ? hook.cwd : process.cwd();

  if ((event === "stop" || event === "notification") && activeMuteFor(projectDir, Date.now())) {
    return; // carpeta silenciada: salida limpia, no se envía
  }

  await sendNotification(event, arg, hook);
}

main().catch((err: unknown) => {
  process.stderr.write(`[notify-cli] Error fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
