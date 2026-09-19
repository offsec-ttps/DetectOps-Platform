"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Lock, Mail, User as UserIcon, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live policy hints
  const rules = [
    { ok: password.length >= 10, label: "At least 10 characters" },
    { ok: /[a-z]/.test(password), label: "Contains a lowercase letter" },
    { ok: /[A-Z]/.test(password), label: "Contains an uppercase letter" },
    { ok: /\d/.test(password), label: "Contains a number" },
  ];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sign-up failed.");
        return;
      }
      const q = new URLSearchParams({ userId: data.userId, email: data.email });
      if (data.__devCode) q.set("devCode", data.__devCode);
      router.push(`/verify?${q.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm shadow-[0_0_60px_rgba(59,130,246,0.08)] p-8">
      <h1 className="text-2xl font-semibold text-foreground tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Spin up a detection lab and validate your first rule tonight.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field
          label="Full name"
          icon={<UserIcon className="h-4 w-4" />}
          type="text"
          autoComplete="name"
          value={name}
          onChange={setName}
          placeholder="Jane Doe"
          required
        />
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          placeholder="At least 10 characters"
          required
          trailing={
            <button type="button" onClick={() => setShowPw((s) => !s)} className="text-muted-foreground hover:text-foreground p-1">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />

        <ul className="grid grid-cols-2 gap-1.5 text-[11px]">
          {rules.map((r) => (
            <li key={r.label} className={r.ok ? "text-success" : "text-muted-foreground"}>
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> {r.label}
              </span>
            </li>
          ))}
        </ul>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || rules.some((r) => !r.ok) || !email || !name}
          className="w-full h-11 rounded-lg bg-accent hover:bg-[#60a5fa] text-white font-medium text-sm transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </button>

        <p className="text-[11px] text-center text-muted-foreground">
          By creating an account you agree to our <Link href="#" className="hover:text-foreground underline">Terms</Link> and <Link href="#" className="hover:text-foreground underline">Privacy</Link>.
        </p>

        <div className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:text-[#60a5fa]">Sign in</Link>
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
