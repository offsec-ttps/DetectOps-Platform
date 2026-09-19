"use client";
/**
 * Wordmark "DetectOps" + shield-radar mark used by landing + auth pages.
 * Pure SVG; no raster assets. Mark uses the accent → purple gradient
 * defined in the design brief.
 */
import Link from "next/link";

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="bm-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      {/* Shield silhouette */}
      <path
        d="M16 2.5L4 6.2v8.5c0 6.7 4.7 12.4 12 14.8 7.3-2.4 12-8.1 12-14.8V6.2L16 2.5z"
        stroke="url(#bm-grad)" strokeWidth="1.5" fill="rgba(59,130,246,0.06)"
      />
      {/* Radar arcs */}
      <path d="M9 16a7 7 0 0 1 14 0" stroke="url(#bm-grad)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M12 16a4 4 0 0 1 8 0" stroke="url(#bm-grad)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <circle cx="16" cy="16" r="1.5" fill="url(#bm-grad)" />
      {/* Sweep line */}
      <path d="M16 16 L22 11" stroke="url(#bm-grad)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ href = "/", size = 18 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="flex items-center gap-2 group">
      <BrandMark size={size + 10} />
      <span className="font-semibold tracking-tight text-foreground" style={{ fontSize: size }}>
        Detect<span className="bg-gradient-to-r from-[#3b82f6] to-[#a855f7] bg-clip-text text-transparent">Ops</span>
      </span>
    </Link>
  );
}
