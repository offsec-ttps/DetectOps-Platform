import { Wordmark } from "@/components/marketing/Brand";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col">
      {/* Background grid + glow — matches landing visual system */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(#1e293b 1px, transparent 1px), linear-gradient(90deg, #1e293b 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at 50% 30%, black 0%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(ellipse at 50% 30%, black 0%, transparent 70%)",
          }}
        />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(60rem 40rem at 50% 0%, rgba(59,130,246,0.12), transparent 60%)",
        }} />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <Wordmark />
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </Link>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="relative z-10 px-6 py-5 text-center text-[11px] text-muted-foreground">
        Detection Engineering, operationalized · © {new Date().getFullYear()} DetectOps
      </footer>
    </div>
  );
}
