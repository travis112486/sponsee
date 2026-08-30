import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  useEffect(() => {
    document.title = "Not found · Sponsee";
  }, []);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-serif text-[48px] leading-none text-ink">404</p>
      <h2 className="mt-2 text-[15px] font-semibold text-ink">Page not found</h2>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">
        The page you're looking for doesn't exist or may have moved.
      </p>
      <Link
        to="/"
        className="mt-5 flex items-center gap-1.5 rounded-lg bg-pine px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to dashboard
      </Link>
    </div>
  );
}
