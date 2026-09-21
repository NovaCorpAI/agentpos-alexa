/**
 * The public playground's panel block: what visitors bought through the demo, and the
 * waitlist. Renders nothing on a local simulator.
 */
import { useCallback, useEffect, useState } from "react";
import { playgroundApi, type PlaygroundStats } from "./api";
import { useT } from "./i18n";

export function Playground() {
  const t = useT();
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
      <label>{t("playground")}</label>
      <p className="small">
        {t("purchasesByVisitors")} <b>{stats.purchases?.thirdParty ?? "n/a"}</b>
        <span className="muted"> {t("purchasesNote")}</span>
      </p>
      <label>{t("joinWaitlist")}</label>
      <select value={role} onChange={(e) => setRole(e.target.value === "shopper" ? "shopper" : "merchant")} aria-label={t("joinWaitlist")}>
        <option value="merchant">{t("roleMerchant")}</option>
        <option value="shopper">{t("roleShopper")}</option>
      </select>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} aria-label="Email" />
      {role === "merchant" ? <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder={t("storeUrlOptional")} aria-label={t("storeAddress")} /> : null}
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {t("consent")}
      </label>
      <button onClick={() => void join()} disabled={busy || !email || !consent}>
        {busy ? t("joining") : t("join")}
      </button>
      {note ? <p className={note.ok ? "small good" : "small error"}>{note.text}</p> : null}
    </div>
  );
}
