import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Merchant } from "./Merchant";
import "./styles.css";

// Two routes, two sides: the Household's simulator and the Merchant console (#/merchant).
// The console imports nothing from the Household side (docs/ARCHITECTURE.md).
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.startsWith("#/merchant") ? <Merchant /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
