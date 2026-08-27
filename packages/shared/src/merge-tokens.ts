// Canonical merge-token renderer for Sponsee chase emails.
// Same code path for Settings preview and actual sends.

export interface MergeContext {
  /** Brand contact name (e.g. "Sarah") */
  brandContact: string;
  /** Brand name (e.g. "NordVPN") */
  brand: string;
  /** Deal title (e.g. "July Sponsorship") */
  dealTitle: string;
  /** Invoice ID / number for display (e.g. "INV-0042") */
  invoiceId: string;
  /** Amount formatted for display (e.g. "$1,250.00") */
  amount: string;
  /** Due date formatted for display (e.g. "Aug 15, 2026") */
  dueDate: string;
  /** Days late as a number (0 if not late) */
  daysLate: number;
  /** Creator display name for sign-off */
  creatorName: string;
}

const TOKEN_RE_SOURCE = "\\{(brand_contact|brand|deal_title|invoice_id|amount|due_date|days_late|creator_name)\\}";

function makeTokenRe(flags?: string): RegExp {
  return new RegExp(TOKEN_RE_SOURCE, flags);
}

const TOKEN_MAP: Record<string, keyof MergeContext> = {
  brand_contact: "brandContact",
  brand: "brand",
  deal_title: "dealTitle",
  invoice_id: "invoiceId",
  amount: "amount",
  due_date: "dueDate",
  days_late: "daysLate",
  creator_name: "creatorName",
};

/**
 * Render a template string by replacing merge tokens with values from context.
 * Unknown tokens are left as-is so the user sees them in previews.
 */
export function renderMergeTokens(template: string, ctx: MergeContext): string {
  return template.replace(makeTokenRe("g"), (_match, rawKey: string) => {
    const key = TOKEN_MAP[rawKey];
    if (!key) return `{${rawKey}}`;
    const value = ctx[key];
    if (value === undefined || value === null) {
      return `{${rawKey}}`;
    }
    return String(value);
  });
}

/**
 * Validate that a template contains only known tokens.
 * Returns an array of unknown token strings (empty if valid).
 */
export function validateMergeTokens(template: string): string[] {
  const known = new Set([
    "brand_contact",
    "brand",
    "deal_title",
    "invoice_id",
    "amount",
    "due_date",
    "days_late",
    "creator_name",
  ]);
  const unknown: string[] = [];
  const matches = template.matchAll(makeTokenRe("g"));
  for (const match of matches) {
    const token = match[1];
    if (!known.has(token)) {
      unknown.push(token);
    }
  }
  // Also catch any {…} that didn't match the regex at all
  const allTokens = template.matchAll(/\{([a-z_]+)\}/g);
  for (const match of allTokens) {
    if (!known.has(match[1])) {
      unknown.push(match[1]);
    }
  }
  return [...new Set(unknown)];
}

/** Quick check: does the string contain any merge tokens at all? */
export function hasMergeTokens(template: string): boolean {
  return makeTokenRe().test(template);
}
