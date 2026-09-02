/** Human-readable binary size ("2.4 MB", "4 GB") — matches the 1024-based GiB cap. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** Friendly type label — a PDF is "PDF", an image is its extension uppercased. */
export function fileTypeLabel(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return mimeType.slice("image/".length).toUpperCase();
  return mimeType || "File";
}
