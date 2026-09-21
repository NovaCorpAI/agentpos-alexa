/**
 * Item card: the get_item view. One item with everything the store publishes about it,
 * and one action: ask to buy it. Nothing here is computed; it is all from the tool result.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/theme.css";
import "./item-card.css";
import { useToolResult } from "../shared/useToolResult";

interface ItemView {
  id: string;
  title: string;
  description: string;
  price: { minor: string; asset: string; display: string };
  imageUrl?: string;
  physical: boolean;
  attributes: Record<string, unknown>;
}

function Facts({ attributes, t }: { attributes: Record<string, unknown>; t: (key: "allergens" | "ingredients" | "weight" | "pieces") => string }) {
  const rows: Array<[string, string]> = [];
  const allergens = attributes.allergens;
  if (Array.isArray(allergens) && allergens.length) rows.push([t("allergens"), allergens.map(String).join(", ")]);
  const ingredients = attributes.ingredients;
  if (Array.isArray(ingredients) && ingredients.length) rows.push([t("ingredients"), ingredients.map(String).join(", ")]);
  if (typeof attributes.weightGrams === "number") rows.push([t("weight"), `${attributes.weightGrams} g`]);
  if (typeof attributes.pieces === "number") rows.push([t("pieces"), String(attributes.pieces)]);
  if (rows.length === 0) return null;
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ItemCard() {
  const { app, data, isError, t } = useToolResult<{ item: ItemView }>("item-card");
  if (isError) return <p className="empty">{t("notInCatalog")}</p>;
  if (!data) return <p className="empty" aria-busy="true">{t("loadingItem")}</p>;
  const it = data.item;
  const buy = () => void app?.sendMessage({ role: "user", content: [{ type: "text", text: t("wantToBuy", { title: it.title }) }] });
  const gf = it.attributes.glutenFree;
  return (
    <article className="item">
      {it.imageUrl ? <img src={it.imageUrl} alt="" /> : <div className="img-placeholder" aria-hidden="true" />}
      <div className="body">
        <h1>{it.title}</h1>
        <p className="price">{it.price.display}</p>
        <p className="desc">{it.description}</p>
        <div className="badges">
          {gf === true ? <span className="badge ok">{t("glutenFree")}</span> : null}
          {gf === false ? <span className="badge warn">{t("containsGluten")}</span> : null}
          {it.physical ? <span className="badge">{t("delivered")}</span> : <span className="badge">{t("digital")}</span>}
        </div>
        <Facts attributes={it.attributes} t={t} />
        <button className="cta" onClick={buy}>
          {t("buyThis")}
        </button>
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ItemCard />
  </StrictMode>,
);
