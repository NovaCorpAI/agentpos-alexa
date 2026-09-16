/** The browser side of the Simulator API. */
export interface Addon {
  slug: string;
  origin: string;
  name: string;
  mcp: string;
  checkout: string;
  profile: string;
  paymentHandlers: string[];
}

export interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface Turn {
  turnId: string;
  traceId: string;
  brain: "scripted-router" | "agent" | "recorded";
  speak: string[];
  toolCalls: Array<{ name: string; arguments: Record<string, unknown>; result: ToolResult; resourceUri: string | null; latencyMs: number }>;
  view: { resourceUri: string; toolName: string; arguments: Record<string, unknown>; result: ToolResult } | null;
  error?: string;
}

export interface Inspection {
  generatedAt: string;
  turns: Array<{
    turnId: string;
    input: string;
    toolCalls: Array<{ name: string; latencyMs: number; isError: boolean; itemCount: number | null }>;
    render?: { viewInitializedMs?: number; firstItemMs?: number; displayMode: string; component: string | null };
    checks: Record<string, boolean | null>;
  }>;
  totals: { turns: number; toolCalls: number; failedChecks: number };
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { code?: string; message?: string };
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
  return body;
}

export const api = {
  addons: () => fetch("/api/addons").then((r) => json<{ addons: Addon[] }>(r)),
  turn: (addon: string, text: string) =>
    fetch("/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addon, text }) }).then((r) => json<Turn>(r)),
  resource: (addon: string, uri: string) =>
    fetch(`/api/resource?addon=${encodeURIComponent(addon)}&uri=${encodeURIComponent(uri)}`).then((r) => json<{ html: string; mimeType: string; meta: unknown }>(r)),
  inspection: () => fetch("/api/inspection").then((r) => json<Inspection>(r)),
  render: (turnId: string, timing: { viewInitializedMs?: number; firstItemMs?: number; displayMode: string; component: string | null }) =>
    fetch(`/api/inspection/${turnId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(timing) }).then((r) => json<unknown>(r)),
};
