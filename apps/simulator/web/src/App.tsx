/**
 * The simulated Alexa+ experience: an Echo Show frame, the four display modes, the list of
 * Enabled add-ons, voice or text input, the host's own checkout pattern, scripted Scenes
 * and the inspection summary. Everything visible in the frame came from a Bridge tool
 * result or a UCP session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Playground } from "./Playground";
import { api, checkoutApi, merchantApi, type Addon, type BrainInfo, type CheckoutState, type Inspection, type Scene, type Turn } from "./api";
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

/** The display modes Alexa+ can ask a view for, named the way a person would describe them. */
const MODE_LABELS: Record<Mode, string> = {
  inline: "A card under the answer",
  fullscreen: "The whole screen",
  "voice-only": "Voice only",
  hydrated: "The raw data too",
};
const MODE_HELP: Record<Mode, string> = {
  inline: "What an Echo Show does while the conversation continues around the card.",
  fullscreen: "The view takes the screen, the way a recipe or a map would.",
  "voice-only": "No screen at all, like an Echo speaker. The answer has to stand on its own.",
  hydrated: "The card, and underneath it the data the store returned, for a host that renders its own.",
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

function fmtMs(ms: number | null): string {
  if (ms === null) return "n/a";
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
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
  const [lang, setLang] = useState<Lang>("en-US");
  const [voiceOut, setVoiceOut] = useState(true);
  const [voiceSource, setVoiceSource] = useState<SpeechSource>("none");
  const [speaking, setSpeaking] = useState(false);
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
        setSpeaking(true);
        speechRef.current = speak(turn.speak.join(" "), lang).finally(() => setSpeaking(false));
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
          if ("onboard" in step) {
            // The Merchant side of Scene 5: scan, then wait for a human to confirm in the console.
            const origin = addons.find((a) => a.slug === addon)?.origin;
            if (!origin) continue;
            setLines((l) => [...l, { who: "alexa", text: `Merchant console: scanning ${origin} and drafting the voice overlay.` }]);
            const draft = await merchantApi.scan(origin, lang);
            setLines((l) => [...l, { who: "alexa", text: `Draft ready: ${draft.overlay.length} items${draft.modelUsed ? " (strong model)" : " (deterministic drafter)"}. Waiting for the Merchant to confirm at #/merchant.` }]);
            let state = draft;
            while (state.status !== "published" || !state.stages.published || (draft.stages.scan && state.stages.published < draft.stages.scan)) {
              await wait(2000);
              state = await merchantApi.get(draft.slug);
            }
            setLines((l) => [...l, { who: "alexa", text: `Published by the Merchant ${fmtMs(state.elapsedMs.scanToPublished)} after the scan.` }]);
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
            let t = await confirmCheckout(lastCheckout, option.handlerId, option.instrumentId, scene.id);
            lastCheckout = t?.checkout ?? null;
            // The guardian may ask once; the Scene's prerecorded household answer is yes.
            const review = lastCheckout?.session.status === "incomplete" && lastCheckout.session.messages.some((m) => m.severity === "requires_buyer_review");
            if (review && step.answerReviewYes && lastCheckout) {
              await speechRef.current;
              await wait(1200);
              setLines((l) => [...l, { who: "household", text: "Yes, order it again." }]);
              t = await confirmCheckout(lastCheckout, option.handlerId, option.instrumentId, scene.id);
              lastCheckout = t?.checkout ?? null;
            }
          }
          await speechRef.current;
          await wait(step.pauseMs ?? 900);
        }
        if (scene.steps.some((s) => "onboard" in s)) {
          const state = await merchantApi.get(addon).catch(() => null);
          if (state?.elapsedMs.scanToFirstVoicePurchase !== null && state?.elapsedMs.scanToFirstVoicePurchase !== undefined) {
            setLines((l) => [...l, { who: "alexa", text: `From URL to first voice purchase: ${fmtMs(state.elapsedMs.scanToFirstVoicePurchase)}, computed from usage_events.` }]);
          }
        }
      } finally {
        setRunningScene(null);
        refreshInspection();
      }
    },
    [addon, addons, lang, runningScene, submit, confirmCheckout, refreshInspection],
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
    <div className={`shell theme-${theme}`}>
      <aside className="panel">
        <div className="brand">
          <span className="mark">
            Agent<b>POS</b>
          </span>
          <span className="for">for Alexa+</span>
        </div>
        <p className="lede">
          An Echo Show, simulated. Talk to the store on the right: it answers out loud, puts a card on the screen, and takes the payment without leaving the conversation.
        </p>
        {error ? <p className="error">{error}</p> : null}

        <label>The store on screen</label>
        <select value={addon} onChange={(e) => setAddon(e.target.value)} aria-label="The store on screen">
          {addons.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="muted small">
          A real store, reached the way Alexa+ would reach it. Ask it anything in the box under the screen, or press the mic and speak.
        </p>

        <label>Ask it something</label>
        <div className="chips">
          {SUGGESTIONS.map((t) => (
            <button key={t} onClick={() => void submit(t)} disabled={busy || !addon || Boolean(runningScene)}>
              {t}
            </button>
          ))}
        </div>

        <label>Or watch a whole scene</label>
        <p className="muted small">Each one runs a real conversation against that store and marks its own checks.</p>
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

        <p className="muted small">
          <a href="#/merchant">Put a store on Alexa+ yourself</a>, in the Merchant console. It is Scene 5, done by hand.
        </p>

        <Playground />

        <details className="drawer">
          <summary>Screen, voice and device</summary>

          <label>What the screen does with an answer</label>
          <div className="seg">
            {(["inline", "fullscreen", "voice-only", "hydrated"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <p className="muted small">{MODE_HELP[mode]}</p>

          <label>Device</label>
          <div className="seg">
            {(Object.keys(FRAMES) as Frame[]).map((f) => (
              <button key={f} className={frame === f ? "on" : ""} onClick={() => setFrame(f)}>
                {FRAMES[f].label}
              </button>
            ))}
          </div>

          <label>Look</label>
          <div className="seg">
            <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>Dark room</button>
            <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>Daylight</button>
          </div>

          <label>Language and voice</label>
          <div className="seg">
            <button className={lang === "en-US" ? "on" : ""} onClick={() => setLang("en-US")}>English</button>
            <button className={lang === "es-CL" ? "on" : ""} onClick={() => setLang("es-CL")}>Español</button>
            <button className={voiceOut ? "on" : ""} onClick={() => setVoiceOut((v) => !v)}>{voiceOut ? "Speaking" : "Muted"}</button>
          </div>
          <p className="muted small">
            {voiceOut
              ? voiceSource === "polly"
                ? "Amazon Polly is speaking the answers."
                : voiceSource === "browser"
                  ? "Your browser is speaking the answers: Polly is not reachable from here."
                  : "The next answer will be spoken."
              : "Answers are written, not spoken."}
          </p>
        </details>

        <details className="drawer">
          <summary>Under the hood</summary>

          <p className="muted small">
            Answers come from{" "}
            <b>{brain?.kind === "agent" ? `a Household agent on Amazon Bedrock (${brain.modelId ?? "model"}, ${brain.region ?? "region"})` : brain?.kind === "recorded" ? "recorded responses, no model" : "a scripted router, no model"}</b>
            {brain?.degraded ? <span> {brain.degraded}</span> : null}. It reaches the store the way Alexa+ would: MCP for the catalogue, UCP checkout sessions for the payment.
          </p>
          {current ? (
            <p className="muted small">
              MCP endpoint {current.mcp}
              <br />
              payment handlers {current.paymentHandlers.join(", ") || "none"}
            </p>
          ) : null}

          <label>What each turn did</label>
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
            <p className="muted small">Nothing said yet. Ask the store something and this fills in.</p>
          )}
        </details>
      </aside>

      <main className="stage">
        <div className="device" style={{ width: frameSpec.width * scale, height: frameSpec.height * scale }}>
          <div className={`screen mode-${mode}`} style={{ width: frameSpec.width, height: frameSpec.height, transform: `scale(${scale})` }}>
            <div className="statusbar">
              <span>{current?.name ?? "No add-on"}</span>
              <div className={`wave ${speaking ? "on" : ""}`} aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <span key={i} />
                ))}
              </div>
              <span>{runningScene ? `Scene: ${scenes.find((s) => s.id === runningScene)?.title ?? runningScene}` : mode}</span>
            </div>
            <div className="conversation">
              {lines.slice(checkout ? -1 : -4).map((l, i) => (
                <div key={i} className={`bubble ${l.who}`}>
                  {l.text}
                </div>
              ))}
              {busy ? <div className="bubble alexa thinking">...</div> : null}
            </div>
            {lines.length === 0 && !busy && !checkout && !view ? (
              <div className="idle">
                <div className="idle-mark" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <span key={i} />
                  ))}
                </div>
                <p className="idle-title">Ask the store, out loud</p>
                <div className="idle-prompts">
                  {SUGGESTIONS.slice(0, 3).map((t) => (
                    <button key={t} onClick={() => void submit(t)} disabled={busy || !addon || Boolean(runningScene)}>
                      {t}
                    </button>
                  ))}
                </div>
                <p className="idle-hint">{recognitionAvailable() ? "or press the mic and speak" : "type it in the box below"}</p>
              </div>
            ) : null}
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
