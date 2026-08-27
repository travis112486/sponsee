import { useEffect, useState } from "react";

export default function Layout({
  children,
  title = "Sponsee — The Sponsorship CRM for Streamers",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const [navBorder, setNavBorder] = useState(false);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    const onScroll = () => setNavBorder(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <header
        className={`sticky top-0 z-50 bg-paper/92 backdrop-blur transition-shadow ${
          navBorder ? "shadow-warm border-b border-hairline" : ""
        }`}
      >
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
          <a href="/" className="font-serif text-[22px] text-ink">
            Sponsee<sup className="text-[13px]">™</sup>
          </a>
          <a
            href="/"
            className="rounded-[10px] bg-pine px-4 py-2 text-sm font-medium text-white transition hover:bg-pine-hover"
          >
            Back to home
          </a>
        </div>
      </header>
      <main>{children}</main>
      <footer className="bg-paper border-t border-hairline py-12">
        <div className="mx-auto max-w-[1120px] px-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="font-serif text-lg text-ink">
                Sponsee<sup className="text-xs">™</sup>
              </p>
              <p className="text-sm text-ink-3">The sponsorship CRM for streamers.</p>
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-ink-2">
              <a href="/privacy.html" className="hover:text-ink transition">Privacy</a>
              <a href="/terms.html" className="hover:text-ink transition">Terms</a>
              <a href="mailto:hello@sponsee.app" className="hover:text-ink transition">Contact</a>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-hairline text-[13px] text-ink-3">
            <p>Sponsee is not affiliated with Twitch, YouTube, TikTok, or Kick.</p>
            <p className="mt-1">© 2026 Sponsee.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
