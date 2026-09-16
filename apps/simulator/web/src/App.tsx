/**
 * The simulated Alexa+ experience: an Echo Show frame, the four display modes, the list of
 * Enabled add-ons, voice or text input, the host's own checkout pattern, scripted Scenes
 * and the inspection summary. Everything visible in the frame came from a Bridge tool
 * result or a UCP session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, checkoutApi, type Addon, type BrainInfo, type CheckoutState, type Inspection, type Scene, type Turn } from "./api";
import { AppHost, type DisplayMode } from "./AppHost";
import { Checkout } from "./Checkout";
import { listenOnce, recognitionAvailable, speak, type SpeechSource } from "./speech";

type Mode = "inline" | "fullscreen" | "voice-only" | "hydrated";
type Frame = "show8" | "show5";
type Theme = "light" | "dark";
type Lang = "en-US" | "es-CL";

const FRAMES: Record<Frame, { label: string; width: number; height: number }> = {
  show8: { label: "Echo Show 8", width: 1280, height: 800 },
  show5: { label: "Echo Show 5", width: 960, height: 480 },
};

const SUGGESTIONS = ["What bread do you have?", "Tell me about the gluten-free seeded loaf", "Do you deliver?", "Buy two sourdough loaf", "Show my order", "Show me the receipt", "The same as last week"];

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
  result: NonNullable<Turn["view"]>["result"];
  resourceUri: string;
}

function componentOf(uri: string): string | null {
  const m = /ui:\/\/[^/]+\/([a-z-]+)\.html$/.exec(uri);
  return m?.[1] ?? null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const [lang, setLang] = useState<Lang>("en-US");
  const [voiceOut, setVoiceOut] = useState(true);
  const [voiceSource, setVoiceSource] = useState<SpeechSource>("none");
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [view, setView] = useState<ViewState | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [lastTurn, setLastTurn] = useState<Turn | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [brain, setBrain] = useState<BrainInfo | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [runningScene, setRunningScene] = useState<string | null>(null);
  const stopListen = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const speechRef = useRef<Promise<SpeechSource>>(Promise.resolve("none"));

  useEffect(() => {
    api
      .addons()
      .then(({ addons }) => {
        setAddons(addons);
        if (addons[0]) setAddon(addons[0].slug);
      })
      .catch((e: Error) => setError(e.message));
    api.brain().then(setBrain).catch(() => undefined);
    api.scenes().then(({ scenes }) => setScenes(scenes)).catch(() => undefined);
  }, []);

  const refreshInspection = useCallback(() => {
    api.inspection().then(setInspection).catch(() => undefined);
  }, []);

  const setBusyBoth = (b: boolean) => {
    busyRef.current = b;
    setBusy(b);
  };

  /** Applies what a turn brought back: speech, a checkout to confirm, or a view to render. */
  const applyTurn = useCallback(
    async (turn: Turn, _requestedAt: number) => {
      // Render timing starts when the tool result is in hand: the 500 ms rule is about the
      // view showing its first item, not about the model's thinking time.
      const submittedAt = performance.now();
      void _requestedAt;
      setLastTurn(turn);
      if (turn.fallbackReason) setBrain((b) => (b ? { ...b, kind: turn.brain, degraded: turn.fallbackReason ?? null } : b));
      for (const s of turn.speak) setLines((l) => [...l, { who: "alexa", text: s }]);
      if (voiceOut && turn.speak[0]) {
        speechRef.current = speak(turn.speak.join(" "), lang);
        void speechRef.current.then(setVoiceSource);
      }
      setCheckout(turn.checkout ?? null);
      if (turn.view && mode !== "voice-only" && mode !== "hydrated") {
        const r = await api.resource(addon, turn.view.resourceUri);
        setView({ turnId: turn.turnId, submittedAt, html: r.html, toolName: turn.view.toolName, toolArguments: turn.view.arguments, result: turn.view.result, resourceUri: turn.view.resourceUri });
      } else {
        setView(null);
        if (turn.view) void api.render(turn.turnId, { displayMode: mode, component: null });
      }
      refreshInspection();
    },
    [addon, mode, voiceOut, lang, refreshInspection],
  );

  const submit = useCallback(
    async (text: string, scene?: string): Promise<Turn | null> => {
      if (!addon || !text.trim() || busyRef.current) return null;
      setBusyBoth(true);
      setInput("");
      setLines((l) => [...l, { who: "household", text }]);
      const submittedAt = performance.now();
      try {
        const turn = await api.turn(addon, text, lang, scene);
        await applyTurn(turn, submittedAt);
        return turn;
      } catch (e) {
        setLines((l) => [...l, { who: "alexa", text: `Something went wrong: ${(e as Error).message}` }]);
        return null;
      } finally {
        setBusyBoth(false);
      }
    },
    [addon, lang, applyTurn],
  );

  const confirmCheckout = useCallback(
    async (state: CheckoutState, handlerId: string, instrumentId?: string, scene?: string): Promise<Turn | null> => {
      if (busyRef.current) return null;
      setBusyBoth(true);
      const submittedAt = performance.now();
      try {
        const turn = await checkoutApi.confirm(state.sessionId, handlerId, instrumentId, scene);
        await applyTurn(turn, submittedAt);
        return turn;
      } catch (e) {
        setLines((l) => [...l, { who: "alexa", text: `Payment failed: ${(e as Error).message}` }]);
        return null;
      } finally {
        setBusyBoth(false);
      }
    },
    [applyTurn],
  );

  const cancelCheckout = useCallback(async () => {
    if (!checkout) return;
    try {
      const r = await checkoutApi.cancel(checkout.sessionId);
      for (const s of r.speak) setLines((l) => [...l, { who: "alexa", text: s }]);
    } finally {
      setCheckout(null);
    }
  }, [checkout]);

  /** Plays a Scene step by step on screen, pacing on the spoken audio. */
  const runScene = useCallback(
    async (scene: Scene) => {
      if (!addon || runningScene || busyRef.current) return;
      setRunningScene(scene.id);
      let lastCheckout: CheckoutState | null = null;
      try {
        for (const step of scene.steps) {
          if ("reset" in step) {
            await api.reset(addon);
            setLines([]);
            setView(null);
            setCheckout(null);
            lastCheckout = null;
            continue;
          }
          if ("say" in step) {
            const t = await submit(step.say, scene.id);
            lastCheckout = t?.checkout ?? null;
          } else if (step.confirmCheckout) {
            const option = lastCheckout?.options.find((o) => o.available);
            if (!lastCheckout || !option) {
              setLines((l) => [...l, { who: "alexa", text: "Scene step skipped: there is no checkout to confirm." }]);
              continue;
            }
            await wait(1200);
            const t = await confirmCheckout(lastCheckout, option.handlerId, option.instrumentId, scene.id);
            lastCheckout = t?.checkout ?? null;
          }
          await speechRef.current;
          await wait(step.pauseMs ?? 900);
        }
      } finally {
        setRunningScene(null);
        refreshInspection();
      }
    },
    [addon, runningScene, submit, confirmCheckout, refreshInspection],
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
  const sceneTurns = (id: string) => inspection?.turns.filter((t) => t.scene === id) ?? [];

  return (
    <div className={`sim theme-${theme}`}>
      <aside className="panel">
        <h1>AgentPOS Alexa+ simulator</h1>
        <p className="muted">
          Simulated Alexa+ experience. Brain:{" "}
          <b>{brain?.kind === "agent" ? `Household agent on Bedrock (${brain.modelId ?? "model"}, ${brain.region ?? "region"})` : brain?.kind === "recorded" ? "recorded responses, no model" : "scripted router, no model"}</b>
          {brain?.degraded ? <span className="small"> {brain.degraded}</span> : null}
          {voiceOut ? <span className="small"> Voice: {voiceSource === "polly" ? "Amazon Polly" : voiceSource === "browser" ? "browser" : "not yet"}</span> : null}
        </p>
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

        <label>Scenes</label>
        <div className="scenes">
          {scenes.map((s) => {
            const turns = sceneTurns(s.id);
            const failed = turns.reduce((n, t) => n + Object.values(t.checks).filter((v) => v === false).length, 0);
            return (
              <div key={s.id} className="scene">
                <button onClick={() => void runScene(s)} disabled={Boolean(s.pending) || Boolean(runningScene) || busy || !addon} title={s.proves}>
                  {runningScene === s.id ? "Running" : "Run"}
                </button>
                <div>
                  <div>{s.title}</div>
                  <div className="muted small">{s.pending ? `pending: ${s.pending}` : s.proves}</div>
                  {turns.length ? (
                    <div className="small">
                      {turns.length} turns, <span className={failed ? "bad" : "good"}>{failed} failed checks</span>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

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
          {SUGGESTIONS.map((t) => (
            <button key={t} onClick={() => void submit(t)} disabled={busy || !addon || Boolean(runningScene)}>
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
                <div className="muted small">
                  {t.scene ? `[${t.scene}] ` : ""}
                  {t.input}
                </div>
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
              <span>{runningScene ? `Scene: ${scenes.find((s) => s.id === runningScene)?.title ?? runningScene}` : mode}</span>
            </div>
            <div className="conversation">
              {lines.slice(-4).map((l, i) => (
                <div key={i} className={`bubble ${l.who}`}>
                  {l.text}
                </div>
              ))}
              {busy ? <div className="bubble alexa thinking">...</div> : null}
            </div>
            {checkout && mode !== "voice-only" ? (
              <div className="viewport inline">
                <Checkout state={checkout} busy={busy} onConfirm={(h, i) => void confirmCheckout(checkout, h, i)} onCancel={() => void cancelCheckout()} />
              </div>
            ) : null}
            {mode !== "voice-only" && view && !checkout ? (
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
            {mode === "hydrated" && lastTurn?.view && !checkout ? (
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
