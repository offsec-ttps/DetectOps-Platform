"use client";
/**
 * Wordmark "DetectOps" + RuSecure mark ("powered by RuSecure") used by landing + auth pages.
 * The mark is public/brand/rusecure-mark.png; the wordmark keeps the accent → purple gradient.
 */
import Link from "next/link";

export function BrandMark({ size = 28 }: { size?: number }) {
  // RuSecure mark (public/brand/rusecure-mark.png — circular-masked yin-yang).
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/rusecure-mark.png" width={size} height={size} alt="RuSecure" className="shrink-0 rounded-full select-none" draggable={false} />
  );
}

/** "DetectOps" wordmark (product) with the RuSecure mark and a "powered by RuSecure" credit. */
export function Wordmark({ href = "/", size = 18, credit = true }: { href?: string; size?: number; credit?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2 group">
      <BrandMark size={size + 14} />
      <span className="flex flex-col leading-none">
        <span className="font-semibold tracking-tight text-foreground" style={{ fontSize: size }}>
          Detect<span className="bg-gradient-to-r from-[#3b82f6] to-[#a855f7] bg-clip-text text-transparent">Ops</span>
        </span>
        {credit && (
          <span className="mt-1 uppercase tracking-[0.14em] text-muted-foreground" style={{ fontSize: Math.max(8, Math.round(size * 0.5)) }}>
            powered by <span className="font-semibold text-[#c084fc]">RuSecure</span>
          </span>
        )}
      </span>
    </Link>
  );
}
