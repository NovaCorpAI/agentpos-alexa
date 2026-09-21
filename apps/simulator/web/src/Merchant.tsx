/**
 * The Merchant console (CONTEXT.md): paste a Store URL, the onboarding agent drafts the Voice
 * overlay and the voice policies, the Merchant edits and confirms, the Bridge publishes.
 * Every stage is timestamped in usage_events; the timer shown here is read back from them.
 * Merchant-side only: this file imports nothing from the Household side of the app.
 */
import { useCallback, useEffect, useState } from "react";
import { merchantApi, type OnboardingState, type OverlayLine, type Policies } from "./api";
import { turnLangOf, useLang, useT } from "./i18n";

/** The stages of the run, in order, each with the key the dictionary translates. */
const STAGES: Array<[keyof OnboardingState["stages"], "stageScan" | "stageCatalog" | "stagePolicies" | "stageConfirm" | "stagePublished" | "stageFirstPurchase"]> = [
  ["scan", "stageScan"],
  ["catalog_draft", "stageCatalog"],
  ["policies_draft", "stagePolicies"],
  ["human_confirm", "stageConfirm"],
  ["published", "stagePublished"],
  ["first_voice_purchase", "stageFirstPurchase"],
];

function fmt(ms: number | null, notYet: string): string {
  if (ms === null) return notYet;
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

function clock(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleTimeString() : "";
}

export function Merchant() {
  const t = useT();
  const [uiLang, setUiLang] = useLang();
  const language = turnLangOf(uiLang);
  const [storeUrl, setStoreUrl] = useState("");
  const [state, setState] = useState<OnboardingState | null>(null);
  const [overlay, setOverlay] = useState<OverlayLine[]>([]);
  const [policies, setPolicies] = useState<Policies>({ voiceIntro: "", deliveryNote: "", reviewNote: "" });
  const [busy, setBusy] = useState<"scan" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A draft left by an earlier visit, rather than something that happened just now. */
  const [fromEarlier, setFromEarlier] = useState(false);

  // The first Enabled add-on is the natural URL to try; the field stays editable.
  useEffect(() => {
    fetch("/api/addons")
      .then((r) => r.json())
      .then((b: { addons: Array<{ slug: string; origin: string }> }) => {
        const first = b.addons[0];
        if (!first) return;
        setStoreUrl((u) => u || first.origin);
        merchantApi
          .get(first.slug)
          .then((st) => {
            setFromEarlier(true);
            load(st);
          })
          .catch(() => undefined);
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
      setFromEarlier(false);
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
          <span className="for">{t("merchantEyebrow")}</span>
          <div className="langswitch" role="group" aria-label="Language">
            <button className={uiLang === "en" ? "on" : ""} onClick={() => setUiLang("en")} lang="en">
              EN
            </button>
            <button className={uiLang === "es" ? "on" : ""} onClick={() => setUiLang("es")} lang="es">
              ES
            </button>
          </div>
        </div>
        <h1>{t("merchantTitle")}</h1>
        <p className="muted">
          {t("merchantLede")} <a href="#/">{t("backToSimulator")}</a>
        </p>
      </header>

      <section className="card step" data-step="1">
        <h2>{t("step1")}</h2>
        <p className="muted small">{t("step1Help")}</p>
        <div className="row">
          <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://tu-tienda.ejemplo" aria-label={t("storeAddress")} />
          <button className="primary" onClick={() => void scan()} disabled={busy !== null || !storeUrl.trim()}>
            {busy === "scan" ? t("reading") : t("readAndDraft")}
          </button>
        </div>
        {busy === "scan" ? <p className="muted small">{t("readingHelp")}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      {state ? (
        <section className="card step" data-step="2">
          <h2>{fromEarlier && !state.stages.scan ? t("step2Earlier") : t("step2")}</h2>
          <p className="muted small">
            {state.origin} <span className={`pill ${state.status === "published" ? "ok" : ""}`}>{state.status === "published" ? t("published") : t("draftNotLive")}</span>{" "}
            {state.modelUsed ? t("draftedByModel") : t("draftedByRules")}
            {fromEarlier ? t("draftEarlierNote") : ""}
          </p>
          <ol className="stages">
            {STAGES.map(([key, label]) => (
              <li key={key} className={state.stages[key] ? "done" : ""}>
                <span>{t(label)}</span>
                <span className="muted small">{clock(state.stages[key])}</span>
              </li>
            ))}
          </ol>
          <p className="timer">
            {t("urlToPublished")} <b>{fmt(state.elapsedMs.scanToPublished, t("notYet"))}</b>. {t("urlToFirstPurchase")} <b>{fmt(state.elapsedMs.scanToFirstVoicePurchase, t("notYet"))}</b>.
            <span className="muted small"> {t("fromUsageEvents")}</span>
          </p>
          {state.stale.length ? (
            <p className="error">
              {t("staleWarning")} {state.stale.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {state && overlay.length ? (
        <section className="card step" data-step="3">
          <h2>{t("step3")}</h2>
          <p className="muted small">{t("step3Help")}</p>
          <table>
            <thead>
              <tr>
                <th>{t("colItem")}</th>
                <th>{t("colSpokenName")}</th>
                <th>{t("colSummary")}</th>
                <th>{t("colSynonyms")}</th>
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
          <h2>{t("policiesTitle")}</h2>
          <p className="muted small">{t("policiesHelp")}</p>
          <label>{t("policyIntro")}</label>
          <input value={policies.voiceIntro} onChange={(e) => setPolicies({ ...policies, voiceIntro: e.target.value })} />
          <label>{t("policyDelivery")}</label>
          <input value={policies.deliveryNote} onChange={(e) => setPolicies({ ...policies, deliveryNote: e.target.value })} />
          <label>{t("policyReview")}</label>
          <input value={policies.reviewNote} onChange={(e) => setPolicies({ ...policies, reviewNote: e.target.value })} />
        </section>
      ) : null}

      {state && overlay.length ? (
        <section className="card step" data-step="4">
          <h2>{state.status === "published" ? t("step4Live") : t("step4Publish")}</h2>
          <p className="muted small">
            {state.status === "published" ? (
              <>
                {t("step4LiveNote")} <a href="#/">{t("step4LiveLink")}</a>
                {t("step4LiveRest")}
              </>
            ) : (
              t("step4Note")
            )}
          </p>
          <div className="row end">
            <button className="primary" onClick={() => void confirm()} disabled={busy !== null}>
              {busy === "confirm" ? t("publishing") : state.status === "published" ? t("publishChanges") : t("confirmAndPublish")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
