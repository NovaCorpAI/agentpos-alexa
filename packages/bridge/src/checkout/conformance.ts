/**
 * Validates session responses against the vendored official UCP schemas. Used by tests and
 * available to the simulator's inspection summary.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

// ajv-formats is CommonJS; under NodeNext the callable may sit on `.default`.
const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv2020) => void;

export type UcpRelease = "2026-04-08" | "2026-08-25";

const VENDOR = new URL("../../vendor/ucp/", import.meta.url);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

export interface Conformance {
  validate(schemaPath: string, value: unknown): { ok: true } | { ok: false; errors: string[] };
}

/** Loads every schema of one release under its published $id so relative $refs resolve. */
export function loadUcpConformance(release: UcpRelease): Conformance {
  const root = join(decodeURIComponent(VENDOR.pathname.replace(/^\/([A-Za-z]:)/, "$1")), release, "source", "schemas");
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  for (const file of walk(root)) {
    const schema = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const rel = file.slice(root.length + 1).replace(/\\/g, "/");
    const id = typeof schema.$id === "string" ? schema.$id : `https://ucp.dev/schemas/${rel}`;
    if (!ajv.getSchema(id)) ajv.addSchema(schema, id);
  }
  return {
    validate(schemaPath, value) {
      const validate = ajv.getSchema(`https://ucp.dev/schemas/${schemaPath}`);
      if (!validate) throw new Error(`No vendored schema ${schemaPath} in release ${release}`);
      const ok = validate(value) as boolean;
      if (ok) return { ok: true };
      return { ok: false, errors: (validate.errors ?? []).map((e) => `${e.instancePath || "$"} ${e.message ?? ""} ${JSON.stringify(e.params)}`) };
    },
  };
}
