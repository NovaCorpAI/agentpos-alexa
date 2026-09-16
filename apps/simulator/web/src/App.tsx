/**
 * The simulated Alexa+ experience: an Echo Show frame, the four display modes, the list of
 * Enabled add-ons, voice or text input, and the inspection summary. Everything visible in
 * the frame came from a Bridge tool result.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Addon, type Inspection, type Turn } from "./api";
import { AppHost, type DisplayMode } from "./AppHost";
import { listenOnce, recognitionAvailable, speak } from "./speech";

type Mode = "inline" | "fullscreen" | "voice-only" | "hydrated";
type Frame = "show8" | "show5";
type Theme = "light" | "dark";

const FRAMES: Record<Frame, { label: string; width: number; height: number }> = {
  show8: { label: "Echo Show 8", width: 1280, height: 800 },
  show5: { label: "Echo Show 5", width: 960, height: 480 },
};

interface Line {
  who: "household" | "alexa";
  text: string;
}

interface ViewState {
  turnId: string;
  submittedAt: number;
  html: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  result: Turn["view"] extends infer V ? (V extends { result: infer R } ? R : never) : never;
  resourceUri: string;
}

function componentOf(uri: string): string | null {
  const m = /ui:\/\/[^/]+\/([a-z-]+)\.html$/.exec(uri);
  return m?.[1] ?? null;
}

/** Native rendering of structured content for hydrated mode: the host's own look, no view. */
function Hydrated({ result }: { result: { structuredContent?: Record<string, unknown> } }) {
  const sc = result.structuredContent ?? {};
  const items = (sc.items as Array<{ title: string; price: { display: string } }> | undefined) ?? (sc.item ? [sc.item as { title: string; price: { display: string } }] : undefined);
  if (items) {
    return (
      <ul className="hydrated">
        {items.map((it, i) => (
          <li key={i}>
            <span>{it.title}</span>
            <b>{it.price.display}</b>
          </li>
        ))}
      </ul>
    );
  }
  return <pre className="hydrated-raw">{JSON.stringify(sc, null, 2)}</pre>;
}

export function App() {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addon, setAddon] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("inline");
  const [frame, setFrame] = useState<Frame>("show8");
  const [theme, setTheme] = useState<Theme>("dark");
  const [lang, setLang] = useState<"en-US" | "es-CL">("en-US");
  const [voiceOut, setVoiceOut] = useState(true);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [view, setView] = useState<ViewState | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [lastTurn, setLastTurn] = useState<Turn | null>(null);
  const stopListen = useRef<(() => void) | null>(null);

  useEffect(() => {
    api
      .addons()
      .then(({ addons }) => {
        setAddons(addons);
        if (addons[0]) setAddon(addons[0].slug);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const refreshInspection = useCallback(() => {
    api.inspection().then(setInspection).catch(() => undefined);
  }, []);

  const submit = useCallback(
    async (text: string) => {
      if (!addon || !text.trim() || busy) return;
      setBusy(true);
      setInput("");
      setLines((l) => [...l, { who: "household", text }]);
      const submittedAt = performance.now();
      try {
        const turn = await api.turn(addon, text);
        setLastTurn(turn);
        for (const s of turn.speak) setLines((l) => [...l, { who: "alexa", text: s }]);
        if (voiceOut && turn.speak[0]) speak(turn.speak.join(" "), lang);
        if (turn.view && mode !== "voice-only" && mode !== "hydrated") {
          const r = await api.resource(addon, turn.view.resourceUri);
          setView({ turnId: turn.turnId, submittedAt, html: r.html, toolName: turn.view.toolName, toolArguments: turn.view.arguments, result: turn.view.result as ViewState["result"], resourceUri: turn.view.resourceUri });
        } else {
          setView(null);
          if (turn.view) void api.render(turn.turnId, { displayMode: mode, component: null });
        }
        refreshInspection();
      } catch (e) {
        setLines((l) => [...l, { who: "alexa", text: `Something went wrong: ${(e as Error).message}` }]);
      } finally {
        setBusy(false);
      }
    },
    [addon, busy, mode, voiceOut, lang, refreshInspection],
  );

  const onViewInitialized = useCallback(() => {
    if (!view) return;
    const ms = Math.round(performance.now() - view.submittedAt);
    void api.render(view.turnId, { viewInitializedMs: ms, firstItemMs: ms, displayMode: mode, component: componentOf(view.resourceUri) }).then(refreshInspection);
  }, [view, mode, refreshInspection]);

  const toggleListen = () => {
    if (listening) {
      stopListen.current?.();
      return;
    }
    setListening(true);
    stopListen.current = listenOnce(
      lang,
      (t) => {
        setInput(t);
        void submit(t);
      },
      () => setListening(false),
    );
  };

  const frameSpec = FRAMES[frame];
  const scale = useMemo(() => Math.min(1, 900 / frameSpec.width), [frameSpec.width]);
  const displayMode: DisplayMode = mode === "fullscreen" ? "fullscreen" : "inline";
  const current = addons.find((a) => a.slug === addon);

  return (
    <div className={`sim theme-${theme}`}>
      <aside className="panel">
        <h1>AgentPOS Alexa+ simulator</h1>
        <p className="muted">Simulated Alexa+ experience. Brain: <b>scripted router, no model</b> until the Household agent lands.</p>
        {error ? <p className="error">{error}</p> : null}

        <label>Enabled add-ons</label>
        <select value={addon} onChange={(e) => setAddon(e.target.value)}>
          {addons.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.name} ({a.slug})
            </option>
          ))}
        </select>
        {current ? (
          <p className="muted small">
            MCP {current.mcp}
            <br />
            handlers {current.paymentHandlers.join(", ") || "none"}
          </p>
        ) : null}

        <label>Display mode</label>
        <div className="seg">
          {(["inline", "fullscreen", "voice-only", "hydrated"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
        </div>

        <label>Device</label>
        <div className="seg">
          {(Object.keys(FRAMES) as Frame[]).map((f) => (
            <button key={f} className={frame === f ? "on" : ""} onClick={() => setFrame(f)}>
              {FRAMES[f].label}
            </button>
          ))}
        </div>

        <label>Theme, language, voice</label>
        <div className="seg">
          <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>dark</button>
          <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>light</button>
          <button className={lang === "en-US" ? "on" : ""} onClick={() => setLang("en-US")}>en-US</button>
          <button className={lang === "es-CL" ? "on" : ""} onClick={() => setLang("es-CL")}>es-CL</button>
          <button className={voiceOut ? "on" : ""} onClick={() => setVoiceOut((v) => !v)}>speak {voiceOut ? "on" : "off"}</button>
        </div>

        <label>Try</label>
        <div className="chips">
          {["What bread do you have?", "Tell me about the gluten-free seeded loaf", "Do you deliver?", "Buy two sourdough loaf"].map((t) => (
            <button key={t} onClick={() => void submit(t)} disabled={busy || !addon}>
              {t}
            </button>
          ))}
        </div>

        <label>Inspection summary</label>
        {inspection ? (
          <div className="inspection">
            <div>
              turns {inspection.totals.turns}, tool calls {inspection.totals.toolCalls}, failed checks <b className={inspection.totals.failedChecks ? "bad" : "good"}>{inspection.totals.failedChecks}</b>
            </div>
            {inspection.turns.slice(-3).reverse().map((t) => (
              <div key={t.turnId} className="turn">
                <div className="muted small">{t.input}</div>
                {t.toolCalls.map((c, i) => (
                  <div key={i} className="small">
                    {c.name} {c.latencyMs} ms{c.itemCount !== null ? `, ${c.itemCount} items` : ""}{c.isError ? ", error" : ""}
                  </div>
                ))}
                {t.render?.firstItemMs !== undefined ? <div className="small">first item {t.render.firstItemMs} ms, {t.render.displayMode}, {t.render.component}</div> : null}
                <div className="checks">
                  {Object.entries(t.checks).map(([k, v]) => (
                    <span key={k} className={v === false ? "bad" : v === null ? "na" : "good"}>
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <a href="/api/inspection" target="_blank" rel="noreferrer" className="small">
              inspection-summary.json
            </a>
          </div>
        ) : (
          <p className="muted small">No turns yet.</p>
        )}
      </aside>

      <main className="stage">
        <div className="device" style={{ width: frameSpec.width * scale, height: frameSpec.height * scale }}>
          <div className={`screen mode-${mode}`} style={{ width: frameSpec.width, height: frameSpec.height, transform: `scale(${scale})` }}>
            <div className="statusbar">
              <span>{current?.name ?? "No add-on"}</span>
              <span>{mode}</span>
            </div>
            <div className="conversation">
              {lines.slice(-6).map((l, i) => (
                <div key={i} className={`bubble ${l.who}`}>
                  {l.text}
                </div>
              ))}
              {busy ? <div className="bubble alexa thinking">...</div> : null}
            </div>
            {mode !== "voice-only" && view ? (
              <div className={`viewport ${displayMode}`}>
                <AppHost
                  html={view.html}
                  toolName={view.toolName}
                  toolArguments={view.toolArguments}
                  result={view.result}
                  theme={theme}
                  displayMode={displayMode}
                  width={displayMode === "fullscreen" ? frameSpec.width - 48 : Math.min(frameSpec.width - 48, 900)}
                  onMessage={(t) => void submit(t)}
                  onRequestDisplayMode={(m) => setMode(m)}
                  onInitialized={onViewInitialized}
                />
              </div>
            ) : null}
            {mode === "hydrated" && lastTurn?.view ? (
              <div className="viewport inline">
                <Hydrated result={lastTurn.view.result} />
              </div>
            ) : null}
            <div className="inputbar">
              <button className={`mic ${listening ? "on" : ""}`} onClick={toggleListen} disabled={!recognitionAvailable() || busy} title={recognitionAvailable() ? "Speak" : "Speech recognition not available in this browser"}>
                {listening ? "listening" : "mic"}
              </button>
              <input
                value={input}
                placeholder={`Alexa, ask ${current?.name ?? "the store"}...`}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit(input);
                }}
                disabled={busy || !addon}
              />
              <button onClick={() => void submit(input)} disabled={busy || !addon || !input.trim()}>
                Send
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
