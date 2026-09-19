"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Sidebar, TopBar } from "./sidebar";

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  // Owned here so the content column's left margin always matches the rail's
  // actual width — see the note in Sidebar.
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    // `min-w-0` is load-bearing: a flex item defaults to `min-width: auto`, so
    // this column refuses to shrink below the intrinsic width of its widest
    // descendant. One long unbroken string — an SPL query, a wide table — then
    // stretches the column past the viewport, and because the sidebar is fixed
    // (offset by ml-60) the page gains a horizontal scrollbar and the content
    // slides off to the right. With min-w-0 the column tracks the viewport and
    // wide children scroll inside their own containers instead.
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-all duration-200",
          collapsed ? "ml-16" : "ml-60",
        )}
      >
        <TopBar />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
