import Layout from "../components/Layout";

export default function ConfirmedPage() {
  return (
    <Layout>
      <div className="mx-auto max-w-[720px] px-6 py-16 text-center md:py-28">
        <img
          src="/illustrations/beta-invite.svg"
          alt=""
          aria-hidden
          width={128}
          height={128}
          className="mx-auto mb-2 h-32 w-32"
        />
        <h1 className="mb-4 font-serif text-[30px] leading-tight text-ink md:text-[40px]">
          You&apos;re on the list.
        </h1>
        <p className="mb-8 leading-relaxed text-ink-2">
          We&apos;ll email you when your invite is ready — beta seats open in small batches. In the meantime, everything about how Sponsee works is on the landing page, and the free rate calculator is coming soon.
        </p>
        <a
          href="/"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-pine px-6 text-[15px] font-medium text-white transition-all duration-150 hover:bg-pine-hover active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          Back to Sponsee
        </a>
      </div>
    </Layout>
  );
}
