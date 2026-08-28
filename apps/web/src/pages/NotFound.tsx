import { useNavigate } from "react-router";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="font-serif text-[64px] font-semibold leading-none text-ink">
        404
      </h1>
      <p className="mt-4 text-[15px] text-ink-2">
        This page doesn't exist.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-4 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-subtle"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Go back
        </button>
        <button
          onClick={() => navigate("/")}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-pine px-4 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover"
        >
          <Home className="h-3.5 w-3.5" />
          Dashboard
        </button>
      </div>
    </div>
  );
}
