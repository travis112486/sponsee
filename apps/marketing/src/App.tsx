import { useEffect, useState, useRef } from "react";
import {
  Check,
  CreditCard,
  LayoutDashboard,
  CalendarDays,
  Settings,
  Briefcase,
  ChevronDown,
  ShieldCheck,
  Globe,
} from "lucide-react";
import WaitlistForm from "./components/WaitlistForm";

function BrowserFrame({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="rounded-[14px] border border-hairline bg-surface shadow-warm-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-surface-subtle border-b border-hairline">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink/20" />
          <span className="h-2 w-2 rounded-full bg-ink/20" />
          <span className="h-2 w-2 rounded-full bg-ink/20" />
        </div>
        {label && <span className="ml-2 text-xs text-ink-3 font-mono">{label}</span>}
      </div>
      <div className="p-4 md:p-6">{children}</div>
    </div>
  );
}

function Section({
  id,
  children,
  className = "",
  alt = false,
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
  alt?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      id={id}
      className={`py-16 md:py-28 ${alt ? "bg-surface-subtle border-y border-hairline" : "bg-paper"} ${className} transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <div className="mx-auto max-w-[1120px] px-6">{children}</div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[13px] font-medium uppercase tracking-[0.06em] text-ink-3">
      {children}
    </p>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-ink-2">
      <Check className="mt-0.5 h-5 w-5 shrink-0 text-pine" strokeWidth={1.5} />
      <span>{children}</span>
    </li>
  );
}

function AccordionItem({
  question,
  answer,
  open,
  onClick,
}: {
  question: string;
  answer: string;
  open: boolean;
  onClick: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [answer]);

  return (
    <div className="border-b border-hairline">
      <button
        onClick={onClick}
        className="flex w-full items-center justify-between py-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pine focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <span className="font-serif text-lg md:text-xl text-ink pr-4">{question}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all"
        style={{ maxHeight: open ? (contentHeight || 200) : 0 }}
      >
        <p className="pb-5 text-ink-2 leading-relaxed">{answer}</p>
      </div>
    </div>
  );
}

const FAQS = [
  {
    q: "Do you take a cut of my deals?",
    a: "No. Flat monthly price. Your deals, your money, 100%.",
  },
  {
    q: "Do you hold my money?",
    a: "Never. Invoices carry your own PayPal / Wise / bank details and brands pay you directly. Sponsee tracks the invoice and helps you chase payment — it never touches the funds.",
  },
  {
    q: "Are you a marketplace? Will brands find me here?",
    a: "No. Sponsee runs the deals you land anywhere — DMs, email, through your agent. Your rates and your relationships stay yours.",
  },
  {
    q: "What platforms does it work with?",
    a: "Built for live creators on Twitch, YouTube Live, TikTok Live, and Kick. Deals from any platform can go in the pipeline.",
  },
  {
    q: "I have [X] viewers — is this for me?",
    a: "Sponsee is built for streamers roughly between 100 and 5,000 concurrent viewers who are already doing brand deals. Under that? The free rate calculator is still yours.",
  },
  {
    q: "Does Sponsee send emails as me?",
    a: "Chase emails go out with your name and reply to your own inbox — brands answer you, not a robot. In v1 you review and approve every email before it sends.",
  },
  {
    q: "Can I get my data out?",
    a: "Always — CSV / JSON export of every deal and invoice, on every plan.",
  },
];

export default function App() {
  const [navBorder, setNavBorder] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    const onScroll = () => setNavBorder(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToWaitlist = () => {
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-paper">
      {/* Nav */}
      <header
        className={`sticky top-0 z-50 bg-paper/92 backdrop-blur transition-shadow ${
          navBorder ? "shadow-warm border-b border-hairline" : ""
        }`}
      >
        <div className="mx-auto flex max-w-[1120px] items-center justify-between px-6 py-4">
          <a href="/" className="font-serif text-[22px] text-ink">
            Sponsee<sup className="text-[13px]">™</sup>
          </a>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="text-sm text-ink-2 hover:text-ink transition">How it works</a>
            <a href="#product" className="text-sm text-ink-2 hover:text-ink transition">Product</a>
            <a href="#pricing" className="text-sm text-ink-2 hover:text-ink transition">Pricing</a>
            <a href="#faq" className="text-sm text-ink-2 hover:text-ink transition">FAQ</a>
            <a href="/blog/rate-calculator-for-streamers.html" className="text-sm text-ink-2 hover:text-ink transition">Rate Calculator</a>
            <a href="/blog/pricing-your-first-sponsorship.html" className="text-sm text-ink-2 hover:text-ink transition">Pricing Guide</a>
            <a href="/blog/how-to-chase-late-payments.html" className="text-sm text-ink-2 hover:text-ink transition">Chase Guide</a>
          </nav>
          <button
            onClick={scrollToWaitlist}
            className="rounded-[10px] bg-pine px-4 py-2 text-sm font-medium text-white transition hover:bg-pine-hover"
          >
            Join the waitlist
          </button>
        </div>
      </header>

      {/* Hero */}
      <Section className="pt-12 md:pt-20 pb-0">
        <div className="text-center max-w-3xl mx-auto">
          <Eyebrow>The sponsorship CRM for streamers</Eyebrow>
          <h1 className="font-serif text-[40px] md:text-[64px] leading-[1.05] tracking-[-0.015em] text-ink mb-6">
            Run your sponsorships <em className="text-pine not-italic">like an agency.</em> Keep 100%.
          </h1>
          <p className="text-lg md:text-[18px] leading-relaxed text-ink-2 max-w-[640px] mx-auto mb-8">
            Every brand deal in one pipeline. Every deal priced against real CPVH benchmarks. Every late invoice chased on a schedule you control. Flat price, no cut — and your money never passes through us.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <button
              onClick={scrollToWaitlist}
              className="w-full sm:w-auto rounded-[10px] bg-pine px-8 py-3 font-medium text-white transition hover:bg-pine-hover"
            >
              Join the waitlist
            </button>
          </div>
          <p className="text-sm text-ink-3 mb-12">
            Private beta opening soon. Built for streamers between 100 and 5,000 concurrent viewers.
          </p>
        </div>
        {/* Hero screenshot placeholder */}
        <div className="max-w-[960px] mx-auto">
          <BrowserFrame label="pipeline.sponsee.app">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {["Inbound", "Negotiating", "Contract Sent", "Live"].map((stage) => (
                <div key={stage} className="rounded-lg border border-hairline bg-surface-subtle p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-ink">{stage}</span>
                    <span className="text-xs font-mono text-ink-3">{2}</span>
                  </div>
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-8 rounded bg-hairline/60" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </BrowserFrame>
        </div>
      </Section>

      {/* Trust strip */}
      <Section>
        <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-hairline">
          {[
            { icon: CreditCard, text: "Flat $19–$39/mo. No revenue share, no per-deal cut. Ever." },
            { icon: ShieldCheck, text: "Never touches your money. Brands pay you directly, on your own rails." },
            { icon: Globe, text: "Deals from anywhere. Your DMs, your inbox, your agent — Sponsee runs them all." },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-4 py-6 md:py-0 md:px-8 first:md:pl-0 last:md:pr-0">
              <Icon className="h-6 w-6 shrink-0 text-pine" strokeWidth={1.5} />
              <p className="text-ink-2 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Problem strip */}
      <Section alt>
        <div className="max-w-[720px] mx-auto text-center">
          <p className="font-serif text-2xl md:text-[28px] leading-relaxed text-ink mb-6">
            Your deals live in DMs.<br />
            Your rates live in your gut.<br />
            Your money lives in a brand&apos;s accounts-payable queue.
          </p>
          <div className="mb-4">
            <span className="font-mono text-[48px] md:text-[56px] text-brick leading-none">48–87%</span>
          </div>
          <p className="text-ink mb-2">of creators get paid late.</p>
          <p className="font-serif text-xl md:text-2xl text-ink mb-6">
            You&apos;re running a real business on vibes.
          </p>
          <p className="text-[13px] text-ink-3">
            * Lumanu survey: 48% of 500 influencers paid late in the past year. Industry payment-platform data cited by Campaign (2025) puts it as high as 87%.
          </p>
        </div>
      </Section>

      {/* Product Tour A — 3 Pillars */}
      <Section id="product">
        {/* Pillar 1: Pipeline */}
        <div className="grid md:grid-cols-5 gap-8 md:gap-12 items-center mb-20 md:mb-28">
          <div className="md:col-span-3 order-2 md:order-1">
            <BrowserFrame label="pipeline.sponsee.app">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {["Inbound", "Negotiating", "Contract Sent", "Live", "Delivered", "Paid"].map((stage) => (
                  <div key={stage} className="rounded-lg border border-hairline bg-surface-subtle p-2">
                    <div className="text-[10px] font-medium text-ink mb-1 truncate">{stage}</div>
                    <div className="text-[10px] font-mono text-ink-3">2 deals</div>
                    <div className="mt-1 space-y-1">
                      {[1].map((i) => (
                        <div key={i} className="h-6 rounded bg-hairline/50" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </BrowserFrame>
          </div>
          <div className="md:col-span-2 order-1 md:order-2">
            <Eyebrow>Pipeline</Eyebrow>
            <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-4">
              Every deal, one board.
            </h2>
            <p className="text-ink-2 leading-relaxed mb-6">
              A mid-tier streamer&apos;s &quot;pipeline&quot; is a Twitter DM, two email threads, a Discord ping, and a half-remembered verbal yes. Deals don&apos;t die because the brand said no — they die because nobody followed up. Sponsee gives every deal a card and every card a stage, from first DM to paid invoice.
            </p>
            <ul className="space-y-3">
              <CheckItem>Six stages: Inbound → Negotiating → Contract Sent → Live → Delivered → Paid</CheckItem>
              <CheckItem>Every column shows count and total value, live</CheckItem>
              <CheckItem>Days-in-stage aging, so nothing quietly rots</CheckItem>
            </ul>
          </div>
        </div>

        {/* Pillar 2: Rate Calculator */}
        <div className="grid md:grid-cols-5 gap-8 md:gap-12 items-center mb-20 md:mb-28">
          <div className="md:col-span-2">
            <Eyebrow>Rate Calculator</Eyebrow>
            <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-4">
              Know your number before you reply.
            </h2>
            <p className="text-ink-2 leading-relaxed mb-6">
              No platform publishes a rate card, and brands know it. Sponsee prices every deal in cost per viewer-hour — the benchmark real live deals clear at: $0.60–$1.50 per viewer-hour, up to ~$2.00 for agency-repped talent. Punch in your CCV and the deal shape; get your floor, mid, and high before you answer the DM.
            </p>
            <ul className="space-y-3">
              <CheckItem>Floor / mid / high for your exact CCV and deliverables</CheckItem>
              <CheckItem>See your past deals against the benchmark band</CheckItem>
              <CheckItem>The &quot;we usually do $200 flat&quot; reply-guy rate stops working on you</CheckItem>
            </ul>
            <div className="mt-4">
              <a href="/blog/rate-calculator-for-streamers.html" className="text-sm font-medium text-pine hover:underline">
                Try the free rate calculator →
              </a>
            </div>
          </div>
          <div className="md:col-span-3">
            <BrowserFrame label="calculator.sponsee.app">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="h-8 rounded bg-hairline/50" />
                  <div className="h-8 rounded bg-hairline/50" />
                  <div className="h-8 rounded bg-hairline/50" />
                </div>
                <div className="rounded-lg border border-hairline bg-pine-tint p-4">
                  <div className="text-xs font-medium text-pine mb-2">Your rate range</div>
                  <div className="font-mono text-lg text-ink mb-1">$420 – $1,050</div>
                  <div className="text-xs text-ink-3">for 3-hour sponsored stream</div>
                </div>
              </div>
            </BrowserFrame>
          </div>
        </div>

        {/* Pillar 3: Payments */}
        <div className="grid md:grid-cols-5 gap-8 md:gap-12 items-center">
          <div className="md:col-span-3 order-2 md:order-1">
            <BrowserFrame label="payments.sponsee.app">
              <div className="space-y-3">
                <div className="flex gap-2">
                  {["Current", "1–30 days", "31–60 days", "60+ days"].map((bucket) => (
                    <div key={bucket} className="flex-1 rounded-lg border border-hairline bg-surface-subtle p-3 text-center">
                      <div className="text-[10px] text-ink-3 mb-1">{bucket}</div>
                      <div className="font-mono text-sm text-ink">$2,400</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-hairline bg-surface-subtle p-3">
                  <div className="text-xs text-ink-3 mb-1">Chase sequence</div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-pine" />
                    <div className="h-2 w-2 rounded-full bg-pine" />
                    <div className="h-2 w-2 rounded-full bg-hairline" />
                    <span className="text-xs text-ink-2">Reminder 2 of 3</span>
                  </div>
                </div>
                <div className="rounded-lg bg-pine-tint p-3 text-xs text-pine">
                  Sponsee never holds your money. Invoices point to your own PayPal / Wise / bank details; brands pay you directly.
                </div>
              </div>
            </BrowserFrame>
          </div>
          <div className="md:col-span-2 order-1 md:order-2">
            <Eyebrow>Payments</Eyebrow>
            <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-4">
              The awkward follow-up email — handled.
            </h2>
            <p className="text-ink-2 leading-relaxed mb-6">
              Chasing a brand for your own money is the worst job in streaming: unpaid, awkward, and easy to put off — which is exactly why invoices go stale. Sponsee turns every deal into an invoice with a due date and a three-step chase sequence: friendly nudge, professional reminder, final notice. You approve each email before it sends.
            </p>
            <ul className="space-y-3">
              <CheckItem>Aging buckets: current, 1–30, 31–60, 60+ days</CheckItem>
              <CheckItem>Three-step chase ladder, on your timing, in your voice</CheckItem>
              <CheckItem>Never write &quot;hey, just bumping this 🙂&quot; again</CheckItem>
            </ul>
            <div className="mt-6 rounded-[10px] bg-pine-tint p-4 text-sm text-pine">
              <strong>Sponsee never holds your money.</strong> Invoices point to your own PayPal / Wise / bank details; brands pay you directly.
            </div>
            <div className="mt-4">
              <a href="/blog/how-to-chase-late-payments.html" className="text-sm font-medium text-pine hover:underline">
                Read the chase guide →
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* Product Tour B — Back office grid */}
      <Section alt>
        <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink text-center mb-12">
          A complete back office, not a widget.
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            {
              icon: LayoutDashboard,
              title: "Dashboard",
              body: "The 60-second answer to 'what needs my attention today?' Pipeline value, deliverables due, outstanding invoices, revenue by month.",
            },
            {
              icon: Briefcase,
              title: "Deal workspace",
              body: "Everything about one deal on one screen: deliverables checklist, proof-of-delivery, contract-to-payment timeline, full activity log.",
            },
            {
              icon: CalendarDays,
              title: "Deliverable calendar",
              body: "Your sponsor obligations laid over your streaming schedule, color-coded by brand. Missed one? Reschedule it in two clicks, logged.",
            },
            {
              icon: Settings,
              title: "Settings & templates",
              body: "Your payout details, your chase-email templates, your platform connections. Export everything as CSV / JSON, anytime — your data is never locked in.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-[14px] border border-hairline bg-surface shadow-warm-md p-6"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-subtle border border-hairline">
                <Icon className="h-5 w-5 text-ink-2" strokeWidth={1.5} />
              </div>
              <h3 className="font-sans text-lg font-semibold text-ink mb-2">{title}</h3>
              <p className="text-ink-2 leading-relaxed text-sm">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works">
        <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink text-center mb-12">
          Set up in an evening, not a sprint.
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              num: "01",
              title: "Drop your deals in.",
              body: "Add the deals sitting in your DMs and inbox — takes about ten minutes.",
            },
            {
              num: "02",
              title: "Price with benchmarks.",
              body: "The calculator turns your CCV into a defensible number.",
            },
            {
              num: "03",
              title: "Go live. Sponsee chases.",
              body: "Deliverables tracked, invoices generated, late payments followed up on schedule — every chase email yours to approve.",
            },
          ].map(({ num, title, body }) => (
            <div key={num} className="text-center md:text-left">
              <span className="font-serif text-[32px] text-pine">{num}</span>
              <h3 className="font-sans text-lg font-semibold text-ink mt-2 mb-2">{title}</h3>
              <p className="text-ink-2 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Free guides */}
      <Section id="guides" alt>
        <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink text-center mb-12">
          Free tools &amp; guides.
        </h2>
        <div className="grid md:grid-cols-3 gap-6 max-w-[960px] mx-auto">
          <a
            href="/blog/rate-calculator-for-streamers.html"
            className="rounded-[14px] border border-hairline bg-surface shadow-warm-md p-6 hover:border-pine transition"
          >
            <h3 className="font-sans text-lg font-semibold text-ink mb-2">Rate Calculator</h3>
            <p className="text-ink-2 leading-relaxed text-sm">
              Calculate what to charge for Twitch, YouTube Live, TikTok Live, and Kick sponsorships using real CPVH benchmarks.
            </p>
          </a>
          <a
            href="/blog/pricing-your-first-sponsorship.html"
            className="rounded-[14px] border border-hairline bg-surface shadow-warm-md p-6 hover:border-pine transition"
          >
            <h3 className="font-sans text-lg font-semibold text-ink mb-2">Pricing Your First Sponsorship</h3>
            <p className="text-ink-2 leading-relaxed text-sm">
              How much should you charge for your first brand deal? A data-backed guide for streamers with 100–5,000 viewers.
            </p>
          </a>
          <a
            href="/blog/how-to-chase-late-payments.html"
            className="rounded-[14px] border border-hairline bg-surface shadow-warm-md p-6 hover:border-pine transition"
          >
            <h3 className="font-sans text-lg font-semibold text-ink mb-2">How to Chase Late Payments</h3>
            <p className="text-ink-2 leading-relaxed text-sm">
              The three-email ladder that gets you paid without burning bridges — and the exact scripts to copy.
            </p>
          </a>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" alt>
        <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink text-center mb-12">
          Flat pricing. No cut. Ever.
        </h2>
        <div className="grid md:grid-cols-3 gap-6 max-w-[960px] mx-auto">
          {[
            {
              name: "Starter",
              price: "$19",
              desc: "For your first serious quarter of deals.",
              features: ["5 active deals", "20 invoices/mo", "1 chase template set", "Rate calculator"],
            },
            {
              name: "Creator",
              price: "$29",
              desc: "The full back office.",
              features: [
                "Unlimited deals and invoices",
                "Full chase sequences",
                "Calendar sync",
                "Benchmark reports",
              ],
              best: true,
            },
            {
              name: "Pro",
              price: "$39",
              desc: "For streamers running sponsorships at volume.",
              features: [
                "Everything in Creator",
                "Multi-platform analytics",
                "Custom branding on invoices",
                "Priority support & early features",
              ],
            },
          ].map((tier) => (
            <div
              key={tier.name}
              className={`rounded-[14px] border bg-surface p-6 ${
                tier.best ? "border-pine border-[1.5px]" : "border-hairline"
              }`}
            >
              {tier.best && (
                <span className="mb-4 inline-block rounded-full bg-pine-tint px-3 py-1 text-xs font-medium text-pine">
                  Best value
                </span>
              )}
              <h3 className="font-sans text-lg font-semibold text-ink">{tier.name}</h3>
              <div className="mt-2 mb-1 font-mono text-[40px] text-ink">{tier.price}<span className="text-lg text-ink-3">/mo</span></div>
              <p className="text-sm text-ink-3 mb-6">{tier.desc}</p>
              <ul className="space-y-3 mb-6">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-ink-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-pine" strokeWidth={1.5} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="text-center mt-8">
          <p className="text-sm text-ink-3 mb-4">
            14-day trial, no card required. Annual = 2 months free. Free forever: the rate calculator.
          </p>
          <button
            onClick={scrollToWaitlist}
            className="rounded-[10px] bg-pine px-8 py-3 font-medium text-white transition hover:bg-pine-hover"
          >
            Join the waitlist
          </button>
          <p className="mt-4 text-[15px] text-ink-2 italic">
            If we ever ask for a percentage of your deals, delete your account. (We won&apos;t.)
          </p>
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq">
        <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink text-center mb-8">
          Questions?
        </h2>
        <div className="max-w-[720px] mx-auto">
          {FAQS.map((faq, i) => (
            <AccordionItem
              key={i}
              question={faq.q}
              answer={faq.a}
              open={openFaq === i}
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
            />
          ))}
        </div>
      </Section>

      {/* Final CTA + Waitlist */}
      <Section id="waitlist" className="bg-pine-tint">
        <div className="max-w-[720px] mx-auto text-center">
          <h2 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-4">
            Your sponsorships are a business. Give them a back office.
          </h2>
          <p className="text-ink-2 mb-8">
            Join the waitlist and be first in when the private beta opens.
          </p>
          <WaitlistForm />
        </div>
      </Section>

      {/* Footer */}
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
              <a href="/blog/rate-calculator-for-streamers.html" className="hover:text-ink transition">Rate Calculator</a>
              <a href="/blog/pricing-your-first-sponsorship.html" className="hover:text-ink transition">Pricing Guide</a>
              <a href="/blog/how-to-chase-late-payments.html" className="hover:text-ink transition">Chase Late Payments</a>
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
