"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Settings,
  Users,
  Shield,
  Bell,
  Globe,
  Database,
  GitBranch,
  Bot,
  ChevronRight,
} from "lucide-react";

const settingsSections = [
  {
    id: "general",
    label: "General",
    icon: Settings,
    description: "Organization name, timezone, and defaults",
  },
  {
    id: "users",
    label: "Users & Roles",
    icon: Users,
    description: "Manage team members and role-based access",
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    description: "Authentication, SSO, and API keys",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    description: "Email, Slack, and webhook notifications",
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: Globe,
    description: "SIEM, EDR, and pipeline connections",
  },
  {
    id: "agents",
    label: "Agent Configuration",
    icon: Bot,
    description: "AI agent settings and approval policies",
  },
  {
    id: "repository",
    label: "Repository",
    icon: GitBranch,
    description: "Git repository and CI/CD settings",
  },
  {
    id: "data",
    label: "Data & Storage",
    icon: Database,
    description: "Data retention, backup, and export",
  },
];

const roleColors: Record<string, string> = {
  "Detection Engineer": "text-accent bg-accent/15",
  "Threat Hunter": "text-purple bg-purple/15",
  "CTI Analyst": "text-warning bg-warning/15",
  "SOC Analyst": "text-info bg-info/15",
  "Engineering Lead": "text-success bg-success/15",
  "Platform Engineer": "text-muted-foreground bg-muted/15",
};

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("users");

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings & Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage organization settings, users, integrations, and platform configuration
        </p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Settings navigation */}
        <div className="col-span-3 space-y-1">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                activeSection === section.id
                  ? "bg-accent/10 text-accent"
                  : "text-muted-foreground hover:bg-card hover:text-foreground"
              )}
            >
              <section.icon className="h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{section.label}</p>
              </div>
              <ChevronRight className={cn("h-4 w-4 shrink-0", activeSection === section.id ? "text-accent" : "text-muted")} />
            </button>
          ))}
        </div>

        {/* Settings content */}
        <div className="col-span-9">
          {activeSection === "users" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Users & Roles</h2>
                  <p className="text-sm text-muted">0 team members</p>
                </div>
                <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors">
                  Invite User
                </button>
              </div>

              {/* Roles overview */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { role: "Detection Engineer", permissions: "Full rule CRUD, test execution, deployment" },
                  { role: "Threat Hunter", permissions: "Rule authoring, emulation, LOCK docs" },
                  { role: "CTI Analyst", permissions: "Threat modeling, community content, intel" },
                  { role: "SOC Analyst", permissions: "View rules, view reports, acknowledge alerts" },
                  { role: "Engineering Lead", permissions: "All permissions, approval authority, metrics" },
                  { role: "Platform Engineer", permissions: "Infrastructure, pipelines, integrations" },
                ].map((r) => (
                  <div key={r.role} className="rounded-lg border border-border bg-card p-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", roleColors[r.role])}>
                      {r.role}
                    </span>
                    <p className="mt-1.5 text-[10px] text-muted">{r.permissions}</p>
                  </div>
                ))}
              </div>

              {/* Empty users state */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12">
                <Users className="h-10 w-10 text-muted mb-3" />
                <p className="text-sm text-muted-foreground text-center max-w-md">
                  No users configured. Invite team members to collaborate.
                </p>
              </div>
            </div>
          )}

          {activeSection === "general" && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold text-foreground">General Settings</h2>
              <div className="space-y-4">
                {[
                  { label: "Organization Name", value: "Acme Corp Security", type: "text" },
                  { label: "Timezone", value: "America/New_York (UTC-5)", type: "select" },
                  { label: "Default Rule Severity", value: "medium", type: "select" },
                  { label: "Detection Staleness Threshold", value: "90 days", type: "select" },
                  { label: "Max False Positive Rate", value: "50 per week", type: "text" },
                ].map((setting) => (
                  <div key={setting.label} className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{setting.label}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-input px-3 py-1.5 text-sm text-muted-foreground min-w-[200px] text-right">
                      {setting.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection !== "users" && activeSection !== "general" && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
              <Settings className="h-12 w-12 text-muted mb-4" />
              <h3 className="text-lg font-medium text-foreground">
                {settingsSections.find((s) => s.id === activeSection)?.label}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {settingsSections.find((s) => s.id === activeSection)?.description}
              </p>
              <p className="mt-4 text-xs text-muted">Configuration panel coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
