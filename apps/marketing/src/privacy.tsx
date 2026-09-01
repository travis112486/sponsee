import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./index.css";
import PrivacyPage from "./pages/PrivacyPage";

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <PrivacyPage />
  </StrictMode>
);
