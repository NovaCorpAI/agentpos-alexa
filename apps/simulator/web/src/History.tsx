/**
 * The household's own purchases at this store, drawn by the host the way the checkout is:
 * Alexa+ knows what you ordered, the store knows what it sold. Every number here comes from
 * a settled checkout session; nothing is estimated and nothing is stored about the person.
 */
import type { PurchaseSummary } from "./api";
import { useLang, useT } from "./i18n";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function History({ summary }: { summary: PurchaseSummary }) {
  const t = useT();
  const [lang] = useLang();
  const locale = lang === "es" ? "es-CL" : "en-US";
  // The period starts at the first of the month in UTC, so it is read in UTC: a household in
  // Santiago should not be told its month began on the 31st.
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <section className="history" aria-label={t("historyTitle")}>
      <header>
        <span className="eyebrow">{t("historyTitle")}</span>
        <span className="pill">{t("historySince", { date: day(summary.since) })}</span>
      </header>
      <div className="headline">
        <b>{money(summary.totals.amountCents)}</b>
        <span className="muted">{t("historyOrders", { orders: summary.totals.orders })}</span>
      </div>
      {summary.orders.length === 0 ? (
        <p className="muted">{t("historyNone")}</p>
      ) : (
        <ul className="lines">
          {summary.orders.slice(0, 4).map((o) => (
            <li key={o.orderId}>
              <span>
                {day(o.at)} · {o.lines.map((l) => `${l.quantity} ${l.title}`).join(", ")}
              </span>
              <span>{money(o.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {summary.top.length ? (
        <p className="muted small">
          {t("historyTop")} {summary.top.map((l) => `${l.title} x${l.quantity}`).join(", ")}
        </p>
      ) : null}
    </section>
  );
}
