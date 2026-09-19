"use client";
import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck, RefreshCw } from "lucide-react";

function VerifyPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const userId = params.get("userId") || "";
  const email = params.get("email") || "";
  const devCodeFromUrl = params.get("devCode") || "";

  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [devCode, setDevCode] = useState(devCodeFromUrl);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  const code = digits.join("");

  const setDigit = (i: number, v: string) => {
    const next = [...digits];
    next[i] = v.replace(/\D/g, "").slice(-1);
    setDigits(next);
    if (next[i] && i < 5) inputs.current[i + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (t.length > 0) {
      e.preventDefault();
      const arr = ["", "", "", "", "", ""];
      for (let i = 0; i < t.length; i++) arr[i] = t[i];
      setDigits(arr);
      inputs.current[Math.min(t.length, 5)]?.focus();
    }
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) inputs.current[i + 1]?.focus();
  };

  const submit = async (theCode?: string) => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: theCode ?? code }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(data.redirect || "/overview");
        router.refresh();
        return;
      }
      setError(data.error || "Verification failed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally { setBusy(false); }
  };

  // Auto-submit when all 6 digits are filled
  useEffect(() => {
    if (code.length === 6 && !busy) submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const resend = async () => {
    setResending(true); setError(null); setInfo(null);
    try {
      const res = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        setInfo("A new code has been sent.");
        if (data.__devCode) setDevCode(data.__devCode);
      } else {
        setError(data.error || "Could not resend.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally { setResending(false); }
  };

  if (!userId) {
    return (
      <div className="rounded-2xl border border-border bg-card/80 p-8 text-center">
        <p className="text-sm text-muted-foreground">No pending verification. Head back to sign up.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm shadow-[0_0_60px_rgba(59,130,246,0.08)] p-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-2">
          <MailCheck className="h-5 w-5 text-accent" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Verify your email</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        We sent a 6-digit code to <span className="font-mono text-foreground">{email}</span>.
        Enter it below to confirm your account.
      </p>

      {devCode && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <strong>Dev mode:</strong> SMTP is not configured. Your code is{" "}
          <span className="font-mono text-foreground tracking-widest">{devCode}</span>.
        </div>
      )}

      <div className="mt-6 flex gap-2 justify-between" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el; }}
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className="w-12 h-14 rounded-lg bg-input border border-border text-center text-2xl font-mono font-semibold text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
      )}
      {info && (
        <div className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">{info}</div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {resending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Resend code
        </button>
        <button
          type="button"
          onClick={() => submit()}
          disabled={busy || code.length !== 6}
          className="h-10 px-4 rounded-lg bg-accent hover:bg-[#60a5fa] text-white text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Verify
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="rounded-2xl border border-border bg-card/80 p-8 text-sm text-muted-foreground">Loading…</div>}>
      <VerifyPanel />
    </Suspense>
  );
}
