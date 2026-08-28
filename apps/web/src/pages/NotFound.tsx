import { ArrowLeft, Home } from "lucide-react";
import { useNavigate } from "react-router";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export default function NotFound() {
  const navigate = useNavigate();
  useDocumentTitle("Page not found");

  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="font-serif text-[32px] text-ink">404</h1>
      <p className="text-[15px] text-ink-2">
        This page doesn't exist.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 rounded-lg border border-hairline px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Go back
        </button>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 rounded-lg bg-pine px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-1"
        >
          <Home className="h-3.5 w-3.5" aria-hidden="true" />
          Dashboard
        </button>
      </div>
    </div>
  );
}
