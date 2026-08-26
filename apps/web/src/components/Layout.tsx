import { Outlet, useLocation } from "react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { Sidebar, Topbar } from "./Navbar";
import Footer from "./Footer";

/**
 * App shell: fixed 232px sidebar + 56px topbar + internally-scrolling content slot.
 */
export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-[100dvh] bg-paper">
      <Sidebar />
      <Topbar />
      <main className="fixed bottom-0 left-[232px] right-0 top-14 overflow-y-auto">
        <ScrollReset key={location.pathname} />
        <div className="mx-auto max-w-[1360px] p-6">
          <Outlet />
          <Footer />
        </div>
      </main>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#FFFFFF",
            border: "1px solid #E8E3DB",
            color: "#1B1815",
            boxShadow: "0 4px 16px rgba(27,24,21,.08), 0 1px 3px rgba(27,24,21,.06)",
          },
        }}
      />
    </div>
  );
}

function ScrollReset() {
  const location = useLocation();
  useEffect(() => {
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, [location.pathname]);
  return null;
}
