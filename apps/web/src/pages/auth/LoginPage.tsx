import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isSubmitting) return;
    setIsSubmitting(true);

    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: "/",
    });

    if (error) {
      toast.error(error.message || "Failed to send magic link. Try again.");
    } else {
      setSent(true);
      toast.success("Magic link sent! Check your email.");
    }
    setIsSubmitting(false);
  };

  const handleGoogle = async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
    });
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-[420px] rounded-2xl border border-hairline bg-surface px-6 py-8 shadow-warm-md sm:px-8">
        <div className="mb-7 text-center">
          <div className="mb-4 flex justify-center">
            <img src="/logo.svg" alt="Sponsee" className="h-10 w-10" />
          </div>
          <h1 className="font-serif text-[27px] leading-tight tracking-[-0.01em] text-ink">
            Sign in to Sponsee
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-3">
            Run your sponsorship business like an agency
          </p>
        </div>

        {sent ? (
          <div className="rounded-[10px] border border-hairline bg-surface-subtle p-5 text-center">
            <h2 className="text-[15px] font-semibold text-ink">Check your email</h2>
            <p className="mt-2 text-[13px] text-ink-3">
              We sent a magic link to <span className="font-medium text-ink">{email}</span>.
              Click it to sign in.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              className="mt-4 text-[13px] font-medium text-pine hover:text-pine-hover"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-[12.5px] font-medium text-ink">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-10 w-full items-center justify-center rounded-lg bg-pine text-[13.5px] font-semibold text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
              >
                {isSubmitting ? "Sending…" : "Send magic link"}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-hairline" />
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">or</span>
              <div className="h-px flex-1 bg-hairline" />
            </div>

            <button
              onClick={handleGoogle}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-hairline bg-surface text-[13.5px] font-medium text-ink transition-colors hover:bg-surface-subtle"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </button>

            <p className="mt-5 text-center text-[11.5px] text-ink-3">
              New here? Enter your email and we&apos;ll create your workspace automatically.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
