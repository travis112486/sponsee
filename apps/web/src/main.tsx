import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "./lib/auth";
import { MotionProvider } from "./components/MotionProvider";
import { TRPCProvider } from "./trpc";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <TRPCProvider>
        <MotionProvider>
          <App />
        </MotionProvider>
      </TRPCProvider>
    </AuthProvider>
  </BrowserRouter>
);
