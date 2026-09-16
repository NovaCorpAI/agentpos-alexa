/**
 * Carousel: the search_items view. Three to five cards, the first one ready as soon as the
 * result arrives (Amazon's guidance: first item within 500 ms). Tapping a card asks the
 * assistant about that item, so the conversation stays voice-first.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/theme.css";
import "./carousel.css";
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

interface SearchResult {
  query: string | null;
  total: number;
  items: ItemView[];
  store: { name: string; url: string };
}

function Carousel() {
  const { app, data, isError, displayMode } = useToolResult<SearchResult>("carousel");
  if (isError) return <p className="empty">The store could not answer right now.</p>;
  if (!data) return <p className="empty" aria-busy="true">Loading items</p>;
  if (data.items.length === 0) return <p className="empty">Nothing found{data.query ? ` for "${data.query}"` : ""}.</p>;
  const items = data.items.slice(0, 5);
  const ask = (it: ItemView) =>
    void app?.sendMessage({ role: "user", content: [{ type: "text", text: `Tell me more about ${it.title}` }] });
  return (
    <section className={`carousel ${displayMode}`} aria-label={`${data.store.name} items`}>
      <header className="carousel-head">
        <span className="store">{data.store.name}</span>
        <span className="count">{data.total} item{data.total === 1 ? "" : "s"}</span>
      </header>
      <ul className="cards">
        {items.map((it) => (
          <li key={it.id}>
            <button className="card" onClick={() => ask(it)} aria-label={`${it.title}, ${it.price.display}`}>
              {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" /> : <div className="img-placeholder" aria-hidden="true" />}
              <span className="title">{it.title}</span>
              <span className="price">{it.price.display}</span>
              {it.attributes.glutenFree === true ? <span className="badge ok">Gluten free</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Carousel />
  </StrictMode>,
);
