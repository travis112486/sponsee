import type {
  BrandContext,
  CreatorContext,
  DraftSection,
  OfferingContext,
} from "./types.js";

function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtCurrency(cents: number, currency: string): string {
  const amount = (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

function platformReachBlock(ctx: CreatorContext): string {
  if (ctx.platforms.length === 0) return "No platform stats are connected yet.";
  return ctx.platforms
    .map((p) => {
      const parts: string[] = [];
      parts.push(`${p.platform}${p.handle ? ` (${p.handle})` : ""}`);
      if (p.ccv != null) parts.push(`avg concurrent viewers: ${p.ccv}`);
      if (p.followers != null) parts.push(`followers: ${p.followers}`);
      if (p.scheduleLabel) parts.push(`schedule: ${p.scheduleLabel}`);
      return parts.join(" · ");
    })
    .join("\n");
}

function dealHistoryBlock(ctx: CreatorContext): string {
  const d = ctx.dealHistory;
  if (d.total === 0) return "No past brand deals recorded yet.";
  const lines: string[] = [
    `${d.total} deal${d.total === 1 ? "" : "s"} logged (${d.paid} paid)`,
  ];
  if (d.brandCategories.length > 0) {
    lines.push(`brand categories worked with: ${[...new Set(d.brandCategories)].join(", ")}`);
  }
  if (d.recentTitles.length > 0) {
    lines.push(`recent deals: ${d.recentTitles.join("; ")}`);
  }
  if (d.typicalValueCents) {
    lines.push(
      `typical deal value: ${fmtCents(d.typicalValueCents.min)}–${fmtCents(d.typicalValueCents.max)}`,
    );
  }
  return lines.join("\n");
}

function cpvhBlock(ctx: CreatorContext): string {
  if (!ctx.cpvhGuidance) return "No benchmark pricing guidance available yet.";
  const g = ctx.cpvhGuidance;
  return `benchmark price guidance per viewer-hour (floor/mid/agency): ${fmtCents(g.floor)} / ${fmtCents(g.mid)} / ${fmtCents(g.agency)}`;
}

/**
 * Assemble a factual, creator-owned summary of the account. Every field here
 * comes from the creator's own rows (creators, creator_platforms, deals,
 * benchmark_configs) — never third-party PII, never scraped data.
 */
export function summarizeCreator(ctx: CreatorContext): string {
  const who = [
    `creator: ${ctx.displayName}`,
    ctx.pronouns ? `pronouns: ${ctx.pronouns}` : null,
    ctx.category ? `category: ${ctx.category}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    who,
    "",
    "Reach:",
    platformReachBlock(ctx),
    "",
    "Deal history:",
    dealHistoryBlock(ctx),
    "",
    "Pricing:",
    cpvhBlock(ctx),
  ].join("\n");
}

function systemDirective(section: DraftSection): string {
  const base = [
    "You are a sponsorship-media-kit copywriter for a live-streaming creator.",
    "Write first-person, natural, factual copy. Never invent statistics, viewers, followers, past clients, or brand names not given to you.",
    "Use only the creator's own data provided below.",
    "Return plain text with no markdown, no headings, and no quotation marks.",
    "Keep it warm, confident, and professional — not salesy or exaggerated.",
  ];

  switch (section) {
    case "bio":
      return base.concat([
        "Write a short bio/about paragraph (2–4 sentences) introducing the creator and what brands get from working with them.",
      ]).join(" ");
    case "audience":
      return base.concat([
        "Write an audience summary (2–4 sentences) describing the creator's reach, platforms, and typical viewership, grounded strictly in the numbers provided.",
      ]).join(" ");
    case "offering":
      return base.concat([
        "Write a concise offering description (2–4 sentences) for the sponsorship package named below, tying it to the creator's reach and the benchmark pricing guidance where relevant.",
      ]).join(" ");
    case "pitch":
      return base.concat([
        "Write a pitch paragraph (3–5 sentences) to send to a prospective brand. Reference the creator's reach and track record, and end with a confident invitation to discuss a partnership.",
      ]).join(" ");
  }
}

function sectionContextBlock(
  section: DraftSection,
  offering?: OfferingContext,
  brand?: BrandContext,
): string {
  const lines: string[] = [];
  if (section === "offering" && offering) {
    lines.push(`Offering to describe: ${offering.title}`);
    if (offering.priceCents != null && offering.currency) {
      lines.push(`Offering price: ${fmtCurrency(offering.priceCents, offering.currency)}`);
    }
  }
  if (section === "pitch" && brand) {
    lines.push(`Target brand: ${brand.name}`);
    if (brand.category) lines.push(`Brand category: ${brand.category}`);
  }
  return lines.length ? lines.join("\n") : "";
}

export interface DraftPrompt {
  system: string;
  user: string;
}

export function buildDraftPrompt(
  ctx: CreatorContext,
  section: DraftSection,
  offering?: OfferingContext,
  brand?: BrandContext,
): DraftPrompt {
  const system = systemDirective(section);

  const userParts = ["Creator account:", summarizeCreator(ctx)];
  const extra = sectionContextBlock(section, offering, brand);
  if (extra) userParts.push("", extra);
  userParts.push("", "Draft the requested copy now.");

  return { system, user: userParts.join("\n") };
}
