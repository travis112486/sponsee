import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Layout from "./components/Layout";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Layout>
      <div className="mx-auto max-w-[720px] px-6 py-16 md:py-28 text-center">
        <h1 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-4">
          You&apos;re on the list.
        </h1>
        <p className="text-ink-2 leading-relaxed mb-8">
          We&apos;ll email you when your invite is ready — beta seats open in small batches. In the meantime, everything about how Sponsee works is on the landing page, and the free rate calculator is coming soon.
        </p>
        <a
          href="/"
          className="inline-block rounded-[10px] bg-pine px-8 py-3 font-medium text-white transition hover:bg-pine-hover"
        >
          Back to Sponsee
        </a>
      </div>
    </Layout>
  </StrictMode>
);
