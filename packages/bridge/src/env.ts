/**
 * Loads KEY=VALUE lines from a .env file into process.env without overriding variables that
 * are already set, so a judge's `pnpm dev:*` picks up what the wizard wrote. No dependency,
 * no interpolation, no printing. Values may be wrapped in single or double quotes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** The nearest .env walking up from cwd: `pnpm --filter` runs each package from its own folder. */
export function findDotenv(from = process.cwd()): string | undefined {
  let dir = resolve(from);
  for (;;) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The pnpm workspace root (where pnpm-workspace.yaml lives), else cwd. Data files live there. */
export function workspaceRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

/** `.data` under the workspace root, so every service shares one place regardless of cwd. */
export function dataDir(): string {
  return resolve(workspaceRoot(), ".data");
}

export function loadDotenv(path = findDotenv()): string[] {
  if (!path || !existsSync(path)) return [];
  const loaded: string[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}
