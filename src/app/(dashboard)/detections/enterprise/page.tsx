"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldAlert, Search, Loader2, Inbox, ChevronRight, Upload, User, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ValidationBadge, { type ValidationVerdict } from "@/components/enterprise-use-cases/ValidationBadge";
import SiemCompatMatrix from "@/components/enterprise-use-cases/SiemCompatMatrix";
import PlatformChipStrip from "@/components/enterprise-use-cases/PlatformChipStrip";

interface UcRow {
  id: string;
  name: string;
  description: string;
  severity: string;
  platforms: string[];
  mitreTechniques: string[];
  owner: string;
  format: string;
  selectedLogic: string;
  status: string;
  validationStatus: ValidationVerdict;
  siemCompatibility: Record<string, string>;
  sourceFilename: string | null;
  scenarioCount: number;
  runCount: number;
  commentCount: number;
  createdAt: string;
}

interface Stats {
  totalUseCases: number;
  byStatus: { name: string; count: number }[];
  byValidation: { name: string; count: number }[];
  topOwners: { name: string; count: number }[];
  byPlatformBucket: { name: string; count: number }[];
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-danger/15 text-danger",
  high:     "bg-warning/15 text-warning",
  medium:   "bg-info/15 text-info",
  low:      "bg-success/15 text-success",
  info:     "bg-muted/15 text-muted-foreground",
};

const STATUS_FILTERS = ["", "imported", "mapped", "scenarios-defined", "validated", "promoted"] as const;
const VALIDATION_FILTERS = ["", "green", "yellow", "red", "pending"] as const;

export default function EnterpriseUseCasesPage() {
  const [rows, setRows] = useState<UcRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [validationStatus, setValidationStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [platformBucket, setPlatformBucket] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (validationStatus) params.set("validationStatus", validationStatus);
    if (owner) params.set("owner", owner);
    if (platformBucket) params.set("platformBucket", platformBucket);
    fetch(`/api/enterprise-use-cases?${params}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.items || []); if (d.stats) setStats(d.stats); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [q, status, validationStatus, owner, platformBucket]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-accent" />
            Enterprise Use Cases
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Org-uploaded custom detection use cases. Lifecycle: upload → validate → map → simulate → measure coverage → promote.
          </p>
        </div>
        <Link
          href="/detections/enterprise/upload"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-xs font-medium bg-accent text-white hover:bg-[#60a5fa]"
        >
          <Upload className="h-3.5 w-3.5" /> Upload use cases
        </Link>
      </div>

      {stats?.byPlatformBucket && (
        <PlatformChipStrip
          buckets={stats.byPlatformBucket}
          selected={platformBucket}
          onChange={setPlatformBucket}
        />
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <StatCell label="Total" value={String(stats.totalUseCases)} />
          <StatCell label="By status" value={stats.byStatus.map((s) => `${s.name}:${s.count}`).join(" · ") || "—"} />
          <StatCell label="By validation" value={stats.byValidation.map((s) => `${s.name}:${s.count}`).join(" · ") || "—"} />
          <StatCell label="Top owners" value={stats.topOwners.slice(0, 3).map((s) => `${s.name}:${s.count}`).join(" · ") || "—"} />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, description, owner, filename…"
            className="w-full pl-7 pr-3 py-1.5 text-xs rounded-md border border-border bg-input text-foreground focus:outline-none focus:border-accent"
          />
        </div>
        <Pill label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS as any} />
        <Pill label="Validation" value={validationStatus} onChange={setValidationStatus} options={VALIDATION_FILTERS as any} />
        {stats?.topOwners && stats.topOwners.length > 0 && (
          <Pill label="Owner" value={owner} onChange={setOwner} options={["", ...stats.topOwners.map((o) => o.name)] as any} />
        )}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No use cases yet. <Link href="/detections/enterprise/upload" className="text-accent hover:underline">Upload</Link> a spreadsheet, Markdown runbook, or rule file to get started.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <Link key={r.id} href={`/detections/enterprise/${r.id}`} className="block px-4 py-3 hover:bg-card-hover transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ValidationBadge status={r.validationStatus} />
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase", SEVERITY_COLORS[r.severity] || SEVERITY_COLORS.info)}>
                        {r.severity}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] uppercase bg-muted/15 text-muted-foreground">{r.status}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-accent/10 text-accent">{r.format || "?"}</span>
                      <SiemCompatMatrix matrix={r.siemCompatibility} format={r.format} compact />
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-foreground truncate">{r.name || "Untitled"}</h3>
                    {r.description && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{r.description}</p>}
                    <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                      {r.owner && <span className="inline-flex items-center gap-0.5"><User className="h-2.5 w-2.5" />{r.owner}</span>}
                      {r.sourceFilename && <span className="inline-flex items-center gap-0.5"><FileText className="h-2.5 w-2.5" />{r.sourceFilename}</span>}
                      <span>{r.scenarioCount} scenario{r.scenarioCount !== 1 ? "s" : ""}</span>
                      <span>{r.runCount} run{r.runCount !== 1 ? "s" : ""}</span>
                      {r.mitreTechniques.length > 0 && (
                        <span className="font-mono">{r.mitreTechniques.slice(0, 3).join(", ")}{r.mitreTechniques.length > 3 ? ` +${r.mitreTechniques.length - 3}` : ""}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="mt-0.5 text-xs text-foreground truncate" title={value}>{value}</div>
    </div>
  );
}

function Pill({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs rounded-md border border-border bg-input text-foreground px-2 py-1.5 focus:outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o || "_all"} value={o}>{o ? o : `All ${label}`}</option>
      ))}
    </select>
  );
}
