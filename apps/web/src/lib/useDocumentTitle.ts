import { useEffect } from "react";

const defaultTitle = "Sponsee — Run your sponsorships like an agency";

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · Sponsee` : defaultTitle;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
