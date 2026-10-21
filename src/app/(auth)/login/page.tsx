"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { Loader2, Lock, Mail, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirectPath(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(safeRedirectPath(data.redirect, next));
        router.refresh();
        return;
      }
      if (res.status === 403 && data.status === "verification_required") {
        // Send the user to verify with the userId + dev code surfaced
        const q = new URLSearchParams({ userId: data.userId, email: data.email });
        if (data.__devCode) q.set("devCode", data.__devCode);
        router.push(`/verify?${q.toString()}`);
        return;
      }
      setError(data.error || "Sign-in failed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm shadow-[0_0_60px_rgba(59,130,246,0.08)] p-8">
      <h1 className="text-2xl font-semibold text-foreground tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Welcome back. Open the Detection Engineering console.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field
          label="Work email"
          icon={<Mail className="h-4 w-4" />}
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          placeholder="you@company.com"
          required
        />
        <Field
          label="Password"
          icon={<Lock className="h-4 w-4" />}
          type={showPw ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••••"
          required
          trailing={
            <button type="button" onClick={() => setShowPw((s) => !s)} className="text-muted-foreground hover:text-foreground p-1">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full h-11 rounded-lg bg-accent hover:bg-[#60a5fa] text-white font-medium text-sm transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            No account?{" "}
            <Link href="/signup" className="text-accent hover:text-[#60a5fa]">Sign up</Link>
          </span>
          <Link href="#" className="hover:text-foreground">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}

function Field(props: {
  label: string;
  icon: React.ReactNode;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        {props.label}
      </span>
      <div className="relative flex items-center">
        <span className="absolute left-3 text-muted-foreground">{props.icon}</span>
        <input
          type={props.type}
          autoComplete={props.autoComplete}
          required={props.required}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className="w-full h-11 pl-9 pr-10 rounded-lg bg-input border border-border text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-2 focus:ring-input-focus/30 transition-colors"
        />
        {props.trailing && <span className="absolute right-2">{props.trailing}</span>}
      </div>
    </label>
  );
}
