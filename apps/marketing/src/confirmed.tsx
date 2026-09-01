import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import "./index.css";
import ConfirmedPage from "./pages/ConfirmedPage";

hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <ConfirmedPage />
  </StrictMode>
);
