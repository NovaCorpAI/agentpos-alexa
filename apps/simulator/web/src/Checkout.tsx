/**
 * The host's native checkout pattern, rendered by the Simulator the way Alexa+ renders
 * checkout for every add-on: summary, delivery address, payment choice, confirm. Nothing
 * here comes from an add-on view; it is fed by the UCP session.
 */
import { useState } from "react";
import type { CheckoutState } from "./api";
import { useT } from "./i18n";

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Checkout({ state, busy, onConfirm, onCancel }: { state: CheckoutState; busy: boolean; onConfirm: (handlerId: string, instrumentId?: string) => void; onCancel: () => void }) {
  const t = useT();
  const available = state.options.filter((o) => o.available);
  const [choice, setChoice] = useState(0);
  const s = state.session;
  // A buyer review (the guardian's question) keeps the quote and expects the buyer's answer.
  const review = s.status === "incomplete" && s.messages.some((m) => m.severity === "requires_buyer_review");
  const ready = s.status === "ready_for_complete" || review;
  const chosen = available[choice];
  return (
    <section className="checkout" aria-label={t("checkout")}>
      <header>
        <span className="eyebrow">{t("checkout")}</span>
        <span className={`pill ${ready ? "ok" : ""}`}>
          {s.status === "ready_for_complete" ? t("statusReady") : s.status === "completed" ? t("statusCompleted") : s.status === "canceled" ? t("statusCanceled") : t("statusIncomplete")}
        </span>
      </header>
      <ul className="lines">
        {s.line_items.map((l) => (
          <li key={l.id}>
            <span>
              {l.quantity} x {l.item.title}
            </span>
            <span>{dollars(l.item.price * l.quantity)}</span>
          </li>
        ))}
      </ul>
      <div className="totals">
        {s.totals.map((t, i) => (
          <div key={i} className={t.type === "total" ? "grand" : ""}>
            <span>{t.display_text ?? t.type}</span>
            <span>{dollars(t.amount)}</span>
          </div>
        ))}
      </div>
      <div className="address">
        <span className="eyebrow">{t("deliverTo")}</span>
        <span>Alex Demo, 1 Fixture Street, Santiago 8320000, CL</span>
        <span className="muted">{t("personaNote")}</span>
      </div>
      {s.messages.length ? (
        <ul className="messages">
          {s.messages.map((m, i) => (
            <li key={i} className={m.type}>
              {m.content}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="pay">
        <span className="eyebrow">{t("payWith")}</span>
        {available.length === 0 ? <span className="muted">{t("noPayment")}</span> : null}
        {available.map((o, i) => (
          <label key={`${o.handlerId}:${o.instrumentId ?? ""}`} className={i === choice ? "on" : ""}>
            <input type="radio" name="pay" checked={i === choice} onChange={() => setChoice(i)} />
            <span>{o.label}</span>
            {o.simulated ? <span className="sim">{t("simulated")}</span> : o.testMode ? <span className="sim test">{t("testMode")}</span> : null}
          </label>
        ))}
        {state.options
          .filter((o) => !o.available)
          .map((o) => (
            <label key={`${o.handlerId}:na`} className="na">
              <span>{o.label}</span>
              <span className="muted">{o.reason}</span>
            </label>
          ))}
      </div>
      <div className="actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </button>
        <button className="primary" onClick={() => chosen && onConfirm(chosen.handlerId, chosen.instrumentId)} disabled={busy || !ready || !chosen}>
          {busy ? t("paying") : review ? t("yesOrderAgain") : t("confirm", { total: dollars(s.totals.find((line) => line.type === "total")?.amount ?? 0) })}
        </button>
      </div>
    </section>
  );
}
