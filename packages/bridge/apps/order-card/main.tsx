/**
 * Order card: the get_order view. Status, lines, total and how it was paid, with the
 * SIMULATED label whenever the payment was. One action: show the receipt.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/theme.css";
import "./order-card.css";
import { useToolResult } from "../shared/useToolResult";

interface OrderView {
  orderId: string;
  externalOrderId: string | null;
  status: string;
  lines: Array<{ itemId: string; title: string; quantity: number; lineTotalMinor: string }>;
  totalMinor: string | null;
  asset: string;
  payment: { handler: string | null; pspMode: string | null; simulated: boolean; settlementReference: string | null; network: string | null };
  store: { name: string; origin: string };
}

function money(minor: string | null, asset: string): string {
  if (!minor) return "";
  const n = Number(minor) / 10_000_000;
  return `${n.toFixed(2).replace(/\.?0+$/, "")} ${asset}`;
}

function OrderCard() {
  const { app, data, isError, t } = useToolResult<{ order: OrderView }>("order-card");
  if (isError) return <p className="empty">{t("orderNotFound")}</p>;
  if (!data) return <p className="empty" aria-busy="true">{t("loadingOrder")}</p>;
  const o = data.order;
  const paid = o.status === "paid";
  const receipt = () => void app?.sendMessage({ role: "user", content: [{ type: "text", text: t("showReceiptFor", { order: o.orderId }) }] });
  return (
    <article className="order">
      <header>
        <div>
          <span className="eyebrow">{o.store.name}</span>
          <h1>
            {t("order")} {o.externalOrderId ?? o.orderId}
          </h1>
        </div>
        <span className={`status ${paid ? "paid" : ""}`}>{o.status.replace(/_/g, " ")}</span>
      </header>
      <ul className="lines">
        {o.lines.map((l, i) => (
          <li key={i}>
            <span>
              {l.quantity} x {l.title}
            </span>
            <span className="price">{money(l.lineTotalMinor || null, o.asset)}</span>
          </li>
        ))}
      </ul>
      <div className="total">
        <span>{t("total")}</span>
        <span className="price">{money(o.totalMinor, o.asset)}</span>
      </div>
      <div className="badges">
        {o.payment.simulated ? <span className="badge warn">{t("simulatedPayment")}</span> : null}
        {o.payment.pspMode === "test_mode" ? <span className="badge">{t("testModeBadge")}</span> : null}
        {o.payment.handler ? <span className="badge">{o.payment.handler}</span> : null}
        {o.payment.network ? <span className="badge">{o.payment.network}</span> : null}
      </div>
      <button className="cta" onClick={receipt}>
        {t("showReceipt")}
      </button>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OrderCard />
  </StrictMode>,
);
