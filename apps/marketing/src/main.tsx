import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// The markup is pre-rendered into index.html at build time (scripts/prerender.mjs)
// so crawlers and no-JS visitors get the full page; here we only hydrate it.
hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <App />
  </StrictMode>
);
