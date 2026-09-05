import Layout from "../components/Layout";

const h2 = "font-sans text-lg font-semibold text-ink mt-8 mb-3";
const p = "text-ink-2 leading-relaxed mb-4";
const mail = "text-pine underline";

function Mail({ children = "hello@sponsee.app" }: { children?: string }) {
  return (
    <a href={`mailto:${children}`} className={mail}>
      {children}
    </a>
  );
}

export default function PrivacyPage() {
  return (
    <Layout title="Privacy Policy — Sponsee">
      <div className="mx-auto max-w-[720px] px-6 py-16 md:py-28">
        <h1 className="font-serif text-[30px] md:text-[40px] leading-tight text-ink mb-8">
          Privacy Policy
        </h1>
        <div className="prose prose-ink max-w-none">
          <p className="text-ink-2 leading-relaxed mb-6">
            <strong>Last updated:</strong> September 2026
          </p>
          <p className={p}>
            Sponsee is a sponsorship CRM for live streamers. This policy covers the marketing
            site at sponsee.app (including the waitlist) and the product itself — the pipeline,
            invoices, chase emails, and billing.
          </p>
          <p className={p}>
            If a sentence here does not match what the product actually does, the product is
            wrong or this page is stale. Email <Mail /> and we will fix the page.
          </p>

          <h2 className={h2}>1. Who this is for</h2>
          <p className={p}>
            This is for you if you join the waitlist, create a Sponsee account, or work at a
            brand and receive an email we sent because a creator asked us to send it.
          </p>
          <p className={p}>
            We do not take custody of your money. Brand payments stay between you and the
            brand. Stripe on this page is how you pay <strong>us</strong> for Sponsee, not how a
            brand pays you.
          </p>

          <h2 className={h2}>2. Information we collect</h2>
          <p className={p}>
            <strong>Waitlist.</strong> Email. Optionally, your channel handle, platforms, and a
            concurrent-viewer band, so we can prioritize beta invites.
          </p>
          <p className={p}>
            <strong>Account.</strong> Email, name, and (if you use Google sign-in) the profile
            Google sends us. We store a session cookie, and we may store the IP and browser
            used to sign in.
          </p>
          <p className={p}>
            <strong>Creator profile.</strong> Display name, pronouns, category, timezone,
            currency, avatar, and the platforms you add (Twitch, YouTube, Kick, TikTok) with
            the handle, URL, and stats you enter or that we sync.
          </p>
          <p className={p}>
            <strong>Payout rails.</strong> Optional PayPal link, Wise instructions, and bank
            instructions you type in. These are <strong>template fields for invoices</strong>,
            not login credentials. Do not put passwords or full card numbers here.
          </p>
          <p className={p}>
            <strong>Your sponsorship pipeline.</strong> Brands (name, category, domain),
            contacts (name, email, role), deals, deliverables, contracts, invoices, notes,
            CPVH calculator inputs, and chase-email templates.
          </p>
          <p className={p}>
            <strong>Files you upload.</strong> Contracts and proof (VODs, clips, screenshots,
            PDFs). We store the file and enough metadata to show it back to you.
          </p>
          <p className={p}>
            <strong>Emails we send for you.</strong> When a chase email goes out, we keep a
            copy of the subject, body, recipient, and delivery status (sent, delivered, opened,
            bounced, failed).
          </p>
          <p className={p}>
            <strong>Sponsee billing.</strong> If you subscribe, Stripe sees your payment method
            and billing details. We store Stripe customer and subscription IDs, plan, and
            status — not your full card number.
          </p>
          <p className={p}>
            <strong>Usage on the marketing site.</strong> The marketing pages (including this
            one) load Google Analytics, which sets cookies and collects device and usage data
            so we can tell whether the site is working.
          </p>
          <p className={p}>
            We do not scrape your chat, VODs, or audience. Platform stats come from what you
            type, from a public lookup on the handle you gave us, or from an OAuth connect you
            chose (Twitch or Kick).
          </p>

          <h2 className={h2}>3. How we use it</h2>
          <ul className="list-disc pl-5 space-y-2 mb-4 text-ink-2 leading-relaxed">
            <li>Run the product: your pipeline, invoices, deliverables, files, and CPVH numbers.</li>
            <li>Sign you in (magic link from noreply@sponsee.app, or Google).</li>
            <li>Send waitlist confirmation and beta updates.</li>
            <li>
              Send payment-chase emails <strong>to the contacts you entered</strong>, when you
              arm chase and approve a send.
            </li>
            <li>Bill your Sponsee subscription.</li>
            <li>Sync platform stats you asked us to sync.</li>
            <li>Figure out whether the marketing site is working.</li>
            <li>Reply when you email us.</li>
          </ul>
          <p className={p}>
            We do not sell your data. We do not share it with anyone for their marketing.
          </p>

          <h2 className={h2}>4. Emails we send for you</h2>
          <p className={p}>
            This is the part the waitlist policy did not mention, and it is the most important
            sentence on this page.
          </p>
          <p className={p}>
            If you arm late-payment chase,{" "}
            <strong>we email the brand contacts you saved, on your behalf.</strong> Mail comes
            from chase@sponsee.app. Replies go to <strong>your</strong> email. We use the
            subject and body you set in your templates (or the defaults you left in place). We
            keep a log of what was sent so you can see it in the product.
          </p>
          <p className={p}>
            You are choosing to give us those contacts and to let us write to them. Do not put
            a contact in Sponsee unless you have a reason to email them about a deal or an
            invoice.
          </p>
          <p className={p}>
            We cannot unsend an email that already landed. Deleting your account does not pull
            a message out of a brand person&apos;s inbox.
          </p>

          <h2 className={h2}>5. Who else sees data</h2>
          <p className={p}>
            We use other companies to run Sponsee. They only get what they need to do that job.
          </p>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-left text-sm text-ink-2 border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  <th scope="col" className="py-2 pr-3 font-semibold text-ink">
                    Who
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold text-ink">
                    What they see
                  </th>
                  <th scope="col" className="py-2 font-semibold text-ink">
                    Why
                  </th>
                </tr>
              </thead>
              <tbody>
                <Subprocessor
                  who="Neon"
                  sees="Everything in the database"
                  why="Hosts Postgres."
                />
                <Subprocessor
                  who="Render"
                  sees="App traffic and the data the API reads and writes"
                  why="Hosts the API (sponsee.onrender.com)."
                />
                <Subprocessor
                  who="Vercel"
                  sees="Marketing-site traffic and waitlist form posts"
                  why="Hosts sponsee.app."
                />
                <Subprocessor
                  who="Resend"
                  sees="Email addresses and the content of mail we send (waitlist, sign-in, chase)"
                  why="Sends the mail."
                />
                <Subprocessor
                  who="Stripe"
                  sees="Your Sponsee billing details"
                  why="Charges your subscription. Not brand-to-you payments."
                />
                <Subprocessor
                  who="unavatar.io"
                  sees="Brand domains you save, on a cache miss from our servers"
                  why="Fallback logo fetch from our servers on cache miss."
                />
                <Subprocessor
                  who="Google"
                  sees="Analytics on the marketing site; account profile if you sign in with Google"
                  why="Analytics and optional sign-in."
                />
                <Subprocessor
                  who="Twitch / Kick"
                  sees="The OAuth tokens you grant if you hit Connect"
                  why="Subscriber counts, instead of a public lookup."
                />
              </tbody>
            </table>
          </div>
          <p className={p}>
            If you upload files, they live in S3-compatible object storage we control. We will
            name that vendor on this page when it is locked.
          </p>
          <p className={p}>
            Your browser talks to us and to Google Analytics directly. Brand logos load from
            us, not from unavatar. We do not run a marketplace, so other creators do not see
            your pipeline.
          </p>

          <h2 className={h2}>6. Brand logos</h2>
          <p className={p}>
            When you save a brand domain, our servers try the brand&apos;s own favicon first, then{" "}
            <a href="https://unavatar.io" className={mail}>
              unavatar.io
            </a>{" "}
            if that fails, and we cache the result. Your browser loads the logo from{" "}
            <strong>us</strong>, not from unavatar.
          </p>
          <p className={p}>
            <strong>What unavatar may still see:</strong> the domain, on a cache miss, from our
            servers. Not your IP, not your name, not your email, and not the rest of your
            pipeline.
          </p>
          <p className={p}>
            If logo loading fails, we show a monogram instead.
          </p>

          <h2 className={h2}>7. How long we keep it</h2>
          <ul className="list-disc pl-5 space-y-2 mb-4 text-ink-2 leading-relaxed">
            <li>
              <strong>Account and pipeline</strong> (brands, contacts, deals, invoices, chase
              logs, activity): for as long as the account is open.
            </li>
            <li>
              <strong>Files you upload:</strong> until you delete the file or the account.
              Deleting a deal does not delete the file; that is on purpose, so proof and
              contracts survive a deal you archive.
            </li>
            <li>
              <strong>Waitlist:</strong> until you ask us to remove you, or until you convert
              to an account and we no longer need the list row.
            </li>
            <li>
              <strong>Sessions:</strong> until they expire or you sign out.
            </li>
            <li>
              <strong>Sponsee billing records at Stripe:</strong> for as long as Stripe is
              required to keep them, including after you cancel.
            </li>
            <li>
              <strong>Emails already sent:</strong> copies we keep in Sponsee go away with the
              account. Copies at Resend, and the message in the recipient&apos;s inbox, do not.
            </li>
          </ul>
          <p className={p}>
            We do not have a &quot;delete after X days&quot; timer on pipeline data. If you want it
            gone, ask.
          </p>

          <h2 className={h2}>8. Deleting your account</h2>
          <p className={p}>
            There is no delete button in the app yet. Email <Mail /> from the address on the
            account and ask us to delete it.
          </p>
          <p className={p}>
            We will delete the login, the workspace, the pipeline, the files, and the waitlist
            row for that email. We will not keep a copy &quot;just in case.&quot;
          </p>
          <p className={p}>We cannot delete:</p>
          <ul className="list-disc pl-5 space-y-2 mb-4 text-ink-2 leading-relaxed">
            <li>Chase emails already sitting in a brand person&apos;s inbox.</li>
            <li>Billing records Stripe is required to keep.</li>
            <li>
              Backups that have not yet rotated. Those age out; we will not restore a deleted
              account from them.
            </li>
          </ul>
          <p className={p}>
            Waitlist-only: the same address, subject &quot;remove me from the waitlist.&quot; We honor
            unsubscribe on beta mail immediately.
          </p>

          <h2 className={h2}>9. Cookies</h2>
          <ul className="list-disc pl-5 space-y-2 mb-4 text-ink-2 leading-relaxed">
            <li>
              <strong>Product:</strong> a session cookie so you stay signed in (
              <code>sponsee</code> prefix). Required for the app to work.
            </li>
            <li>
              <strong>Marketing site:</strong> Google Analytics cookies. The waitlist form
              works without them.
            </li>
          </ul>

          <h2 className={h2}>10. Your rights</h2>
          <p className={p}>
            Email <Mail /> to access, correct, or delete what we have, or to export your
            waitlist row. We will do it.
          </p>
          <p className={p}>
            If you are in a place with extra rules (California, EEA, UK, and others), use the
            same address. We are a small team; we will not hide behind a form.
          </p>

          <h2 className={h2}>11. Kids</h2>
          <p className={p}>
            Sponsee is for people running a sponsorship business. It is not for children under
            13, and we do not knowingly collect their data.
          </p>

          <h2 className={h2}>12. Changes</h2>
          <p className={p}>
            If we start doing something this page does not describe — new subprocessors, a new
            kind of email, a new place data lives — we will update this page and change the
            date at the top. Material changes get a note in the product or an email.
          </p>

          <h2 className={h2}>13. Contact</h2>
          <p className="text-ink-2 leading-relaxed">
            <Mail />
          </p>
        </div>
      </div>
    </Layout>
  );
}

function Subprocessor({
  who,
  sees,
  why,
}: {
  who: string;
  sees: string;
  why: string;
}) {
  return (
    <tr className="border-b border-hairline align-top">
      <th scope="row" className="py-2 pr-3 font-medium text-ink whitespace-nowrap">
        {who}
      </th>
      <td className="py-2 pr-3">{sees}</td>
      <td className="py-2">{why}</td>
    </tr>
  );
}
