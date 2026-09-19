import React from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "flat";
  className?: string;
}

export function MetricCard({ title, value, change, changeLabel, icon, trend, className }: MetricCardProps) {
  const trendColor = trend === "up" ? "text-success" : trend === "down" ? "text-success" : "text-muted";
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="flex items-center justify-between">
        <div className="text-muted">{icon}</div>
        {change !== undefined && (
          <span className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
            <TrendIcon className="h-3 w-3" />
            {Math.abs(change)}%
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted">{changeLabel ?? title}</p>
    </div>
  );
}
