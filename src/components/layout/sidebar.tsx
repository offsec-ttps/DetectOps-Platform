"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Shield,
  FileCode2,
  Library,
  GitBranch,
  Workflow,
  BarChart3,
  Bot,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  Bell,
  Crosshair,
  Database,
  BookOpen,
  ShieldCheck,
  Gauge,
  Radar,
  Sparkles,
  Code2,
  Server,
  Atom,
  Swords,
  ScrollText,
  GitPullRequest,
  RefreshCw,
  Orbit,
  Blocks,
  Plug,
  FlaskRound,
  Hammer,
  Layers,
  ShieldAlert,
  Rocket,
  Skull,
  Trash2,
  LogOut,
  User,
  ChevronDown,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

const navSections: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: "Overview", href: "/overview", icon: LayoutDashboard },
    ],
  },
  {
    title: "Engineering",
    items: [
      { label: "Threat Modeling", href: "/threat-modeling", icon: Crosshair },
      { label: "Threat Intel Ingestion", href: "/threat-intel", icon: Radar },
      { label: "SigmaGen AI", href: "/sigmagen", icon: Sparkles },
      { label: "Rule Workspace", href: "/rule-workspace", icon: Code2 },
      { label: "Atomic Test Library", href: "/atomic-tests", icon: Atom },
      { label: "Community Content", href: "/community", icon: Library },
    ],
  },
  {
    title: "Preparation",
    items: [
      { label: "Deploy", href: "/deploy", icon: Rocket, badge: "New" },
      { label: "Attack Simulations", href: "/simulations", icon: Skull, badge: "New" },
      { label: "Module Marketplace", href: "/marketplace", icon: Blocks },
      { label: "Detection Lab (advanced)", href: "/detection-lab", icon: FlaskRound },
    ],
  },
  {
    title: "Simulation",
    items: [
      { label: "Campaign Designer", href: "/campaign-designer", icon: Swords },
      { label: "Enterprise Environments", href: "/detections/enterprise/environments", icon: Server },
      { label: "Enterprise Use Cases", href: "/detections/enterprise", icon: ShieldAlert, badge: "New" },
      { label: "Custom Simulation Builder", href: "/use-cases", icon: Layers, badge: "New" },
      { label: "Replay Catalog", href: "/replay-catalog", icon: Database, badge: "New" },
      { label: "Build Forge", href: "/build-forge", icon: Hammer, badge: "New" },
      { label: "Execution Logs", href: "/execution-logs", icon: ScrollText },
    ],
  },
  {
    title: "Detection",
    items: [
      { label: "Detections", href: "/detections", icon: FileCode2, badge: "12" },
      { label: "Detection Packs", href: "/detections/packs", icon: ShieldAlert, badge: "New" },
      { label: "Detection Validation", href: "/detection-validation", icon: ShieldCheck },
    ],
  },
  {
    title: "GitHub Operations",
    items: [
      { label: "PR Management", href: "/pr-management", icon: GitPullRequest },
      { label: "Agentic Sync", href: "/agentic-sync", icon: RefreshCw },
      { label: "CI/CD", href: "/cicd", icon: GitBranch },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      { label: "Pipelines", href: "/pipelines", icon: Workflow },
      { label: "Data Lakes", href: "/data-lakes", icon: Database },
      { label: "OpenTide Orchestrator", href: "/orchestrator", icon: Orbit },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { label: "Reporting", href: "/reporting", icon: BarChart3 },
      { label: "Agents", href: "/agents", icon: Bot, badge: "2" },
      { label: "Analytics", href: "/analytics", icon: Gauge },
    ],
  },
  {
    title: "System",
    items: [
      { label: "MCP Registry", href: "/mcp-registry", icon: Blocks },
      { label: "Integrations", href: "/integrations", icon: Plug },
      { label: "Documentation", href: "/docs", icon: BookOpen },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "LLM Providers", href: "/settings/llm-providers", icon: Sparkles },
      { label: "MCP Servers", href: "/settings/mcp-servers", icon: Plug },
    ],
  },
  {
    title: "Manage Labs",
    items: [
      { label: "Manage Labs", href: "/manage-labs", icon: Trash2 },
    ],
  },
];

// lucide icon names a module manifest may reference for its nav contribution.
const MODULE_ICONS: Record<string, React.ElementType> = {
  Blocks, ShieldAlert, Server, Layers, Swords, Database, Radar, FlaskRound, Rocket, Crosshair, Bot, ShieldCheck, Skull,
};

interface ModuleNavItem { moduleId: string; label: string; href: string; icon?: string; badge?: string }

/**
 * The collapsed flag is owned by DashboardShell because the main column's left
 * margin has to match this width. While it lived here as local state, collapsing
 * shrank the rail to w-16 but the content kept `ml-60`, leaving a ~176px dead
 * gap and squeezing the content area for no reason.
 */
export function Sidebar({
  collapsed: collapsedProp,
  onToggleCollapsed,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
} = {}) {
  const pathname = usePathname();
  // Fall back to local state if rendered without the shell's props.
  const [collapsedLocal, setCollapsedLocal] = useState(false);
  const collapsed = collapsedProp ?? collapsedLocal;
  const setCollapsed = onToggleCollapsed
    ? () => onToggleCollapsed()
    : () => setCollapsedLocal((v) => !v);
  const [moduleNav, setModuleNav] = useState<ModuleNavItem[]>([]);

  // Registry-aware: live modules contribute nav entries (kept separate from the
  // static sections, mirroring how community-sources keeps legacy adapters on).
  // Module nav is global and route-independent — fetch once on mount, not on
  // every navigation. (pathname is still used below for active-link styling.)
  useEffect(() => {
    fetch("/api/modules/nav").then((r) => r.json()).then((d) => setModuleNav(d.items || [])).catch(() => {});
  }, []);

  const allSections = [
    ...navSections,
    ...(moduleNav.length
      ? [{ title: "Simulation Modules", items: moduleNav.map((m) => ({ label: m.label, href: m.href, icon: MODULE_ICONS[m.icon || ""] || Blocks, badge: m.badge })) as NavItem[] }]
      : []),
  ];

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-border bg-sidebar transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <Shield className="h-7 w-7 shrink-0 text-accent" />
        {!collapsed && (
          <span className="ml-2.5 text-lg font-bold tracking-tight text-foreground">
            Detect<span className="text-accent">Ops</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {allSections.map((section, si) => (
          <div key={si} className={cn(si > 0 && "mt-4")}>
            {section.title && !collapsed && (
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
                {section.title}
              </p>
            )}
            {section.title && collapsed && (
              <div className="mx-auto my-2 h-px w-8 bg-border" />
            )}
            {section.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/overview" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-active text-accent"
                      : "text-muted-foreground hover:bg-sidebar-hover hover:text-foreground",
                    collapsed && "justify-center px-2"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      isActive ? "text-accent" : "text-muted group-hover:text-foreground"
                    )}
                  />
                  {!collapsed && (
                    <>
                      <span className="ml-3 truncate">{item.label}</span>
                      {item.badge && (
                        <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setCollapsed()}
          className="flex w-full items-center justify-center rounded-lg p-2 text-muted hover:bg-sidebar-hover hover:text-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>
    </aside>
  );
}

interface SessionUser { id: string; email: string; name?: string | null; role?: string | null; emailVerified?: boolean }

function initialsOf(name?: string | null, email?: string): string {
  const src = (name || "").trim();
  if (src) {
    const parts = src.split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || src.slice(0, 2).toUpperCase();
  }
  return (email || "DE").slice(0, 2).toUpperCase();
}

function roleLabel(role?: string | null): string {
  if (!role) return "Detection Engineer";
  return role.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TopBar() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .catch(() => setUser(null));
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      const r = await fetch("/api/auth/logout", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      window.location.href = d?.redirect || "/login";
    } catch {
      window.location.href = "/login";
    }
  };

  const displayName = user?.name || "Detection Engineer";
  const initials = initialsOf(user?.name, user?.email);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search detections, techniques, tests…"
            className="h-9 w-80 rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted">
            ⌘K
          </kbd>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="relative rounded-lg p-2 text-muted hover:bg-card hover:text-foreground transition-colors" aria-label="Notifications">
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />
        </button>

        {/* Account menu */}
        <div className="relative ml-2" ref={menuRef}>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors",
              open ? "border-accent/40 bg-card" : "border-border hover:bg-card",
            )}
          >
            <div className="h-7 w-7 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold text-accent">
              {initials}
            </div>
            <div className="text-sm text-left hidden sm:block">
              <p className="font-medium text-foreground leading-tight">{displayName}</p>
              <p className="text-[10px] text-muted leading-tight">{roleLabel(user?.role)}</p>
            </div>
            <ChevronDown className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")} />
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
            >
              {/* Profile header */}
              <div className="flex items-center gap-3 border-b border-border p-4">
                <div className="h-10 w-10 rounded-full bg-accent/20 flex items-center justify-center text-sm font-bold text-accent">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
                  <p className="text-[11px] text-muted truncate">{user?.email || "not signed in"}</p>
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                    {roleLabel(user?.role)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="py-1.5">
                <Link href="/settings" onClick={() => setOpen(false)} role="menuitem"
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-foreground hover:bg-card-hover">
                  <User className="h-4 w-4 text-muted" /> Profile
                </Link>
                <Link href="/settings" onClick={() => setOpen(false)} role="menuitem"
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-foreground hover:bg-card-hover">
                  <Settings className="h-4 w-4 text-muted" /> Settings
                </Link>
                <Link href="/settings/llm-providers" onClick={() => setOpen(false)} role="menuitem"
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-foreground hover:bg-card-hover">
                  <Sparkles className="h-4 w-4 text-muted" /> LLM Providers
                </Link>
                <Link href="/docs" onClick={() => setOpen(false)} role="menuitem"
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-foreground hover:bg-card-hover">
                  <BookOpen className="h-4 w-4 text-muted" /> Documentation
                </Link>
              </div>

              <div className="border-t border-border py-1.5">
                <button onClick={signOut} disabled={signingOut} role="menuitem"
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-danger hover:bg-danger/10 disabled:opacity-50">
                  <LogOut className="h-4 w-4" /> {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
