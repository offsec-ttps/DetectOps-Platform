import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  const sizeClass = size === "sm" ? "h-4 w-4" : size === "md" ? "h-6 w-6" : "h-8 w-8";
  return <Loader2 className={cn("animate-spin text-accent", sizeClass, className)} />;
}

export function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn("h-4 rounded bg-card-hover animate-pulse", className)} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 space-y-3", className)}>
      <SkeletonLine className="w-1/3 h-5" />
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-2/3" />
    </div>
  );
}

export function FullPageLoading() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="text-center">
        <Spinner size="lg" />
        <p className="mt-3 text-sm text-muted">Loading…</p>
      </div>
    </div>
  );
}
