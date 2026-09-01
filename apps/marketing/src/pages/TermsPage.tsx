import Layout from "../components/Layout";

export default function TermsPage() {
  return (
    <Layout title="Terms of Service — Sponsee">
      <div className="mx-auto max-w-[720px] px-6 py-16 md:py-28">
        <h1 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-8">
          Terms of Service
        </h1>
        <div className="prose prose-ink max-w-none">
          <p className="text-ink-2 leading-relaxed mb-6">
            <strong>Last updated:</strong> August 2026
          </p>
          <h2 className="font-sans text-lg font-semibold text-ink mt-8 mb-3">Overview</h2>
          <p className="text-ink-2 leading-relaxed mb-4">
            Sponsee is a sponsorship CRM for live streamers. These terms govern your use of our website and services.
          </p>
          <h2 className="font-sans text-lg font-semibold text-ink mt-8 mb-3">No financial custody</h2>
          <p className="text-ink-2 leading-relaxed mb-4">
            Sponsee does not hold, transfer, or process payments on behalf of creators. All payment arrangements are between you and the brand directly.
          </p>
          <h2 className="font-sans text-lg font-semibold text-ink mt-8 mb-3">Beta software</h2>
          <p className="text-ink-2 leading-relaxed mb-4">
            Sponsee is currently in private beta. Features, pricing, and availability are subject to change. We make no guarantees about uptime or data retention during the beta period.
          </p>
          <h2 className="font-sans text-lg font-semibold text-ink mt-8 mb-3">Contact</h2>
          <p className="text-ink-2 leading-relaxed">
            Questions? Email us at <a href="mailto:hello@sponsee.app" className="text-pine underline">hello@sponsee.app</a>.
          </p>
        </div>
      </div>
    </Layout>
  );
}
