export const pageTitles: Record<string, { title: string; crumb?: string }> = {
  "/": { title: "Dashboard" },
  "/pipeline": { title: "Pipeline" },
  "/payments": { title: "Payments" },
  "/calendar": { title: "Calendar" },
  "/calculator": { title: "Rate Calculator" },
  "/settings": { title: "Settings" },
};

/**
 * Resolve the fixed top-bar title for a pathname. Dynamic deal routes
 * (`/pipeline/:id`) must read as "Deal" with Pipeline context, never the
 * static "Dashboard" fallback (P-04 / SPO-57).
 */
export function resolveTopbarPage(pathname: string): { title: string; crumb?: string } {
  const exact = pageTitles[pathname];
  if (exact) return exact;
  if (pathname.startsWith("/pipeline/")) {
    return { title: "Deal", crumb: "Pipeline" };
  }
  return { title: "Dashboard" };
}
