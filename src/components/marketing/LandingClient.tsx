"use client";
/**
 * DetectOps public landing page.
 *
 * All sections built to the brief in /home/nested/.claude/plans/crispy-dancing-eclipse.md.
 * Uses CSS-only motion (no framer-motion dependency); design tokens consumed
 * from src/styles/globals.css.
 */
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { Wordmark, BrandMark } from "./Brand";
import {
  Shield, ShieldCheck, Radar, Crosshair, Target, FlaskConical, GitBranch, GitPullRequest,
  Brain, Cloud, Server, Terminal, Activity, Zap, Layers, Database, Workflow, FileCode2,
  Play, ArrowRight, CheckCircle2, XCircle, Lock, FileText, KeyRound,
  Menu, X, Sparkles, Cpu, Boxes, RotateCw, Loader2,
} from "lucide-react";

// lucide-react@^1.7.0 in this repo doesn't export Github / Linkedin / Youtube
// (the dependency is an older / forked release). Inline SVGs instead.
function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}
function LinkedinIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}
function YoutubeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
    </svg>
  );
}

/* ─────────────────── Motion primitives (no deps) ─────────────────── */
function useInView<T extends HTMLElement>(opts?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px", ...opts });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, inView };
}

/** Fade + rise into view on scroll. */
function Reveal({ children, delay = 0, y = 24, className = "" }: { children: React.ReactNode; delay?: number; y?: number; className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={className} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? "none" : `translateY(${y}px)`,
      transition: `opacity .7s cubic-bezier(.16,1,.3,1) ${delay}ms, transform .7s cubic-bezier(.16,1,.3,1) ${delay}ms`,
      willChange: "opacity, transform",
    }}>{children}</div>
  );
}

/** Count a number up from 0 when it scrolls into view; preserves prefix/suffix. */
function CountUp({ text, className = "" }: { text: string; className?: string }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const m = text.match(/^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
  const [val, setVal] = useState(0);
  const prefix = m?.[1] ?? "", numStr = m?.[2] ?? "", suffix = m?.[3] ?? "";
  const target = numStr ? parseFloat(numStr.replace(/,/g, "")) : 0;
  const hasComma = numStr.includes(",");
  const decimals = numStr.includes(".") ? (numStr.split(".")[1]?.length ?? 0) : 0;
  useEffect(() => {
    if (!inView || !target) return;
    let raf = 0; const t0 = performance.now(); const dur = 1300;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target]);
  if (!numStr) return <span className={className}>{text}</span>;
  const shown = hasComma ? Math.round(val).toLocaleString() : val.toFixed(decimals);
  return <span ref={ref} className={className}>{prefix}{shown}{suffix}</span>;
}

/** Cursor-following radial glow — sets --mx/--my CSS vars on the element. */
function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);
  return { ref, onMove };
}

/** Thin gradient scroll-progress bar pinned to the top. */
function ScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setP(max > 0 ? (h.scrollTop / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[2px] bg-transparent">
      <div className="h-full bg-gradient-to-r from-[#3b82f6] via-[#8b5cf6] to-[#a855f7] transition-[width] duration-150" style={{ width: `${p}%` }} />
    </div>
  );
}

/* Shared keyframes used across sections. */
function MotionStyles() {
  return (
    <style>{`
      @keyframes do-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
      .do-float { animation: do-float 4s ease-in-out infinite; }
      @keyframes do-grad { 0%,100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }
      .do-anim-grad { background-size: 200% auto; animation: do-grad 6s ease infinite; }
      @keyframes do-blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
      .do-caret { animation: do-blink 1s step-end infinite; }
      @keyframes do-rise { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform:none } }
      .do-line { animation: do-rise .35s ease both; }
      .do-spot { position: relative; }
      .do-spot::before {
        content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
        background: radial-gradient(220px circle at var(--mx,50%) var(--my,0%), rgba(59,130,246,0.14), transparent 60%);
        opacity:0; transition: opacity .3s;
      }
      .do-spot:hover::before { opacity:1; }
      @media (prefers-reduced-motion: reduce) {
        .do-float, .do-anim-grad, .do-caret, .do-line { animation: none !important; }
      }
    `}</style>
  );
}

export default function LandingClient({ signedIn, userName }: { signedIn: boolean; userName: string }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <MotionStyles />
      <ScrollProgress />
      <BackgroundFx />
      <Nav signedIn={signedIn} userName={userName} />
      <main>
        <Hero signedIn={signedIn} />
        <LogoBar />
        <Problem />
        <Pillars />
        <Library />
        <WorkflowSection />
        <DeploymentModels />
        <CoreTide />
        <Metrics />
        <Integrations />
        <Agents />
        <Quote />
        <Trust />
        <PricingTeaser />
        <FinalCTA signedIn={signedIn} />
      </main>
      <Footer />
    </div>
  );
}

/* ─────────────────────────── Background FX ─────────────────────────── */
function BackgroundFx() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(#1e293b 1px, transparent 1px), linear-gradient(90deg, #1e293b 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse at 30% 0%, black 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at 30% 0%, black 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 40rem at 30% 25%, rgba(59,130,246,0.12), transparent 60%), radial-gradient(40rem 30rem at 80% 10%, rgba(168,85,247,0.08), transparent 60%)",
        }}
      />
      {/* Slow diagonal scanlines */}
      <div className="absolute inset-0 do-scanline" />
      <style>{`
        @keyframes do-scan { from { transform: translateY(-20%); } to { transform: translateY(120%); } }
        .do-scanline::before, .do-scanline::after {
          content: "";
          position: absolute; inset: -10% -5%;
          background: linear-gradient(transparent 49%, rgba(59,130,246,0.06) 50%, transparent 51%);
          background-size: 100% 6px;
          opacity: 0.25;
          animation: do-scan 20s linear infinite;
        }
        .do-scanline::after { animation-duration: 28s; opacity: 0.15; transform: skewY(-2deg); }
      `}</style>
    </div>
  );
}

/* ───────────────────────────── Nav ───────────────────────────── */
function Nav({ signedIn, userName }: { signedIn: boolean; userName: string }) {
  const [open, setOpen] = useState(false);
  const items = [
    { label: "Platform", href: "#pillars" },
    { label: "Detections", href: "#library" },
    { label: "Labs", href: "#labs" },
    { label: "Integrations", href: "#integrations" },
    { label: "Pricing", href: "#pricing" },
  ];
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/70 border-b border-border/60">
      <div className="max-w-7xl mx-auto h-16 flex items-center justify-between px-6">
        <Wordmark />
        <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          {items.map((i) => (
            <a key={i.label} href={i.href} className="hover:text-foreground transition-colors">{i.label}</a>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-3">
          {signedIn ? (
            <>
              <span className="text-xs text-muted-foreground">Welcome{userName ? `, ${userName.split(" ")[0]}` : ""}</span>
              <Link href="/overview" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-accent hover:bg-[#60a5fa] text-white text-sm font-medium">
                Open Console <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
              <Link href="/signup" className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-accent hover:bg-[#60a5fa] text-white text-sm font-medium">
                Open Console <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
        <button className="md:hidden text-foreground" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="md:hidden border-t border-border/60 bg-background/95 px-6 py-4 space-y-3">
          {items.map((i) => (
            <a key={i.label} href={i.href} onClick={() => setOpen(false)} className="block text-sm text-muted-foreground">{i.label}</a>
          ))}
          {!signedIn && (
            <div className="flex gap-2 pt-2">
              <Link href="/login" className="flex-1 h-10 rounded-lg border border-border text-sm flex items-center justify-center text-foreground">Sign in</Link>
              <Link href="/signup" className="flex-1 h-10 rounded-lg bg-accent text-white text-sm flex items-center justify-center">Sign up</Link>
            </div>
          )}
          {signedIn && (
            <Link href="/overview" className="block h-10 rounded-lg bg-accent text-white text-sm flex items-center justify-center">Open Console</Link>
          )}
        </div>
      )}
    </header>
  );
}

/* ─────────────────────── Section wrapper ─────────────────────── */
function Section({ id, children, className = "", reveal = true }: { id?: string; children: React.ReactNode; className?: string; reveal?: boolean }) {
  return (
    <section id={id} className={`relative z-10 max-w-7xl mx-auto px-6 py-20 md:py-28 ${className}`}>
      {reveal ? <Reveal>{children}</Reveal> : children}
    </section>
  );
}

function H2({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">{icon}</span>
      {children}
    </h2>
  );
}

/* ─────────────────────────── Hero ─────────────────────────── */
function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <Section className="!pt-16 md:!pt-24">
      <div className="grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
        <div className="space-y-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent uppercase tracking-wider">
            <Sparkles className="h-3 w-3" />
            New — 14,000+ unified detection rules
          </span>
          <h1 className="text-[44px] sm:text-5xl md:text-6xl lg:text-[72px] font-bold leading-[1.05] tracking-tight">
            Detection Engineering,
            <br />
            <span className="do-anim-grad bg-gradient-to-r from-[#3b82f6] via-[#8b5cf6] to-[#a855f7] bg-clip-text text-transparent">
              operationalized.
            </span>
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
            Simulate attacks, validate detections across every SIEM you run, and ship rules to GitHub —
            from one platform. Built for senior detection engineers, not dashboards.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={signedIn ? "/overview" : "/signup"}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-lg bg-accent hover:bg-[#60a5fa] text-white font-medium text-sm shadow-[0_0_40px_rgba(59,130,246,0.35)] transition-all"
            >
              {signedIn ? "Open the Console" : "Open the Console"} <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#workflow"
              className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-border text-foreground hover:bg-card-hover text-sm font-medium transition-colors"
            >
              <Play className="h-4 w-4" /> Watch the 4-min tour
            </a>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Used by detection teams running <strong className="text-foreground/90">Splunk · Sentinel · Defender XDR · Elastic Security · CrowdStrike Falcon</strong>
          </p>
        </div>
        <ProductMock />
      </div>
    </Section>
  );
}

/* Hero product mock — INTERACTIVE: pick a technique, watch it simulate + validate live. */
type Scenario = { id: string; label: string; name: string; lines: string[]; detected: boolean; matches: number; rd: string };
const SCENARIOS: Scenario[] = [
  {
    id: "T1003.001", label: "T1003.001", name: "OS Credential Dumping — LSASS",
    detected: true, matches: 4, rd: "0.81",
    lines: [
      "POST /api/sar/simulate  techniques=T1003.001 target=lab-DC01",
      "art › Invoke-AtomicTest T1003.001-1 — Dump LSASS (comsvcs.dll)",
      "art › ART_EXECUTION_DONE  exit=0",
      "splunkd  index=sysmon  EventCode=10  target=lsass.exe",
      "esc › saved_search 'Mimikatz LSASS Memory Access' — TRIGGERED",
      "validation › attempt 1/20 — DETECTED  matches=4",
      "report › push branch=report/t1003 … PR #138 opened",
    ],
  },
  {
    id: "T1059.001", label: "T1059.001", name: "PowerShell Execution",
    detected: true, matches: 6, rd: "0.74",
    lines: [
      "POST /api/sar/simulate  techniques=T1059.001 target=lab-WS01",
      "art › Invoke-AtomicTest T1059.001-1 — Encoded command",
      "art › ART_EXECUTION_DONE  exit=0",
      "splunkd  index=windows  EventCode=4104  ScriptBlockText=…",
      "esc › saved_search 'Suspicious PowerShell ScriptBlock' — TRIGGERED",
      "validation › attempt 2/20 — DETECTED  matches=6",
      "report › push branch=report/t1059 … PR #141 opened",
    ],
  },
  {
    id: "T1135", label: "T1135", name: "Network Share Discovery",
    detected: true, matches: 3, rd: "0.69",
    lines: [
      "POST /api/sar/simulate  techniques=T1135 target=lab-WS01",
      "art › Invoke-AtomicTest T1135-5 — Get-SmbShare enumeration",
      "art › ART_EXECUTION_DONE  exit=0",
      "splunkd  index=windows  EventCode=5145  ShareName=ADMIN$",
      "esc › saved_search 'Network Share Enumeration' — TRIGGERED",
      "validation › attempt 3/20 — DETECTED  matches=3",
      "report › push branch=report/t1135 … PR #144 opened",
    ],
  },
  {
    id: "T1486", label: "T1486", name: "Data Encrypted for Impact",
    detected: false, matches: 0, rd: "0.42",
    lines: [
      "POST /api/sar/simulate  techniques=T1486 target=lab-DC01",
      "art › Invoke-AtomicTest T1486-3 — Mass file encryption",
      "art › ART_EXECUTION_DONE  exit=0",
      "splunkd  index=sysmon  EventCode=11  files_modified=812",
      "esc › no saved_search matched mass-write burst",
      "validation › attempt 20/20 — MISSED  coverage gap found",
      "sigmagen › drafted rule 'Rapid File Modification' — review →",
    ],
  },
];

function ProductMock() {
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(0);          // how many log lines are visible
  const sc = SCENARIOS[active];
  const total = sc.lines.length;
  const running = shown < total;
  const done = shown >= total;

  // Stream lines in one-by-one whenever the active scenario changes.
  useEffect(() => {
    setShown(0);
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= total) clearInterval(t);
    }, 520);
    return () => clearInterval(t);
  }, [active, total]);

  // Auto-advance to the next scenario a moment after one finishes.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % SCENARIOS.length), 3200);
    return () => clearTimeout(t);
  }, [done, active]);

  // Heatmap: cells "light up" progressively with the run.
  const cells = Array.from({ length: 48 }).map((_, i) => {
    const v = ((i * 53 + active * 17) % 100);
    const lit = i / 48 <= shown / total;
    const color = v > 80 ? "#22c55e" : v > 60 ? "#86efac" : v > 40 ? "#f59e0b" : v > 20 ? "#7f1d1d" : "#1e293b";
    return { color, lit };
  });
  const pct = Math.round((shown / total) * 100);

  return (
    <div className="relative">
      <div className="absolute -inset-8 rounded-[40px] opacity-60" style={{ background: "radial-gradient(closest-side, rgba(59,130,246,0.25), transparent 70%)" }} />
      <div className="relative rounded-2xl border border-border bg-card/80 backdrop-blur p-5 shadow-[0_0_60px_rgba(59,130,246,0.12)] do-float">
        {/* header */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${running ? "bg-warning animate-pulse" : "bg-success"}`} />
            {running ? "running" : "live"} · lab-u9c29x
          </span>
          <span className="font-mono">{sc.name}</span>
        </div>

        {/* interactive technique picker */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {SCENARIOS.map((s, i) => (
            <button key={s.id} onClick={() => setActive(i)}
              className={`px-2 py-1 rounded-md text-[10.5px] font-mono border transition-all ${i === active ? "border-accent/60 bg-accent/15 text-accent" : "border-border text-muted-foreground hover:text-foreground hover:border-border-hover"}`}>
              {s.label}
            </button>
          ))}
          <button onClick={() => setActive(active)} title="Re-run"
            className="ml-auto px-2 py-1 rounded-md text-[10.5px] border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <RotateCw className="h-3 w-3" /> re-run
          </button>
        </div>

        {/* metric chips */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { l: "Rules", v: "4,217" },
            { l: "Matches", v: done ? String(sc.matches) : "—" },
            { l: "Verdict", v: done ? (sc.detected ? "DET" : "MISS") : "…", tone: done ? (sc.detected ? "text-success" : "text-danger") : "" },
            { l: "Rd score", v: done ? sc.rd : "—" },
          ].map((m) => (
            <div key={m.l} className="rounded-lg border border-border bg-background/60 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{m.l}</div>
              <div className={`text-[13px] font-semibold font-mono ${(m as any).tone || "text-foreground"}`}>{m.v}</div>
            </div>
          ))}
        </div>

        {/* progress */}
        <div className="h-1 rounded-full bg-muted/20 overflow-hidden mb-3">
          <div className={`h-full rounded-full transition-all duration-500 ${done ? (sc.detected ? "bg-success" : "bg-danger") : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>

        {/* heatmap */}
        <div className="grid grid-cols-8 gap-1 mb-3">
          {cells.map((c, i) => (
            <div key={i} className="aspect-square rounded-[3px] transition-all duration-500" style={{ background: c.color, opacity: c.lit ? (c.color === "#1e293b" ? 0.5 : 0.9) : 0.12 }} />
          ))}
        </div>

        {/* live log */}
        <div className="rounded-lg border border-border bg-[#0d1117] p-3 font-mono text-[10.5px] leading-relaxed text-emerald-300/90 h-40 overflow-hidden">
          {sc.lines.slice(0, shown).map((l, i) => {
            const isVerdict = /DETECTED|MISSED/.test(l);
            const ok = l.includes("DETECTED");
            return (
              <div key={`${active}-${i}`} className={`do-line truncate ${isVerdict ? (ok ? "text-success font-semibold" : "text-danger font-semibold") : ""}`}>
                <span className="text-muted-foreground/60">›</span> {l}
                {i === shown - 1 && running && <span className="do-caret text-accent">▋</span>}
              </div>
            );
          })}
          {done && (
            <div className="do-line mt-1 flex items-center gap-1.5 font-semibold">
              {sc.detected
                ? <><CheckCircle2 className="h-3 w-3 text-success" /> <span className="text-success">DETECTED — {sc.matches} rule(s) · Rd {sc.rd}</span></>
                : <><XCircle className="h-3 w-3 text-danger" /> <span className="text-danger">MISSED — coverage gap, rule drafted</span></>}
            </div>
          )}
        </div>
        <div className="mt-2 text-center text-[10px] text-muted-foreground">↑ click a technique to run it live</div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Logo bar ─────────────────────────── */
function LogoBar() {
  const items = ["Splunk", "Microsoft Sentinel", "Defender XDR", "Elastic Security", "CrowdStrike Falcon", "SentinelOne", "Sigma", "MITRE ATT&CK", "GitHub", "AWS", "Azure", "GCP"];
  return (
    <div className="relative z-10 border-y border-border/40 bg-card/30">
      <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center gap-x-8 gap-y-3 justify-center">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Compatible with</span>
        {items.map((n) => (
          <span key={n} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">{n}</span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Problem ─────────────────────────── */
function Problem() {
  const cols = [
    { h: "Rules live in 6 places.", b: "Splunk content updates, SigmaHQ pulls, Elastic detection-rules repo, custom Confluence pages, vendor packs, and one engineer's laptop. Nothing reconciles." },
    { h: "Simulations never feed back.", b: "Atomic tests run in a lab. Alerts fire (or don't) in Splunk. The connection between the two lives in a screenshot in a Notion doc." },
    { h: "Reports rot in Confluence.", b: "A detection report becomes a stale wiki page within a sprint. No PR, no review, no audit trail of why a rule was tuned the way it was." },
  ];
  return (
    <Section>
      <H2 icon={<Crosshair className="h-5 w-5" />}>The detection workflow is broken.</H2>
      <div className="mt-10 grid md:grid-cols-3 gap-6">
        {cols.map((c) => (
          <div key={c.h} className="rounded-2xl border border-border bg-card p-6 hover:border-border-hover transition-colors">
            <h3 className="text-base font-semibold text-foreground">{c.h}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{c.b}</p>
          </div>
        ))}
      </div>
      <p className="mt-10 text-lg font-medium text-accent text-center">
        DetectOps replaces that stack with one workflow.
      </p>
    </Section>
  );
}

/* ─────────────────────────── Pillars ─────────────────────────── */
function Pillars() {
  const pillars = [
    {
      icon: <FlaskConical className="h-7 w-7" />,
      title: "Simulate",
      desc: "Run Atomic Red Team across 4,000+ techniques on on-prem (SAR + GOAD) or cloud labs (AWS · Azure · GCP). Spin up a lab in 8 minutes.",
      href: "#labs",
    },
    {
      icon: <Radar className="h-7 w-7" />,
      title: "Validate",
      desc: "Auto-retry detection validation up to 20× against Splunk ESCU saved searches, fired_alerts, the notable index, and direct SPL — until your rule fires or proves a gap.",
      href: "#workflow",
    },
    {
      icon: <FileCode2 className="h-7 w-7" />,
      title: "Author",
      desc: "Sigma editor with one-click pySigma conversion to Splunk SPL, Elastic ES|QL, Microsoft KQL, Panther, Falco — plus SigmaGen for AI-drafted rules from natural language.",
      href: "#library",
    },
    {
      icon: <GitBranch className="h-7 w-7" />,
      title: "Ship",
      desc: "Reports auto-push to GitHub: branch-per-report, PR with checklist, issue created, project board updated. Reviewer merges. Done.",
      href: "#workflow",
    },
  ];
  return (
    <Section id="pillars">
      <H2 icon={<Layers className="h-5 w-5" />}>Four pillars. One platform.</H2>
      <div className="mt-10 grid md:grid-cols-2 gap-6">
        {pillars.map((p) => (
          <a key={p.title} href={p.href}
            onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`); e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`); }}
            className="do-spot group overflow-hidden rounded-3xl border border-border bg-card p-7 hover:bg-card-hover hover:border-accent/40 hover:shadow-[0_0_60px_rgba(59,130,246,0.12)] transition-all">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent group-hover:scale-105 group-hover:rotate-3 transition-transform">
              {p.icon}
            </div>
            <h3 className="mt-5 text-2xl font-semibold text-foreground tracking-tight">{p.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
            <span className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-accent group-hover:gap-2 transition-all">
              Learn more <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </a>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────── Detection Library ─────────────────────── */
function Library() {
  const sources = [
    { name: "Splunk ESCU", count: "1,500+", dot: "#22c55e" },
    { name: "SigmaHQ", count: "3,000+", dot: "#22c55e" },
    { name: "Elastic Security", count: "1,200+", dot: "#f59e0b" },
    { name: "MITRE CAR", count: "200+", dot: "#22c55e" },
    { name: "Microsoft Sentinel", count: "2,000+", dot: "#22c55e" },
    { name: "Defender XDR", count: "1,400+", dot: "#22c55e" },
    { name: "Google SecOps", count: "900+", dot: "#f59e0b" },
    { name: "Panther", count: "700+", dot: "#22c55e" },
    { name: "Falco", count: "600+", dot: "#22c55e" },
    { name: "Wazuh", count: "2,500+", dot: "#22c55e" },
  ];
  return (
    <Section id="library">
      <H2 icon={<Database className="h-5 w-5" />}>14,000+ rules, unified.</H2>
      <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
        {[
          { v: "14,000+", l: "detection rules ingested" },
          { v: "9", l: "community + commercial sources" },
          { v: "400+", l: "MITRE ATT&CK techniques covered" },
          { v: "28+", l: "integrated platform modules" },
        ].map((s) => (
          <div key={s.l} className="rounded-2xl border border-border bg-card p-5 hover:border-accent/40 transition-colors">
            <CountUp text={s.v} className="block text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-[#3b82f6] to-[#a855f7] bg-clip-text text-transparent" />
            <div className="mt-1 text-xs text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex gap-3 overflow-x-auto pb-4 -mx-6 px-6">
        {sources.map((s) => (
          <div key={s.name} className="flex-shrink-0 w-[240px] rounded-xl border border-border bg-card p-4 hover:bg-card-hover transition-colors">
            <div className="flex items-center justify-between">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent font-bold text-sm">
                {s.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </span>
              <span className="h-2 w-2 rounded-full" style={{ background: s.dot }} title="sync status" />
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">{s.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.count} rules · synced 4h ago</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Workflow ─────────────────────────── */
function WorkflowSection() {
  const steps = [
    { title: "Pick technique", caption: "T1003.001 chip", icon: <Target className="h-5 w-5" /> },
    { title: "Run simulation", caption: "POST /api/sar/simulate", icon: <FlaskConical className="h-5 w-5" /> },
    { title: "Telemetry lands", caption: "splunkd:9997", icon: <Activity className="h-5 w-5" /> },
    { title: "Auto-validate ×20", caption: "GET fired_alerts", icon: <Radar className="h-5 w-5" /> },
    { title: "GitHub PR opened", caption: "branch=report/t1003-…", icon: <GitPullRequest className="h-5 w-5" /> },
  ];
  const [active, setActive] = useState(0);
  const { ref, inView } = useInView<HTMLDivElement>();
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setActive((a) => (a + 1) % steps.length), 1600);
    return () => clearInterval(t);
  }, [inView, steps.length]);
  return (
    <Section id="workflow">
      <H2 icon={<Workflow className="h-5 w-5" />}>From threat to merged PR in one platform.</H2>
      <p className="mt-3 text-sm text-muted-foreground max-w-3xl">
        Every step has a real API touchpoint you can script against. No screens stitched together by humans.
      </p>
      <div ref={ref} className="mt-12 grid grid-cols-1 md:grid-cols-5 gap-6 md:gap-3">
        {steps.map((s, i) => {
          const on = i === active;
          const passed = i < active;
          return (
            <div key={s.title} className="relative">
              <div className={`rounded-2xl border bg-card p-5 h-full transition-all duration-500 ${on ? "border-accent/70 shadow-[0_0_40px_rgba(59,130,246,0.18)] -translate-y-1" : passed ? "border-success/40" : "border-border"}`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className="h-px flex-1 bg-border" />
                  {on && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
                  {passed && <CheckCircle2 className="h-3 w-3 text-success" />}
                </div>
                <div className={`mt-3 inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-500 ${on ? "border-accent/50 bg-accent/20 text-accent scale-110" : passed ? "border-success/40 bg-success/10 text-success" : "border-accent/30 bg-accent/10 text-accent"}`}>
                  {s.icon}
                </div>
                <h3 className="mt-3 text-sm font-semibold text-foreground">{s.title}</h3>
                <p className="mt-1 text-[11px] font-mono text-muted-foreground break-all">{s.caption}</p>
              </div>
              {i < steps.length - 1 && (
                <ArrowRight className={`hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 h-4 w-4 z-10 transition-all duration-500 ${i < active ? "text-success" : on ? "text-accent scale-125" : "text-border"}`} />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Deployment Models ─────────────────────────── */
function DeploymentModels() {
  return (
    <Section id="labs">
      <H2 icon={<Server className="h-5 w-5" />}>Lab in your basement, or in any cloud.</H2>
      <div className="mt-10 grid lg:grid-cols-3 gap-6">
        <LabCard
          icon={<Boxes className="h-5 w-5" />}
          title="On-prem Vagrant"
          subtitle="SAR + GOAD on VirtualBox"
          bullets={["Minimal — 8 GB RAM", "Standard — 14 GB RAM", "Full + Kali + ES — 44 GB RAM"]}
          netLabel="10.0.1.0/24"
          accent="#3b82f6"
        />
        <LabCard
          icon={<Cloud className="h-5 w-5" />}
          title="On-prem Docker (Controller)"
          subtitle="SAR Cloud Deployment Docker"
          bullets={["REST API · localhost:4000", "Web UI · localhost:4321", "Brokers AWS / Azure / GCP ranges"]}
          netLabel="docker bridge"
          accent="#a855f7"
        />
        <LabCard
          icon={<Cpu className="h-5 w-5" />}
          title="Pure Cloud"
          subtitle="Terraform on AWS · Azure · GCP"
          bullets={["AWS SAR Minimal (t3.xlarge)", "Azure SAR (D4s_v3)", "GOAD-on-m5.2xlarge nested AD"]}
          netLabel="10.0.2.0/24"
          accent="#06b6d4"
        />
      </div>
    </Section>
  );
}
function LabCard({ icon, title, subtitle, bullets, netLabel, accent }: { icon: React.ReactNode; title: string; subtitle: string; bullets: string[]; netLabel: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 hover:border-accent/40 transition-colors">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md" style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}55` }}>{icon}</span>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      <ul className="mt-4 space-y-1.5 text-sm text-foreground">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" /> {b}
          </li>
        ))}
      </ul>
      {/* Mini architecture sketch */}
      <div className="mt-5 rounded-lg border border-border bg-background/60 p-4">
        <div className="text-[10px] font-mono text-muted-foreground mb-3">{netLabel}</div>
        <div className="grid grid-cols-3 gap-2">
          {["splunk", "DC01", "WS01"].map((n) => (
            <div key={n} className="rounded border text-[10px] font-mono text-foreground py-2 text-center" style={{ borderColor: `${accent}55`, background: `${accent}10` }}>
              {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── CoreTide ─────────────────────────── */
function CoreTide() {
  const nodes = [
    { x: 50, y: 0, label: "CoreTide Reconciler", icon: <Workflow className="h-4 w-4" /> },
    { x: 100, y: 50, label: "Splunk Deployment", icon: <Database className="h-4 w-4" /> },
    { x: 50, y: 100, label: "MDE Graph Connector", icon: <ShieldCheck className="h-4 w-4" /> },
    { x: 0, y: 50, label: "GitHub Actions", icon: <GithubIcon /> },
  ];
  return (
    <Section>
      <H2 icon={<Zap className="h-5 w-5" />}>The CoreTide loop — always in sync.</H2>
      <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
        Your detection rules reconcile across Splunk, Defender, and Git every 5 minutes. Always in sync. Always auditable.
      </p>
      <div className="mt-10 grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
        <div className="relative aspect-square max-w-md mx-auto w-full">
          <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full" aria-hidden>
            <defs>
              <linearGradient id="ct-grad" x1="0" y1="0" x2="200" y2="200">
                <stop offset="0" stopColor="#3b82f6" />
                <stop offset="1" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="80" stroke="url(#ct-grad)" strokeWidth="1.5" fill="none" strokeDasharray="6 8" className="do-rotate" />
            <circle cx="100" cy="100" r="60" stroke="rgba(59,130,246,0.2)" strokeWidth="1" fill="none" />
          </svg>
          {nodes.map((n, i) => (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border border-accent/40 bg-card px-3 py-2 text-[11px] flex items-center gap-1.5 text-foreground"
              style={{ left: `${10 + (n.x * 0.8)}%`, top: `${10 + (n.y * 0.8)}%` }}
            >
              <span className="text-accent">{n.icon}</span> {n.label}
            </div>
          ))}
          <style>{`@keyframes do-rotate { from { transform: rotate(0) } to { transform: rotate(360deg) } } .do-rotate { transform-origin: 100px 100px; animation: do-rotate 30s linear infinite; }`}</style>
        </div>
        <div className="space-y-4">
          {[
            { t: "5-minute reconcile", d: "Detection rules in your Splunk indexers and MDE custom rules table reflect HEAD of your detection repo within minutes — automatically." },
            { t: "Audit on every action", d: "Who changed which rule, on which branch, after which PR review. CoreTide writes it to the audit log on every reconcile." },
            { t: "Two-way drift detection", d: "If somebody edits a rule directly in Splunk, CoreTide surfaces the drift on the next cycle and opens a PR to bring Git back in line." },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border border-border bg-card p-4">
              <div className="text-sm font-semibold text-foreground">{f.t}</div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Metrics ─────────────────────────── */
function Metrics() {
  const cards = [
    { name: "Detection Reliability (Rd)", v: "0.78", l: "% of attacks that trigger your rule", series: [.2, .35, .55, .6, .72, .68, .78] },
    { name: "Mean Time to Implement", v: "14h", l: "Hours from use case to production", series: [.95, .82, .7, .55, .4, .3, .2] },
    { name: "MITRE Coverage", v: "67%", l: "Heatmap by tactic, data source, platform", series: [.3, .42, .48, .52, .58, .62, .67] },
  ];
  return (
    <Section>
      <H2 icon={<Activity className="h-5 w-5" />}>Metrics you actually measure.</H2>
      <div className="mt-10 grid md:grid-cols-3 gap-6">
        {cards.map((c) => (
          <div key={c.name} className="rounded-2xl border border-border bg-card p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.name}</div>
            <div className="mt-3 flex items-baseline justify-between">
              <CountUp text={c.v} className="text-4xl font-bold font-mono text-foreground tracking-tight" />
              <Sparkline values={c.series} />
            </div>
            {/* Coverage bar */}
            <div className="mt-4 h-1.5 rounded-full bg-border overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#3b82f6] to-[#a855f7]" style={{ width: `${(c.series[c.series.length - 1]) * 100}%` }} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{c.l}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
function Sparkline({ values }: { values: number[] }) {
  const w = 80, h = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - v * h}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-90" aria-hidden>
      <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─────────────────────────── Integrations ─────────────────────────── */
function Integrations() {
  const tiles = [
    "Splunk Enterprise", "Microsoft Sentinel", "Defender XDR", "Elastic Security",
    "CrowdStrike Falcon", "SentinelOne", "AWS CloudTrail", "Okta",
    "Palo Alto NGFW", "Jira", "Slack", "GitHub Actions",
  ];
  return (
    <Section id="integrations">
      <H2 icon={<Shield className="h-5 w-5" />}>Plugs into your stack.</H2>
      <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map((name) => (
          <div key={name} className="rounded-xl border border-border bg-card px-4 py-3 hover:bg-card-hover transition-colors">
            <div className="flex items-center justify-between">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent text-[10px] font-bold">
                {name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
            </div>
            <div className="mt-2 text-sm font-medium text-foreground">{name}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">Configured · Test passed · 23 syncs</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Auth via OAuth, PAT, API key, or self-hosted MCP server. Credentials live in your environment, never ours.
      </p>
    </Section>
  );
}

/* ─────────────────────────── Agents ─────────────────────────── */
function Agents() {
  const agents = [
    { name: "Developer Agent", desc: "Drafts Sigma rules and translates to SPL / KQL / ES|QL.", icon: <Brain className="h-6 w-6" />, status: "idle" },
    { name: "Simulation Agent", desc: "Executes ART + CALDERA profiles on the right lab.", icon: <FlaskConical className="h-6 w-6" />, status: "running" },
    { name: "Validation Agent", desc: "Auto-retries Splunk / MDE alert validation up to 20×.", icon: <Radar className="h-6 w-6" />, status: "idle" },
    { name: "Reporter Agent", desc: "Generates LOCK docs and updates GitHub PR + Project.", icon: <FileText className="h-6 w-6" />, status: "idle" },
  ];
  return (
    <Section>
      <H2 icon={<Brain className="h-5 w-5" />}>Four agents working in the background.</H2>
      <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {agents.map((a) => (
          <div key={a.name} className="rounded-2xl border border-border bg-card p-5 relative overflow-hidden">
            <div className="absolute top-4 right-4 flex items-center gap-1.5 text-[10px]">
              <span className={`h-2 w-2 rounded-full ${a.status === "running" ? "bg-warning animate-pulse" : "bg-success"}`} />
              <span className={a.status === "running" ? "text-warning" : "text-success"}>{a.status === "running" ? "Running" : "Idle"}</span>
            </div>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">{a.icon}</div>
            <div className="mt-4 text-base font-semibold text-foreground">{a.name}</div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        MCP-compatible. Bring your own LLM.
      </p>
    </Section>
  );
}

/* ─────────────────────────── Quote ─────────────────────────── */
function Quote() {
  return (
    <Section>
      <div className="rounded-3xl border border-border bg-card p-8 md:p-12 flex flex-col md:flex-row items-start gap-6">
        <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#a855f7] flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
          DL
        </div>
        <div>
          <blockquote className="text-xl md:text-2xl font-semibold text-foreground leading-snug">
            “We replaced six spreadsheets, three Notion pages, and a Jenkins job with one DetectOps workflow. Our purple-team cycle dropped from <span className="text-accent">9 days to 11 hours</span>.”
          </blockquote>
          <div className="mt-4 text-sm text-muted-foreground">— Detection Lead, regional MDR provider</div>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Trust ─────────────────────────── */
function Trust() {
  const items = [
    { icon: <Lock className="h-5 w-5" />, title: "Your data never leaves", desc: "Self-host on your own VMs or cloud subnet. We never hold a copy of your detections, logs, or telemetry." },
    { icon: <FileText className="h-5 w-5" />, title: "Audit log on every action", desc: "Every rule edit, simulation, validation, and GitHub push is recorded with actor, timestamp, and outcome." },
    { icon: <KeyRound className="h-5 w-5" />, title: "Bring your own KMS", desc: "Plug into your secrets manager (Vault, Secrets Manager, Key Vault). API keys never sit in plaintext." },
  ];
  return (
    <Section>
      <H2 icon={<ShieldCheck className="h-5 w-5" />}>Security & trust.</H2>
      <div className="mt-10 grid md:grid-cols-3 gap-6">
        {items.map((i) => (
          <div key={i.title} className="rounded-2xl border border-border bg-card p-6">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">{i.icon}</span>
            <h3 className="mt-4 text-base font-semibold text-foreground">{i.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{i.desc}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Pricing ─────────────────────────── */
function PricingTeaser() {
  const tiers = [
    { name: "Open Source", price: "$0", note: "Forever free", features: ["Full landing platform", "All 28+ modules", "Community detection rules"], cta: "Get the code", href: "https://github.com" },
    { name: "Team", price: "$/seat", note: "Coming soon", features: ["Multi-user workspace", "Shared lab pool", "GitHub-org integrations"], cta: "Join waitlist", href: "#", highlight: true },
    { name: "Enterprise", price: "Custom", note: "Talk to us", features: ["Self-hosted on-prem", "SSO / SAML / SCIM", "24×7 support"], cta: "Book a call", href: "#" },
  ];
  return (
    <Section id="pricing">
      <H2 icon={<Target className="h-5 w-5" />}>Built to fit any team.</H2>
      <div className="mt-10 grid md:grid-cols-3 gap-6">
        {tiers.map((t) => (
          <div key={t.name} className={`rounded-2xl border p-6 ${t.highlight ? "border-accent/60 bg-card/90 shadow-[0_0_60px_rgba(59,130,246,0.12)]" : "border-border bg-card"}`}>
            <div className="text-sm font-semibold text-foreground">{t.name}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-foreground">{t.price}</span>
              <span className="text-xs text-muted-foreground">{t.note}</span>
            </div>
            <ul className="mt-5 space-y-2 text-sm text-foreground">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success mt-0.5" /> {f}
                </li>
              ))}
            </ul>
            <a href={t.href} className={`mt-6 inline-flex w-full h-10 items-center justify-center rounded-lg text-sm font-medium ${t.highlight ? "bg-accent text-white hover:bg-[#60a5fa]" : "border border-border text-foreground hover:bg-card-hover"}`}>
              {t.cta}
            </a>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────── Final CTA ─────────────────────────── */
function FinalCTA({ signedIn }: { signedIn: boolean }) {
  return (
    <Section>
      <div className="rounded-3xl border border-accent/40 bg-gradient-to-br from-[#0a0e1a] via-[#111c2e] to-[#1a1130] p-10 md:p-16 text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-30" style={{
          background: "radial-gradient(40rem 30rem at 50% 0%, rgba(59,130,246,0.3), transparent 60%), radial-gradient(30rem 20rem at 50% 100%, rgba(168,85,247,0.2), transparent 60%)",
        }} />
        <div className="relative">
          <h2 className="text-3xl md:text-5xl font-bold text-foreground tracking-tight">
            Stop hand-stitching your detection workflow.
          </h2>
          <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            Spin up a lab in 8 minutes. Validate your first detection tonight.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href={signedIn ? "/overview" : "/signup"} className="inline-flex items-center gap-2 h-12 px-6 rounded-lg bg-accent hover:bg-[#60a5fa] text-white font-medium text-sm">
              Open the Console <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#" className="inline-flex items-center gap-2 h-12 px-5 rounded-lg border border-border text-foreground hover:bg-card-hover text-sm">
              Book a 20-min walkthrough
            </a>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────── Footer ─────────────────────────── */
function Footer() {
  const cols = [
    { h: "Platform", items: ["Simulate", "Validate", "Author", "Ship", "Agents"] },
    { h: "Resources", items: ["Docs", "API reference", "Detection cookbook", "Changelog"] },
    { h: "Company", items: ["About", "Careers", "Press", "Contact"] },
    { h: "Legal", items: ["Privacy", "Terms", "Security", "DPA"] },
  ];
  return (
    <footer className="relative z-10 border-t border-border/60 bg-card/30 mt-20">
      <div className="max-w-7xl mx-auto px-6 py-12 grid md:grid-cols-5 gap-8">
        <div className="md:col-span-2 space-y-3">
          <Wordmark />
          <p className="text-xs text-muted-foreground max-w-xs">
            Made by detection engineers, for detection engineers.
          </p>
          <div className="flex items-center gap-3 text-muted-foreground">
            <a href="#" aria-label="GitHub" className="hover:text-foreground"><GithubIcon /></a>
            <a href="#" aria-label="LinkedIn" className="hover:text-foreground"><LinkedinIcon /></a>
            <a href="#" aria-label="YouTube" className="hover:text-foreground"><YoutubeIcon /></a>
          </div>
        </div>
        {cols.map((c) => (
          <div key={c.h}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{c.h}</div>
            <ul className="mt-3 space-y-2">
              {c.items.map((i) => (
                <li key={i}><a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{i}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border/60">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <div>© {new Date().getFullYear()} DetectOps. All rights reserved.</div>
          <div className="font-mono">v0.1.0 · main@HEAD</div>
        </div>
      </div>
    </footer>
  );
}
