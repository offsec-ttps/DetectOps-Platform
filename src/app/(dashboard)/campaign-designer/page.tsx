"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { NavigationGuardModal, type NavGuardHandle } from "@/components/campaign-designer/NavigationGuard";
import EnvironmentAccessPanel from "@/components/campaign-designer/EnvironmentAccessPanel";
import SiemConnectModal from "@/components/siem/SiemConnectModal";
import AtomicPreview from "@/components/campaign-designer/AtomicPreview";
import {
  Plus, Play, ArrowRight, Copy,
  Clock, CheckCircle2, XCircle, Loader2,
  GitBranch, ChevronDown, ChevronRight, Zap,
  Server, Power, PowerOff, MonitorCheck, Terminal, RefreshCw,
  AlertTriangle, FolderOpen, Network, ChevronLeft, Hash,
  Layers, ArrowDown, ExternalLink, Eye, EyeOff, X,
  Shield, Search, ShieldCheck, ShieldAlert, Activity, Flame, Download, FileCode2,
  Globe, Cpu, Radio,
} from "lucide-react";

// ── Types ──

interface SARStatus {
  connected: boolean;
  probeTimeMs: number;
  installPath: string;
  config: {
    splunk: { ip: string; adminPassword: string; version: string };
    windows: { dcIp: string; username: string; password: string };
    simulation: { defaultTechnique: string };
    caldera: { password: string; ip: string };
    enabledMachines: Record<string, boolean>;
  };
  virtualMachines: { name: string; state: string; provider: string }[];
  network: {
    splunkServer: { ip: string; pingReachable: boolean };
    windowsDC: { ip: string; pingReachable: boolean };
  };
  splunk: { reachable: boolean; version?: string };
  recentLogs: string[];
}

// ── Deployed lab types (from /api/detection-lab/system-info + templates) ──

interface InstalledEnv {
  id: string; name: string; templateName?: string; templateId?: string;
  type: string; status: string; path: string; vms: string[]; fleetLab?: boolean;
  networkBase?: string; splunkIp?: string;
}

interface SystemInfo {
  allVMs: { name: string; state: string }[];
  installedEnvironments: InstalledEnv[];
}

interface TemplateVM {
  name: string; role: string; os: string; ip?: string;
  cpus: number; memoryMB: number; diskGB: number; services: string[];
}

interface LabTemplate {
  id: string; name: string; labType: string; vms: TemplateVM[];
}

/**
 * A single selectable server in the Campaign Designer's target list.
 * Can come from SAR directly OR from a deployed lab (with prefixed name).
 */
interface LabTarget {
  deployedName: string;     // the actual VBox name to target (prefixed for managed deployments)
  displayName: string;      // human-readable short name
  originalName: string;     // template VM name (e.g. "DC01")
  ip: string;
  role: string;
  os: string;
  services: string[];
  state: string;            // "running" | "poweroff" | ...
  source: "sar" | "deployed-lab" | "cloud" | "fleet" | "c2";
  labName?: string;         // "SAR + GOAD Minimal" for deployed labs; template name for cloud; fleet name for fleet
  labPath?: string;
  /** C2 servers only — C2Server id for run-technique dispatch */
  c2Id?: string;
  /** Deployed lab that belongs under Fleet Simulation (deployed from there) */
  fleetLab?: boolean;
  /** Cloud ranges only — attack_range_id for the live SAR build */
  rangeId?: string;
  /** Cloud ranges only — credentials for SSH/RDP to the target */
  credentials?: { username: string; password: string };
  /** Fleet nodes only — fleet + node ids for run-test dispatch */
  fleetId?: string;
  nodeId?: string;
  /** Fleet nodes only — reported host facts (privilege, user, cpu…) + liveness */
  hostStatus?: Record<string, unknown>;
  liveness?: string;
}

interface StartOpStatus {
  action: string;
  status: "running" | "completed" | "failed" | "idle";
  logs: string[];
  startedAt?: string;
  completedAt?: string | null;
  message?: string;
}

interface AtomicTestOption {
  id: string;
  techniqueId: string;
  techniqueName: string;
  testName: string;
  testNumber: number;
  tactic: string;
  platforms: string[];
  executorName: string;
  elevationRequired: boolean;
  command: string;
}

interface SimulationRecord {
  id: string;
  techniqueIds: string[];
  targetServer: string;
  targetIp: string;
  source?: string;                                 // local | cloud | fleet | c2
  executor: string;
  parameters: Record<string, string>;
  status: string;
  logs: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  // Full detection-validation chain (added 2026-05). May be empty for legacy rows.
  executionMode?: string;                          // "simulation" | "simulation_detection"
  selectedDetections?: SplunkDetectionOption[];
  detectionResults?: DetectionResult[];
  splunkUrl?: string;
  maxRetries?: number;
  validationCompletedAt?: string | null;
}

interface SplunkDetectionOption {
  id: string;
  detectionId: string;
  name: string;
  type: string;
  status: string;
  mitreTechniques: string[];
  mitreTactics: string[];
  category: string;
  securityDomain: string;
  search: string;
}

interface DetectionResult {
  detectionId: string;
  detectionName: string;
  status: "pending" | "searching" | "detected" | "not_detected" | "error";
  matchCount: number;
  searchQuery: string;
  editedQuery?: string;
  message: string;
  timestamp?: string;
  attempt: number;
  strategies?: { strategy: string; found: boolean; resultCount: number; details: string; results?: Record<string, string>[] }[];
  diagnostics?: string[];
  sampleResults?: Record<string, string>[];
  savedToLibrary?: boolean;
  markedVerified?: boolean;
}

// SAR CLI flags reference
const SAR_FLAGS = ["build", "destroy", "simulate", "stop", "resume", "dump"] as const;

// Privilege-requirement badge for a technique / atomic test.
function ElevationBadge({ admin }: { admin?: boolean }) {
  if (admin === undefined) return null;
  return admin ? (
    <span title="Requires Admin / SYSTEM elevation to run" className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold border border-warning/40 bg-warning/10 text-warning">
      <ShieldAlert className="h-2.5 w-2.5" /> Admin
    </span>
  ) : (
    <span title="Runs at normal user privilege" className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold border border-success/40 bg-success/10 text-success">
      <ShieldCheck className="h-2.5 w-2.5" /> User
    </span>
  );
}

// ── Main Component ──

export default function CampaignDesignerPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"simulate" | "campaigns" | "history">("simulate");

  // SAR environment state
  const [sar, setSar] = useState<SARStatus | null>(null);
  const [sarLoading, setSarLoading] = useState(true);
  const [sarError, setSarError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startOp, setStartOp] = useState<StartOpStatus | null>(null);
  const [showStartLogs, setShowStartLogs] = useState(false);

  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedServer, setSelectedServer] = useState("");
  const [techniqueMode, setTechniqueMode] = useState<"single" | "pair" | "batch">("single");
  const [techniqueInput, setTechniqueInput] = useState("");
  const [techniqueList, setTechniqueList] = useState<string[]>([]);
  // Per-technique selected atomic test number (default 1). Lets the user preview/
  // edit/save-as a custom atomic and choose which test runs (honored on fleet).
  const [techniqueTests, setTechniqueTests] = useState<Record<string, number>>({});
  const [techniqueSearchResults, setTechniqueSearchResults] = useState<AtomicTestOption[]>([]);
  // Per-technique privilege requirement of the atomic that will run (test #1),
  // so the user can tell which techniques need Admin/SYSTEM before launching.
  const [techElevation, setTechElevation] = useState<Record<string, { admin: boolean; testName?: string }>>({});
  const [searching, setSearching] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState(false);

  // Execution mode state
  const [executionMode, setExecutionMode] = useState<"simulation" | "simulation_detection">("simulation");
  const [selectedDetections, setSelectedDetections] = useState<SplunkDetectionOption[]>([]);
  const [detectionSearch, setDetectionSearch] = useState("");
  const [detectionSearchResults, setDetectionSearchResults] = useState<SplunkDetectionOption[]>([]);
  const [searchingDetections, setSearchingDetections] = useState(false);
  const [detectionResults, setDetectionResults] = useState<DetectionResult[]>([]);
  const [validatingDetections, setValidatingDetections] = useState(false);
  const [splunkUrl, setSplunkUrl] = useState("");
  const [splunkToken, setSplunkToken] = useState("");
  // Per-environment SIEM connection resolved for the selected target (Splunk or MDE).
  const [siemConn, setSiemConn] = useState<{ id: string; name: string; kind: string; status?: string } | null>(null);
  const [siemLang, setSiemLang] = useState<"spl" | "kql">("spl");
  const [siemResolved, setSiemResolved] = useState(false);
  const [siemModalOpen, setSiemModalOpen] = useState(false);
  const [autoMapDetections, setAutoMapDetections] = useState(true);
  const [expandedDetectionId, setExpandedDetectionId] = useState<string | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Cancellation for the detection chain: when the user stops polling we set the
  // flag (so in-flight loops bail out) and abort any in-flight detection fetch.
  const detectionCancelRef = useRef(false);
  const detectionAbortRef = useRef<AbortController | null>(null);
  // The SimulationRun DB id of the CURRENT run — the row detection results are
  // persisted onto. SAR sets it from /api/sar/simulate; fleet/cloud/c2 set it
  // from the recordHistory row they create. So detection lands on the right row
  // for every environment (fixes "detection missing in History" for fleet/cloud).
  const runIdRef = useRef<string>("");
  const guardRef = useRef<NavGuardHandle>(null);
  // When restoring a run from History we set what to auto-run once state is applied.
  const [pendingResume, setPendingResume] = useState<null | "detect" | "full">(null);
  const [retryActive, setRetryActive] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [saveDialogIdx, setSaveDialogIdx] = useState<number | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadSpl, setUploadSpl] = useState("");
  const [uploadTechnique, setUploadTechnique] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customDetName, setCustomDetName] = useState("");
  const [customDetSpl, setCustomDetSpl] = useState("");
  const [customDetTechnique, setCustomDetTechnique] = useState("");
  // Search detection queries from collections (Community Content, Detection Packs…) by technique
  const [collTech, setCollTech] = useState("");
  const [collSources, setCollSources] = useState<{ community: boolean; packs: boolean; splunk: boolean }>({ community: true, packs: true, splunk: false });
  const [collResults, setCollResults] = useState<SplunkDetectionOption[]>([]);
  const [collSearching, setCollSearching] = useState(false);
  const [collSearched, setCollSearched] = useState(false);
  const [detailTab, setDetailTab] = useState<Record<string, "spl" | "output">>({}); // per-detection tab

  // Report & GitHub push state
  const [showReportPush, setShowReportPush] = useState(false);
  const [reportGhOwner, setReportGhOwner] = useState("");
  const [reportGhRepo, setReportGhRepo] = useState("detection-reports");
  const [gitConfigured, setGitConfigured] = useState(false);
  const [reportPushing, setReportPushing] = useState(false);
  const [reportResult, setReportResult] = useState<{ success: boolean; message: string; reportUrl?: string; issueUrl?: string; localId?: string; localPath?: string } | null>(null);

  // Simulation execution state
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{
    id: string; status: string; logs: string; techniques: string[]; durationMs?: number;
  } | null>(null);

  // History state
  const [history, setHistory] = useState<SimulationRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Deployed lab state (from /api/detection-lab/system-info + /api/detection-lab/templates)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [labTemplates, setLabTemplates] = useState<LabTemplate[]>([]);
  const [cloudRanges, setCloudRanges] = useState<Array<{
    attack_range_id?: string | null;
    attack_range_name?: string | null;
    template_name?: string | null;
    status: string;
    result?: {
      architecture?: Array<{ name: string; os_type?: string | null; instance_type?: string | null; ip_last_octet?: number | null; roles?: string[] | null }> | null;
      guacamole_info?: { host_ip?: string; servers?: Array<{ name: string; hostname: string; port: number; protocol: string; username: string; password: string }> | null } | null;
    } | null;
  }>>([]);

  // Remote-fleet nodes usable as simulation targets (online endpoints).
  const [fleetTargets, setFleetTargets] = useState<LabTarget[]>([]);
  const [c2Targets, setC2Targets] = useState<LabTarget[]>([]);

  // ── Fetch SAR status + deployed labs + cloud ranges in parallel ──
  const fetchSar = useCallback(async () => {
    setSarLoading(true);
    setSarError(null);
    try {
      const [sarRes, sysRes, tplRes, cloudRes] = await Promise.all([
        fetch("/api/sar/status"),
        fetch("/api/detection-lab/system-info"),
        fetch("/api/detection-lab/templates"),
        fetch("/api/detection-lab/cloud/attack-range/list").catch(() => null),
      ]);
      if (!sarRes.ok) throw new Error(`Status check failed: ${sarRes.status}`);
      setSar(await sarRes.json());
      if (sysRes.ok) setSystemInfo(await sysRes.json());
      if (tplRes.ok) { const d = await tplRes.json(); setLabTemplates(d.templates || []); }
      if (cloudRes && cloudRes.ok) {
        const d = await cloudRes.json();
        setCloudRanges(d.attack_ranges || []);
      } else {
        setCloudRanges([]); // SAR controller not deployed — cloud ranges just absent
      }
    } catch (err) {
      setSarError(err instanceof Error ? err.message : "Failed to probe SAR");
    } finally {
      setSarLoading(false);
    }
  }, []);

  // ── Fetch fleets + their nodes → selectable fleet targets ──
  const fetchFleets = useCallback(async () => {
    try {
      const r = await fetch("/api/fleets");
      if (!r.ok) { setFleetTargets([]); return; }
      const { items } = await r.json();
      const all: LabTarget[] = [];
      for (const f of (items || [])) {
        try {
          const dr = await fetch(`/api/fleets/${f.id}`);
          if (!dr.ok) continue;
          const detail = await dr.json();
          for (const n of (detail.nodes || [])) {
            if (n.status === "revoked") continue;   // stopped agent — not a live target
            // "online" or "stale" (heartbeat within the last minute) = a live,
            // selectable target; only a truly offline node is greyed out.
            const live = n.liveness === "online" || n.liveness === "stale";
            all.push({
              deployedName: `fleet:${f.id}:${n.id}`,
              displayName: n.hostname || n.name || n.id.slice(0, 8),
              originalName: n.hostname || n.id,
              ip: "",
              role: `Fleet endpoint${n.os ? ` (${n.os})` : ""}`,
              os: n.os || "",
              services: [],
              state: live ? "running" : "poweroff",   // "running" so it shows as a live target
              source: "fleet",
              labName: f.name,
              fleetId: f.id,
              nodeId: n.id,
              hostStatus: n.hostStatus || {},
              liveness: n.liveness,
            });
          }
        } catch { /* skip this fleet */ }
      }
      setFleetTargets(all);
    } catch { setFleetTargets([]); }
  }, []);

  // ── Fetch C2 servers → selectable targets (online/running Caldera etc.) ──
  const fetchC2 = useCallback(async () => {
    try {
      const r = await fetch("/api/c2");
      if (!r.ok) { setC2Targets([]); return; }
      const { items } = await r.json();
      const live = (items || []).filter((s: any) => s.status === "online" || s.status === "running");
      setC2Targets(live.map((s: any): LabTarget => ({
        deployedName: `c2:${s.id}`,
        displayName: s.name,
        originalName: s.name,
        ip: "",
        role: `${s.provider} C2${s.mode === "managed" ? " (local)" : ""}`,
        os: s.agentPlatform || "",
        services: [],
        state: "running",
        source: "c2",
        labName: s.name,
        c2Id: s.id,
      })));
    } catch { setC2Targets([]); }
  }, []);

  // Refresh SAR/local environments, the remote fleet, and C2 servers together, so a
  // freshly-online fleet node / C2 beacon appears without a full page reload.
  const refreshEnvironments = useCallback(() => { fetchSar(); fetchFleets(); fetchC2(); }, [fetchSar, fetchFleets, fetchC2]);

  useEffect(() => { fetchSar(); fetchFleets(); fetchC2(); }, [fetchSar, fetchFleets, fetchC2]);

  // Poll fleet liveness periodically so a node coming online is picked up
  // automatically (the agent heartbeats every ~5s).
  useEffect(() => {
    const iv = setInterval(() => { fetchFleets(); fetchC2(); }, 15000);
    return () => clearInterval(iv);
  }, [fetchFleets, fetchC2]);

  // Cleanup retry timers on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  // ── Start SAR ──
  const startSar = async (action: "resume" | "stop") => {
    setStarting(true);
    setStartOp(null);
    try {
      const res = await fetch("/api/sar/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setShowStartLogs(true);
        // Poll for progress
        const poll = setInterval(async () => {
          try {
            const statusRes = await fetch("/api/sar/start");
            const data: StartOpStatus = await statusRes.json();
            setStartOp(data);
            if (data.status === "completed" || data.status === "failed") {
              clearInterval(poll);
              setStarting(false);
              // Refresh SAR status
              setTimeout(() => fetchSar(), 2000);
            }
          } catch { /* continue polling */ }
        }, 3000);
      } else {
        const data = await res.json();
        setSarError(data.error || "Failed to start SAR");
        setStarting(false);
      }
    } catch (err) {
      setSarError(err instanceof Error ? err.message : "Start request failed");
      setStarting(false);
    }
  };

  // ── Search techniques ──
  const searchTechniques = async (query: string) => {
    if (!query || query.length < 2) {
      setTechniqueSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/atomic-tests?search=${encodeURIComponent(query)}&page_size=10`);
      if (res.ok) {
        const data = await res.json();
        setTechniqueSearchResults(data.items);
      }
    } catch { /* ignore */ }
    finally { setSearching(false); }
  };

  // ── Add technique ──
  const addTechnique = (id: string) => {
    const cleaned = id.trim().toUpperCase();
    if (!cleaned) return;
    if (techniqueMode === "single") {
      setTechniqueList([cleaned]);
    } else if (techniqueMode === "pair" && techniqueList.length < 2) {
      if (!techniqueList.includes(cleaned)) setTechniqueList([...techniqueList, cleaned]);
    } else if (techniqueMode === "batch") {
      if (!techniqueList.includes(cleaned)) setTechniqueList([...techniqueList, cleaned]);
    }
    setTechniqueInput("");
    setTechniqueSearchResults([]);
  };

  const removeTechnique = (id: string) => {
    setTechniqueList(techniqueList.filter((t) => t !== id));
  };

  /**
   * Dispatch a simulation to a cloud lab host via SAR's own
   * POST /attack-range/simulate endpoint. SAR inspects the target server's OS
   * (from the range config), picks the right transport (WinRM for Windows,
   * SSH for Linux), installs Atomic Red Team if missing, runs the technique,
   * and returns execution_output in one synchronous call.
   *
   * Earlier versions of this handler tried to SSH into Windows hosts as
   * `ubuntu@…:22` which times out — the fundamental issue is that Windows
   * hosts are WinRM targets, not SSH targets. Letting SAR handle transport
   * selection is the correct boundary.
   */
  // Record a client-orchestrated run (fleet/cloud/c2) into Simulation History.
  // The local SAR path records itself server-side; these paths don't, so without
  // this they'd never appear in History. Best-effort — never blocks the run.
  const recordHistory = async (args: { source: "cloud" | "fleet" | "c2"; targetServer: string; status: string; logs: string; durationMs?: number }): Promise<string> => {
    try {
      const res = await fetch("/api/sar/simulations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          techniqueIds: techniqueList, targetServer: args.targetServer, source: args.source,
          status: args.status, logs: args.logs, durationMs: args.durationMs,
          // Carry the run's execution mode + selected detections so the History
          // row is set up to receive the detection chain (persisted next).
          executionMode: isDetectionMode ? "simulation_detection" : "simulation",
          selectedDetections: isDetectionMode ? selectedDetections : [],
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.id) runIdRef.current = d.id;   // detection results persist onto this row
      if (activeTab === "history") fetchHistory();
      return d?.id || "";
    } catch { return ""; }
  };

  // After a client-orchestrated run (fleet/cloud/c2) succeeds in detection mode,
  // record the row then kick off detection validation against its SIEM — the
  // results persist onto the recorded row (runIdRef), so History shows the
  // detection part just like the local SAR path.
  const recordAndMaybeValidate = async (args: { source: "cloud" | "fleet" | "c2"; targetServer: string; status: string; logs: string; durationMs?: number; succeeded: boolean }) => {
    const id = await recordHistory(args);
    if (id) setSimResult((prev) => (prev ? { ...prev, id } : prev));
    if (id && args.succeeded && isDetectionMode && selectedDetections.length > 0) {
      // Deferred start must honour a Stop pressed during the wait, otherwise
      // validation springs to life 8s after the user thought they'd halted it.
      setTimeout(() => {
        if (detectionCancelRef.current) return;
        void runDetectionValidation();
      }, 8000);
    }
  };

  // C2 target (Caldera etc.): for each selected technique, ask the C2 to run the
  // matching ability against its enrolled beacons over the C2 channel, then show
  // per-technique verdicts. Same run→verdict shape as the fleet path; detection
  // scoring uses the environment's SIEM exactly like the other target types.
  const launchC2Simulation = async (target: LabTarget) => {
    if (!target.c2Id) return;
    if (techniqueList.length === 0) { setSimulating(false); return; }
    const started = Date.now();
    let logs = `Dispatching ${techniqueList.length} technique(s) to C2 "${target.displayName}" (${target.role}).\n`
      + `Each technique maps to a Caldera ability and runs on the enrolled beacon(s) over the C2 channel.\n\n`;
    setSimResult({ id: `c2-${Date.now()}`, status: "running", logs, techniques: techniqueList });

    const results: any[] = [];
    try {
      for (const technique of techniqueList) {
        logs += `▶ ${technique} — running…\n`;
        setSimResult({ id: `c2-run`, status: "running", logs, techniques: techniqueList });
        const res = await fetch(`/api/c2/${target.c2Id}/run-technique`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ techniqueId: technique, timeoutMs: 180_000 }),
        });
        const j = await res.json().catch(() => ({}));
        const r = j.result || { status: "error", notes: j.error || `HTTP ${res.status}` };
        results.push({ technique, ...r });
        const icon = r.status === "ok" ? "✅" : r.status === "failure" ? "❌" : "⚠️";
        const verdict = r.status === "ok" ? "executed — telemetry generated" : r.status === "failure" ? "execution failed" : "not executed";
        logs = logs.replace(`▶ ${technique} — running…\n`, `${icon} ${technique} — ${verdict}${r.notes ? `\n     ${r.notes}` : ""}\n`);
        if (r.stdout && String(r.stdout).trim()) logs += `   ── stdout ──\n${String(r.stdout).trim().split("\n").map((l: string) => "     " + l).join("\n")}\n`;
        setSimResult({ id: `c2-run`, status: "running", logs, techniques: techniqueList });
      }
      const passed = results.filter((r) => r.status === "ok").length;
      const stubbed = results.filter((r) => r.status === "stubbed").length;
      logs += `\n── outcome ──\n${passed} executed · ${results.length - passed} not executed (of ${results.length})`;
      if (passed < results.length) {
        logs += `\nA non-executed technique usually means no beacon is checked in to the C2 group "${target.labName}", or no Caldera ability maps to it. `
          + `Enroll a beacon (Deploy → Fleet Simulation → this C2 → Enroll, or the /caldera page), then retry.`;
        if (stubbed) logs += ` (${stubbed} had no mappable ability / no agent.)`;
      }
      const finalStatus = results.length && !passed ? "failure" : "success";
      setSimResult({ id: "c2", status: finalStatus, logs, techniques: techniqueList, durationMs: Date.now() - started });
      void recordAndMaybeValidate({ source: "c2", targetServer: target.displayName, status: finalStatus, logs, durationMs: Date.now() - started, succeeded: finalStatus === "success" });
    } catch (e: any) {
      const errLogs = logs + `\ndispatch error: ${e?.message || String(e)}`;
      setSimResult({ id: "", status: "error", logs: errLogs, techniques: techniqueList, durationMs: Date.now() - started });
      void recordHistory({ source: "c2", targetServer: target.displayName, status: "error", logs: errLogs, durationMs: Date.now() - started });
    } finally {
      setSimulating(false);
    }
  };

  // Remote-fleet target: queue one atomic per selected technique on the node's
  // agent (it runs on the endpoint itself), then poll the node's test-runs for
  // execute/cleanup status. Uses testIndex 1 (the first atomic of each technique).
  const launchFleetSimulation = async (target: LabTarget) => {
    if (!target.fleetId || !target.nodeId) return;
    if (techniqueList.length === 0) { setSimulating(false); return; }

    let logs = `Dispatching ${techniqueList.length} technique(s) to fleet node ${target.displayName} (${target.labName || "fleet"}).\n`
      + `The agent runs each atomic locally on the endpoint and always cleans up.\n\n`;
    setSimResult({ id: `fleet-${Date.now()}`, status: "running", logs, techniques: techniqueList });

    const opIds: string[] = [];
    try {
      for (const technique of techniqueList) {
        const res = await fetch(`/api/fleets/${target.fleetId}/nodes/${target.nodeId}/run-test`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ technique, testIndex: techniqueTests[technique] || 1, maxRuntimeMs: 300_000 }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.operationId) { opIds.push(j.operationId); logs += `queued ${technique} #${j.testIndex} → ${j.testName || "atomic"} (op ${j.operationId.slice(0, 8)})\n`; }
        else logs += `skip ${technique}: ${j.error || `HTTP ${res.status}`}\n`;
        setSimResult({ id: `fleet-${Date.now()}`, status: "running", logs, techniques: techniqueList });
      }
    } catch (e: any) {
      setSimResult({ id: "", status: "error", logs: logs + `\ndispatch error: ${e?.message || String(e)}`, techniques: techniqueList });
      setSimulating(false);
      return;
    }

    if (!opIds.length) {
      setSimResult({ id: "", status: "error", logs: logs + "\nNo operations were queued.", techniques: techniqueList });
      setSimulating(false);
      return;
    }

    // Poll the node's test-runs until all queued ops report, or we time out.
    logs += `\nWaiting for the agent to pick up and report ${opIds.length} test(s)…\n`;
    setSimResult({ id: `fleet-${Date.now()}`, status: "running", logs, techniques: techniqueList });
    const started = Date.now();
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/fleets/${target.fleetId}/nodes/${target.nodeId}/test-runs`);
        if (r.ok) {
          const d = await r.json();
          const pendingCount = (d.pending || []).filter((p: any) => opIds.includes(p.id)).length;
          const recent = (d.runs || []).slice(0, opIds.length);

          const indent = (t: string) => (t || "").trim().split("\n").map((l) => "     " + l).join("\n");
          const fmtRun = (run: any) => {
            const es = run.executeStatus || "";
            const ok = es === "success";
            const blocked = es === "blocked";
            const icon = ok ? "✅" : blocked ? "⛔" : "❌";
            const verdict = ok ? "executed — telemetry generated" : blocked ? "blocked by fleet policy/consent" : "execution failed — technique did NOT run";
            let s = `${icon} ${run.technique} #${run.testIndex} — ${verdict}\n     exit=${run.exitCode ?? "?"} · execute=${es || "?"} · cleanup=${run.cleanupStatus || "?"}`;
            if (run.stdout && run.stdout.trim()) s += `\n   ── stdout ──\n${indent(run.stdout)}`;
            if (run.stderr && run.stderr.trim()) s += `\n   ── stderr ──\n${indent(run.stderr)}`;
            return s;
          };
          const summary = recent.map(fmtRun).join("\n\n");

          const allDone = pendingCount === 0;
          let tail = "";
          if (allDone && recent.length) {
            const passed = recent.filter((r2: any) => r2.executeStatus === "success").length;
            const failed = recent.filter((r2: any) => r2.executeStatus && r2.executeStatus !== "success" && r2.executeStatus !== "blocked").length;
            const blocked = recent.filter((r2: any) => r2.executeStatus === "blocked").length;
            tail = `\n\n── outcome ──\n${passed} executed · ${failed} failed · ${blocked} blocked (of ${recent.length})`;
            if (failed > 0) tail += `\nA failed atomic means the technique didn't run on the host — check stderr above (common causes: needs admin/elevation, the tool binary (e.g. ProcDump) wasn't downloaded, or EDR/AV blocked it).`;
          }
          const liveLogs = logs + (summary ? `\n${summary}\n` : "") + (pendingCount ? `\n${pendingCount} still pending…` : tail);

          // "success" = the run reported back; per-atomic pass/fail is shown above.
          const anyPassed = recent.some((r2: any) => r2.executeStatus === "success");
          const fleetStatus = allDone ? (recent.length && !anyPassed ? "failure" : "success") : "running";
          setSimResult({ id: `fleet`, status: fleetStatus, logs: liveLogs, techniques: techniqueList, durationMs: Date.now() - started });
          if (allDone) {
            clearInterval(poll); setSimulating(false);
            void recordAndMaybeValidate({ source: "fleet", targetServer: target.displayName, status: fleetStatus, logs: liveLogs, durationMs: Date.now() - started, succeeded: fleetStatus === "success" });
          }
        }
      } catch { /* keep polling */ }
      if (Date.now() - started > 300_000) {   // 5-min cap (tooling is pre-installed; first-run per-test prereqs may still download)
        clearInterval(poll);
        const toLogs = logs + "\nTimed out waiting for the agent — check Execution Logs. Ensure the endpoint was prepped once (Deploy → Remote Fleet → install tooling) so Atomic Red Team is present locally.";
        setSimResult({ id: "fleet", status: "timeout", logs: toLogs, techniques: techniqueList, durationMs: Date.now() - started });
        setSimulating(false);
        void recordHistory({ source: "fleet", targetServer: target.displayName, status: "timeout", logs: toLogs, durationMs: Date.now() - started });
      }
    }, 4000);
  };

  const launchCloudSimulation = async (target: LabTarget) => {
    if (!target.rangeId) return;
    if (techniqueList.length === 0) { setSimulating(false); return; }
    const started = Date.now();

    setSimResult({
      id: `cloud-${Date.now()}`,
      status: "running",
      logs:
        `Dispatching ${techniqueList.length} technique(s) to ${target.displayName} ` +
        `(${target.ip}, ${target.os || "unknown OS"})\n` +
        `via SAR's /attack-range/simulate endpoint. WireGuard tunnel must be connected.\n\n` +
        `This can take 1-3 minutes on first run while Atomic Red Team / tooling\n` +
        `is installed on the target. Subsequent runs are faster. Please wait…\n\n`,
      techniques: techniqueList,
    });

    try {
      const res = await fetch("/api/detection-lab/cloud/attack-range/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attack_range_id: target.rangeId,
          // SAR expects the server NAME (e.g. "win" / "splunk"), NOT the IP.
          // target.originalName preserves that from our LabTarget mapping.
          target: target.originalName,
          techniques: techniqueList,
        }),
      });
      const json = await res.json().catch(() => ({}));

      const header =
        `Range: ${json.attack_range_id?.slice(0, 8) || "—"}\n` +
        `Target: ${json.target || target.originalName}\n` +
        `Techniques: ${(json.techniques || techniqueList).join(", ")}\n` +
        `Status: ${json.status || (res.ok ? "ok" : `http-${res.status}`)}\n` +
        `Message: ${json.message || "—"}\n\n── execution_output ──\n`;

      let outputText: string;
      if (json.execution_output == null) outputText = "(no output returned)";
      else if (typeof json.execution_output === "string") outputText = json.execution_output;
      else outputText = JSON.stringify(json.execution_output, null, 2);

      const isError = !res.ok || json.status === "error" || json.status === "failed";
      const cloudLogs = header + outputText;
      setSimResult({
        id: json.attack_range_id || "",
        status: isError ? "failed" : "success",
        logs: cloudLogs,
        techniques: techniqueList,
      });
      void recordAndMaybeValidate({ source: "cloud", targetServer: target.displayName, status: isError ? "failure" : "success", logs: cloudLogs, durationMs: Date.now() - started, succeeded: !isError });
    } catch (err) {
      const errLogs =
        `Failed to dispatch simulation: ${err instanceof Error ? err.message : String(err)}\n\n` +
        `Check that:\n` +
        `  1. Your WireGuard tunnel is connected (ping 10.0.2.${target.ip.split(".").pop()}).\n` +
        `  2. The SAR controller is running (http://localhost:4321).\n` +
        `  3. The range status is "running" in the Cloud tab.`;
      setSimResult({ id: "", status: "error", logs: errLogs, techniques: techniqueList });
      void recordHistory({ source: "cloud", targetServer: target.displayName, status: "error", logs: errLogs, durationMs: Date.now() - started });
    } finally {
      setSimulating(false);
    }
  };

  // ── Launch simulation ──
  const launchSimulation = async () => {
    setSimulating(true);
    setSimResult(null);

    // Cloud targets route through the SAR terminal run-tool endpoint. Output
    // streams over SSE and is concatenated into simResult.logs. No /sar/simulate
    // polling for these.
    const selectedTarget = labTargets.find((t) => t.deployedName === selectedServer);
    if (selectedTarget?.source === "cloud" && selectedTarget.rangeId) {
      await launchCloudSimulation(selectedTarget);
      return;
    }
    if (selectedTarget?.source === "fleet" && selectedTarget.fleetId && selectedTarget.nodeId) {
      await launchFleetSimulation(selectedTarget);
      return;
    }
    if (selectedTarget?.source === "c2" && selectedTarget.c2Id) {
      await launchC2Simulation(selectedTarget);
      return;
    }

    try {
      const res = await fetch("/api/sar/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          techniques: techniqueList,
          target: selectedServer,
          parameters: params,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = `API error ${res.status}`;
        try { msg = JSON.parse(text).error || msg; } catch { /* use default */ }
        setSimResult({ id: "", status: "error", logs: msg, techniques: techniqueList });
        setSimulating(false);
        return;
      }
      const data = await res.json();

      if (!data.id) {
        setSimResult({ id: "", status: "error", logs: data.error || "Unknown error", techniques: techniqueList });
        setSimulating(false);
        return;
      }

      // Start polling for live status and logs
      runIdRef.current = data.id;
      setSimResult({ id: data.id, status: "running", logs: "Simulation started…\n", techniques: techniqueList });

      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/sar/simulations?id=${data.id}`);
          if (!pollRes.ok) return;
          const run = await pollRes.json();
          setSimResult({
            id: run.id,
            status: run.status,
            logs: run.logs || "",
            techniques: run.techniqueIds || techniqueList,
            durationMs: run.durationMs,
          });
          // Stop polling when simulation is done
          if (run.status !== "running" && run.status !== "queued") {
            clearInterval(pollInterval);
            simPollRef.current = null;
            setSimulating(false);
            // Auto-trigger detection validation in detection mode
            if (executionMode === "simulation_detection" && selectedDetections.length > 0 && run.status === "success") {
              // Small delay to let Splunk index the telemetry. Re-check the
              // cancel flag on fire so a Stop during the wait actually sticks.
              setTimeout(() => {
                if (detectionCancelRef.current) return;
                void runDetectionValidation();
              }, 8000);
            }
          }
        } catch { /* keep polling */ }
      }, 3000);
      simPollRef.current = pollInterval;

      // Safety: stop polling after 5 minutes and show timeout
      setTimeout(() => {
        clearInterval(pollInterval);
        setSimulating(false);
        setSimResult((prev) => prev && prev.status === "running" ? {
          ...prev,
          status: "failure",
          logs: (prev.logs || "") + "\n[timeout] Stopped polling after 5 minutes. The simulation may still be running on the server.\n",
        } : prev);
      }, 300000);
    } catch (err) {
      setSimResult({
        id: "", status: "error",
        logs: err instanceof Error ? err.message : "Request failed",
        techniques: techniqueList,
      });
      setSimulating(false);
    }
  };

  // ── Fetch history ──
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/sar/simulations?page_size=50");
      if (res.ok) {
        const data = await res.json();
        setHistory(data.items);
      }
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  };

  useEffect(() => {
    if (activeTab === "history") fetchHistory();
  }, [activeTab]);

  // Report push targets the configured GitHub integration — prefill owner/repo
  // so the push works "based on the git integration" without manual entry.
  useEffect(() => {
    fetch("/api/reports/git-config").then((r) => r.json()).then((d) => {
      setGitConfigured(!!d.configured);
      if (d.configured) {
        setReportGhOwner((prev) => prev || d.owner || "");
        setReportGhRepo((prev) => prev || d.repo || "detection-reports");
      }
    }).catch(() => {});
  }, []);

  // Resolve each selected technique's elevation requirement (the atomic run by
  // the fleet path is test #1; fall back to "any test needs elevation").
  useEffect(() => {
    const missing = techniqueList.filter((t) => techElevation[t] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, { admin: boolean; testName?: string }> = {};
      for (const t of missing) {
        try {
          const r = await fetch(`/api/atomic-tests?technique_id=${encodeURIComponent(t)}&page_size=50`);
          const d = r.ok ? await r.json() : { items: [] };
          const items: any[] = d.items || [];
          const first = items.find((x) => x.testNumber === 1) || items[0];
          const anyAdmin = items.some((x) => x.elevationRequired);
          updates[t] = { admin: first ? !!first.elevationRequired : anyAdmin, testName: first?.testName };
        } catch { updates[t] = { admin: false }; }
      }
      if (!cancelled) setTechElevation((prev) => ({ ...prev, ...updates }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techniqueList]);

  // After restoreFromRecord() applies state, kick off the requested resume.
  useEffect(() => {
    if (!pendingResume) return;
    if (pendingResume === "detect") {
      if (selectedDetections.length > 0) { setPendingResume(null); void runDetectionValidation(); }
      else setPendingResume(null);
    } else if (pendingResume === "full") {
      if (selectedServer && techniqueList.length > 0) { setPendingResume(null); void launchSimulation(); }
      else setPendingResume(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResume, selectedDetections, selectedServer, techniqueList]);

  // ── Populate default params from SAR config ──
  useEffect(() => {
    if (sar?.config) {
      setParams((prev) => ({
        splunk_admin_password: sar.config.splunk.adminPassword !== "••••••••" ? sar.config.splunk.adminPassword : "",
        win_password: sar.config.windows.password !== "••••••••" ? sar.config.windows.password : "",
        ...prev,
      }));
      if (sar.config.splunk.ip && !splunkUrl) {
        setSplunkUrl(`https://${sar.config.splunk.ip}:8089`);
      }
    }
  }, [sar]);

  // ── Search detections across all community sources (Splunk + Sigma + Elastic) ──
  const searchSplunkDetections = async (query: string) => {
    if (!query || query.length < 2) { setDetectionSearchResults([]); return; }
    setSearchingDetections(true);

    const normalize = (det: any, source: string): SplunkDetectionOption => ({
      id: `${source}-${det.id || det.sigmaId || det.ruleId || det.detectionId}`,
      detectionId: det.detectionId || det.sigmaId || det.ruleId || det.id,
      name: det.name || det.title || "Unnamed",
      type: source,
      status: det.status || det.maturity || "community",
      mitreTechniques: Array.isArray(det.mitreTechniques)
        ? det.mitreTechniques
        : (typeof det.mitreTechniques === "string"
          ? (() => { try { return JSON.parse(det.mitreTechniques); } catch { return [det.mitreTechniques]; } })()
          : []),
      mitreTactics: Array.isArray(det.mitreTactics)
        ? det.mitreTactics
        : (typeof det.mitreTactics === "string"
          ? (() => { try { return JSON.parse(det.mitreTactics); } catch { return []; } })()
          : []),
      category: det.category || det.logsourceCategory || source,
      securityDomain: det.securityDomain || det.platform || "",
      search: det.search || det.query || det.detectionYaml || det.detection || "",
    });

    try {
      const params = new URLSearchParams({ text_search: query, page_size: "15" });
      const [splunkRes, sigmaRes, elasticRes] = await Promise.allSettled([
        fetch(`/api/community/splunk/rules?${params}`),
        fetch(`/api/community/sigmahq/rules?${params}`),
        fetch(`/api/community/elastic/rules?${params}`),
      ]);

      const combined: SplunkDetectionOption[] = [];
      const addFromResponse = async (res: PromiseSettledResult<Response>, source: string) => {
        if (res.status !== "fulfilled" || !res.value.ok) return;
        try {
          const data = await res.value.json();
          for (const det of (data.items || [])) {
            const n = normalize(det, source);
            if (n.search && !combined.find((d) => d.id === n.id)) combined.push(n);
          }
        } catch {}
      };

      await addFromResponse(splunkRes, "splunk");
      await addFromResponse(sigmaRes, "sigma");
      await addFromResponse(elasticRes, "elastic");

      setDetectionSearchResults(combined);
    } catch { /* ignore */ }
    finally { setSearchingDetections(false); }
  };

  // ── Auto-map detections from ALL community sources by MITRE ID ──
  const autoMapDetectionsToTechniques = async () => {
    if (techniqueList.length === 0) return;
    setSearchingDetections(true);
    const mapped: SplunkDetectionOption[] = [];

    // Normalize a community rule (Splunk/Sigma/Elastic) into SplunkDetectionOption shape
    const normalize = (det: any, source: string): SplunkDetectionOption => ({
      id: `${source}-${det.id || det.sigmaId || det.ruleId || det.detectionId}`,
      detectionId: det.detectionId || det.sigmaId || det.ruleId || det.id,
      name: det.name || det.title || "Unnamed detection",
      type: source,
      status: det.status || det.maturity || "community",
      mitreTechniques: Array.isArray(det.mitreTechniques)
        ? det.mitreTechniques
        : (typeof det.mitreTechniques === "string"
          ? (() => { try { return JSON.parse(det.mitreTechniques); } catch { return [det.mitreTechniques]; } })()
          : []),
      mitreTactics: Array.isArray(det.mitreTactics)
        ? det.mitreTactics
        : (typeof det.mitreTactics === "string"
          ? (() => { try { return JSON.parse(det.mitreTactics); } catch { return []; } })()
          : []),
      category: det.category || det.logsourceCategory || source,
      securityDomain: det.securityDomain || det.platform || "",
      search: det.search || det.query || det.detectionYaml || det.detection || "",
    });

    try {
      // Pull from all 3 main community sources in parallel for each technique
      for (const techId of techniqueList) {
        const [splunkRes, sigmaRes, elasticRes, unifiedRes] = await Promise.allSettled([
          fetch(`/api/community/splunk/rules?mitre_technique=${techId}&page_size=20`),
          fetch(`/api/community/sigmahq/rules?mitre_technique=${techId}&page_size=20`),
          fetch(`/api/community/elastic/rules?mitre_technique=${techId}&page_size=20`),
          fetch(`/api/community/unified/search?technique=${techId}&pageSize=20`),
        ]);

        const addFromResponse = async (res: PromiseSettledResult<Response>, source: string) => {
          if (res.status !== "fulfilled" || !res.value.ok) return;
          try {
            const data = await res.value.json();
            const items = data.items || data.results || data.rules || [];
            for (const det of items) {
              const normalized = normalize(det, source);
              if (normalized.search && !mapped.find((d) => d.id === normalized.id)) {
                mapped.push(normalized);
              }
            }
          } catch { /* skip */ }
        };

        await addFromResponse(splunkRes, "splunk");
        await addFromResponse(sigmaRes, "sigma");
        await addFromResponse(elasticRes, "elastic");
        await addFromResponse(unifiedRes, "unified");
      }
      setSelectedDetections(mapped);
    } catch { /* ignore */ }
    finally { setSearchingDetections(false); }
  };

  // ── Search detection queries from selected collections by Technique ID ──
  // Community Content (Splunk/Sigma/Elastic + unified sources), Detection Packs,
  // and synced Splunk detections. Results are added to the validation list.
  const searchCollectionsByTechnique = async () => {
    const tech = collTech.trim().toUpperCase();
    if (!/^T\d{4}(\.\d{3})?$/.test(tech)) { setCollResults([]); setCollSearched(true); return; }
    if (!collSources.community && !collSources.packs && !collSources.splunk) { setCollResults([]); setCollSearched(true); return; }
    setCollSearching(true); setCollSearched(false);

    const results: SplunkDetectionOption[] = [];
    const seen = new Set<string>();
    const push = (o: SplunkDetectionOption) => { if (o.search && !seen.has(o.id)) { seen.add(o.id); results.push(o); } };
    const asArr = (v: any): string[] => Array.isArray(v) ? v : (typeof v === "string" ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [v]; } catch { return v ? [v] : []; } })() : []);
    const normalize = (det: any, source: string): SplunkDetectionOption => ({
      id: `${source}-${det.id || det.sigmaId || det.ruleId || det.detectionId}`,
      detectionId: det.detectionId || det.sigmaId || det.ruleId || det.id,
      name: det.name || det.title || "Unnamed detection",
      type: source,
      status: det.status || det.maturity || "community",
      mitreTechniques: asArr(det.mitreTechniques),
      mitreTactics: asArr(det.mitreTactics),
      category: det.category || det.logsourceCategory || source,
      securityDomain: det.securityDomain || det.platform || "",
      search: det.search || det.query || det.detectionYaml || det.detection || "",
    });

    try {
      const jobs: Promise<void>[] = [];

      if (collSources.community) {
        jobs.push((async () => {
          const settled = await Promise.allSettled([
            fetch(`/api/community/splunk/rules?mitre_technique=${tech}&page_size=25`),
            fetch(`/api/community/sigmahq/rules?mitre_technique=${tech}&page_size=25`),
            fetch(`/api/community/elastic/rules?mitre_technique=${tech}&page_size=25`),
            fetch(`/api/community/unified/search?technique=${tech}&pageSize=25`),
          ]);
          const srcs = ["splunk", "sigma", "elastic", "community"] as const;
          for (let i = 0; i < settled.length; i++) {
            const res = settled[i];
            if (res.status !== "fulfilled" || !res.value.ok) continue;
            try {
              const j = await res.value.json();
              for (const it of (j.items || j.results || j.rules || [])) push(normalize(it, srcs[i]));
            } catch { /* skip */ }
          }
        })());
      }

      if (collSources.packs) {
        jobs.push((async () => {
          const r = await fetch(`/api/detection-packs?technique=${tech}&withRules=1&pageSize=25`).catch(() => null);
          if (!r || !r.ok) return;
          try {
            const j = await r.json();
            for (const pack of (j.items || [])) {
              for (const rule of (pack.rules || [])) {
                push({
                  id: `pack-${rule.id}`, detectionId: rule.id,
                  name: rule.title || pack.name || "Pack rule", type: "pack", status: "pack",
                  mitreTechniques: asArr(pack.mitreTechniques).length ? asArr(pack.mitreTechniques) : [tech],
                  mitreTactics: asArr(pack.mitreTactics),
                  category: pack.name || "Detection Pack",
                  securityDomain: rule.format || rule.language || "",
                  search: rule.body || "",
                });
              }
            }
          } catch { /* skip */ }
        })());
      }

      if (collSources.splunk) {
        jobs.push((async () => {
          const r = await fetch(`/api/splunk-detections?technique=${tech}&page_size=25`).catch(() => null);
          if (!r || !r.ok) return;
          try {
            const j = await r.json();
            for (const it of (j.items || j.results || [])) push(normalize(it, "splunk-detections"));
          } catch { /* skip */ }
        })());
      }

      await Promise.all(jobs);
      setCollResults(results);
    } finally {
      setCollSearching(false);
      setCollSearched(true);
    }
  };

  // ── Run a single detection check against Splunk ──
  const runSingleDetection = async (
    detIdx: number,
    det: { detectionId: string; name: string; search?: string; mitreTechniques?: string[] },
    overrideSpl?: string
  ): Promise<boolean> => {
    // Bail out immediately if detection was cancelled (Stop Polling).
    if (detectionCancelRef.current) return false;
    // Use override SPL, or the edited query from state, or the original search
    let spl = overrideSpl || det.search || "";
    // Check if user has edited the SPL in the results
    setDetectionResults((prev) => {
      const existing = prev[detIdx];
      if (existing?.editedQuery) spl = existing.editedQuery;
      return prev;
    });
    const techId = det.mitreTechniques?.[0] || techniqueList[0] || "";

    setDetectionResults((prev) =>
      prev.map((r, idx) => idx === detIdx ? {
        ...r,
        status: "searching" as const,
        message: `Attempt ${(r.attempt || 0) + 1}: Checking ESCU saved searches, alerts, and running SPL…`,
      } : r)
    );

    const ctrl = new AbortController();
    detectionAbortRef.current = ctrl;
    try {
      // Route through the resolved per-environment SIEM connection (Splunk SPL or
      // MDE KQL). Falls back to the legacy local-SAR endpoint only when nothing
      // is resolved (keeps the local lab working with zero setup).
      const res = siemConn
        ? await fetch(`/api/siem/${siemConn.id}/detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: spl, detectionName: det.name, techniqueId: techId, windowMinutes: 30 }),
            signal: ctrl.signal,
          })
        : await fetch("/api/sar/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splunkUrl,
          splunkPassword: params.splunk_admin_password,
          splunkToken,
          searchQuery: spl,
          detectionName: det.name,
          techniqueId: techId,
          earliestTime: "-30m",
        }),
        signal: ctrl.signal,
      });

      if (res.ok) {
        const data = await res.json();
        const strategies = (data.strategies || []) as { strategy: string; found: boolean; resultCount: number; details: string; results?: Record<string, string>[] }[];
        const diagnostics = (data.diagnostics || []) as string[];
        const telemetry = strategies.find((s) => s.strategy === "telemetry_check");

        let message = data.summary || "";
        if (telemetry) {
          message += telemetry.found
            ? ` | Telemetry: ${telemetry.resultCount} raw events`
            : " | No raw telemetry found";
        }

        // Collect sample results from strategies
        const sampleResults: Record<string, string>[] = [];
        for (const s of strategies) {
          if (s.results) sampleResults.push(...(s.results as Record<string, string>[]));
        }

        setDetectionResults((prev) =>
          prev.map((r, idx) => idx === detIdx ? {
            ...r,
            status: data.detected ? "detected" : "not_detected",
            matchCount: data.resultCount || 0,
            message,
            timestamp: new Date().toISOString(),
            attempt: (r.attempt || 0) + 1,
            strategies,
            diagnostics: diagnostics.length > 0 ? diagnostics : r.diagnostics,
            sampleResults: sampleResults.length > 0 ? sampleResults.slice(0, 5) : r.sampleResults,
          } : r)
        );
        return data.detected;
      } else {
        const errData = await res.json().catch(() => ({ error: "Connection failed" }));
        setDetectionResults((prev) =>
          prev.map((r, idx) => idx === detIdx ? {
            ...r,
            status: "error",
            message: errData.error || `Splunk API error (${res.status})`,
            attempt: (r.attempt || 0) + 1,
          } : r)
        );
        return false;
      }
    } catch (err) {
      const aborted = detectionCancelRef.current || (err as any)?.name === "AbortError";
      setDetectionResults((prev) =>
        prev.map((r, idx) => idx === detIdx ? (
          aborted
            ? { ...r, status: r.status === "detected" ? ("detected" as const) : ("error" as const), message: "Detection stopped — polling cancelled by user." }
            : { ...r, status: "error" as const, message: err instanceof Error ? err.message : "Failed to reach Splunk", attempt: (r.attempt || 0) + 1 }
        ) : r)
      );
      return false;
    } finally {
      if (detectionAbortRef.current === ctrl) detectionAbortRef.current = null;
    }
  };

  // ── Persist detection chain back onto the SimulationRun row ──
  // Fired after the validation loop settles + after rerunSingleDetection so the
  // History tab can re-display the chain and re-export it as a report later.
  // Uses a ref to grab the latest detectionResults inside async closures without
  // forcing every caller to take a snapshot manually.
  const detectionResultsRef = useRef<DetectionResult[]>([]);
  useEffect(() => { detectionResultsRef.current = detectionResults; }, [detectionResults]);

  const persistDetectionChain = useCallback(async (
    simId: string | undefined,
    overrides?: { validationCompletedAt?: string | null; detectionResults?: DetectionResult[] }
  ) => {
    if (!simId) return;
    try {
      await fetch(`/api/sar/simulations?id=${encodeURIComponent(simId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionMode,
          selectedDetections,
          detectionResults: overrides?.detectionResults ?? detectionResultsRef.current,
          splunkUrl,
          maxRetries: 20,
          ...(overrides?.validationCompletedAt !== undefined
            ? { validationCompletedAt: overrides.validationCompletedAt }
            : {}),
        }),
      });
    } catch { /* non-fatal — UI continues to work even if persistence misses */ }
  }, [executionMode, selectedDetections, splunkUrl]);

  // Is any long-running task active? (drives the navigation guard.)
  const simInProgress = simulating || validatingDetections || retryActive;

  // Stop everything currently running on the client + mark the run stopped
  // server-side (best-effort). The detached SAR process may finish on its own.
  const stopEverything = useCallback(async () => {
    if (retryTimerRef.current) { clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    if (simPollRef.current) { clearInterval(simPollRef.current); simPollRef.current = null; }
    // Cancel the detection chain + abort any in-flight detection fetch.
    detectionCancelRef.current = true;
    if (detectionAbortRef.current) { try { detectionAbortRef.current.abort(); } catch {} detectionAbortRef.current = null; }
    setSimulating(false);
    setValidatingDetections(false);
    setRetryActive(false);
    const id = simResult?.id;
    if (id) {
      await fetch(`/api/sar/simulations?id=${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "stopped" }),
      }).catch(() => {});
    }
  }, [simResult?.id]);

  // Restore a run from History back into the Simulate view. Optionally auto-run
  // the detection chain ("detect") or the whole thing again ("full").
  const restoreFromRecord = useCallback((rec: SimulationRecord, resume?: "detect" | "full") => {
    stopRetryTimers();
    setSelectedServer(rec.targetServer || "");
    setTechniqueList(rec.techniqueIds || []);
    setParams(rec.parameters || {});
    // If the run carried a detection chain, treat it as detection mode so the
    // Detection Validation panel renders — even if the stored executionMode flag
    // was "simulation".
    const hadDetection = (rec.detectionResults?.length || 0) > 0 || (rec.selectedDetections?.length || 0) > 0;
    setExecutionMode(hadDetection ? "simulation_detection" : ((rec.executionMode as "simulation" | "simulation_detection") || "simulation"));
    setSelectedDetections(rec.selectedDetections || []);
    setDetectionResults(rec.detectionResults || []);
    if (rec.splunkUrl) setSplunkUrl(rec.splunkUrl);
    setSimResult({
      id: rec.id, status: rec.status, logs: rec.logs || "",
      techniques: rec.techniqueIds || [], durationMs: rec.durationMs,
    });
    setActiveTab("simulate");
    setWizardStep(4);   // jump to the run/results view so the restored run + detections are visible
    setPendingResume(resume || null);
  }, []);

  // ── Run detection validation with auto-retry polling ──
  const stopRetryTimers = () => {
    // retryTimerRef holds a setTimeout id (the non-overlapping retry chain);
    // clear it as both to be safe across environments.
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); clearInterval(retryTimerRef.current); retryTimerRef.current = null; }
    if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
    setRetryActive(false);
    setRetryCountdown(0);
  };

  const runDetectionValidation = async () => {
    if (selectedDetections.length === 0) return;

    // Clear any existing retry timers + arm a fresh (non-cancelled) run.
    stopRetryTimers();
    detectionCancelRef.current = false;
    setValidatingDetections(true);

    // Initialize results
    setDetectionResults(
      selectedDetections.map((d) => ({
        detectionId: d.detectionId,
        detectionName: d.name,
        status: "pending" as const,
        matchCount: 0,
        searchQuery: d.search,
        message: "Waiting for telemetry to be indexed in Splunk…",
        attempt: 0,
      }))
    );

    // Wait for initial telemetry indexing
    await new Promise((r) => setTimeout(r, 3000));

    // First pass — run all detections
    const firstPassResults: boolean[] = [];
    for (let i = 0; i < selectedDetections.length; i++) {
      if (detectionCancelRef.current) break;
      const detected = await runSingleDetection(i, selectedDetections[i]);
      firstPassResults.push(detected);
    }

    // Stopped mid first-pass → halt without scheduling retries.
    if (detectionCancelRef.current) { setValidatingDetections(false); return; }

    // If all detected on first pass, we're done
    if (firstPassResults.every(Boolean)) {
      setValidatingDetections(false);
      void persistDetectionChain(runIdRef.current || simResult?.id, { validationCompletedAt: new Date().toISOString() });
      return;
    }

    // ── Auto-retry: re-check undetected detections every 5s, up to 10 times
    // (~50s total). CRITICAL: each pass runs to COMPLETION before the next is
    // scheduled (recursive setTimeout, not setInterval) — a detection query can
    // take longer than the interval, and setInterval would pile overlapping
    // passes on top of each other, hammering Splunk and making the UI crawl. ──
    let retryCount = 0;
    const MAX_RETRIES = 10;       // ~50 seconds total
    const RETRY_INTERVAL = 5;     // seconds between passes

    // Track detected state outside React state for the closure.
    const detectedSet = new Set<number>();
    firstPassResults.forEach((d, i) => { if (d) detectedSet.add(i); });

    setRetryActive(true);
    setValidatingDetections(false); // first pass done; retries continue in the background

    // Cosmetic 1s countdown shown between passes.
    const startCountdown = () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      setRetryCountdown(RETRY_INTERVAL);
      countdownTimerRef.current = setInterval(() => {
        setRetryCountdown((prev) => (prev > 1 ? prev - 1 : 0));
      }, 1000);
    };

    const runRetryPass = async () => {
      if (detectionCancelRef.current) { stopRetryTimers(); return; }
      if (countdownTimerRef.current) { clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
      retryCount++;

      // Re-check only still-undetected detections, sequentially (no overlap).
      for (let i = 0; i < selectedDetections.length; i++) {
        if (detectionCancelRef.current) break;
        if (detectedSet.has(i)) continue;
        const detected = await runSingleDetection(i, selectedDetections[i]);
        if (detected) detectedSet.add(i);
      }
      if (detectionCancelRef.current) { stopRetryTimers(); return; }

      // All detected, or budget exhausted → stop.
      if (detectedSet.size === selectedDetections.length || retryCount >= MAX_RETRIES) {
        stopRetryTimers();
        if (retryCount >= MAX_RETRIES) {
          setDetectionResults((prev) =>
            prev.map((r, idx) => {
              if (detectedSet.has(idx) || r.status === "detected") return r;
              return { ...r, status: "not_detected" as const, message: `Not detected after ${MAX_RETRIES} checks (${MAX_RETRIES * RETRY_INTERVAL}s). Detection may need tuning or telemetry was not generated.` };
            })
          );
        }
        void persistDetectionChain(runIdRef.current || simResult?.id, { validationCompletedAt: new Date().toISOString() });
        return;
      }

      // Schedule the next pass ONLY now that this one finished → never overlaps.
      startCountdown();
      retryTimerRef.current = setTimeout(runRetryPass, RETRY_INTERVAL * 1000);
    };

    // Kick off the first retry after the interval.
    startCountdown();
    retryTimerRef.current = setTimeout(runRetryPass, RETRY_INTERVAL * 1000);
  };

  // ── Re-run a single detection (user-triggered) ──
  const rerunSingleDetection = async (idx: number) => {
    const det = selectedDetections[idx];
    const result = detectionResults[idx];
    if (!det) return;
    detectionCancelRef.current = false; // a manual re-run re-arms the chain
    setValidatingDetections(true);
    await runSingleDetection(idx, det, result?.editedQuery || undefined);
    setValidatingDetections(false);
    // Persist updated chain so it survives navigation away from the page.
    void persistDetectionChain(runIdRef.current || simResult?.id);
  };

  // ── Update edited SPL for a detection ──
  const updateDetectionSpl = (idx: number, spl: string) => {
    setDetectionResults((prev) =>
      prev.map((r, i) => i === idx ? { ...r, editedQuery: spl } : r)
    );
  };

  // ── Stop retry polling — fully halts the detection chain ──
  // Cancels in-flight loops + aborts the current detection fetch, so nothing
  // keeps searching after the user clicks Stop.
  const stopRetryPolling = () => {
    detectionCancelRef.current = true;
    if (detectionAbortRef.current) { try { detectionAbortRef.current.abort(); } catch {} detectionAbortRef.current = null; }
    stopRetryTimers();
    setValidatingDetections(false);
    setDetectionResults((prev) => prev.map((r) =>
      (r.status === "searching" || r.status === "pending")
        ? { ...r, status: "error" as const, message: "Detection stopped — polling cancelled by user." }
        : r));
    void persistDetectionChain(runIdRef.current || simResult?.id);
  };

  // ── Build a report payload (pure — no React state reads) ──
  // Used by both the live "Save Report" button and the History row's "Save to
  // Report" button. Keeps the two paths bit-identical so a saved report from
  // history matches what the user would have saved in-flight.
  type ReportInput = {
    techniqueIds: string[];
    targetServer: string;
    simStatus: string;
    simLogs: string;
    selectedDetections: SplunkDetectionOption[];
    detectionResults: DetectionResult[];
    isDetectionMode: boolean;
    source?: string;
  };
  const envLabel = (source?: string) =>
    source === "cloud" ? "Cloud Lab" : source === "fleet" ? "Remote Fleet" : source === "c2" ? "Caldera C2" : "Splunk Attack Range";
  const buildReportPayload = (input: ReportInput) => {
    const techList = input.techniqueIds;
    const cleanServer = input.targetServer.replace("attack-range-", "");
    const detected = input.detectionResults.filter((r) => r.status === "detected").length;
    const notDetected = input.detectionResults.filter((r) => r.status === "not_detected").length;
    const reportName = `${techList.join("_")}_${cleanServer}`;

    const simulations: { description: string; output: string; order: number }[] = [
      {
        description: `Atomic Red Team simulation of ${techList.join(", ")} on ${cleanServer}`,
        output: input.simLogs || "Simulation completed",
        order: 0,
      },
    ];
    input.detectionResults.forEach((dr, i) => {
      simulations.push({
        description: `Detection: ${dr.detectionName} — ${dr.status === "detected" ? "DETECTED" : dr.status === "not_detected" ? "NOT DETECTED" : dr.status.toUpperCase()}`,
        output: dr.message + (dr.sampleResults?.length ? `\n\nSplunk returned ${dr.sampleResults.length} event(s)` : ""),
        order: i + 1,
      });
    });

    const detectionQueries = input.selectedDetections.map((d) => {
      const result = input.detectionResults.find((r) => r.detectionId === d.detectionId);
      return `-- ${d.name} (${result?.status || "pending"})\n${result?.editedQuery || result?.searchQuery || d.search || "N/A"}`;
    }).join("\n\n");

    const observations = input.isDetectionMode && input.detectionResults.length > 0
      ? `${techList.length} technique(s) simulated. ${detected} detection(s) triggered, ${notDetected} not detected out of ${input.detectionResults.length} rules tested.`
      : `${techList.length} technique(s) simulated on ${cleanServer}.`;

    const failures = input.detectionResults
      .filter((r) => r.status === "not_detected" || r.status === "error")
      .map((r) => `- ${r.detectionName}: ${r.message}`)
      .join("\n") || "";

    const recommendations = input.detectionResults
      .filter((r) => r.diagnostics?.length)
      .map((r) => r.diagnostics!.map((d) => `- [${r.detectionName}] ${d}`).join("\n"))
      .join("\n") || "";

    return {
      name: reportName,
      description: `Simulation of ${techList.join(", ")} techniques with ${input.isDetectionMode ? "detection validation" : "simulation only"} on ${envLabel(input.source)}`,
      severity: "high",
      status: input.simStatus === "success" ? "Done" : "In Progress",
      assignee: "Detection Engineer",
      platform: "Splunk Enterprise",
      maturityLevel: detected === input.detectionResults.length && detected > 0 ? "Fine-tuned" : "Developing",
      procedureCoverage: "Full Procedure Covered",
      deviceGroup: "Cover All Devices",
      falsePositive: "No",
      detectionQuery: detectionQueries || "N/A",
      observations,
      reasonsForFailure: failures,
      recommendations,
      definedAndWorking: detected > 0,
      needsImprovement: notDetected > 0,
      observationsCheck: true,
      failureReasonCheck: !!failures,
      recommendCheck: !!recommendations,
      startDate: new Date().toISOString().split("T")[0],
      simulations,
    };
  };

  // ── Create local report row + (optionally) push to GitHub ──
  // `onResult` lets the caller route the status into either the global
  // `reportResult` slot (for the live panel) or a per-history-row slot.
  const createAndPushReport = async (
    payload: ReturnType<typeof buildReportPayload>,
    setResult: (r: { success: boolean; message: string; reportUrl?: string; issueUrl?: string; localId?: string; localPath?: string }) => void,
    setBusy: (b: boolean) => void,
  ) => {
    setBusy(true);
    setResult({ success: true, message: "Saving report…" });
    try {
      const createRes = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        setResult({ success: false, message: err.error || "Failed to create report" });
        return;
      }
      const report = await createRes.json();
      const localMsg = report.localPath
        ? "Report saved locally to disk"
        : report.localWriteError
          ? `Report saved (DB) but could not write file: ${report.localWriteError}`
          : "Report saved locally";
      setResult({ success: true, message: localMsg, localId: report.id, localPath: report.localPath || undefined });

      // Push only after the local save above succeeded. Push whenever an owner
      // was given OR a GitHub integration is configured (the route resolves the
      // owner from the integration when omitted).
      if (reportGhOwner || gitConfigured) {
        const pushRes = await fetch(`/api/reports/${report.id}/github-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner: reportGhOwner || undefined, repoName: reportGhRepo }),
        });
        const pushData = await pushRes.json().catch(() => ({}));
        if (pushData.success) {
          setResult({
            success: true,
            message: `Report saved${report.localPath ? " to disk" : ""} and PR #${pushData.prNumber || ""} created on GitHub — awaiting review`,
            localId: report.id,
            localPath: report.localPath || undefined,
            reportUrl: pushData.prUrl || pushData.reportUrl,
            issueUrl: pushData.issueUrl,
          });
        } else {
          setResult({
            success: true,
            message: `Report saved locally but GitHub push failed: ${pushData.error}`,
            localId: report.id,
            localPath: report.localPath || undefined,
          });
        }
      }
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : "Failed" });
    } finally { setBusy(false); }
  };

  // ── Live panel: save current simulation+detection state ──
  const saveReportAndPush = async () => {
    if (!simResult) return;
    const payload = buildReportPayload({
      techniqueIds: techniqueList,
      targetServer: selectedServer,
      simStatus: simResult.status,
      simLogs: simResult.logs,
      selectedDetections,
      detectionResults,
      isDetectionMode,
      source: labTargets.find((t) => t.deployedName === selectedServer)?.source,
    });
    await createAndPushReport(payload, setReportResult, setReportPushing);
  };

  // ── History row: save report from a stored SimulationRecord ──
  // Uses the row's persisted detection chain (or empty arrays for legacy rows).
  const [historyReportBusy, setHistoryReportBusy] = useState<string | null>(null);
  const [historyReportResult, setHistoryReportResult] = useState<Record<string, { success: boolean; message: string; reportUrl?: string; issueUrl?: string; localId?: string; localPath?: string }>>({});
  const saveReportFromRecord = async (rec: SimulationRecord) => {
    const payload = buildReportPayload({
      techniqueIds: rec.techniqueIds,
      targetServer: rec.targetServer,
      simStatus: rec.status,
      simLogs: rec.logs,
      selectedDetections: rec.selectedDetections || [],
      detectionResults: rec.detectionResults || [],
      isDetectionMode: (rec.executionMode || "simulation") === "simulation_detection",
      source: rec.source,
    });
    await createAndPushReport(
      payload,
      (r) => setHistoryReportResult((prev) => ({ ...prev, [rec.id]: r })),
      (b) => setHistoryReportBusy(b ? rec.id : null),
    );
  };

  // ── Save detection to library ──
  const saveDetectionToLibrary = async (idx: number, customName?: string, customDesc?: string) => {
    const det = selectedDetections[idx];
    const result = detectionResults[idx];
    if (!det) return;
    setSaving(true);
    try {
      const res = await fetch("/api/custom-detections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customName || det.name,
          description: customDesc || "",
          author: "Detection Engineer",
          search: result?.editedQuery || result?.searchQuery || det.search || "",
          source: result?.editedQuery ? "edited" : "custom",
          sourceDetectionId: det.id,
          mitreTechniques: det.mitreTechniques || [],
          mitreTactics: det.mitreTactics || [],
          type: det.type || "Custom",
          category: det.category || "",
          securityDomain: det.securityDomain || "",
          verified: result?.status === "detected",
          verifiedTechnique: techniqueList[0] || "",
        }),
      });
      if (res.ok) {
        setDetectionResults((prev) =>
          prev.map((r, i) => i === idx ? { ...r, savedToLibrary: true } : r)
        );
      }
    } catch { /* ignore */ }
    finally { setSaving(false); setSaveDialogIdx(null); }
  };

  // ── Mark Splunk detection as verified ──
  const markDetectionVerified = async (idx: number) => {
    const det = selectedDetections[idx];
    if (!det) return;
    try {
      const res = await fetch("/api/splunk-detections/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detectionId: det.id,
          techniqueId: techniqueList[0] || "",
          verified: true,
        }),
      });
      if (res.ok) {
        setDetectionResults((prev) =>
          prev.map((r, i) => i === idx ? { ...r, markedVerified: true } : r)
        );
      }
    } catch { /* ignore */ }
  };

  // ── Upload custom detection ──
  const uploadCustomDetection = async () => {
    if (!uploadName || !uploadSpl) return;
    setSaving(true);
    try {
      const res = await fetch("/api/custom-detections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: uploadName,
          search: uploadSpl,
          source: "uploaded",
          mitreTechniques: uploadTechnique ? [uploadTechnique.trim().toUpperCase()] : [],
          type: "Custom",
        }),
      });
      if (res.ok) {
        setShowUploadDialog(false);
        setUploadName("");
        setUploadSpl("");
        setUploadTechnique("");
      }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  // Derived state
  const onlineVMs = (sar?.virtualMachines || []).filter((vm) => vm.state === "running");
  const sarOnline = sar?.connected === true;

  // ── Build unified target list: SAR VMs + all deployed lab VMs ──
  // For each deployed lab (e.g. "SAR + GOAD Minimal") we cross-reference the
  // template's VM definitions (role, IP, OS, services) against the live
  // VirtualBox state. This gives users a complete server list to pick from.
  const labTargets: LabTarget[] = React.useMemo(() => {
    const targets: LabTarget[] = [];

    // Authoritative "present" set: only VMs currently registered in VirtualBox.
    // A lab/template only appears once its VMs actually exist — destroyed VMs
    // (removed via Manage Labs or `destroy`) drop out here even if a stale
    // source-tree config still references them.
    const vmStateMap = new Map((systemInfo?.allVMs || []).map((v) => [v.name, v.state]));
    const presentVMs = new Set(vmStateMap.keys());

    // VMs owned by a platform-managed deployment (registry). The SAR source-install
    // path below must NOT also list these — getActiveLab() now resolves to the
    // RUNNING registered lab, so its VMs appear in both `sar.virtualMachines` and
    // the deployed-lab list, showing the same lab twice ("SAR source install" +
    // the deployed lab). This set de-dupes them.
    const deployedVmNames = new Set<string>();
    for (const e of (systemInfo?.installedEnvironments || [])) {
      if (!e.templateId) continue;
      for (const line of (e.vms || [])) deployedVmNames.add(line.replace(/\s+\([^)]+\)$/, ""));
    }

    // 1. SAR source-install VMs (traditional SAR simulation target path) — only
    //    genuine source installs, i.e. VMs NOT already owned by a registry deploy.
    for (const vm of sar?.virtualMachines || []) {
      if (!presentVMs.has(vm.name)) continue;   // skip VMs no longer present in VirtualBox
      if (deployedVmNames.has(vm.name)) continue; // already listed as a deployed lab
      const isSplunk = vm.name.includes("splunk");
      const isDC = vm.name.includes("domain-controller");
      targets.push({
        deployedName: vm.name,
        displayName: vm.name.replace("attack-range-", ""),
        originalName: vm.name,
        ip: isDC ? sar?.config?.windows?.dcIp || "" : isSplunk ? sar?.config?.splunk?.ip || "" : "",
        role: isSplunk ? "Splunk Server" : isDC ? "Windows Domain Controller" : vm.name,
        os: isDC ? "Windows Server 2016" : isSplunk ? "Ubuntu 18.04" : "",
        services: isSplunk ? ["Splunk Enterprise", "ESCU"] : isDC ? ["AD DS", "DNS", "Splunk UF", "Sysmon", "ART"] : [],
        state: vmStateMap.get(vm.name) || vm.state,
        source: "sar",
      });
    }

    // 2. Deployed lab VMs (platform-managed deployments from the registry).
    //    Keyed off templateId (the registry marker), not a name suffix.
    const deployedLabs = (systemInfo?.installedEnvironments || []).filter((e) => !!e.templateId);

    for (const lab of deployedLabs) {
      // Find the template by matching lab.path back to registry — but system-info
      // doesn't return the templateId directly. Fall back to heuristics: match by
      // the VMs the lab claims to have.
      // Easier: parse the lab.id prefix ("deploy-xxx") and the VM list directly.
      // We match each VM line against the template library by its suffix.
      for (const vmLine of lab.vms) {
        const vmName = vmLine.replace(/\s+\([^)]+\)$/, "");
        if (!presentVMs.has(vmName)) continue;   // skip missing/destroyed VMs
        const vmState = vmStateMap.get(vmName) || vmLine.match(/\(([^)]+)\)$/)?.[1] || "unknown";

        // Extract the "original" template VM name by stripping the lab prefix.
        // Prefix format: "lab-xxxxxx-<OriginalName>"
        const prefixMatch = vmName.match(/^(lab-[a-z0-9]+)-(.+)$/);
        const originalName = prefixMatch ? prefixMatch[2] : vmName;

        // Find a template that defines this original VM name
        let role = originalName;
        let ip = "";
        let os = "";
        let services: string[] = [];
        for (const tpl of labTemplates) {
          const tplVM = tpl.vms.find((v) => v.name === originalName);
          if (tplVM) {
            role = tplVM.role;
            ip = tplVM.ip || "";
            os = tplVM.os;
            services = tplVM.services || [];
            break;
          }
        }

        // Rebase the template's default private IP (10.0.1.x) onto the lab's actual
        // network base chosen at deploy time (e.g. 192.168.56.x), so the shown IP is
        // the reachable one — the same net Caldera and the fleet use to reach it.
        if (ip && lab.networkBase) { const oct = ip.split("."); if (oct.length === 4) ip = `${lab.networkBase}.${oct[3]}`; }

        // Is this a Fleet Simulation lab? (fleetLab flag OR a SAR lab under the
        // project's labs/deployments/ dir — same rule as the env panel.)
        const isFleet = !!lab.fleetLab || ((lab.type === "sar" || lab.type === "sar-docker") && /[\\/]labs[\\/]deployments[\\/]/.test(lab.path || ""));
        // Distinguish fleet VM names from the local lab's identically-named VMs
        // (both are "splunk-server"/"windows-dc") using the unique deploy prefix,
        // so the two labs never collide in the Step 1 picker.
        const shortPrefix = prefixMatch ? prefixMatch[1].replace(/^lab-/, "") : "";
        const displayName = isFleet ? `${originalName} · fleet-${shortPrefix || "vm"}` : originalName;

        targets.push({
          deployedName: vmName,
          displayName,
          originalName,
          ip, role, os, services,
          // A VM powered on but whose lab Splunk is unreachable is NOT a live
          // target — reflect the lab's reachability-gated status so it drops out
          // of "running" targets.
          state: lab.status === "unreachable" ? "unreachable" : vmState,
          source: "deployed-lab",
          labName: lab.templateName || lab.name,
          labPath: lab.path,
          // Groups under "Fleet Simulation" vs "Local Lab" (see isFleet above).
          fleetLab: isFleet,
        });
      }
    }

    // 3. Cloud ranges (from SAR controller, via our proxy)
    //
    // IMPORTANT: `architecture[]` is the authoritative source of server names.
    // SAR's /attack-range/simulate endpoint rejects any target that doesn't
    // match a name in the range config's `attack_range:` block. Guacamole's
    // `servers[]` uses DIFFERENT, more descriptive names (e.g. "windows_server"
    // instead of "win"), so we must key off architecture and merely enrich
    // with hostname/credentials from guacamole when the names match.
    for (const range of cloudRanges) {
      if (range.status !== "running") continue;
      const tplName = range.template_name?.replace(/\.yml$/, "") || "cloud";
      const arch = range.result?.architecture || [];
      const guacServers = range.result?.guacamole_info?.servers || [];

      // Build a lookup from the most-likely-matching guacamole entry.
      // Try: exact name match first; fall back to substring; fall back to os_type mapping.
      const matchGuac = (a: typeof arch[number]) => {
        if (!guacServers.length) return undefined;
        const byName = guacServers.find((g) => g.name === a.name);
        if (byName) return byName;
        const byContains = guacServers.find((g) => g.name.includes(a.name) || a.name.includes(g.name));
        if (byContains) return byContains;
        // Last resort: match by OS family (e.g. one Windows host in both lists)
        const isWin = (a.os_type || "").toLowerCase() === "windows";
        return guacServers.find((g) => (g.protocol === "rdp") === isWin);
      };

      for (const a of arch) {
        const isWin = (a.os_type || "").toLowerCase() === "windows";
        const g = matchGuac(a);
        const ip = g?.hostname || `10.0.2.${a.ip_last_octet ?? 10}`;
        const username = g?.username || (isWin ? "Administrator" : "ubuntu");
        const password = g?.password || "changeme123!";

        targets.push({
          // Keep attack_range_id + architecture name in the key so SAR simulate works.
          deployedName: `cloud:${range.attack_range_id}:${a.name}`,
          displayName: a.name,
          originalName: a.name,                 // ← must match the config's server name
          ip,
          role: isWin ? "Windows Target (cloud)" : "Linux Host (cloud)",
          os: isWin ? "Windows" : "Linux",
          services: a.roles || [],
          state: "running",
          source: "cloud",
          labName: tplName,
          rangeId: range.attack_range_id || undefined,
          credentials: { username, password },
        });
      }
    }

    // 4. Remote-fleet nodes (agent endpoints) — already built from live fleet state.
    targets.push(...fleetTargets);

    // 5. C2 servers (Caldera etc.) — techniques run over the C2 channel against beacons.
    targets.push(...c2Targets);

    return targets;
  }, [sar, systemInfo, labTemplates, cloudRanges, fleetTargets, c2Targets]);

  const runningTargets = labTargets.filter((t) => t.state === "running");
  const hasAnyTargets = labTargets.length > 0;
  const hasAnyRunning = runningTargets.length > 0;

  const canSimulate = (sarOnline || hasAnyRunning) && techniqueList.length > 0 && selectedServer;
  const isDetectionMode = executionMode === "simulation_detection";

  // Resolve which SIEM this environment validates detection against:
  // Local → local Splunk (auto), Cloud → cloud Splunk, Fleet/C2 → BYO MDE/Splunk.
  const resolveSiem = useCallback(async () => {
    if (!isDetectionMode || !selectedServer) { setSiemResolved(false); return; }
    const t = labTargets.find((x) => x.deployedName === selectedServer);
    const source = t?.source || "local";
    const targetRef = t?.c2Id || t?.fleetId || t?.labName || "";
    setSiemResolved(false);
    try {
      const r = await fetch(`/api/siem/resolve?source=${encodeURIComponent(source)}&targetRef=${encodeURIComponent(targetRef)}`);
      const d = await r.json();
      setSiemConn(d.connection ? { id: d.connection.id, name: d.connection.name, kind: d.connection.kind, status: d.connection.status } : null);
      setSiemLang(d.language === "kql" ? "kql" : "spl");
    } catch { /* leave as-is */ } finally { setSiemResolved(true); }
  }, [isDetectionMode, selectedServer, labTargets]);
  useEffect(() => { void resolveSiem(); }, [resolveSiem]);

  // Privilege of the selected target (fleet nodes only carry an interactive
  // privilege constraint; SAR/cloud lab runs execute as the lab admin/SYSTEM).
  const selectedTargetObj = labTargets.find((t) => t.deployedName === selectedServer);
  const targetPriv: "elevated" | "low" | "unknown" | null = (() => {
    if (!selectedTargetObj || selectedTargetObj.source !== "fleet") return null;
    const h = (selectedTargetObj.hostStatus || {}) as Record<string, unknown>;
    const integ = String((h.integrity as string) || (h.elevated ? "high" : "")).toLowerCase();
    if (!integ) return "unknown";
    return (h.elevated === true || ["system", "high", "root"].includes(integ)) ? "elevated" : "low";
  })();
  // Selected techniques that need Admin but the chosen node can't provide it.
  const adminTechs = techniqueList.filter((t) => techElevation[t]?.admin);
  const privMismatchTechs = targetPriv === "low" ? adminTechs : [];

  // ── Render ──
  return (
    <div className="space-y-5 animate-fade-in">
      {/* Guard against leaving while a simulation / detection chain is running */}
      <NavigationGuardModal ref={guardRef} active={simInProgress} onStop={stopEverything} />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaign Designer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Simulate MITRE ATT&CK techniques against your deployed detection engineering lab
          </p>
        </div>
      </div>

      {/* ── Active Environments (categorized · collapsible · with credentials) ── */}
      <EnvironmentAccessPanel
        loading={sarLoading}
        error={sarError}
        sar={sar}
        installedEnvs={systemInfo?.installedEnvironments || []}
        labTargets={labTargets}
        cloudRanges={cloudRanges}
        fleetTargets={fleetTargets}
        onRefresh={refreshEnvironments}
      />

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 border-b border-border">
        {[
          { key: "simulate", label: "New Simulation", icon: Zap },
          { key: "campaigns", label: "Campaigns", icon: GitBranch },
          { key: "history", label: "Simulation History", icon: Clock },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              const go = () => setActiveTab(tab.key as typeof activeTab);
              const g = guardRef.current;
              if (g) g.attempt(go); else go();
            }}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.key
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="h-3.5 w-3.5" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════ TAB: New Simulation (4-Step Wizard) ═══════════════ */}
      {activeTab === "simulate" && (
        <div className="space-y-5">
          {/* Step indicator */}
          <div className="flex items-center gap-0">
            {[
              { n: 1, label: "Select Server" },
              { n: 2, label: "Select Techniques" },
              { n: 3, label: "Configure Parameters" },
              { n: 4, label: "Launch & Results" },
            ].map((s, i) => (
              <React.Fragment key={s.n}>
                <button
                  onClick={() => setWizardStep(s.n)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                    wizardStep === s.n ? "bg-accent/10 text-accent border border-accent/30" :
                    wizardStep > s.n ? "text-success" : "text-muted-foreground"
                  )}
                >
                  <span className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                    wizardStep === s.n ? "bg-accent text-white" :
                    wizardStep > s.n ? "bg-success text-white" : "bg-muted/20 text-muted"
                  )}>
                    {wizardStep > s.n ? <CheckCircle2 className="h-3 w-3" /> : s.n}
                  </span>
                  {s.label}
                </button>
                {i < 3 && <div className={cn("h-px w-8 mx-1", wizardStep > s.n ? "bg-success" : "bg-border")} />}
              </React.Fragment>
            ))}
          </div>

          {/* ── Step 1: Select Server ── */}
          {wizardStep === 1 && (
            <div className="rounded-xl border border-border bg-card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Step 1: Select Simulation Server</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Choose a target from your running environments. Simulation techniques will execute on the selected host.
                  </p>
                </div>
                <button
                  onClick={refreshEnvironments}
                  disabled={sarLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card-hover disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3 w-3", sarLoading && "animate-spin")} />
                  Refresh
                </button>
              </div>

              {!hasAnyTargets ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <PowerOff className="h-10 w-10 text-warning mb-3" />
                  <p className="text-sm font-medium text-foreground">No Environments Detected</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Start the Splunk Attack Range or deploy a lab from the Detection Engineering Lab.
                  </p>
                </div>
              ) : !hasAnyRunning ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <PowerOff className="h-10 w-10 text-warning mb-3" />
                  <p className="text-sm font-medium text-foreground">No VMs Currently Running</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Resume your lab from the Environment Manager or Detection Engineering Lab page.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Group targets by their lab source */}
                  {(() => {
                    const groups = new Map<string, LabTarget[]>();
                    for (const t of runningTargets) {
                      const groupKey =
                        t.fleetLab           ? `Fleet Simulation — ${t.labName || "detection lab"}` :
                        t.source === "sar"   ? "Local — SAR source install" :
                        t.source === "cloud" ? `Cloud — ${t.labName || "range"}` :
                        t.source === "fleet" ? `Remote Fleet — ${t.labName || "fleet"}` :
                        t.source === "c2"    ? `C2 — ${t.labName || "server"}` :
                                               `Local — ${t.labName || "Deployed Lab"}`;
                      const list = groups.get(groupKey) || [];
                      list.push(t);
                      groups.set(groupKey, list);
                    }

                    return Array.from(groups.entries()).map(([groupName, groupTargets]) => {
                      const firstSource = groupTargets[0]?.source;
                      const isFleetLab = !!groupTargets[0]?.fleetLab;
                      return (
                      <div key={groupName}>
                        <div className="flex items-center gap-2 mb-2">
                          {isFleetLab ? (
                            <Cpu className="h-3.5 w-3.5 text-purple" />
                          ) : firstSource === "sar" ? (
                            <Server className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : firstSource === "cloud" ? (
                            <Globe className="h-3.5 w-3.5 text-accent" />
                          ) : firstSource === "fleet" ? (
                            <Cpu className="h-3.5 w-3.5 text-accent" />
                          ) : firstSource === "c2" ? (
                            <Radio className="h-3.5 w-3.5 text-accent" />
                          ) : (
                            <Shield className="h-3.5 w-3.5 text-accent" />
                          )}
                          <span className="text-xs font-semibold text-foreground">{groupName}</span>
                          <span className="text-[11px] text-muted-foreground">({groupTargets.length} running)</span>
                          {groupTargets[0].labPath && (
                            <code className="text-[10px] font-mono text-muted">{groupTargets[0].labPath}</code>
                          )}
                          {firstSource === "cloud" && groupTargets[0].rangeId && (
                            <code className="text-[10px] font-mono text-muted-foreground">{groupTargets[0].rangeId.slice(0, 8)}</code>
                          )}
                        </div>

                        <div className="space-y-2">
                          {groupTargets.map((t) => {
                            const isSelected = selectedServer === t.deployedName;
                            const isSplunk = t.role.toLowerCase().includes("splunk");
                            const isDC = t.role.toLowerCase().includes("domain controller");
                            const isWorkstation = t.role.toLowerCase().includes("workstation");

                            return (
                              <button
                                key={t.deployedName}
                                onClick={() => setSelectedServer(t.deployedName)}
                                className={cn(
                                  "w-full flex items-center justify-between rounded-lg border p-4 transition-all text-left",
                                  isSelected ? "border-accent/40 bg-accent/5" : "border-border hover:bg-card-hover"
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0",
                                    isSelected ? "bg-accent/10" : "bg-muted/10"
                                  )}>
                                    <Server className={cn("h-5 w-5", isSelected ? "text-accent" : "text-muted")} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-sm font-medium text-foreground">{t.displayName}</p>
                                      {t.source === "deployed-lab" && (
                                        <code className="text-[10px] font-mono text-muted-foreground bg-background rounded px-1">{t.deployedName}</code>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                                      <span>{t.role}</span>
                                      {t.ip && <><span>·</span><span className="font-mono">{t.ip}</span></>}
                                      {t.os && <><span>·</span><span>{t.os}</span></>}
                                      <span>·</span>
                                      <span className="text-success">● {t.state}</span>
                                      {isDC && <span className="rounded bg-accent/10 px-1 py-0.5 text-accent font-medium">Domain Controller</span>}
                                      {isSplunk && <span className="rounded bg-success/10 px-1 py-0.5 text-success font-medium">Splunk SIEM</span>}
                                      {isWorkstation && <span className="rounded bg-warning/10 px-1 py-0.5 text-warning font-medium">Workstation</span>}
                                    </div>
                                    {t.services.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1.5">
                                        {t.services.slice(0, 6).map((svc) => (
                                          <span key={svc} className="text-[10px] px-1.5 py-0.5 rounded bg-background border border-border/50 text-muted-foreground">{svc}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className={cn(
                                  "h-5 w-5 rounded-full border-2 transition-colors flex-shrink-0",
                                  isSelected ? "border-accent bg-accent" : "border-muted"
                                )}>
                                  {isSelected && <CheckCircle2 className="h-4 w-4 text-white" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      );
                    });
                  })()}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setWizardStep(2)}
                  disabled={!selectedServer}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Select Techniques ── */}
          {wizardStep === 2 && (
            <div className="rounded-xl border border-border bg-card p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Step 2: Select MITRE Technique(s)</h3>
                <p className="text-xs text-muted-foreground mt-1">Choose one or more ATT&CK techniques to simulate</p>
              </div>

              {/* Mode selector */}
              <div className="flex items-center gap-2">
                {(["single", "pair", "batch"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setTechniqueMode(mode); setTechniqueList([]); }}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      techniqueMode === mode ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-card-hover"
                    )}
                  >
                    {mode === "single" ? "Single Technique" : mode === "pair" ? "Technique Pair" : "Batch (Multiple)"}
                  </button>
                ))}
              </div>

              {/* Technique search input */}
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder="Search technique ID (e.g. T1003) or name…"
                  value={techniqueInput}
                  onChange={(e) => {
                    setTechniqueInput(e.target.value);
                    searchTechniques(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && techniqueInput.trim()) {
                      addTechnique(techniqueInput);
                    }
                  }}
                  className="h-10 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                />
                {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />}

                {/* Search dropdown */}
                {techniqueSearchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg max-h-[250px] overflow-y-auto">
                    {techniqueSearchResults.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => addTechnique(t.techniqueId)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-card-hover transition-colors border-b border-border last:border-0"
                      >
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-mono font-bold text-accent shrink-0">{t.techniqueId}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{t.testName}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{t.tactic} · {t.platforms.join(", ")} · {t.executorName}</p>
                        </div>
                        <ElevationBadge admin={t.elevationRequired} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-[11px] text-muted">
                {techniqueMode === "single" ? "Select 1 technique" :
                 techniqueMode === "pair" ? "Select up to 2 techniques" :
                 "Add as many techniques as needed"} — press Enter or click a result to add
              </p>

              {/* Selected techniques */}
              {techniqueList.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {techniqueList.map((tid) => (
                    <span key={tid} className="flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs font-mono font-bold text-accent">
                      {tid}
                      <ElevationBadge admin={techElevation[tid]?.admin} />
                      <button onClick={() => removeTechnique(tid)} className="text-accent/50 hover:text-accent transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Per-technique atomic preview + edit/save-as — see & customize
                  exactly what will run on the endpoint. */}
              {techniqueList.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">Preview &amp; customize what runs on the endpoint:</p>
                  {techniqueList.map((tid) => (
                    <AtomicPreview key={tid} techniqueId={tid} selectedTest={techniqueTests[tid]}
                      onSelectTest={(n) => setTechniqueTests((m) => ({ ...m, [tid]: n }))} />
                  ))}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setWizardStep(1)} className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                  <ChevronLeft className="h-3 w-3" /> Back
                </button>
                <button
                  onClick={() => setWizardStep(3)}
                  disabled={techniqueList.length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Configure Parameters ── */}
          {wizardStep === 3 && (
            <div className="rounded-xl border border-border bg-card p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Step 3: Configure Parameters</h3>
                  <p className="text-xs text-muted-foreground mt-1">Set execution mode, credentials, and optionally select detection rules</p>
                </div>
                <button
                  onClick={() => setShowPasswords(!showPasswords)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPasswords ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showPasswords ? "Hide" : "Show"} Passwords
                </button>
              </div>

              {/* Summary */}
              <div className="rounded-lg border border-border bg-background p-3 space-y-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted font-semibold uppercase text-[11px] w-20">Target:</span>
                  <span className="text-foreground font-medium">{selectedServer.replace("attack-range-", "")}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted font-semibold uppercase text-[11px] w-20">Techniques:</span>
                  <div className="flex gap-1.5">
                    {techniqueList.map((t) => (
                      <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-mono font-bold text-accent">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted font-semibold uppercase text-[11px] w-20">Executor:</span>
                  <span className="text-foreground">Atomic Red Team (ART)</span>
                </div>
              </div>

              {/* ── Execution Mode Selector ── */}
              <div className="space-y-3">
                <p className="text-[11px] font-semibold text-muted uppercase">Execution Mode</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setExecutionMode("simulation")}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4 text-left transition-all",
                      executionMode === "simulation"
                        ? "border-accent/40 bg-accent/5 ring-1 ring-accent/20"
                        : "border-border hover:bg-card-hover"
                    )}
                  >
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                      executionMode === "simulation" ? "bg-accent/10" : "bg-muted/10"
                    )}>
                      <Zap className={cn("h-5 w-5", executionMode === "simulation" ? "text-accent" : "text-muted")} />
                    </div>
                    <div>
                      <p className={cn("text-sm font-semibold", executionMode === "simulation" ? "text-accent" : "text-foreground")}>Just Simulation</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        Run adversary simulation only. No Splunk connection required. Best for testing technique execution.
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setExecutionMode("simulation_detection");
                      if (autoMapDetections && techniqueList.length > 0 && selectedDetections.length === 0) {
                        autoMapDetectionsToTechniques();
                      }
                    }}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-4 text-left transition-all",
                      executionMode === "simulation_detection"
                        ? "border-purple/40 bg-purple/5 ring-1 ring-purple/20"
                        : "border-border hover:bg-card-hover"
                    )}
                  >
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                      executionMode === "simulation_detection" ? "bg-purple/10" : "bg-muted/10"
                    )}>
                      <ShieldCheck className={cn("h-5 w-5", executionMode === "simulation_detection" ? "text-purple" : "text-muted")} />
                    </div>
                    <div>
                      <p className={cn("text-sm font-semibold", executionMode === "simulation_detection" ? "text-purple" : "text-foreground")}>Simulation & Detection</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                        Run simulation then validate detections against Splunk Attack Range. End-to-end attack-to-detect coverage.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Parameter fields */}
              <div className="grid grid-cols-2 gap-3">
                <ParamField
                  label="Splunk Admin Password"
                  value={params.splunk_admin_password || ""}
                  onChange={(v) => setParams({ ...params, splunk_admin_password: v })}
                  isPassword={!showPasswords}
                  placeholder="From SAR config"
                />
                <ParamField
                  label="Windows Password"
                  value={params.win_password || ""}
                  onChange={(v) => setParams({ ...params, win_password: v })}
                  isPassword={!showPasswords}
                  placeholder="From SAR config"
                />
                <ParamField
                  label="Target IP Override"
                  value={params.target_ip || ""}
                  onChange={(v) => setParams({ ...params, target_ip: v })}
                  placeholder={sar?.config?.windows?.dcIp || "10.0.1.14"}
                />
                <ParamField
                  label="Custom Atomics (optional)"
                  value={params.simulation_atomics || ""}
                  onChange={(v) => setParams({ ...params, simulation_atomics: v })}
                  placeholder="Specific atomic name"
                />
              </div>

              {/* ── Simulation & Detection Mode: Splunk Connection + Detection Rules ── */}
              {isDetectionMode && (
                <div className="space-y-4 border-t border-border pt-4">
                  {/* Detection SIEM for THIS environment (Local→Splunk, Cloud→Splunk, Fleet/C2→MDE/Splunk) */}
                  <div className={cn("rounded-lg border p-3 flex items-center gap-2 flex-wrap", siemConn ? "border-purple/30 bg-purple/5" : "border-warning/40 bg-warning/10")}>
                    <ShieldCheck className={cn("h-4 w-4", siemConn ? "text-purple" : "text-warning")} />
                    <span className="text-xs font-semibold text-foreground">Detection SIEM</span>
                    {siemConn ? (
                      <>
                        <span className="text-[11px] text-foreground">{siemConn.name}</span>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-muted/15 text-muted-foreground">{siemConn.kind === "mde" ? "MDE · KQL" : "Splunk · SPL"}</span>
                        {siemConn.status && <span className={cn("text-[10px] uppercase", siemConn.status === "online" ? "text-success" : siemConn.status === "error" ? "text-danger" : "text-muted-foreground")}>{siemConn.status}</span>}
                        <button onClick={async () => { await fetch(`/api/siem/${siemConn.id}/test`, { method: "POST" }).catch(() => {}); void resolveSiem(); }}
                          className="text-[10px] text-accent hover:underline">test</button>
                      </>
                    ) : (
                      <span className="text-[11px] text-warning">{siemResolved ? "No SIEM connected for this environment — connect one to validate detection." : "Resolving…"}</span>
                    )}
                    <button onClick={() => setSiemModalOpen(true)} className="ml-auto inline-flex items-center gap-1 text-[11px] h-7 px-2.5 rounded border border-border text-foreground hover:bg-card-hover">
                      <Plus className="h-3 w-3" /> {siemConn ? "Connect another" : "Connect a SIEM"}
                    </button>
                  </div>
                  {siemConn?.kind === "mde" && (
                    <div className="rounded-md border border-info/30 bg-info/10 px-2.5 py-1.5 text-[11px] text-info">
                      MDE selected — detection queries run as <span className="font-mono">KQL</span> via Graph Advanced Hunting. Edit each rule's query to KQL in the results below (SPL rules won't run on MDE).
                    </div>
                  )}
                  {siemModalOpen && (() => {
                    const t = labTargets.find((x) => x.deployedName === selectedServer);
                    return <SiemConnectModal defaultScope={t?.source || "local"} onClose={() => setSiemModalOpen(false)} onCreated={() => { setSiemModalOpen(false); void resolveSiem(); }} />;
                  })()}

                  {/* Splunk Connection Config */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Flame className="h-4 w-4 text-purple" />
                      <p className="text-xs font-semibold text-foreground">Splunk Attack Range Connection</p>
                      {sar?.splunk?.reachable && (
                        <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" /> Connected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Connects to the Splunk instance running within your Attack Range to validate whether simulated attacks trigger the expected detection rules.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <ParamField
                        label="Splunk Management URL"
                        value={splunkUrl}
                        onChange={setSplunkUrl}
                        placeholder="https://10.0.1.12:8089"
                      />
                      <ParamField
                        label="Splunk Auth Token (optional)"
                        value={splunkToken}
                        onChange={setSplunkToken}
                        isPassword={!showPasswords}
                        placeholder="If token-based auth is configured"
                      />
                    </div>
                    <p className="text-[11px] text-muted">
                      Uses admin credentials from SAR config above. The Splunk instance has security_content detections pre-installed via Attack Range CI/CD pipeline.
                    </p>
                  </div>

                  {/* Detection Rule Selection */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-purple" />
                        <p className="text-xs font-semibold text-foreground">Detection Rules to Validate</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoMapDetections}
                            onChange={(e) => setAutoMapDetections(e.target.checked)}
                            className="h-3 w-3 rounded border-border"
                          />
                          Auto-map by technique
                        </label>
                        <button
                          onClick={autoMapDetectionsToTechniques}
                          disabled={searchingDetections || techniqueList.length === 0}
                          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-card-hover transition-colors disabled:opacity-40"
                        >
                          {searchingDetections ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                          Map Detections
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Select Splunk security_content detections that should fire when the chosen techniques are executed. These are the same detections integrated into Attack Range&apos;s CI/CD detection engineering pipeline.
                    </p>

                    {/* Detection search */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                      <input
                        type="text"
                        placeholder="Search Splunk detections by name, technique, or story…"
                        value={detectionSearch}
                        onChange={(e) => {
                          setDetectionSearch(e.target.value);
                          searchSplunkDetections(e.target.value);
                        }}
                        className="h-9 w-full rounded-lg border border-border bg-input pl-9 pr-4 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
                      />
                      {searchingDetections && <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted" />}

                      {detectionSearchResults.length > 0 && detectionSearch && (
                        <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-lg max-h-[250px] overflow-y-auto">
                          {detectionSearchResults.map((det) => {
                            const alreadySelected = selectedDetections.some((d) => d.id === det.id);
                            return (
                              <button
                                key={det.id}
                                onClick={() => {
                                  if (!alreadySelected) {
                                    setSelectedDetections([...selectedDetections, det]);
                                  }
                                  setDetectionSearch("");
                                  setDetectionSearchResults([]);
                                }}
                                disabled={alreadySelected}
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-border last:border-0 transition-colors",
                                  alreadySelected ? "opacity-40 cursor-not-allowed" : "hover:bg-card-hover"
                                )}
                              >
                                <div className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0",
                                  det.type === "TTP" ? "bg-danger/10 text-danger" :
                                  det.type === "Anomaly" ? "bg-warning/10 text-warning" :
                                  det.type === "Hunting" ? "bg-accent/10 text-accent" :
                                  "bg-success/10 text-success"
                                )}>
                                  {det.type}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-foreground truncate">{det.name}</p>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    {det.mitreTechniques.slice(0, 3).map((t) => (
                                      <span key={t} className="rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono font-bold text-accent">{t}</span>
                                    ))}
                                    <span className="text-[10px] text-muted">{det.category} · {det.securityDomain}</span>
                                  </div>
                                </div>
                                {alreadySelected && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Selected detections */}
                    {selectedDetections.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-muted font-semibold uppercase">{selectedDetections.length} detection{selectedDetections.length !== 1 ? "s" : ""} selected</p>
                        <div className="space-y-1">
                          {selectedDetections.map((det) => (
                            <div key={det.id} className="flex items-center justify-between rounded-lg border border-purple/20 bg-purple/5 px-3 py-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0",
                                  det.type === "TTP" ? "bg-danger/10 text-danger" :
                                  det.type === "Anomaly" ? "bg-warning/10 text-warning" :
                                  "bg-accent/10 text-accent"
                                )}>{det.type}</span>
                                <p className="text-xs font-medium text-foreground truncate">{det.name}</p>
                                <div className="flex gap-1 shrink-0">
                                  {det.mitreTechniques.slice(0, 2).map((t) => (
                                    <span key={t} className="rounded bg-accent/10 px-1 py-0.5 text-[10px] font-mono text-accent">{t}</span>
                                  ))}
                                </div>
                              </div>
                              <button
                                onClick={() => setSelectedDetections(selectedDetections.filter((d) => d.id !== det.id))}
                                className="text-muted hover:text-danger transition-colors shrink-0 ml-2"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Add custom detection inline */}
                    {!showCustomInput ? (
                      <button
                        onClick={() => {
                          setShowCustomInput(true);
                          if (!collTech && techniqueList[0]) setCollTech(techniqueList[0]);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-purple/30 py-2.5 text-[11px] font-medium text-purple hover:bg-purple/5 transition-colors"
                      >
                        <Plus className="h-3 w-3" /> Add Custom Detection Logic
                      </button>
                    ) : (
                      <div className="rounded-lg border border-purple/30 bg-purple/5 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-purple uppercase">Add Custom Detection Logic</p>
                          <button onClick={() => setShowCustomInput(false)} className="text-muted hover:text-foreground"><X className="h-3 w-3" /></button>
                        </div>

                        {/* 1) Find detection queries from collections by Technique ID */}
                        <div className="rounded-lg border border-border bg-background/40 p-2.5 space-y-2">
                          <p className="text-[10px] font-semibold text-muted uppercase flex items-center gap-1.5"><Search className="h-3 w-3" /> Find from collections by Technique ID</p>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={collTech}
                              onChange={(e) => setCollTech(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") searchCollectionsByTechnique(); }}
                              placeholder="Technique ID (e.g. T1003.001)"
                              className="h-8 flex-1 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono"
                            />
                            <button
                              onClick={searchCollectionsByTechnique}
                              disabled={collSearching || !collTech.trim()}
                              className="flex items-center gap-1.5 rounded-lg bg-purple px-3 py-1.5 text-[11px] font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50"
                            >
                              {collSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} Search
                            </button>
                          </div>
                          {/* collection tick boxes */}
                          <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                            <span className="text-[10px] text-muted">Search in:</span>
                            {([
                              ["community", "Community Content"],
                              ["packs", "Detection Packs"],
                              ["splunk", "Splunk Detections"],
                            ] as const).map(([key, label]) => (
                              <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={collSources[key]}
                                  onChange={(e) => setCollSources((s) => ({ ...s, [key]: e.target.checked }))}
                                  className="h-3 w-3 rounded border-border accent-[#a02b93]"
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                          {/* results */}
                          {collSearching ? (
                            <div className="py-3 flex items-center justify-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching collections…</div>
                          ) : collSearched && collResults.length === 0 ? (
                            <p className="py-2 text-[11px] text-muted-foreground text-center">No detection queries found for that technique in the selected collections.</p>
                          ) : collResults.length > 0 ? (
                            <div className="rounded-lg border border-border bg-card max-h-[220px] overflow-y-auto divide-y divide-border">
                              <div className="px-2.5 py-1.5 text-[10px] text-muted uppercase sticky top-0 bg-card">{collResults.length} result{collResults.length !== 1 ? "s" : ""}</div>
                              {collResults.map((det) => {
                                const already = selectedDetections.some((d) => d.id === det.id);
                                return (
                                  <div key={det.id} className="flex items-center gap-2 px-2.5 py-2">
                                    <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0",
                                      det.type === "pack" ? "bg-purple/10 text-purple" :
                                      det.type === "splunk-detections" || det.type === "splunk" ? "bg-success/10 text-success" :
                                      det.type === "sigma" ? "bg-warning/10 text-warning" :
                                      "bg-accent/10 text-accent")}>
                                      {det.type === "pack" ? "Pack" : det.type === "splunk-detections" ? "Splunk" : det.type}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[11px] font-medium text-foreground truncate">{det.name}</p>
                                      <div className="flex items-center gap-1 mt-0.5">
                                        {det.mitreTechniques.slice(0, 3).map((t) => (
                                          <span key={t} className="rounded bg-accent/10 px-1 py-0.5 text-[9px] font-mono text-accent">{t}</span>
                                        ))}
                                        {det.category && <span className="text-[9px] text-muted truncate">{det.category}</span>}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => { if (!already) setSelectedDetections([...selectedDetections, det]); }}
                                      disabled={already}
                                      className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium shrink-0 transition-colors",
                                        already ? "text-success cursor-default" : "border border-purple/40 text-purple hover:bg-purple/10")}
                                    >
                                      {already ? <><CheckCircle2 className="h-3 w-3" /> Added</> : <><Plus className="h-3 w-3" /> Add</>}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>

                        {/* 2) Or write your own detection logic for this environment */}
                        <p className="text-[10px] font-semibold text-muted uppercase flex items-center gap-1.5 pt-1"><Plus className="h-3 w-3" /> Or write your own (environment fields / values)</p>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={customDetName}
                            onChange={(e) => setCustomDetName(e.target.value)}
                            placeholder="Detection name *"
                            className="h-8 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
                          />
                          <input
                            type="text"
                            value={customDetTechnique}
                            onChange={(e) => setCustomDetTechnique(e.target.value)}
                            placeholder="MITRE Technique (e.g. T1003.002)"
                            className="h-8 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono"
                          />
                        </div>
                        <textarea
                          value={customDetSpl}
                          onChange={(e) => setCustomDetSpl(e.target.value)}
                          placeholder="Paste your SPL detection query here…"
                          rows={3}
                          className="w-full rounded-lg border border-border bg-[#0d1117] p-3 text-xs text-green-400 font-mono leading-relaxed resize-y focus:border-purple/40 focus:outline-none placeholder:text-gray-600"
                          spellCheck={false}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (!customDetName || !customDetSpl) return;
                              const customDet: SplunkDetectionOption = {
                                id: `custom-${Date.now()}`,
                                detectionId: `custom-${Date.now()}`,
                                name: customDetName,
                                type: "Custom",
                                status: "custom",
                                mitreTechniques: customDetTechnique ? [customDetTechnique.trim().toUpperCase()] : [],
                                mitreTactics: [],
                                category: "",
                                securityDomain: "",
                                search: customDetSpl,
                              };
                              setSelectedDetections([...selectedDetections, customDet]);
                              setCustomDetName("");
                              setCustomDetSpl("");
                              setCustomDetTechnique("");
                              setShowCustomInput(false);
                            }}
                            disabled={!customDetName || !customDetSpl}
                            className="flex items-center gap-1.5 rounded-lg bg-purple px-3 py-1.5 text-[11px] font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50"
                          >
                            <Plus className="h-3 w-3" /> Add to Validation List
                          </button>
                          <button onClick={() => setShowCustomInput(false)} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-card-hover transition-colors">Cancel</button>
                          <span className="text-[10px] text-muted">Custom detection will be tested alongside mapped rules</span>
                        </div>
                      </div>
                    )}

                    {selectedDetections.length === 0 && !showCustomInput && (
                      <div className="rounded-lg border border-dashed border-border py-4 text-center">
                        <Shield className="h-6 w-6 text-muted mx-auto mb-1.5" />
                        <p className="text-[11px] text-muted-foreground">
                          No detections selected. Click &quot;Map Detections&quot; to auto-match, search manually, or add custom detection logic.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* How it works */}
                  <div className="rounded-lg border border-purple/20 bg-purple/5 px-4 py-3 space-y-2">
                    <p className="text-[11px] font-semibold text-purple flex items-center gap-1.5"><Activity className="h-3 w-3" /> End-to-End Flow</p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-accent font-semibold">
                        <Zap className="h-2.5 w-2.5" /> ART Simulate
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted" />
                      <span className="flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-warning font-semibold">
                        <Clock className="h-2.5 w-2.5" /> Wait for Logs
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted" />
                      <span className="flex items-center gap-1 rounded bg-purple/10 px-1.5 py-0.5 text-purple font-semibold">
                        <Shield className="h-2.5 w-2.5" /> Run SPL Searches
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted" />
                      <span className="flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-success font-semibold">
                        <ShieldCheck className="h-2.5 w-2.5" /> Validate Detection
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      After the atomic simulation completes, each selected detection&apos;s SPL search is executed against the Splunk Attack Range instance to verify whether the attack was detected. Results show coverage gaps for future detection engineering.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <button onClick={() => setWizardStep(2)} className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                  <ChevronLeft className="h-3 w-3" /> Back
                </button>
                <button
                  onClick={() => setWizardStep(4)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
                >
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Launch & Results ── */}
          {wizardStep === 4 && (
            <div className="rounded-xl border border-border bg-card p-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Step 4: Launch Simulation</h3>
                <p className="text-xs text-muted-foreground mt-1">Execute the selected techniques and view results</p>
              </div>

              {/* Summary card */}
              <div className="rounded-lg border border-border bg-background p-4 space-y-2">
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <p className="text-[11px] text-muted uppercase font-semibold">Target Server</p>
                    <p className="text-xs font-medium text-foreground mt-0.5">{selectedServer.replace("attack-range-", "")}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted uppercase font-semibold">Techniques</p>
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {techniqueList.map((t) => (
                        <span key={t} className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-mono font-bold text-accent">
                          {t}<ElevationBadge admin={techElevation[t]?.admin} />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted uppercase font-semibold">Framework</p>
                    <p className="text-xs font-medium text-foreground mt-0.5">Atomic Red Team</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted uppercase font-semibold">Mode</p>
                    <p className={cn("text-xs font-medium mt-0.5", isDetectionMode ? "text-purple" : "text-accent")}>
                      {isDetectionMode ? "Simulate & Detect" : "Simulation Only"}
                    </p>
                    {isDetectionMode && selectedDetections.length > 0 && (
                      <p className="text-[10px] text-muted mt-0.5">{selectedDetections.length} detection rule{selectedDetections.length !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Privilege mismatch: selected node is low-priv but techniques need Admin */}
              {!simResult && privMismatchTechs.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground">These techniques need Admin/SYSTEM — the selected endpoint runs as a low-privilege user</p>
                    <p className="mt-0.5">
                      <span className="font-mono">{privMismatchTechs.join(", ")}</span> will likely fail on
                      <span className="font-mono"> {selectedServer.replace("attack-range-", "")}</span>.
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Fix one of: pick a <span className="text-success font-medium">User</span>-level technique instead · run the fleet agent
                      elevated (install it as a service → LocalSystem) · or target a host whose privilege badge shows SYSTEM/HIGH.
                    </p>
                  </div>
                </div>
              )}
              {!simResult && targetPriv === "unknown" && adminTechs.length > 0 && (
                <div className="rounded-lg border border-border bg-card/60 px-4 py-2 text-[11px] text-muted-foreground flex items-start gap-2">
                  <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Some selected techniques need Admin, and this endpoint&apos;s privilege is unknown (update the agent to v0.2.2+ to report it). If it runs as a normal user, {adminTechs.join(", ")} may fail.
                </div>
              )}

              {/* Launch button — show when no active result */}
              {!simResult && (
                <button
                  onClick={launchSimulation}
                  disabled={!canSimulate || simulating}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-40",
                    isDetectionMode ? "bg-purple hover:bg-purple/90" : "bg-accent hover:bg-accent/90"
                  )}
                >
                  {simulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {simulating ? "Starting…" : isDetectionMode ? "Launch Simulation & Detection" : "Launch Simulation"}
                </button>
              )}

              {/* Result / Live status */}
              {simResult && (
                <div className="space-y-3">
                  {/* Status banner */}
                  <div className={cn(
                    "flex items-center gap-3 rounded-lg border px-4 py-3",
                    simResult.status === "running" ? "border-accent/30 bg-accent/5" :
                    simResult.status === "success" ? "border-success/30 bg-success/5" :
                    simResult.status === "failure" ? "border-warning/30 bg-warning/5" :
                    "border-danger/30 bg-danger/5"
                  )}>
                    {simResult.status === "running" ? <Loader2 className="h-5 w-5 animate-spin text-accent" /> :
                     simResult.status === "success" ? <CheckCircle2 className="h-5 w-5 text-success" /> :
                     simResult.status === "failure" ? <AlertTriangle className="h-5 w-5 text-warning" /> :
                     <XCircle className="h-5 w-5 text-danger" />}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {simResult.status === "running" ? "Simulation Running…" :
                         simResult.status === "success" ? "Simulation Succeeded" :
                         simResult.status === "failure" ? "Simulation Completed with Failures" : "Simulation Error"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {simResult.techniques.join(", ")} on {selectedServer.replace("attack-range-", "")}
                        {simResult.durationMs ? <> · {(simResult.durationMs / 1000).toFixed(1)}s</> : null}
                        {simResult.status === "running" && " — polling for live logs every 3s"}
                      </p>
                    </div>
                    {/* Re-run button when simulation failed or errored */}
                    {(simResult.status === "failure" || simResult.status === "error") && (
                      <button
                        onClick={() => { setSimResult(null); launchSimulation(); }}
                        disabled={simulating}
                        className="flex items-center gap-1.5 rounded-lg bg-warning/10 border border-warning/30 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/20 transition-colors disabled:opacity-50 mt-1"
                      >
                        <RefreshCw className="h-3 w-3" /> Re-run Simulation
                      </button>
                    )}
                  </div>

                  {/* Logs */}
                  <div className="rounded-lg border border-border bg-background overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-card-hover">
                      <span className="text-[11px] font-semibold text-muted uppercase flex items-center gap-1.5">
                        <Terminal className="h-3 w-3" /> Simulation Logs
                      </span>
                    </div>
                    <div
                      ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                      className="p-3 text-[11px] font-mono leading-relaxed whitespace-pre-wrap overflow-auto max-h-[350px] bg-[#0d1117]"
                    >
                      {(simResult.logs || "Waiting for output…").split("\n").map((line, i) => (
                        <div key={i} className={cn(
                          line.includes("[success]") || line.includes("PASSED") || line.includes("successfully") ? "text-green-400" :
                          line.includes("[failure]") || line.includes("[error]") || line.includes("[fatal]") || line.includes("FAILED") || line.includes("ERROR") ? "text-red-400" :
                          line.includes("[stderr]") || line.includes("WARNING") ? "text-yellow-400" :
                          line.includes("[info]") || line.includes("INFO") ? "text-blue-400" :
                          line.startsWith("$") ? "text-cyan-400" :
                          "text-gray-400"
                        )}>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Detection Validation Panel ── */}
                  {/* Show whenever there are detections to validate OR results to
                      display (so a restored run's detection chain is visible even
                      if it was saved without the detection-mode flag). */}
                  {/* The sim-status gate is bypassed while validation is actually
                      running: otherwise a validation kicked off by the auto-trigger
                      renders nothing at all — no counts, and no Stop button for a job
                      that is very much still querying Splunk. */}
                  {(isDetectionMode || selectedDetections.length > 0 || detectionResults.length > 0) && (selectedDetections.length > 0 || detectionResults.length > 0) && ((simResult.status !== "running" && simResult.status !== "queued") || validatingDetections || retryActive) && (
                    <div className="space-y-3">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-purple" />
                          <p className="text-sm font-semibold text-foreground">Detection Validation</p>
                          {retryActive && (
                            <span className="flex items-center gap-1.5 rounded-full border border-purple/30 bg-purple/10 px-2.5 py-0.5 text-[11px] font-semibold text-purple">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Auto-retry in {retryCountdown}s
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Stop must be reachable for the WHOLE run, not just the
                              retry phase. The first pass waits 3s then queries every
                              rule sequentially, which can run for minutes — and while
                              `retryActive` was still false there was no way to stop it. */}
                          {(validatingDetections || retryActive) && (
                            <button onClick={stopRetryPolling} className="flex items-center gap-1 rounded-lg border border-danger/40 bg-danger/5 px-2.5 py-1 text-[11px] font-medium text-danger hover:bg-danger/10 transition-colors">
                              <X className="h-2.5 w-2.5" /> Stop Validation
                            </button>
                          )}
                          <button
                            onClick={() => setShowUploadDialog(true)}
                            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
                          >
                            <Plus className="h-3 w-3" /> Upload Detection
                          </button>
                          {detectionResults.length === 0 ? (
                            <button
                              onClick={runDetectionValidation}
                              disabled={validatingDetections}
                              className="flex items-center gap-1.5 rounded-lg bg-purple px-4 py-1.5 text-xs font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50"
                            >
                              {validatingDetections ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                              Run Detection Validation
                            </button>
                          ) : (
                            <button
                              onClick={runDetectionValidation}
                              disabled={validatingDetections}
                              className="flex items-center gap-1.5 rounded-lg border border-purple/30 px-3 py-1.5 text-xs font-medium text-purple hover:bg-purple/5 transition-colors disabled:opacity-50"
                            >
                              <RefreshCw className="h-3 w-3" /> Re-run All
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Live progress banner.
                          This used to render only while EVERY rule was still
                          "pending", so it disappeared the moment the first query
                          started — leaving a running validation with no visible
                          counts and no way to stop it. It now stays up for the
                          whole run and carries the live tally. */}
                      {(validatingDetections || retryActive) && (() => {
                        const total = detectionResults.length;
                        const detected = detectionResults.filter((r) => r.status === "detected").length;
                        const notDetected = detectionResults.filter((r) => r.status === "not_detected").length;
                        const settled = detectionResults.filter((r) => r.status !== "pending" && r.status !== "searching").length;
                        const searching = detectionResults.find((r) => r.status === "searching");
                        return (
                          <div className="rounded-lg border border-purple/30 bg-purple/5 px-4 py-3 space-y-2">
                            <div className="flex items-center gap-3">
                              <Loader2 className="h-5 w-5 animate-spin text-purple shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground">
                                  {retryActive ? "Re-checking undetected rules…" : "Running Detection Validation…"}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {searching
                                    ? <>Searching Splunk for <span className="text-foreground">{searching.detectionName}</span></>
                                    : retryActive
                                      ? <>Waiting for log ingestion — next pass in {retryCountdown}s</>
                                      : <>Waiting for telemetry to be indexed (can take 1–3 minutes)</>}
                                </p>
                              </div>
                              <button
                                onClick={stopRetryPolling}
                                className="flex shrink-0 items-center gap-1 rounded-lg border border-danger/40 bg-danger/5 px-2.5 py-1 text-[11px] font-medium text-danger hover:bg-danger/10 transition-colors"
                              >
                                <X className="h-2.5 w-2.5" /> Stop
                              </button>
                            </div>
                            {total > 0 && (
                              <>
                                <div className="flex items-center gap-3 text-[11px]">
                                  <span className="text-muted-foreground">{settled}/{total} checked</span>
                                  <span className="text-success font-medium">{detected} detected</span>
                                  <span className="text-danger font-medium">{notDetected} not detected</span>
                                  <span className="text-muted">{total - settled} outstanding</span>
                                </div>
                                <div className="h-1.5 rounded-full bg-muted/20 overflow-hidden">
                                  <div className="h-full rounded-full bg-purple transition-all" style={{ width: `${Math.round((settled / total) * 100)}%` }} />
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {detectionResults.length > 0 && (
                        <div className="space-y-2">
                          {/* Summary stats */}
                          <div className="grid grid-cols-4 gap-2">
                            <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
                              <p className="text-lg font-bold text-foreground">{detectionResults.length}</p>
                              <p className="text-[10px] text-muted uppercase font-semibold">Total Rules</p>
                            </div>
                            <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-center">
                              <p className="text-lg font-bold text-success">{detectionResults.filter((r) => r.status === "detected").length}</p>
                              <p className="text-[10px] text-success uppercase font-semibold">Detected</p>
                            </div>
                            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-center">
                              <p className="text-lg font-bold text-danger">{detectionResults.filter((r) => r.status === "not_detected").length}</p>
                              <p className="text-[10px] text-danger uppercase font-semibold">Not Detected</p>
                            </div>
                            <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-center">
                              <p className="text-lg font-bold text-warning">{detectionResults.filter((r) => r.status === "error" || r.status === "searching" || r.status === "pending").length}</p>
                              <p className="text-[10px] text-warning uppercase font-semibold">Pending/Error</p>
                            </div>
                          </div>

                          {/* Per-detection expandable results */}
                          <div className="space-y-1.5">
                            {detectionResults.map((dr, drIdx) => {
                              const isExpanded = expandedDetectionId === dr.detectionId;
                              return (
                                <div key={dr.detectionId} className={cn("rounded-xl border bg-card overflow-hidden transition-all",
                                  dr.status === "detected" ? "border-success/20" :
                                  dr.status === "not_detected" ? "border-danger/20" :
                                  dr.status === "searching" ? "border-purple/20" : "border-border"
                                )}>
                                  {/* Row header — clickable */}
                                  <button
                                    onClick={() => setExpandedDetectionId(isExpanded ? null : dr.detectionId)}
                                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-card-hover transition-colors"
                                  >
                                    <div className="shrink-0">
                                      {dr.status === "detected" && <ShieldCheck className="h-4 w-4 text-success" />}
                                      {dr.status === "not_detected" && <ShieldAlert className="h-4 w-4 text-danger" />}
                                      {dr.status === "searching" && <Loader2 className="h-4 w-4 animate-spin text-purple" />}
                                      {dr.status === "pending" && <Clock className="h-4 w-4 text-muted" />}
                                      {dr.status === "error" && <AlertTriangle className="h-4 w-4 text-warning" />}
                                    </div>
                                    <div className="flex-1 text-left min-w-0">
                                      <p className="text-xs font-medium text-foreground truncate">{dr.detectionName}</p>
                                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">{dr.message}</p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                        dr.status === "detected" ? "bg-success/10 text-success" :
                                        dr.status === "not_detected" ? "bg-danger/10 text-danger" :
                                        dr.status === "searching" ? "bg-purple/10 text-purple" :
                                        dr.status === "error" ? "bg-warning/10 text-warning" :
                                        "bg-muted/10 text-muted"
                                      )}>
                                        {dr.status === "detected" ? "Detected" :
                                         dr.status === "not_detected" ? "Not Detected" :
                                         dr.status === "searching" ? "Searching…" :
                                         dr.status === "error" ? "Error" : "Pending"}
                                      </span>
                                      {dr.matchCount > 0 && (
                                        <span className="text-xs font-mono font-bold text-success">{dr.matchCount} match{dr.matchCount !== 1 ? "es" : ""}</span>
                                      )}
                                      {dr.attempt > 0 && (
                                        <span className="text-[10px] text-muted">Attempt {dr.attempt}</span>
                                      )}
                                      {isExpanded ? <ChevronDown className="h-3 w-3 text-muted" /> : <ChevronRight className="h-3 w-3 text-muted" />}
                                    </div>
                                  </button>

                                  {/* Expanded panel with tabs */}
                                  {isExpanded && (() => {
                                    const activeDetailTab = detailTab[dr.detectionId] || "spl";
                                    return (
                                    <div className="border-t border-border bg-background">
                                      {/* Tab bar */}
                                      <div className="flex items-center border-b border-border">
                                        {[
                                          { key: "spl", label: "Detection Logic", icon: FileCode2 },
                                          { key: "output", label: `Splunk Output${dr.sampleResults?.length ? ` (${dr.sampleResults.length})` : ""}`, icon: Terminal },
                                        ].map((t) => (
                                          <button
                                            key={t.key}
                                            onClick={() => setDetailTab({ ...detailTab, [dr.detectionId]: t.key as "spl" | "output" })}
                                            className={cn(
                                              "flex items-center gap-1.5 px-4 py-2 text-[11px] font-semibold border-b-2 -mb-px transition-colors",
                                              activeDetailTab === t.key
                                                ? "border-purple text-purple"
                                                : "border-transparent text-muted-foreground hover:text-foreground"
                                            )}
                                          >
                                            <t.icon className="h-3 w-3" /> {t.label}
                                          </button>
                                        ))}
                                        {/* Strategies & diagnostics always visible as small indicators */}
                                        <div className="ml-auto flex items-center gap-2 px-3">
                                          {dr.strategies && dr.strategies.filter((s) => s.found).length > 0 && (
                                            <span className="text-[10px] text-success font-medium">{dr.strategies.filter((s) => s.found).length} strategy matched</span>
                                          )}
                                          {dr.timestamp && (
                                            <span className="text-[10px] text-muted">Checked: {new Date(dr.timestamp).toLocaleTimeString()}</span>
                                          )}
                                        </div>
                                      </div>

                                      <div className="px-4 py-3 space-y-3">
                                        {/* ─── Tab: Detection Logic (SPL) ─── */}
                                        {activeDetailTab === "spl" && (
                                          <>
                                            {/* Diagnostics */}
                                            {dr.diagnostics && dr.diagnostics.length > 0 && (
                                              <div className={cn("rounded-lg border px-3 py-2.5 space-y-1.5",
                                                dr.status === "detected" ? "border-success/20 bg-success/5" : "border-warning/20 bg-warning/5"
                                              )}>
                                                <p className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                                                  {dr.status === "detected"
                                                    ? <><ShieldCheck className="h-3 w-3 text-success" /> Why Detection Fired</>
                                                    : <><AlertTriangle className="h-3 w-3 text-warning" /> Why Detection Did Not Fire</>
                                                  }
                                                </p>
                                                <ul className="space-y-1">
                                                  {dr.diagnostics.map((diag, di) => (
                                                    <li key={di} className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5">
                                                      <span className="text-muted shrink-0 mt-0.5">•</span>
                                                      <span>{diag}</span>
                                                    </li>
                                                  ))}
                                                </ul>
                                              </div>
                                            )}

                                            {/* Strategy breakdown */}
                                            {dr.strategies && dr.strategies.length > 0 && (
                                              <div>
                                                <p className="text-[11px] font-semibold text-muted uppercase mb-1.5">Validation Strategies</p>
                                                <div className="space-y-1">
                                                  {dr.strategies.map((s, si) => (
                                                    <div key={si} className="flex items-center gap-2 text-[11px]">
                                                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", s.found ? "bg-success" : "bg-muted")} />
                                                      <span className="text-muted-foreground font-mono w-32 shrink-0">{s.strategy}</span>
                                                      <span className={cn("font-semibold", s.found ? "text-success" : "text-muted")}>{s.found ? `${s.resultCount} found` : "no match"}</span>
                                                      <span className="text-muted truncate">{s.details}</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            )}

                                            {/* No SPL warning */}
                                            {!dr.searchQuery && !dr.editedQuery && (
                                              <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
                                                <p className="text-[11px] font-semibold text-danger flex items-center gap-1.5">
                                                  <AlertTriangle className="h-3 w-3" /> No SPL Query Available
                                                </p>
                                                <p className="text-[11px] text-muted-foreground mt-1">Write or paste a detection query below to test against your Splunk Attack Range.</p>
                                              </div>
                                            )}

                                            {/* Editable SPL */}
                                            <div>
                                              <div className="flex items-center justify-between mb-1.5">
                                                <p className="text-[11px] font-semibold text-muted uppercase">Detection SPL Query</p>
                                                {dr.editedQuery && dr.editedQuery !== (dr.searchQuery || "") && (
                                                  <span className="text-[10px] text-warning font-medium">Modified</span>
                                                )}
                                              </div>
                                              <textarea
                                                value={dr.editedQuery ?? dr.searchQuery ?? ""}
                                                onChange={(e) => updateDetectionSpl(drIdx, e.target.value)}
                                                rows={Math.min(10, Math.max(3, (dr.editedQuery || dr.searchQuery || "").split("\n").length + 1))}
                                                placeholder="No SPL query available — paste or write one here to test detection"
                                                className="w-full rounded-lg border border-border bg-[#0d1117] p-3 text-xs text-green-400 font-mono leading-relaxed resize-y focus:border-purple/40 focus:outline-none focus:ring-1 focus:ring-purple/30 placeholder:text-gray-600"
                                                spellCheck={false}
                                              />
                                              <p className="text-[10px] text-muted mt-1">Edit index, host, sourcetype, or logic. Changes apply when you re-run.</p>
                                            </div>
                                          </>
                                        )}

                                        {/* ─── Tab: Splunk Output ─── */}
                                        {activeDetailTab === "output" && (
                                          <>
                                            {dr.sampleResults && dr.sampleResults.length > 0 ? (
                                              <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                  <p className="text-[11px] font-semibold text-muted uppercase">Detection Output — {dr.sampleResults.length} event{dr.sampleResults.length !== 1 ? "s" : ""} from Splunk</p>
                                                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                                    dr.status === "detected" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                                                  )}>
                                                    {dr.status === "detected" ? "Attack Detected" : "Not Detected"}
                                                  </span>
                                                </div>
                                                <div className="rounded-lg border border-border bg-[#0d1117] overflow-auto max-h-[350px]">
                                                  <table className="w-full text-[11px] font-mono">
                                                    <thead className="sticky top-0">
                                                      <tr className="border-b border-gray-700 bg-gray-900">
                                                        <th className="px-2 py-1.5 text-left text-gray-500 font-semibold w-6">#</th>
                                                        {Object.keys(dr.sampleResults[0]).filter((k) => !k.startsWith("_") || k === "_time" || k === "_raw").slice(0, 8).map((key) => (
                                                          <th key={key} className="px-2 py-1.5 text-left text-gray-400 font-semibold whitespace-nowrap">{key}</th>
                                                        ))}
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {dr.sampleResults.map((row, ri) => {
                                                        const keys = Object.keys(row).filter((k) => !k.startsWith("_") || k === "_time" || k === "_raw").slice(0, 8);
                                                        return (
                                                          <tr key={ri} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                                                            <td className="px-2 py-1 text-gray-600">{ri + 1}</td>
                                                            {keys.map((key) => (
                                                              <td key={key} className="px-2 py-1 text-gray-300 max-w-[250px] truncate" title={String(row[key] || "")}>
                                                                {key === "_raw" ? String(row[key] || "").substring(0, 150) + "…" : String(row[key] || "")}
                                                              </td>
                                                            ))}
                                                          </tr>
                                                        );
                                                      })}
                                                    </tbody>
                                                  </table>
                                                </div>
                                                {dr.status === "detected" && (
                                                  <div className="rounded-lg border border-success/20 bg-success/5 px-3 py-2">
                                                    <p className="text-[11px] text-success font-medium flex items-center gap-1.5">
                                                      <ShieldCheck className="h-3 w-3" /> Splunk successfully detected the simulated attack. The above events matched the detection query.
                                                    </p>
                                                  </div>
                                                )}
                                              </div>
                                            ) : dr.status === "not_detected" || dr.status === "error" ? (
                                              <div className="flex flex-col items-center py-8 text-center">
                                                <ShieldAlert className="h-8 w-8 text-danger/40 mb-2" />
                                                <p className="text-xs font-medium text-foreground">No Detection Output</p>
                                                <p className="text-[11px] text-muted-foreground mt-1 max-w-sm">
                                                  The detection SPL returned no results from Splunk. Switch to the &quot;Detection Logic&quot; tab to edit the query and re-run.
                                                </p>
                                              </div>
                                            ) : (
                                              <div className="flex flex-col items-center py-8 text-center">
                                                <Clock className="h-8 w-8 text-muted/40 mb-2" />
                                                <p className="text-xs font-medium text-foreground">No Results Yet</p>
                                                <p className="text-[11px] text-muted-foreground mt-1">Run detection validation to see Splunk output here.</p>
                                              </div>
                                            )}
                                          </>
                                        )}

                                        {/* ─── Action buttons (always visible) ─── */}
                                        <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
                                          <button
                                            onClick={() => rerunSingleDetection(drIdx)}
                                            disabled={dr.status === "searching"}
                                            className="flex items-center gap-1.5 rounded-lg bg-purple px-3 py-1.5 text-[11px] font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50"
                                          >
                                            {dr.status === "searching" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                            Re-run Detection
                                          </button>
                                          {dr.editedQuery && dr.editedQuery !== (dr.searchQuery || "") && (
                                            <button
                                              onClick={() => updateDetectionSpl(drIdx, dr.searchQuery || "")}
                                              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-card-hover transition-colors"
                                            >
                                              Reset SPL
                                            </button>
                                          )}
                                          {!dr.savedToLibrary ? (
                                            <button
                                              onClick={() => { setSaveDialogIdx(drIdx); setSaveName(dr.detectionName); setSaveDesc(""); }}
                                              className="flex items-center gap-1 rounded-lg border border-accent/30 px-2.5 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/5 transition-colors"
                                            >
                                              <Download className="h-3 w-3" /> Save to Library
                                            </button>
                                          ) : (
                                            <span className="flex items-center gap-1 text-[11px] text-success font-medium"><CheckCircle2 className="h-3 w-3" /> Saved</span>
                                          )}
                                          {dr.status === "detected" && !dr.markedVerified ? (
                                            <button
                                              onClick={() => markDetectionVerified(drIdx)}
                                              className="flex items-center gap-1 rounded-lg border border-success/30 px-2.5 py-1.5 text-[11px] font-medium text-success hover:bg-success/5 transition-colors"
                                            >
                                              <ShieldCheck className="h-3 w-3" /> Mark Verified
                                            </button>
                                          ) : dr.markedVerified ? (
                                            <span className="flex items-center gap-1 text-[11px] text-success font-medium"><ShieldCheck className="h-3 w-3" /> Verified</span>
                                          ) : null}
                                        </div>

                                        {/* Save dialog */}
                                        {saveDialogIdx === drIdx && (
                                          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2">
                                            <p className="text-[11px] font-semibold text-accent uppercase">Save Detection to Library</p>
                                            <div className="space-y-1.5">
                                              <input type="text" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Detection name"
                                                className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
                                              <input type="text" value={saveDesc} onChange={(e) => setSaveDesc(e.target.value)} placeholder="Description (optional)"
                                                className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <button onClick={() => saveDetectionToLibrary(drIdx, saveName, saveDesc)} disabled={saving || !saveName}
                                                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                                                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Save
                                              </button>
                                              <button onClick={() => setSaveDialogIdx(null)} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-card-hover transition-colors">Cancel</button>
                                              <span className="text-[10px] text-muted">
                                                {dr.editedQuery && dr.editedQuery !== (dr.searchQuery || "") ? "Saves edited SPL" : "Saves original SPL"}
                                                {dr.status === "detected" && " • Auto-marked as verified"}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                          </div>

                          {/* Upload Detection Dialog */}
                          {showUploadDialog && (
                            <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Plus className="h-3.5 w-3.5 text-accent" /> Upload Custom Detection</p>
                                <button onClick={() => setShowUploadDialog(false)} className="text-muted hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  value={uploadName}
                                  onChange={(e) => setUploadName(e.target.value)}
                                  placeholder="Detection name *"
                                  className="h-8 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none"
                                />
                                <input
                                  type="text"
                                  value={uploadTechnique}
                                  onChange={(e) => setUploadTechnique(e.target.value)}
                                  placeholder="MITRE Technique (e.g. T1003.002)"
                                  className="h-8 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono"
                                />
                              </div>
                              <textarea
                                value={uploadSpl}
                                onChange={(e) => setUploadSpl(e.target.value)}
                                placeholder="Paste your SPL detection query here…"
                                rows={4}
                                className="w-full rounded-lg border border-border bg-[#0d1117] p-3 text-xs text-green-400 font-mono leading-relaxed resize-y focus:border-accent/40 focus:outline-none placeholder:text-gray-600"
                                spellCheck={false}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={uploadCustomDetection}
                                  disabled={saving || !uploadName || !uploadSpl}
                                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
                                >
                                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                  Save to Library
                                </button>
                                <button onClick={() => setShowUploadDialog(false)} className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-card-hover transition-colors">Cancel</button>
                                <span className="text-[10px] text-muted">Saved to custom detection library for future use</span>
                              </div>
                            </div>
                          )}

                          {/* Coverage assessment.
                              Note the `length > 0` guards: [].every(...) is TRUE, so an
                              empty result set would otherwise claim "Full Detection
                              Coverage" — a false all-clear on a security verdict. */}
                          {!validatingDetections && !retryActive && detectionResults.length > 0 && (
                            <div className={cn("rounded-lg border px-4 py-3",
                              detectionResults.some((r) => r.status === "error" || r.status === "pending" || r.status === "searching") ? "border-muted/30 bg-muted/5" :
                              detectionResults.every((r) => r.status === "detected") ? "border-success/30 bg-success/5" :
                              detectionResults.some((r) => r.status === "detected") ? "border-warning/30 bg-warning/5" :
                              "border-danger/30 bg-danger/5"
                            )}>
                              {/* An incomplete run (stopped, or errored) is NOT a coverage
                                  result — reporting it as one would be misleading. */}
                              {detectionResults.some((r) => r.status === "error" || r.status === "pending" || r.status === "searching") ? (
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4 text-muted" />
                                  <div>
                                    <p className="text-xs font-semibold text-foreground">Validation Incomplete</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {detectionResults.filter((r) => r.status === "detected").length} detected ·{" "}
                                      {detectionResults.filter((r) => r.status === "not_detected").length} not detected ·{" "}
                                      {detectionResults.filter((r) => r.status === "error" || r.status === "pending" || r.status === "searching").length} not checked.
                                      Coverage can&apos;t be judged until every rule has run — use <span className="font-semibold text-purple">Re-run All</span>.
                                    </p>
                                  </div>
                                </div>
                              ) : detectionResults.every((r) => r.status === "detected") ? (
                                <div className="flex items-center gap-2">
                                  <ShieldCheck className="h-4 w-4 text-success" />
                                  <div>
                                    <p className="text-xs font-semibold text-success">Full Detection Coverage</p>
                                    <p className="text-[11px] text-muted-foreground">All selected Splunk detections successfully fired for the simulated techniques.</p>
                                  </div>
                                </div>
                              ) : detectionResults.some((r) => r.status === "detected") ? (
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4 text-warning" />
                                  <div>
                                    <p className="text-xs font-semibold text-warning">Partial Detection Coverage</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {detectionResults.filter((r) => r.status === "detected").length} of {detectionResults.length} detections triggered.
                                      Click a rule to view/edit its SPL and re-run individually.
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <ShieldAlert className="h-4 w-4 text-danger" />
                                  <div>
                                    <p className="text-xs font-semibold text-danger">No Detections Triggered</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      None of the selected detections fired. Click each rule to inspect and edit the SPL query — check index names, host values, and sourcetypes match your Attack Range environment.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {detectionResults.length === 0 && !validatingDetections && (
                        <div className="rounded-lg border border-dashed border-purple/30 bg-purple/5 py-6 text-center">
                          <Shield className="h-8 w-8 text-purple/40 mx-auto mb-2" />
                          <p className="text-xs text-muted-foreground">
                            {simResult.status === "success"
                              ? "Waiting for Splunk to index telemetry — detection validation will start automatically…"
                              : <>Simulation complete. Click <span className="font-semibold text-purple">Run Detection Validation</span> to verify if Splunk detected the attack.</>
                            }
                          </p>
                          <p className="text-[11px] text-muted mt-1">
                            Checks ESCU saved searches, fired alerts, notable events, and runs SPL directly. Auto-retries for up to 3 minutes waiting for log ingestion.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Failure guidance */}
                  {(simResult.status === "failure" || simResult.status === "error") && (
                    <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 space-y-2">
                      <p className="text-xs font-medium text-warning">Simulation failed — try the following:</p>
                      <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
                        <li>Ensure the SAR environment is running — click <span className="font-semibold text-foreground">Resume SAR</span> above</li>
                        <li>If the environment is corrupted, run <code className="rounded bg-muted/10 px-1 py-0.5 font-mono">destroy</code> then <code className="rounded bg-muted/10 px-1 py-0.5 font-mono">build</code> to rebuild</li>
                        <li>Verify the target VM is reachable (check Environment Manager)</li>
                        <li>Check that the technique ID is valid and supported on the target platform</li>
                      </ul>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-[11px] text-muted font-semibold">SAR flags:</span>
                        {SAR_FLAGS.map((f) => (
                          <code key={f} className="rounded bg-muted/10 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">{f}</code>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions — only when simulation is complete */}
                  {simResult.status !== "running" && simResult.status !== "queued" && (
                    <div className="space-y-3">
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => { setSimResult(null); setWizardStep(1); setTechniqueList([]); setSelectedServer(""); setDetectionResults([]); setShowReportPush(false); setReportResult(null); }}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
                        >
                          <Plus className="h-3 w-3" /> New Simulation
                        </button>
                        <button
                          onClick={() => { setSimResult(null); launchSimulation(); }}
                          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
                        >
                          <RefreshCw className="h-3 w-3" /> Re-run
                        </button>
                        <button
                          onClick={() => { setActiveTab("history"); fetchHistory(); }}
                          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
                        >
                          <Clock className="h-3 w-3" /> View History
                        </button>
                        <button
                          onClick={() => setShowReportPush(!showReportPush)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors",
                            showReportPush ? "bg-purple/10 text-purple border border-purple/30" : "bg-purple text-white hover:bg-purple/90"
                          )}
                        >
                          <GitBranch className="h-3 w-3" /> Save Report & Push to GitHub
                        </button>
                      </div>

                      {/* Report + GitHub push inline panel */}
                      {showReportPush && (
                        <div className="rounded-xl border border-purple/30 bg-purple/5 p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <GitBranch className="h-4 w-4 text-purple" />
                            <p className="text-xs font-semibold text-foreground">Save Simulation Report to GitHub</p>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            This will auto-generate a structured detection report from this simulation{isDetectionMode ? " and detection validation results" : ""}, save it locally, and push it to GitHub as a markdown file + issue.
                          </p>

                          <div className="rounded-lg border border-border bg-background p-3 space-y-1.5 text-[11px]">
                            <p className="font-semibold text-muted uppercase">Report will include:</p>
                            <div className="grid grid-cols-2 gap-x-4 text-muted-foreground">
                              <span>Techniques: {techniqueList.join(", ")}</span>
                              <span>Target: {selectedServer.replace("attack-range-", "")}</span>
                              <span>Status: {simResult.status}</span>
                              <span>Duration: {simResult.durationMs ? `${(simResult.durationMs / 1000).toFixed(1)}s` : "—"}</span>
                              {isDetectionMode && <>
                                <span>Detections tested: {detectionResults.length}</span>
                                <span>Detected: {detectionResults.filter((r) => r.status === "detected").length} / Not: {detectionResults.filter((r) => r.status === "not_detected").length}</span>
                              </>}
                            </div>
                          </div>

                          {/* Report is always written to local disk first; the push
                              targets your configured GitHub integration. */}
                          <div className={cn("rounded-md border px-2.5 py-1.5 text-[10px] flex items-start gap-1.5",
                            gitConfigured ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning")}>
                            <GitBranch className="h-3 w-3 mt-0.5 shrink-0" />
                            {gitConfigured
                              ? <span>GitHub integration connected. The report is <span className="font-semibold">saved locally first</span>, then pushed{reportGhOwner ? ` to ${reportGhOwner}/${reportGhRepo}` : ""} (owner/repo below are prefilled from the integration — edit if needed).</span>
                              : <span>No GitHub integration — the report will be <span className="font-semibold">saved locally only</span>. Connect one under Integrations → GitHub Actions to also push.</span>}
                          </div>

                          <div className="flex items-center gap-2">
                            <input type="text" value={reportGhOwner} onChange={(e) => setReportGhOwner(e.target.value)}
                              placeholder="GitHub username or org (from integration)"
                              className="h-8 flex-1 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
                            <input type="text" value={reportGhRepo} onChange={(e) => setReportGhRepo(e.target.value)}
                              placeholder="detection-reports"
                              className="h-8 w-44 rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none font-mono" />
                          </div>

                          <div className="flex items-center gap-2">
                            <button onClick={saveReportAndPush} disabled={reportPushing}
                              className="flex items-center gap-1.5 rounded-lg bg-purple px-4 py-2 text-[11px] font-medium text-white hover:bg-purple/90 transition-colors disabled:opacity-50">
                              {reportPushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
                              {(reportGhOwner || gitConfigured) ? "Save locally + Push to GitHub" : "Save Report Locally"}
                            </button>
                            <span className="text-[10px] text-muted">
                              {(reportGhOwner || gitConfigured) ? `Saved to disk, then pushed to github.com/${reportGhOwner || "<integration owner>"}/${reportGhRepo}` : "Saved to disk only — connect a GitHub integration to push"}
                            </span>
                          </div>

                          {/* Result */}
                          {reportResult && (
                            <div className={cn("rounded-lg border px-3 py-2.5",
                              reportResult.success ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
                            )}>
                              <div className="flex items-center gap-2">
                                {reportResult.success ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />}
                                <p className="text-[11px] font-medium text-foreground">{reportResult.message}</p>
                              </div>
                              {reportResult.localPath && (
                                <div className="mt-1.5 ml-5 flex items-start gap-1.5">
                                  <FolderOpen className="h-3 w-3 text-muted mt-0.5 shrink-0" />
                                  <div className="min-w-0">
                                    <span className="text-[10px] text-muted-foreground">Saved to </span>
                                    <code className="text-[10px] font-mono text-foreground break-all bg-background/60 rounded px-1 py-0.5">{reportResult.localPath}</code>
                                  </div>
                                </div>
                              )}
                              {(reportResult.reportUrl || reportResult.issueUrl) && (
                                <div className="flex items-center gap-3 mt-1.5 ml-5 flex-wrap">
                                  {reportResult.reportUrl && (
                                    <a href={reportResult.reportUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-[11px] text-purple hover:underline flex items-center gap-0.5 font-medium">
                                      <GitBranch className="h-2.5 w-2.5" /> View PR on GitHub
                                    </a>
                                  )}
                                  {reportResult.issueUrl && (
                                    <a href={reportResult.issueUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-[11px] text-accent hover:underline flex items-center gap-0.5">
                                      <ExternalLink className="h-2.5 w-2.5" /> View Issue
                                    </a>
                                  )}
                                  <a href="/pr-management" className="text-[11px] text-warning hover:underline flex items-center gap-0.5 font-medium">
                                    <Eye className="h-2.5 w-2.5" /> Review in PR Management
                                  </a>
                                  <a href="/reporting" className="text-[11px] text-muted-foreground hover:underline flex items-center gap-0.5">
                                    <FileCode2 className="h-2.5 w-2.5" /> View in Reporting
                                  </a>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!simResult && !simulating && (
                <div className="flex justify-start pt-2">
                  <button onClick={() => setWizardStep(3)} className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors">
                    <ChevronLeft className="h-3 w-3" /> Back
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════ TAB: Campaigns ═══════════════ */}
      {activeTab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 mb-4">
              <GitBranch className="h-8 w-8 text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Multi-Stage Campaigns</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Chain multiple MITRE ATT&CK techniques into adversary campaigns.
              Start by running individual simulations from the "New Simulation" tab — completed simulations appear in Simulation History.
            </p>
            <button
              onClick={() => setActiveTab("simulate")}
              className="mt-6 flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
            >
              <Zap className="h-4 w-4" /> Run a Simulation
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ TAB: Simulation History ═══════════════ */}
      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">{history.length} simulation{history.length !== 1 ? "s" : ""} recorded</p>
            <button
              onClick={fetchHistory}
              disabled={historyLoading}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
            >
              <RefreshCw className={cn("h-3 w-3", historyLoading && "animate-spin")} /> Refresh
            </button>
          </div>

          {historyLoading && history.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="h-10 w-10 text-muted mb-3" />
              <p className="text-sm font-medium text-foreground">No Simulations Yet</p>
              <p className="text-xs text-muted-foreground mt-1">Run your first simulation from the "New Simulation" tab</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((sim) => {
                const isExpanded = expandedHistoryId === sim.id;
                return (
                  <div key={sim.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button
                      onClick={() => setExpandedHistoryId(isExpanded ? null : sim.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
                    >
                      {/* min-w-0 all the way down, and the chip row wraps: a run with
                          many techniques used to lay them out in one non-wrapping
                          line, which set the row's intrinsic width and pushed the
                          whole page sideways. */}
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />}
                        <StatusIcon status={sim.status} />
                        <div className="min-w-0 flex-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            {sim.techniqueIds.map((t) => (
                              <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-mono font-bold text-accent">{t}</span>
                            ))}
                            <span className={cn("text-[11px] font-semibold",
                              sim.status === "success" ? "text-success" :
                              sim.status === "failure" ? "text-warning" :
                              sim.status === "running" ? "text-accent" : "text-danger"
                            )}>
                              {sim.status}
                            </span>
                            {(() => {
                              const src = sim.source || "local";
                              const label = src === "cloud" ? "Cloud Lab" : src === "fleet" ? "Remote Fleet" : src === "c2" ? "C2 · Caldera" : "Local Lab";
                              const tone = src === "cloud" ? "border-info/40 text-info" : src === "fleet" ? "border-accent/40 text-accent" : src === "c2" ? "border-purple/40 text-purple" : "border-border text-muted-foreground";
                              return <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", tone)}>{label}</span>;
                            })()}
                          </div>
                          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                            {sim.targetServer.replace("attack-range-", "")} · {new Date(sim.startedAt).toLocaleString()}
                            {sim.durationMs > 0 && <> · {(sim.durationMs / 1000).toFixed(1)}s</>}
                          </p>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border">
                        {sim.errorMessage && (
                          <div className="px-4 py-2 bg-danger/5 text-xs text-danger">{sim.errorMessage}</div>
                        )}
                        <div className="px-4 py-2 border-b border-border bg-background/50">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Simulation Output</p>
                        </div>
                        <pre className="p-4 text-[11px] text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap overflow-auto max-h-[300px] bg-background">
                          {sim.logs || "No logs captured"}
                        </pre>

                        {/* Detection-validation chain (only when persisted) */}
                        {(sim.detectionResults?.length || 0) > 0 && (
                          <>
                            <div className="px-4 py-2 border-y border-border bg-background/50 flex items-center justify-between">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Detection Validation ({sim.detectionResults?.length || 0} rule{(sim.detectionResults?.length || 0) !== 1 ? "s" : ""})
                              </p>
                              {sim.validationCompletedAt && (
                                <span className="text-[10px] text-muted-foreground">finished {new Date(sim.validationCompletedAt).toLocaleString()}</span>
                              )}
                            </div>
                            <div className="divide-y divide-border">
                              {(sim.detectionResults || []).map((dr, di) => (
                                <div key={`${sim.id}-${di}`} className="px-4 py-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded",
                                      dr.status === "detected" ? "bg-success/15 text-success" :
                                      dr.status === "not_detected" ? "bg-warning/15 text-warning" :
                                      dr.status === "error" ? "bg-danger/15 text-danger" :
                                      "bg-muted/15 text-muted-foreground"
                                    )}>
                                      {dr.status === "detected" ? "✓ DETECTED" :
                                       dr.status === "not_detected" ? "✗ NOT DETECTED" :
                                       dr.status.toUpperCase()}
                                    </span>
                                    {/* min-w-0 is required for `truncate` to work on a
                                        flex child — without it the span keeps its
                                        intrinsic width and overflows instead. */}
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{dr.detectionName}</span>
                                    <span className="shrink-0 text-[10px] text-muted-foreground">attempt {dr.attempt || 0}</span>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mb-1">{dr.message}</p>
                                  {dr.matchCount > 0 && (
                                    <p className="text-[11px] text-success">{dr.matchCount} match{dr.matchCount !== 1 ? "es" : ""}</p>
                                  )}
                                  {(dr.editedQuery || dr.searchQuery) && (
                                    <details className="mt-1.5">
                                      <summary className="text-[10px] cursor-pointer text-accent hover:text-accent/80">SPL query</summary>
                                      {/* break-all + overflow-x-auto: SPL is full of
                                          long unbroken tokens (macros, datamodel
                                          field paths) that whitespace-pre-wrap alone
                                          cannot wrap, so they used to push the page
                                          sideways. */}
                                      <pre className="mt-1 p-2 text-[10px] text-green-400 font-mono bg-[#0d1117] rounded border border-border whitespace-pre-wrap break-all overflow-x-auto max-h-[300px]">{dr.editedQuery || dr.searchQuery}</pre>
                                    </details>
                                  )}
                                  {dr.diagnostics && dr.diagnostics.length > 0 && (
                                    <details className="mt-1.5">
                                      <summary className="text-[10px] cursor-pointer text-accent hover:text-accent/80">{dr.diagnostics.length} diagnostic{dr.diagnostics.length !== 1 ? "s" : ""}</summary>
                                      <ul className="mt-1 ml-3 list-disc text-[10px] text-muted-foreground space-y-0.5">
                                        {dr.diagnostics.map((d, j) => <li key={j}>{d}</li>)}
                                      </ul>
                                    </details>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {/* Resume / re-run actions — restore this run's full context */}
                        <div className="px-4 py-3 border-t border-border bg-background/30 flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted mr-1">Resume / re-run</span>
                            <button
                              onClick={() => restoreFromRecord(sim)}
                              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-card-hover transition-colors">
                              <Eye className="h-3 w-3" /> Open
                            </button>
                            {(sim.selectedDetections?.length || 0) > 0 && sim.status === "success" && (
                              <button
                                onClick={() => restoreFromRecord(sim, "detect")}
                                title="Re-query the detections against the existing telemetry — no re-simulation"
                                className="flex items-center gap-1.5 rounded-md border border-purple/40 bg-purple/10 px-2.5 py-1 text-[11px] font-medium text-purple hover:bg-purple/20 transition-colors">
                                <ShieldCheck className="h-3 w-3" /> Resume detection chain
                              </button>
                            )}
                            <button
                              onClick={() => restoreFromRecord(sim, "full")}
                              title="Re-run the whole scenario (simulate + validate) from the start"
                              className="flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors">
                              <RefreshCw className="h-3 w-3" /> Re-run full
                            </button>
                            {(sim.selectedDetections?.length || 0) > 0 && (
                              <button
                                onClick={() => restoreFromRecord(sim, "detect")}
                                title="Re-run only the detection chain against the current telemetry"
                                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors">
                                <RefreshCw className="h-3 w-3" /> Re-run detection only
                              </button>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Resuming re-queries detections against telemetry already in Splunk — you don&apos;t re-simulate the whole chain.
                          </p>
                        </div>

                        {/* Save-to-Report from history */}
                        <div className="px-4 py-3 border-t border-border bg-background/30 flex flex-col gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => saveReportFromRecord(sim)}
                              disabled={historyReportBusy === sim.id}
                              className="flex items-center gap-1.5 rounded-md bg-accent/10 hover:bg-accent/20 border border-accent/30 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors disabled:opacity-50"
                            >
                              {historyReportBusy === sim.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <CheckCircle2 className="h-3 w-3" />}
                              Save to Report{reportGhOwner ? " + GitHub PR" : " (local only)"}
                            </button>
                            <span className="text-[10px] text-muted-foreground">
                              {reportGhOwner
                                ? <>pushes to <code className="font-mono">{reportGhOwner}/{reportGhRepo}</code></>
                                : <>set GitHub owner in the New Simulation tab to also push a PR</>}
                            </span>
                          </div>
                          {historyReportResult[sim.id] && (
                            <div className={cn("text-[11px]", historyReportResult[sim.id].success ? "text-success" : "text-danger")}>
                              {historyReportResult[sim.id].message}
                              {historyReportResult[sim.id].reportUrl && (
                                <> · <a href={historyReportResult[sim.id].reportUrl} target="_blank" rel="noreferrer" className="underline">view PR</a></>
                              )}
                              {historyReportResult[sim.id].localPath && (
                                <div className="mt-1 flex items-start gap-1.5 text-muted-foreground">
                                  <FolderOpen className="h-3 w-3 mt-0.5 shrink-0" />
                                  <span>Saved to <code className="font-mono text-foreground break-all bg-background/60 rounded px-1 py-0.5">{historyReportResult[sim.id].localPath}</code></span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

function ParamField({ label, value, onChange, isPassword, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; isPassword?: boolean; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-muted uppercase">{label}</label>
      <input
        type={isPassword ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-border bg-input px-3 text-xs text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus font-mono"
      />
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "failure") return <AlertTriangle className="h-4 w-4 text-warning" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-accent" />;
  return <XCircle className="h-4 w-4 text-danger" />;
}
