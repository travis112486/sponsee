import { Outlet, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { Sidebar, Topbar } from "./Navbar";
import Footer from "./Footer";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/pipeline": "Pipeline",
  "/payments": "Payments",
  "/calendar": "Calendar",
  "/settings": "Settings",
  "/login": "Login",
};

function useDocumentTitle() {
  const location = useLocation();
  useEffect(() => {
    const base = "Sponsee";
    const routeTitle = pageTitles[location.pathname];
    if (routeTitle) {
      document.title = `${routeTitle} · ${base}`;
    } else if (location.pathname.startsWith("/pipeline/")) {
      document.title = `Deal · ${base}`;
    } else {
      document.title = base;
    }
  }, [location.pathname]);
}

/**
 * App shell: 232px sidebar (off-canvas drawer below lg) + 56px topbar +
 * internally-scrolling content slot (D-011).
 */
export default function Layout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useDocumentTitle();

  return (
    <div className="min-h-[100dvh] bg-paper">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Topbar onMenuClick={() => setSidebarOpen(true)} />
      <main className="fixed bottom-0 left-0 right-0 top-14 overflow-y-auto lg:left-[232px]">
        <ScrollReset key={location.pathname} />
        <div className="mx-auto max-w-[1360px] p-4 sm:p-6">
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
