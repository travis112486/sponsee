import { useState, useRef, useCallback } from "react";
import { Check, Loader2, Send } from "lucide-react";

const API_URL = ""; // Same-origin Vercel Edge Function at /api/waitlist

const PLATFORMS = [
  { key: "twitch", label: "Twitch", dot: "bg-twitch" },
  { key: "youtube", label: "YouTube Live", dot: "bg-youtube" },
  { key: "tiktok", label: "TikTok Live", dot: "bg-[#FE2C55]" },
  { key: "kick", label: "Kick", dot: "bg-kick" },
  { key: "other", label: "Other", dot: "bg-ink-3" },
];

const CCV_BANDS = [
  "Under 100",
  "100–500",
  "500–1,500",
  "1,500–5,000",
  "Over 5,000",
];

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; email: string }
  | { kind: "duplicate"; confirmed: boolean }
  | { kind: "error"; message: string };

export default function WaitlistForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [ccvBand, setCcvBand] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [touched, setTouched] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const emailError = touched && !emailValid && email.length > 0;
  const emptyError = touched && email.length === 0;

  const togglePlatform = useCallback((key: string) => {
    setPlatforms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!emailValid) return;

    setState({ kind: "submitting" });
    try {
      const res = await fetch(`${API_URL}/api/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          platforms: platforms.length > 0 ? platforms : undefined,
          ccvBand: ccvBand || undefined,
          source: "landing",
          website: "", // honeypot
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        setState({ kind: "error", message: data.error || "Something went wrong. Try again in a minute." });
        return;
      }
      if (data.duplicate) {
        setState({ kind: "duplicate", confirmed: data.confirmed });
      } else {
        setState({ kind: "success", email: email.trim() });
      }
    } catch {
      setState({ kind: "error", message: "Something went wrong. Try again in a minute." });
    }
  };

  if (state.kind === "success") {
    return (
      <div className="rounded-[14px] bg-surface shadow-warm-md p-6 md:p-8 text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-pine-tint">
          <Check className="h-6 w-6 text-pine" />
        </div>
        <h3 className="font-serif text-xl md:text-2xl text-ink mb-2">Check your inbox.</h3>
        <p className="text-ink-2 mb-1">
          We sent a confirmation link to <strong className="text-ink">{state.email}</strong>.
        </p>
        <p className="text-sm text-ink-3">
          Click it and you&apos;re on the waitlist — we&apos;ll invite streamers to the private beta in small batches.
        </p>
      </div>
    );
  }

  if (state.kind === "duplicate") {
    return (
      <div className="rounded-[14px] bg-surface shadow-warm-md p-6 md:p-8 text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-pine-tint">
          <Check className="h-6 w-6 text-pine" />
        </div>
        <h3 className="font-serif text-xl md:text-2xl text-ink mb-2">
          {state.confirmed ? "You're already on the list." : "Check your inbox."}
        </h3>
        <p className="text-ink-2">
          {state.confirmed
            ? "You're all set. We'll email you when the beta opens."
            : "Looks like you've signed up before — we've re-sent your confirmation email."}
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate>
      <div className={`flex flex-col ${compact ? "gap-3" : "md:flex-row gap-3"}`}>
        <div className="flex-1">
          <label htmlFor="email" className="sr-only">Email</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            disabled={state.kind === "submitting"}
            aria-invalid={emailError || emptyError}
            aria-describedby={emailError ? "email-error" : emptyError ? "email-empty" : undefined}
            className={`w-full rounded-[10px] border bg-surface px-4 py-3 text-ink placeholder:text-ink-3 outline-none transition focus:ring-2 focus:ring-pine focus:ring-offset-2 focus:ring-offset-paper disabled:opacity-60 ${
              emailError || emptyError ? "border-brick" : "border-hairline"
            }`}
          />
          {(emailError || emptyError) && (
            <p id={emptyError ? "email-empty" : "email-error"} className="mt-1.5 text-sm text-brick">
              {emptyError ? "Enter your email to join the waitlist." : "That email doesn't look right — check for typos."}
            </p>
          )}
        </div>

        {!compact && (
          <>
            <div className="md:w-48">
              <label htmlFor="ccv" className="sr-only">Typical concurrent viewers</label>
              <select
                id="ccv"
                value={ccvBand}
                onChange={(e) => setCcvBand(e.target.value)}
                disabled={state.kind === "submitting"}
                className="w-full rounded-[10px] border border-hairline bg-surface px-4 py-3 text-ink outline-none transition focus:ring-2 focus:ring-pine focus:ring-offset-2 focus:ring-offset-paper disabled:opacity-60 appearance-none"
              >
                <option value="">CCV (optional)</option>
                {CCV_BANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={state.kind === "submitting"}
          className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-pine px-6 py-3 font-medium text-white transition hover:bg-pine-hover disabled:opacity-60 min-w-[140px]"
        >
          {state.kind === "submitting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Joining…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Join the waitlist
            </>
          )}
        </button>
      </div>

      {!compact && (
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => togglePlatform(p.key)}
              disabled={state.kind === "submitting"}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                platforms.includes(p.key)
                  ? "border-pine bg-pine-tint text-pine"
                  : "border-hairline bg-surface text-ink-2 hover:border-ink-3"
              } disabled:opacity-60`}
            >
              <span className={`h-2 w-2 rounded-full ${p.dot}`} />
              {p.label}
            </button>
          ))}
        </div>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-brick" role="alert">
          {state.message}
        </p>
      )}

      <p className="text-[13px] text-ink-3">
        We&apos;ll email you once to confirm, then only about the Sponsee beta and launch. No spam, unsubscribe anytime.{" "}
        <a href="/privacy.html" className="underline hover:text-ink-2">Privacy Policy</a>.
      </p>

      {/* Honeypot */}
      <div className="hidden">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>
    </form>
  );
}
