import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./index.css";
import TermsPage from "./pages/TermsPage";

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <TermsPage />
  </StrictMode>
);
