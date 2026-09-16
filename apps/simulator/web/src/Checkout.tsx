/**
 * The host's native checkout pattern, rendered by the Simulator the way Alexa+ renders
 * checkout for every add-on: summary, delivery address, payment choice, confirm. Nothing
 * here comes from an add-on view; it is fed by the UCP session.
 */
import { useState } from "react";
import type { CheckoutState } from "./api";

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Checkout({ state, busy, onConfirm, onCancel }: { state: CheckoutState; busy: boolean; onConfirm: (handlerId: string, instrumentId?: string) => void; onCancel: () => void }) {
  const available = state.options.filter((o) => o.available);
  const [choice, setChoice] = useState(0);
  const s = state.session;
  // A buyer review (the guardian's question) keeps the quote and expects the buyer's answer.
  const review = s.status === "incomplete" && s.messages.some((m) => m.severity === "requires_buyer_review");
  const ready = s.status === "ready_for_complete" || review;
  const chosen = available[choice];
  return (
    <section className="checkout" aria-label="Checkout">
      <header>
        <span className="eyebrow">Checkout</span>
        <span className={`pill ${ready ? "ok" : ""}`}>{s.status.replace(/_/g, " ")}</span>
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
        <span className="eyebrow">Deliver to</span>
        <span>Alex Demo, 1 Fixture Street, Santiago 8320000, CL</span>
        <span className="muted">Synthetic persona of the demo household</span>
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
        <span className="eyebrow">Pay with</span>
        {available.length === 0 ? <span className="muted">No payment method is wired in the simulator for this store yet.</span> : null}
        {available.map((o, i) => (
          <label key={`${o.handlerId}:${o.instrumentId ?? ""}`} className={i === choice ? "on" : ""}>
            <input type="radio" name="pay" checked={i === choice} onChange={() => setChoice(i)} />
            <span>{o.label}</span>
            {o.simulated ? <span className="sim">SIMULATED</span> : null}
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
          Cancel
        </button>
        <button className="primary" onClick={() => chosen && onConfirm(chosen.handlerId, chosen.instrumentId)} disabled={busy || !ready || !chosen}>
          {busy ? "Paying" : review ? "Yes, order it again" : `Confirm ${dollars(s.totals.find((t) => t.type === "total")?.amount ?? 0)}`}
        </button>
      </div>
    </section>
  );
}
