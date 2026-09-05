import type { MediaKitViewModel } from "@sponsee/shared";

const CP1252_SPECIALS = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

function ascii(value: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function cp1252Byte(code: number): number | undefined {
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  return CP1252_SPECIALS.get(code);
}

function escapeLine(line: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  for (const char of line) {
    const byte = cp1252Byte(char.codePointAt(0) ?? 0);
    if (byte === undefined) {
      bytes.push(0x3f);
      continue;
    }
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) bytes.push(0x5c);
    bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

function buildLines(kit: MediaKitViewModel): string[] {
  const raw = [
    kit.creator.displayName,
    kit.headline ?? "Sponsorship proposal",
    kit.bio ?? "",
    "",
    "Offerings",
    ...kit.offerings.map((item) => `${item.title} \u2014 ${money(item.priceCents, item.currency)}`),
    "",
    "Examples",
    ...kit.examples.map((item) => `${item.title}: ${item.url}`),
  ];
  const lines: string[] = [];
  for (const part of raw) {
    const split = part.split(/\r?\n/);
    lines.push(...(split.length ? split : [""]));
  }
  return lines;
}

function buildContentStream(lines: string[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [ascii("BT\n/F1 12 Tf\n14 TL\n48 744 Td\n")];
  for (let i = 0; i < lines.length; i++) {
    parts.push(ascii("("), escapeLine(lines[i]), ascii(") Tj\n"));
    if (i < lines.length - 1) parts.push(ascii("T*\n"));
  }
  parts.push(ascii("ET"));
  return concat(parts);
}

export function buildProposalPdf(kit: MediaKitViewModel): Uint8Array<ArrayBuffer> {
  const content = buildContentStream(buildLines(kit));

  const objects = [
    ascii("<< /Type /Catalog /Pages 2 0 R >>\n"),
    ascii("<< /Type /Pages /Count 1 /Kids [3 0 R] >>\n"),
    ascii("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\n"),
    concat([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii("\nendstream\n")]),
    ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n"),
  ];

  const chunks: Uint8Array[] = [ascii("%PDF-1.4\n")];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset);
    const head = ascii(`${i + 1} 0 obj\n`);
    const tail = ascii("endobj\n");
    chunks.push(head, objects[i], tail);
    offset += head.length + objects[i].length + tail.length;
  }

  const xrefOffset = offset;
  const entryCount = objects.length + 1;
  const xrefLines = [`xref\n`, `0 ${entryCount}\n`, `0000000000 65535 f\r\n`];
  for (const objectOffset of offsets) {
    xrefLines.push(`${String(objectOffset).padStart(10, "0")} 00000 n\r\n`);
  }
  const tail = ascii(
    `${xrefLines.join("")}trailer\n<< /Size ${entryCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );
  chunks.push(tail);
  return concat(chunks);
}
