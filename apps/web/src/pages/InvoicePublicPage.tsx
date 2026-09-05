import { useEffect } from "react";
import { useParams } from "react-router";
import { trpc } from "@/trpc";
import "./invoice-page.css";

type Rails = {
  displayName: string | null;
  paypalLink: string | null;
  wiseText: string | null;
  bankText: string | null;
  replyToEmail: string | null;
};

function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function termsLabel(terms: string): string {
  const map: Record<string, string> = { net_15: "Net 15", net_30: "Net 30", net_45: "Net 45" };
  return map[terms] ?? terms;
}

function invoiceNumberFormatted(number: number): string {
  return `INV-${String(number).padStart(4, "0")}`;
}

function hasRails(rails: Rails): boolean {
  return Boolean(rails.paypalLink || rails.wiseText || rails.bankText);
}

// paypalLink is creator-controlled and rendered as a live href on this public,
// unauthenticated page. HTML-escaping stops attribute breakout but not
// `javascript:`/`data:` URLs, so only an https: link is rendered as a link
// (SPO-368 F3). Anything else is shown as inert text.
function isSafeHref(url: string | null): url is string {
  return typeof url === "string" && url.startsWith("https://");
}

/**
 * Hosted invoice view (/i/:token) — the one public, unauthenticated page in the
 * app. Renders the invoice snapshot a brand's AP team prints to PDF and files.
 * No app chrome; the print stylesheet in invoice-page.css is the deliverable.
 */
export default function InvoicePublicPage() {
  const { token = "" } = useParams();
  const query = trpc.invoice.publicView.useQuery({ token });

  const invoice = query.data;

  useEffect(() => {
    document.title = invoice
      ? `Invoice ${invoiceNumberFormatted(invoice.invoiceNumber)} — ${invoice.creatorDisplayName ?? "Sponsee"}`
      : "Invoice · Sponsee";
  }, [invoice]);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  if (query.isLoading) {
    return (
      <div className="invoice-page flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  if (query.isError || !invoice) {
    return (
      <div className="invoice-page flex min-h-screen items-center justify-center">
        <div className="rounded-lg border border-[#E8E3DB] bg-white px-6 py-8 text-center">
          <p className="font-serif text-[28px] text-[#1B1815]">Invoice not found</p>
          <p className="mt-2 text-[13px] text-[#8A8178]">
            This link may have expired. Please contact the sender for a new one.
          </p>
        </div>
      </div>
    );
  }

  const rails: Rails = invoice.railsSnapshot;
  const amount = formatAmount(invoice.amountCents, invoice.currency);
  const railsPresent = hasRails(rails);

  return (
    <div className="invoice-page">
      <main className="sheet">
        <header className="head">
          <div>
            <h1 className="from-name serif">{invoice.creatorDisplayName ?? "Sponsee"}</h1>
            <div className="from-sub">Invoice for sponsorship services</div>
            {invoice.creatorEmail ? (
              <div className="from-sub">{invoice.creatorEmail}</div>
            ) : null}
          </div>
          <div className="doc-id">
            <div className="doc-label">Invoice</div>
            <div className="doc-number tnum">{invoiceNumberFormatted(invoice.invoiceNumber)}</div>
            {invoice.paid && <span className="chip-paid">Paid</span>}
          </div>
        </header>

        <section className="meta">
          <dl className="dates tnum">
            <dt>Issued</dt>
            <dd>{invoice.issuedAt ? formatDate(invoice.issuedAt) : "—"}</dd>
            <dt>Due</dt>
            <dd>{invoice.dueAt ? formatDate(invoice.dueAt) : "On receipt"}</dd>
            <dt>Terms</dt>
            <dd>{termsLabel(invoice.terms)}</dd>
          </dl>
        </section>

        <section className="line">
          <h2>For</h2>
          <p className="deal-title">{invoice.title || "Sponsorship services"}</p>
          {invoice.milestoneNote && <p className="milestone">{invoice.milestoneNote}</p>}
        </section>

        <section className="amount">
          <span className="label">{invoice.paid ? "Amount paid" : "Amount due"}</span>
          <span className="value serif tnum">
            {amount}
            <span className="cur">{invoice.currency}</span>
          </span>
        </section>

        <section className="pay">
          {invoice.paid ? (
            <p className="paid-note">
              <strong>This invoice has been paid.</strong> No further action is needed.
            </p>
          ) : (
            <>
              {railsPresent ? (
                <>
                  <h2>How to pay</h2>
                  {rails.paypalLink && (
                    <div className="rail">
                      <div className="rail-name">PayPal</div>
                      <div className="rail-body">
                        {isSafeHref(rails.paypalLink) ? (
                          <a href={rails.paypalLink} rel="noopener noreferrer">
                            {rails.paypalLink}
                          </a>
                        ) : (
                          rails.paypalLink
                        )}
                      </div>
                    </div>
                  )}
                  {rails.wiseText && (
                    <div className="rail">
                      <div className="rail-name">Wise</div>
                      <div className="rail-body">{rails.wiseText}</div>
                    </div>
                  )}
                  {rails.bankText && (
                    <div className="rail">
                      <div className="rail-name">Bank transfer</div>
                      <div className="rail-body">{rails.bankText}</div>
                    </div>
                  )}
                </>
              ) : (
                <p className="no-rails">
                  To arrange payment, reply to the invoice email and{" "}
                  {invoice.creatorDisplayName ?? "the sender"} will send payment details.
                </p>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="screen-bar">
        <span>
          Questions about this invoice? Reply to the invoice email — it reaches{" "}
          {invoice.creatorDisplayName ?? "the sender"} directly.
        </span>
        <button type="button" className="print-btn" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </footer>
    </div>
  );
}
