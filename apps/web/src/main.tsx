import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "./lib/auth";
import { TRPCProvider } from "./trpc";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </AuthProvider>
  </BrowserRouter>
);
