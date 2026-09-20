/**
 * The Merchant console (CONTEXT.md): paste a Store URL, the onboarding agent drafts the Voice
 * overlay and the voice policies, the Merchant edits and confirms, the Bridge publishes.
 * Every stage is timestamped in usage_events; the timer shown here is read back from them.
 * Merchant-side only: this file imports nothing from the Household side of the app.
 */
import { useCallback, useEffect, useState } from "react";
import { merchantApi, type OnboardingState, type OverlayLine, type Policies } from "./api";

const STAGES: Array<[keyof OnboardingState["stages"], string]> = [
  ["scan", "Scan"],
  ["catalog_draft", "Catalog draft"],
  ["policies_draft", "Policies draft"],
  ["human_confirm", "Human confirm"],
  ["published", "Published"],
  ["first_voice_purchase", "First voice purchase"],
];

function fmt(ms: number | null): string {
  if (ms === null) return "not yet";
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

function clock(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleTimeString() : "";
}

export function Merchant() {
  const [storeUrl, setStoreUrl] = useState("");
  const [language, setLanguage] = useState("en-US");
  const [state, setState] = useState<OnboardingState | null>(null);
  const [overlay, setOverlay] = useState<OverlayLine[]>([]);
  const [policies, setPolicies] = useState<Policies>({ voiceIntro: "", deliveryNote: "", reviewNote: "" });
  const [busy, setBusy] = useState<"scan" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The first Enabled add-on is the natural URL to try; the field stays editable.
  useEffect(() => {
    fetch("/api/addons")
      .then((r) => r.json())
      .then((b: { addons: Array<{ slug: string; origin: string }> }) => {
        const first = b.addons[0];
        if (!first) return;
        setStoreUrl((u) => u || first.origin);
        merchantApi.get(first.slug).then(load).catch(() => undefined);
      })
      .catch(() => undefined);
  }, []);

  const load = (s: OnboardingState) => {
    setState(s);
    setOverlay(s.overlay);
    if (s.policies) setPolicies(s.policies);
  };

  const scan = useCallback(async () => {
    setBusy("scan");
    setError(null);
    try {
      load(await merchantApi.scan(storeUrl.trim(), language));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [storeUrl, language]);

  const confirm = useCallback(async () => {
    if (!state) return;
    setBusy("confirm");
    setError(null);
    try {
      load(await merchantApi.confirm(state.slug, overlay.map(({ itemId, spokenName, summary, synonyms }) => ({ itemId, spokenName, summary, synonyms })), policies));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [state, overlay, policies]);

  // After publication, keep reading the timer until the first voice purchase lands.
  useEffect(() => {
    if (!state || state.status !== "published" || state.elapsedMs.scanToFirstVoicePurchase !== null) return;
    const id = setInterval(() => merchantApi.get(state.slug).then(setState).catch(() => undefined), 3000);
    return () => clearInterval(id);
  }, [state]);

  const edit = (i: number, patch: Partial<OverlayLine>) => setOverlay((o) => o.map((line, j) => (j === i ? { ...line, ...patch } : line)));

  return (
    <div className="merchant">
      <header>
        <div className="brand">
          <span className="mark">
            Agent<b>POS</b>
          </span>
          <span className="for">merchant console</span>
        </div>
        <h1>Put a store on Alexa+</h1>
        <p className="muted">
          Four steps, about a minute. An agent reads what the store already publishes and drafts how it should sound out loud; you read every line and decide what goes live. <a href="#/">Back to the simulator</a>
        </p>
      </header>

      <section className="card step" data-step="1">
        <h2>Point at the store</h2>
        <p className="muted small">Its own address, the one customers use. The agent only reads what the store publishes, and never writes anything back to it.</p>
        <div className="row">
          <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://your-store.example" aria-label="Store address" />
          <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            <option value="en-US">English (US)</option>
            <option value="es-CL">Español (Chile)</option>
          </select>
          <button className="primary" onClick={() => void scan()} disabled={busy !== null || !storeUrl.trim()}>
            {busy === "scan" ? "Reading the store" : "Read it and draft"}
          </button>
        </div>
        {busy === "scan" ? <p className="muted small">Reading the catalogue, then writing a spoken name, a one sentence summary and the words a household might use for each item.</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      {state ? (
        <section className="card step" data-step="2">
          <h2>What the agent did, timed</h2>
          <p className="muted small">
            {state.origin} <span className={`pill ${state.status === "published" ? "ok" : ""}`}>{state.status === "published" ? "published" : "draft, not live"}</span>{" "}
            {state.modelUsed ? "Drafted by the strong model on Amazon Bedrock." : "Drafted by the deterministic drafter, with no model."}
          </p>
          <ol className="stages">
            {STAGES.map(([key, label]) => (
              <li key={key} className={state.stages[key] ? "done" : ""}>
                <span>{label}</span>
                <span className="muted small">{clock(state.stages[key])}</span>
              </li>
            ))}
          </ol>
          <p className="timer">
            URL to published: <b>{fmt(state.elapsedMs.scanToPublished)}</b>. URL to first voice purchase: <b>{fmt(state.elapsedMs.scanToFirstVoicePurchase)}</b>.
            <span className="muted small"> Computed from usage_events stage rows.</span>
          </p>
          {state.stale.length ? <p className="error">Changed in the Store since publication, served in the Store's own words until you confirm again: {state.stale.join(", ")}</p> : null}
        </section>
      ) : null}

      {state && overlay.length ? (
        <section className="card step" data-step="3">
          <h2>Read every line before anyone hears it</h2>
          <p className="muted small">
            The spoken name is what the speaker says instead of the catalogue title. The summary is the one sentence a customer hears when they ask about the item. The synonyms are the words a household
            might actually use for it. Change anything here: this is the draft, not the store.
          </p>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Spoken name</th>
                <th>Summary</th>
                <th>Synonyms</th>
              </tr>
            </thead>
            <tbody>
              {overlay.map((line, i) => (
                <tr key={line.itemId} className={state.stale.includes(line.itemId) ? "stale" : ""}>
                  <td className="muted small">{line.itemId}</td>
                  <td>
                    <input value={line.spokenName} onChange={(e) => edit(i, { spokenName: e.target.value })} />
                  </td>
                  <td>
                    <input value={line.summary} onChange={(e) => edit(i, { summary: e.target.value })} />
                  </td>
                  <td>
                    <input value={line.synonyms.join(", ")} onChange={(e) => edit(i, { synonyms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>What the store says about itself</h2>
          <p className="muted small">Three sentences the assistant may repeat: how the store introduces itself, how it delivers, and what it wants a person to check before an order goes through.</p>
          <label>Introduction</label>
          <input value={policies.voiceIntro} onChange={(e) => setPolicies({ ...policies, voiceIntro: e.target.value })} />
          <label>Delivery</label>
          <input value={policies.deliveryNote} onChange={(e) => setPolicies({ ...policies, deliveryNote: e.target.value })} />
          <label>Human review</label>
          <input value={policies.reviewNote} onChange={(e) => setPolicies({ ...policies, reviewNote: e.target.value })} />
        </section>
      ) : null}

      {state && overlay.length ? (
        <section className="card step" data-step="4">
          <h2>{state.status === "published" ? "It is live" : "Publish it"}</h2>
          <p className="muted small">
            {state.status === "published" ? (
              <>
                Alexa+ now answers for this store in the words above. Go and <a href="#/">ask it for something</a>, or change a line and publish again.
              </>
            ) : (
              "Until you confirm, the assistant answers in the store's own catalogue words. Nothing here is live yet."
            )}
          </p>
          <div className="row end">
            <button className="primary" onClick={() => void confirm()} disabled={busy !== null}>
              {busy === "confirm" ? "Publishing" : state.status === "published" ? "Publish the changes" : "Confirm and publish"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
