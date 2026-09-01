import Layout from "../components/Layout";

export default function PrivacyPage() {
  return (
    <Layout title="Privacy Policy — Sponsee">
      <div className="mx-auto max-w-[720px] px-6 py-16 md:py-28">
        <h1 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-8">
          Privacy Policy
        </h1>
        <div className="prose prose-ink max-w-none">
          <p className="text-ink-2 leading-relaxed mb-6">
            <strong>Last updated:</strong> August 2026
          </p>
          <h2 className="font-sans text-lg font-semibold text-ink mt-8 mb-3">What we collect</h2>
          <p className="text-ink-2 leading-relaxed mb-4">
            We collect your email address when you join the waitlist. Optionally, you may provide your streaming platform and typical concurrent viewer count. This helps us prioritize beta invites.
          </p>
          <h2 className="font-sans text-lg font-semibold text-ink mt-8 mb-3">How we use it</h2>
          <p className="text-ink-2 leading-relaxed mb-4">
            We use your email to send waitlist confirmations and beta launch updates. We do not share your data with third parties for marketing purposes.
          </p>
          <h2 className="font-sans text-lg font-semibold text-ink mt-8 mb-3">Your rights</h2>
          <p className="text-ink-2 leading-relaxed mb-4">
            You can request deletion of your data at any time by emailing hello@sponsee.app. We honor unsubscribe requests immediately.
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
