/**
 * The public playground's panel block: what visitors bought through the demo, and the
 * waitlist. Renders nothing on a local simulator.
 */
import { useCallback, useEffect, useState } from "react";
import { playgroundApi, type PlaygroundStats } from "./api";

export function Playground() {
  const [stats, setStats] = useState<PlaygroundStats | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"merchant" | "shopper">("merchant");
  const [storeUrl, setStoreUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    playgroundApi.stats().then(setStats).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const join = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await playgroundApi.join({ email, role, consent, ...(role === "merchant" && storeUrl.trim() ? { storeUrl: storeUrl.trim() } : {}) });
      setNote({ ok: true, text: r.message });
      setEmail("");
      setStoreUrl("");
      setConsent(false);
      refresh();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [email, role, storeUrl, consent, refresh]);

  if (!stats?.playground) return null;
  return (
    <div className="playground">
      <label>Public playground</label>
      <p className="small">
        Purchases by visitors: <b>{stats.purchases?.thirdParty ?? "n/a"}</b>
        <span className="muted"> (simulated payments, capped at $50 per order; our own Scene runs are not counted)</span>
      </p>
      <label>Join the waitlist</label>
      <select value={role} onChange={(e) => setRole(e.target.value === "shopper" ? "shopper" : "merchant")}>
        <option value="merchant">I sell online and want my store on Alexa+</option>
        <option value="shopper">I want to shop this way</option>
      </select>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" />
      {role === "merchant" ? <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://your-store.example (optional)" aria-label="Store address" /> : null}
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Email me about AgentPOS for Alexa+. Nothing else, and I can ask to be removed.
      </label>
      <button onClick={() => void join()} disabled={busy || !email || !consent}>
        {busy ? "Joining" : "Join"}
      </button>
      {note ? <p className={note.ok ? "small good" : "small error"}>{note.text}</p> : null}
    </div>
  );
}
