/**
 * Receipt card: the get_receipt view. The verification result is the headline: a verified
 * badge only when the Store's signature checks out, an amber badge for fixture or simulated
 * cases. Never a green badge for something unsigned.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/theme.css";
import "./receipt-card.css";
import { useToolResult } from "../shared/useToolResult";

interface ReceiptView {
  orderId: string;
  receipts: Array<{ type: string; issuedAt: string | null; totalMinor: string | null; txHash: string | null; signer: string | null; signed: boolean }>;
  verification: { valid: boolean; mode: string | null; note: string | null };
  payment: { simulated: boolean; pspMode: string | null; handler: string | null; settlementReference: string | null };
  store: { name: string; origin: string };
}

function Badge({ v, t }: { v: ReceiptView["verification"]; t: (key: "unsigned" | "verified" | "unverified") => string }) {
  if (v.mode === "fixture") return <span className="badge warn big">{t("unsigned")}</span>;
  if (v.valid) return <span className="badge ok big">{t("verified")}</span>;
  return <span className="badge bad big">{t("unverified")}</span>;
}

function ReceiptCard() {
  const { data, isError, t } = useToolResult<{ receipt: ReceiptView }>("receipt-card");
  if (isError) return <p className="empty">{t("noReceipt")}</p>;
  if (!data) return <p className="empty" aria-busy="true">{t("loadingReceipt")}</p>;
  const r = data.receipt;
  return (
    <article className="receipt">
      <header>
        <span className="eyebrow">{r.store.name}</span>
        <h1>
          {t("receiptFor")} {r.orderId}
        </h1>
      </header>
      <Badge v={r.verification} t={t} />
      {r.payment.simulated ? <span className="badge warn">{t("simulatedPayment")}</span> : null}
      <ol className="chain">
        {r.receipts.map((x, i) => (
          <li key={i}>
            <div className="row">
              <span className="type">{x.type}</span>
              <span className="muted">{x.issuedAt ? new Date(x.issuedAt).toLocaleString() : ""}</span>
            </div>
            {x.txHash ? <div className="hash" title={x.txHash}>{x.txHash}</div> : null}
            <div className="muted small">{x.signed ? t("signedBy", { signer: x.signer ?? t("theStore") }) : t("unsignedLine")}</div>
          </li>
        ))}
      </ol>
      {r.verification.note ? <p className="muted small">{r.verification.note}</p> : null}
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReceiptCard />
  </StrictMode>,
);
