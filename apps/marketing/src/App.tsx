import { useEffect, useLayoutEffect, useState, useRef } from "react";
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
  ArrowRight,
} from "lucide-react";
import WaitlistForm from "./components/WaitlistForm";
import {
  HeroDashboard,
  PipelineBoard,
  CalculatorMock,
  PaymentsMock,
} from "./components/ProductVisuals";

// useLayoutEffect has no meaning during pre-render and React warns if it is
// called there, so fall back to useEffect on the server.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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
  // Starts visible so the pre-rendered HTML — what crawlers and no-JS visitors
  // get — is never a page of opacity-0 sections.
  const [visible, setVisible] = useState(true);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Anything already on screen at hydration stays put. Everything below the
    // fold is hidden again before the first paint (hence useLayoutEffect, not
    // useEffect) and then rises in on scroll, exactly as it did before.
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setVisible(false);
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
      className={`py-16 md:py-28 ${alt ? "bg-surface-subtle border-y border-hairline" : "bg-paper"} ${className} transition-[opacity,transform] duration-500 ease-house ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      }`}
    >
      <div className="mx-auto max-w-[1120px] px-6">{children}</div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">
      {children}
    </p>
  );
}

// The dashboard's button recipes (SPO-193), scaled up one notch for a
// marketing surface.
const BTN_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-pine px-6 text-[15px] font-medium text-white transition-all duration-150 hover:bg-pine-hover active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";
const BTN_SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-hairline bg-surface px-6 text-[15px] font-medium text-ink transition-all duration-150 hover:border-ink-3/40 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-ink-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-pine-tint">
        <Check className="h-3 w-3 text-pine" strokeWidth={2.5} />
      </span>
      <span className="text-[15px] leading-relaxed">{children}</span>
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
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg py-5 text-left outline-none transition-colors duration-150 hover:text-pine focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <span className="pr-4 font-serif text-lg text-ink md:text-xl">{question}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-ink-3 transition-transform duration-300 ease-house ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-300 ease-house"
        style={{ maxHeight: open ? (contentHeight || 200) : 0 }}
      >
        <p className="pb-5 leading-relaxed text-ink-2">{answer}</p>
      </div>
    </div>
  );
}

// The blog posts surfaced in the "Free tools & guides" section. `href` must
// name a slug the generator actually publishes — blogHrefs.test.ts enforces it
// against apps/marketing/content/blog so a retired or renamed post can't leave
// a dead card on the homepage the way the SPO-20 static pages did.
const GUIDE_CARDS = [
  {
    href: "/blog/sponsor-paying-late",
    title: "Sponsor Paying Late? What to Do",
    blurb:
      "The three-step follow-up sequence for a brand deal that's gone quiet — when to nudge, when to escalate, and when to call it a write-off.",
  },
  {
    href: "/blog/chase-email-templates",
    title: "Payment Reminder Email Templates",
    blurb:
      "Three copy-paste emails for chasing a late brand-deal payment: friendly nudge, professional reminder, and escalation.",
  },
  {
    href: "/blog/deliverable-pricing",
    title: "How to Price Every Deliverable",
    blurb:
      "Ad reads, overlays, chat callouts, VOD — what each one is worth against your hourly CPVH rate, and how to quote a mixed offer.",
  },
  {
    href: "/blog/media-kit-for-streamers",
    title: "Media Kit for Streamers",
    blurb:
      "What a live-streamer media kit should actually contain, and why concurrent viewers beat follower counts as the headline number.",
  },
];

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
        className={`sticky top-0 z-50 bg-paper/90 backdrop-blur transition-shadow duration-150 ${
          navBorder ? "shadow-warm border-b border-hairline" : ""
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between px-6">
          <a
            href="/"
            className="rounded-lg font-serif text-[22px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Sponsee<sup className="text-[13px]">™</sup>
          </a>
          <nav className="hidden items-center gap-7 md:flex">
            {[
              { href: "#how-it-works", label: "How it works" },
              { href: "#product", label: "Product" },
              { href: "#pricing", label: "Pricing" },
              { href: "#faq", label: "FAQ" },
              { href: "/blog/", label: "Blog" },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-md text-[13.5px] font-medium text-ink-2 outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <button
            onClick={scrollToWaitlist}
            className="inline-flex h-9 items-center rounded-lg bg-pine px-4 text-[13px] font-medium text-white transition-all duration-150 hover:bg-pine-hover active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Join the waitlist
          </button>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden">
        {/* Warm wash behind the hero, in CSS so it costs nothing and stays
            exactly on-palette. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(52rem 30rem at 12% -4%, rgba(228,241,235,0.85), transparent 60%), radial-gradient(48rem 28rem at 88% -6%, rgba(250,240,220,0.75), transparent 60%)",
          }}
        />
        <Section className="relative pt-14 md:pt-24 pb-0">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>The sponsorship CRM for streamers</Eyebrow>
            <h1 className="mb-6 font-serif text-[42px] leading-[1.05] tracking-[-0.015em] text-ink md:text-[68px]">
              Run your sponsorships{" "}
              <em className="not-italic text-pine">like an agency.</em> Keep 100%.
            </h1>
            <p className="mx-auto mb-9 max-w-[640px] text-lg leading-relaxed text-ink-2">
              Every brand deal in one pipeline. Every deal priced against real CPVH benchmarks.
              Every late invoice chased on a schedule you control. Flat price, no cut — and your
              money never passes through us.
            </p>
            <div className="mb-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button onClick={scrollToWaitlist} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
                Join the waitlist
              </button>
              <a href="#product" className={`${BTN_SECONDARY} w-full sm:w-auto`}>
                See the product
              </a>
            </div>
            <p className="mb-12 text-sm text-ink-3">
              Private beta opening soon. Built for streamers between 100 and 5,000 concurrent
              viewers.
            </p>
          </div>
          <div className="mx-auto max-w-[960px]">
            <HeroDashboard />
          </div>
        </Section>
      </div>

      {/* Trust strip */}
      <Section>
        <div className="grid divide-y divide-hairline md:grid-cols-3 md:divide-x md:divide-y-0">
          {[
            { icon: CreditCard, text: "Flat $19–$39/mo. No revenue share, no per-deal cut. Ever." },
            { icon: ShieldCheck, text: "Never touches your money. Brands pay you directly, on your own rails." },
            { icon: Globe, text: "Deals from anywhere. Your DMs, your inbox, your agent — Sponsee runs them all." },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-4 py-6 first:md:pl-0 last:md:pr-0 md:px-8 md:py-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hairline bg-pine-tint/60">
                <Icon className="h-5 w-5 text-pine" strokeWidth={1.5} />
              </span>
              <p className="leading-relaxed text-ink-2">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Problem strip */}
      <Section alt>
        <div className="mx-auto max-w-[720px] text-center">
          <p className="mb-6 font-serif text-2xl leading-relaxed text-ink md:text-[28px]">
            Your deals live in DMs.<br />
            Your rates live in your gut.<br />
            Your money lives in a brand&apos;s accounts-payable queue.
          </p>
          <div className="mb-4">
            <span className="tnum font-serif text-[56px] leading-none text-brick md:text-[68px]">
              48–87%
            </span>
          </div>
          <p className="mb-2 text-ink">of creators get paid late.</p>
          <p className="mb-6 font-serif text-xl text-ink md:text-2xl">
            You&apos;re running a real business on vibes.
          </p>
          <p className="text-[13px] text-ink-3">
            * Lumanu survey: 48% of 500 influencers paid late in the past year. Industry
            payment-platform data cited by Campaign (2025) puts it as high as 87%.
          </p>
        </div>
      </Section>

      {/* Product Tour A — 3 Pillars */}
      <Section id="product">
        {/* Pillar 1: Pipeline */}
        <div className="mb-20 grid items-center gap-8 md:mb-28 md:grid-cols-5 md:gap-12">
          <div className="order-2 md:order-1 md:col-span-3">
            <PipelineBoard />
          </div>
          <div className="order-1 md:order-2 md:col-span-2">
            <Eyebrow>Pipeline</Eyebrow>
            <h2 className="mb-4 font-serif text-[30px] leading-tight text-ink md:text-[40px]">
              Every deal, one board.
            </h2>
            <p className="mb-6 leading-relaxed text-ink-2">
              A mid-tier streamer&apos;s &quot;pipeline&quot; is a Twitter DM, two email threads, a
              Discord ping, and a half-remembered verbal yes. Deals don&apos;t die because the brand
              said no — they die because nobody followed up. Sponsee gives every deal a card and
              every card a stage, from first DM to paid invoice.
            </p>
            <ul className="space-y-3">
              <CheckItem>Six stages: Inbound → Negotiating → Contract Sent → Live → Delivered → Paid</CheckItem>
              <CheckItem>Every column shows count and total value, live</CheckItem>
              <CheckItem>Days-in-stage aging, so nothing quietly rots</CheckItem>
            </ul>
          </div>
        </div>

        {/* Pillar 2: Rate Calculator */}
        <div className="mb-20 grid items-center gap-8 md:mb-28 md:grid-cols-5 md:gap-12">
          <div className="md:col-span-2">
            <Eyebrow>Rate Calculator</Eyebrow>
            <h2 className="mb-4 font-serif text-[30px] leading-tight text-ink md:text-[40px]">
              Know your number before you reply.
            </h2>
            <p className="mb-6 leading-relaxed text-ink-2">
              No platform publishes a rate card, and brands know it. Sponsee prices every deal in
              cost per viewer-hour — the benchmark real live deals clear at: $0.60–$1.50 per
              viewer-hour, up to ~$2.00 for agency-repped talent. Punch in your CCV and the deal
              shape; get your floor, mid, and high before you answer the DM.
            </p>
            <ul className="space-y-3">
              <CheckItem>Floor / mid / high for your exact CCV and deliverables</CheckItem>
              <CheckItem>See your past deals against the benchmark band</CheckItem>
              <CheckItem>The &quot;we usually do $200 flat&quot; reply-guy rate stops working on you</CheckItem>
            </ul>
            <div className="mt-5">
              {/* The rate-calculator teaser page retired with SPO-199 and there is
                  still no /calculator route, so this points at the deliverable
                  pricing guide until the real calculator ships. */}
              <a
                href="/blog/deliverable-pricing"
                className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-pine outline-none transition-colors duration-150 hover:text-pine-hover focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                Read the deliverable pricing guide
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          <div className="md:col-span-3">
            <CalculatorMock />
          </div>
        </div>

        {/* Pillar 3: Payments */}
        <div className="grid items-center gap-8 md:grid-cols-5 md:gap-12">
          <div className="order-2 md:order-1 md:col-span-3">
            <PaymentsMock />
          </div>
          <div className="order-1 md:order-2 md:col-span-2">
            <Eyebrow>Payments</Eyebrow>
            <h2 className="mb-4 font-serif text-[30px] leading-tight text-ink md:text-[40px]">
              The awkward follow-up email — handled.
            </h2>
            <p className="mb-6 leading-relaxed text-ink-2">
              Chasing a brand for your own money is the worst job in streaming: unpaid, awkward, and
              easy to put off — which is exactly why invoices go stale. Sponsee turns every deal
              into an invoice with a due date and a three-step chase sequence: friendly nudge,
              professional reminder, final notice. You approve each email before it sends.
            </p>
            <ul className="space-y-3">
              <CheckItem>Aging buckets: current, 1–30, 31–60, 60+ days</CheckItem>
              <CheckItem>Three-step chase ladder, on your timing, in your voice</CheckItem>
              <CheckItem>Never write &quot;hey, just bumping this 🙂&quot; again</CheckItem>
            </ul>
            <div className="mt-6 rounded-xl border border-pine/20 border-l-[3px] border-l-pine bg-pine-tint/50 px-4 py-3 text-sm text-pine">
              <strong>Sponsee never holds your money.</strong> Invoices point to your own PayPal /
              Wise / bank details; brands pay you directly.
            </div>
            <div className="mt-4">
              <a
                href="/blog/sponsor-paying-late"
                className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-pine outline-none transition-colors duration-150 hover:text-pine-hover focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                Read the chase guide
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* Product Tour B — Back office grid */}
      <Section alt>
        <h2 className="mb-12 text-center font-serif text-[30px] leading-tight text-ink md:text-[40px]">
          A complete back office, not a widget.
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
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
              className="rounded-xl border border-hairline bg-surface p-6 shadow-warm transition-all duration-150 hover:-translate-y-px hover:shadow-warm-md"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-surface-subtle">
                <Icon className="h-5 w-5 text-ink-2" strokeWidth={1.5} />
              </div>
              <h3 className="mb-2 font-sans text-lg font-semibold text-ink">{title}</h3>
              <p className="text-sm leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works">
        <h2 className="mb-12 text-center font-serif text-[30px] leading-tight text-ink md:text-[40px]">
          Set up in an evening, not a sprint.
        </h2>
        <div className="grid gap-8 md:grid-cols-3">
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
          ].map(({ num, title, body }, i) => (
            <div key={num} className="relative text-center md:text-left">
              {i < 2 && (
                <span
                  aria-hidden
                  className="absolute right-[-1.25rem] top-4 hidden h-px w-10 bg-hairline md:block"
                />
              )}
              <span className="tnum font-serif text-[34px] italic text-pine">{num}</span>
              <h3 className="mb-2 mt-2 font-sans text-lg font-semibold text-ink">{title}</h3>
              <p className="leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Free guides */}
      <Section id="guides" alt>
        <h2 className="mb-12 text-center font-serif text-[30px] leading-tight text-ink md:text-[40px]">
          Free tools &amp; guides.
        </h2>
        {/* Mirrors apps/marketing/content/blog — blogHrefs.test.ts fails if a card
            points at a slug the generator doesn't publish. */}
        <div className="mx-auto grid max-w-[960px] gap-6 md:grid-cols-2">
          {GUIDE_CARDS.map(({ href, title, blurb }) => (
            <a
              key={href}
              href={href}
              className="group rounded-xl border border-hairline bg-surface p-6 shadow-warm outline-none transition-all duration-150 hover:-translate-y-px hover:shadow-warm-md focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2"
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <h3 className="font-sans text-lg font-semibold text-ink">{title}</h3>
                <ArrowRight className="mt-1.5 h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink" />
              </div>
              <p className="text-sm leading-relaxed text-ink-2">{blurb}</p>
            </a>
          ))}
        </div>
        <div className="mt-8 text-center">
          <a
            href="/blog/"
            className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-pine outline-none transition-colors duration-150 hover:text-pine-hover focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2"
          >
            See all guides
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" alt className="border-t-0">
        <h2 className="mb-12 text-center font-serif text-[30px] leading-tight text-ink md:text-[40px]">
          Flat pricing. No cut. Ever.
        </h2>
        <div className="mx-auto grid max-w-[960px] gap-6 md:grid-cols-3">
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
              className={`rounded-xl bg-surface p-6 transition-all duration-150 ${
                tier.best
                  ? "border-[1.5px] border-pine shadow-warm-md md:-translate-y-2"
                  : "border border-hairline shadow-warm"
              }`}
            >
              {tier.best && (
                <span className="mb-4 inline-flex items-center rounded-full bg-pine-tint px-3 py-1 text-[11px] font-semibold text-pine">
                  Best value
                </span>
              )}
              <h3 className="font-sans text-lg font-semibold text-ink">{tier.name}</h3>
              <div className="tnum mb-1 mt-2 text-[40px] font-semibold tracking-[-0.02em] text-ink">
                {tier.price}
                <span className="text-lg font-normal text-ink-3">/mo</span>
              </div>
              <p className="mb-6 text-sm text-ink-3">{tier.desc}</p>
              <ul className="mb-2 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-ink-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-pine-tint">
                      <Check className="h-2.5 w-2.5 text-pine" strokeWidth={2.5} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <p className="mb-4 text-sm text-ink-3">
            14-day trial, no card required. Annual = 2 months free. Free forever: the rate
            calculator.
          </p>
          <button onClick={scrollToWaitlist} className={BTN_PRIMARY}>
            Join the waitlist
          </button>
          <p className="mt-4 font-serif text-[17px] italic text-ink-2">
            If we ever ask for a percentage of your deals, delete your account. (We won&apos;t.)
          </p>
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq">
        <h2 className="mb-8 text-center font-serif text-[30px] leading-tight text-ink md:text-[40px]">
          Questions?
        </h2>
        <div className="mx-auto max-w-[720px]">
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
      <Section id="waitlist" alt>
        <div className="mx-auto max-w-[720px] text-center">
          <img
            src="/illustrations/beta-invite.svg"
            alt=""
            aria-hidden
            width={128}
            height={128}
            loading="lazy"
            className="mx-auto mb-2 h-32 w-32"
          />
          <h2 className="mb-4 font-serif text-[30px] leading-tight text-ink md:text-[40px]">
            Your sponsorships are a business. Give them a back office.
          </h2>
          <p className="mb-8 text-ink-2">
            Join the waitlist and be first in when the private beta opens.
          </p>
          <WaitlistForm />
        </div>
      </Section>

      {/* Footer */}
      <footer className="border-t border-hairline bg-paper py-12">
        <div className="mx-auto max-w-[1120px] px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-serif text-lg text-ink">
                Sponsee<sup className="text-xs">™</sup>
              </p>
              <p className="text-sm text-ink-3">The sponsorship CRM for streamers.</p>
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-ink-2">
              <a href="/blog/" className="rounded-md outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2">Blog</a>
              <a href="/privacy.html" className="rounded-md outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2">Privacy</a>
              <a href="/terms.html" className="rounded-md outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2">Terms</a>
              <a href="mailto:hello@sponsee.app" className="rounded-md outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2">Contact</a>
            </div>
          </div>
          <div className="mt-8 border-t border-hairline pt-6 text-[13px] text-ink-3">
            <p>Sponsee is not affiliated with Twitch, YouTube, TikTok, or Kick.</p>
            <p className="mt-1">© 2026 Sponsee.</p>
            {/* unavatar.io free-tier ToS requires this attribution while the app
                pulls brand logos from their free tier (SPO-371). It must stay
                followable (no rel="nofollow") and in the pre-rendered HTML.
                Remove only once we are on a paid unavatar plan. */}
            <p className="mt-1">
              <a
                href="https://unavatar.io"
                target="_blank"
                rel="noopener"
                className="rounded-md outline-none transition-colors duration-150 hover:text-ink focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2"
              >
                Avatars provided by Unavatar
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
