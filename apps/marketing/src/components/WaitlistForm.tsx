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

// Stored values stay the raw bands so existing rows keep their meaning; only
// the labels spell out what the number is (SPO-207 — the field was a bare "CCV"
// dropdown that meant nothing to a streamer who doesn't use the acronym).
const CCV_BANDS = [
  { value: "Under 100", label: "Under 100 viewers" },
  { value: "100–500", label: "100–500 viewers" },
  { value: "500–1,500", label: "500–1,500 viewers" },
  { value: "1,500–5,000", label: "1,500–5,000 viewers" },
  { value: "Over 5,000", label: "Over 5,000 viewers" },
];

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; email: string }
  | { kind: "duplicate" }
  | { kind: "error"; message: string };

export default function WaitlistForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [streamerName, setStreamerName] = useState("");
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
          streamerName: streamerName.trim() || undefined,
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
        setState({ kind: "duplicate" });
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
        <h3 className="font-serif text-xl md:text-2xl text-ink mb-2">You&apos;re on the list.</h3>
        <p className="text-ink-2 mb-1">
          We saved <strong className="text-ink">{state.email}</strong>.
        </p>
        <p className="text-sm text-ink-3">
          We invite streamers to the private beta in small batches — you&apos;ll get an email from us when
          it&apos;s your turn. Nothing else to do right now.
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
        <h3 className="font-serif text-xl md:text-2xl text-ink mb-2">You&apos;re already on the list.</h3>
        <p className="text-ink-2">
          Looks like you signed up before — you&apos;re all set. We&apos;ll email you when the beta opens.
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
        <div className="grid gap-4 md:grid-cols-2 text-left">
          <div>
            <label htmlFor="streamer-name" className="block text-sm font-medium text-ink-2 mb-1.5">
              Channel name <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <input
              id="streamer-name"
              type="text"
              autoComplete="off"
              maxLength={128}
              placeholder="e.g. pokimane"
              value={streamerName}
              onChange={(e) => setStreamerName(e.target.value)}
              disabled={state.kind === "submitting"}
              aria-describedby="streamer-name-help"
              className="w-full rounded-[10px] border border-hairline bg-surface px-4 py-3 text-ink placeholder:text-ink-3 outline-none transition focus:ring-2 focus:ring-pine focus:ring-offset-2 focus:ring-offset-paper disabled:opacity-60"
            />
            <p id="streamer-name-help" className="mt-1.5 text-[13px] text-ink-3">
              Your handle or channel URL, so we can look up your stream before we reach out.
            </p>
          </div>

          <div>
            <label htmlFor="ccv" className="block text-sm font-medium text-ink-2 mb-1.5">
              Average concurrent viewers <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <select
              id="ccv"
              value={ccvBand}
              onChange={(e) => setCcvBand(e.target.value)}
              disabled={state.kind === "submitting"}
              aria-describedby="ccv-help"
              className="w-full rounded-[10px] border border-hairline bg-surface px-4 py-3 text-ink outline-none transition focus:ring-2 focus:ring-pine focus:ring-offset-2 focus:ring-offset-paper disabled:opacity-60 appearance-none"
            >
              <option value="">Select a range…</option>
              {CCV_BANDS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <p id="ccv-help" className="mt-1.5 text-[13px] text-ink-3">
              Roughly how many people watch at once on a typical stream (your CCV).
            </p>
          </div>
        </div>
      )}

      {!compact && (
        <fieldset className="text-left">
          <legend className="block text-sm font-medium text-ink-2 mb-1.5">
            Where do you stream? <span className="font-normal text-ink-3">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => togglePlatform(p.key)}
                disabled={state.kind === "submitting"}
                aria-pressed={platforms.includes(p.key)}
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
        </fieldset>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-brick" role="alert">
          {state.message}
        </p>
      )}

      <p className="text-[13px] text-ink-3">
        We&apos;ll only email you about the Sponsee beta and launch. No spam, unsubscribe anytime.{" "}
        <a href="/privacy.html" className="underline hover:text-ink-2">Privacy Policy</a>.
      </p>

      {/* Honeypot */}
      <div className="hidden">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>
    </form>
  );
}
