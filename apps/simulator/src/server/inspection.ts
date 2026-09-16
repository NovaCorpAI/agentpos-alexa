/**
 * Inspection summary: the Simulator's stand-in for Amazon's Local Inspector (FL-002).
 * One entry per turn: which tool ran, how long the Bridge took, whether the result spoke
 * first, whether the carousel size and first-item latency respect the published guide, and
 * whether failures were typed. Written to disk as inspection-summary.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolCallRecord } from "./bridge-client.js";

export interface RenderTiming {
  /** Time from the turn's submission to the view reporting initialized, in ms. */
  viewInitializedMs?: number;
  /** Time from the turn's submission to the first carousel item painted, in ms. */
  firstItemMs?: number;
  displayMode: string;
  component: string | null;
}

export interface TurnInspection {
  turnId: string;
  at: string;
  addon: string;
  input: string;
  brain: "scripted-router" | "agent" | "recorded";
  toolCalls: Array<{
    name: string;
    latencyMs: number;
    isError: boolean;
    voiceTextLength: number;
    resourceUri: string | null;
    itemCount: number | null;
    typedError: boolean;
  }>;
  render?: RenderTiming;
  checks: {
    voiceFirst: boolean;
    carouselSizeOk: boolean | null;
    firstItemUnder500ms: boolean | null;
    typedErrors: boolean;
  };
}

export interface InspectionSummary {
  generatedAt: string;
  simulatorVersion: string;
  turns: TurnInspection[];
  totals: { turns: number; toolCalls: number; failedChecks: number };
}

export function inspectTurn(turnId: string, addon: string, input: string, brain: TurnInspection["brain"], calls: ToolCallRecord[]): TurnInspection {
  const toolCalls = calls.map((c) => {
    const first = c.result.content[0] as { type?: string; text?: string } | undefined;
    const sc = c.result.structuredContent as { items?: unknown[]; error?: unknown } | undefined;
    return {
      name: c.name,
      latencyMs: c.latencyMs,
      isError: c.result.isError === true,
      voiceTextLength: first?.type === "text" ? (first.text?.length ?? 0) : 0,
      resourceUri: c.resourceUri,
      itemCount: Array.isArray(sc?.items) ? sc!.items!.length : null,
      typedError: c.result.isError === true ? typeof (sc?.error as { code?: unknown } | undefined)?.code === "string" : true,
    };
  });
  const carousel = toolCalls.filter((t) => t.name === "search_items" && !t.isError && t.itemCount !== null);
  return {
    turnId,
    at: new Date().toISOString(),
    addon,
    input,
    brain,
    toolCalls,
    checks: {
      voiceFirst: toolCalls.every((t) => t.voiceTextLength > 0),
      carouselSizeOk: carousel.length ? carousel.every((t) => t.itemCount === 0 || (t.itemCount! >= 1 && t.itemCount! <= 5)) : null,
      firstItemUnder500ms: null,
      typedErrors: toolCalls.every((t) => t.typedError),
    },
  };
}

export class InspectionLog {
  private readonly turns = new Map<string, TurnInspection>();

  constructor(
    private readonly filePath: string,
    private readonly simulatorVersion: string,
  ) {}

  add(turn: TurnInspection): void {
    this.turns.set(turn.turnId, turn);
    this.flush();
  }

  attachRender(turnId: string, render: RenderTiming): TurnInspection | undefined {
    const turn = this.turns.get(turnId);
    if (!turn) return undefined;
    turn.render = render;
    if (render.firstItemMs !== undefined) turn.checks.firstItemUnder500ms = render.firstItemMs <= 500;
    this.flush();
    return turn;
  }

  summary(): InspectionSummary {
    const turns = [...this.turns.values()];
    const failedChecks = turns.reduce((n, t) => n + Object.values(t.checks).filter((v) => v === false).length, 0);
    return {
      generatedAt: new Date().toISOString(),
      simulatorVersion: this.simulatorVersion,
      turns,
      totals: { turns: turns.length, toolCalls: turns.reduce((n, t) => n + t.toolCalls.length, 0), failedChecks },
    };
  }

  private flush(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.summary(), null, 2));
    } catch {
      // The summary is also served over HTTP; a read-only disk must not break a turn.
    }
  }
}
