import { StrictMode } from "react";
import type { ReactElement } from "react";
import App from "./App";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import ConfirmedPage from "./pages/ConfirmedPage";

/**
 * Every React-rendered marketing route, keyed by the HTML file `vite build`
 * emits for it. scripts/prerender.mjs renders each one into that file's
 * `<div id="root">` so the served HTML carries the copy and the links.
 *
 * The element here must be the exact tree the matching client entry hydrates,
 * or hydration will throw the markup away and re-render from scratch.
 */
export const PAGES: Record<string, ReactElement> = {
  "index.html": (
    <StrictMode>
      <App />
    </StrictMode>
  ),
  "privacy.html": (
    <StrictMode>
      <PrivacyPage />
    </StrictMode>
  ),
  "terms.html": (
    <StrictMode>
      <TermsPage />
    </StrictMode>
  ),
  "waitlist-confirmed.html": (
    <StrictMode>
      <ConfirmedPage />
    </StrictMode>
  ),
};
