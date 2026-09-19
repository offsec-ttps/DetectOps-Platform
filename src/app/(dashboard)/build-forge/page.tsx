"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Hammer,
  Search,
  Plus,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  GitFork,
  Star,
  ChevronDown,
  ChevronRight,
  Package,
  Trash2,
  RefreshCw,
  Download,
  Terminal,
  Monitor,
  Cpu,
  Box,
  FolderOpen,
  BookmarkPlus,
  Archive,
  Swords,
  Eye,
  FileDown,
  ShieldCheck,
  HardDrive,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface GitHubSearchResult {
  full_name: string;
  owner: string;
  name: string;
  description: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  language: string;
  stars: number;
  visibility: string;
  avatar_url: string;
  topics: string[];
}

interface TargetDef {
  name: string;
  description: string;
  framework: string;
  supported_environments: string[];
  supported_architectures: string[];
  build_command: string;
  artifact_patterns: string[];
}

interface BuildRepo {
  id: string;
  name: string;
  owner: string;
  repoName: string;
  gitUrl: string;
  visibility: string;
  description: string;
  language: string;
  buildSystem: string;
  defaultBranch: string;
  defaultEnvironment: string;
  defaultArch: string;
  framework: string;
  avatarUrl: string;
  stars: number;
  enabled: boolean;
  targets: TargetDef[];
  builds: BuildRecord[];
  createdAt: string;
  /**
   * Seeded snapshot of the repo's prebuilt-binary availability. Written by
   * scripts/seed-offensive-tools.ts at seed time. Surfaces the "Prebuilt"
   * badge + one-click Download when available.
   */
  prebuiltInfo?: {
    available: boolean;
    kind: "release-assets" | "meta-repo" | "branch-zip" | "none";
    tag?: string;
    assetCount?: number;
    primaryAssetName?: string;
    primaryAssetUrl?: string;
    primaryAssetSize?: number;
    lastChecked?: string;
  } | null;
}

interface BuildRecord {
  id: string;
  repoId: string;
  target: string;
  branch: string;
  commitSha: string;
  environment: string;
  architecture: string;
  framework: string;
  buildProfile: string;
  status: string;
  artifactPath: string;
  artifactName: string;
  artifactSize: number;
  artifactHash: string;
  logSnippet: string;
  errorSummary: string;
  durationMs: number;
  startedAt: string;
  completedAt: string | null;
  savedToCollection: boolean;
  repo?: { name: string; owner: string; repoName: string; language: string };
}

interface BinaryCollectionItem {
  id: string;
  name: string;
  binaryName: string;
  repoName: string;
  repoOwner: string;
  language: string;
  target: string;
  environment: string;
  architecture: string;
  framework: string;
  branch: string;
  commitSha: string;
  buildProfile: string;
  filePath: string;
  fileSize: number;
  sha256: string;
  description: string;
  tags: string[];
  usedInSimulation: boolean;
  lastUsedAt: string | null;
  buildRecordId: string | null;
  createdAt: string;
}

// ── Page Component ─────────────────────────────────────────────

export default function BuildForgePage() {
  const [activeTab, setActiveTab] = useState<"repos" | "builds" | "collection">("repos");

  // Search GitHub
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GitHubSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Registered repos
  const [repos, setRepos] = useState<BuildRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);

  // Builds
  const [builds, setBuilds] = useState<BuildRecord[]>([]);
  const [loadingBuilds, setLoadingBuilds] = useState(false);

  // Binary collection
  const [collection, setCollection] = useState<BinaryCollectionItem[]>([]);
  const [loadingCollection, setLoadingCollection] = useState(false);

  // Build dialog
  const [buildDialog, setBuildDialog] = useState<BuildRepo | null>(null);
  const [buildTarget, setBuildTarget] = useState("");
  const [buildBranch, setBuildBranch] = useState("");
  const [buildEnv, setBuildEnv] = useState("linux");
  const [buildArch, setBuildArch] = useState("x64");
  const [buildProfile, setBuildProfile] = useState("release");
  const [triggeringBuild, setTriggeringBuild] = useState(false);

  // Expanded repo
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  // Saving state
  const [savingBuildId, setSavingBuildId] = useState<string | null>(null);

  // ── Prebuilt GitHub releases (lazily fetched per repo when expanded) ─────
  interface PrebuiltAsset {
    name: string;
    size: number;
    url: string;
    kind: "binary" | "source-zip" | "source-tar" | "branch-zip";
    content_type?: string;
  }
  interface PrebuiltPayload {
    status: "loading" | "ready" | "error";
    hasRelease?: boolean;
    release?: { tag: string; name: string | null; html_url: string; published_at: string } | null;
    assets?: PrebuiltAsset[];
    defaultBranch?: string;
    error?: string;
    downloadingUrl?: string | null;  // which asset is mid-download
  }
  const [prebuilts, setPrebuilts] = useState<Record<string, PrebuiltPayload>>({});

  const fetchPrebuilts = useCallback(async (repo: BuildRepo) => {
    const key = repo.id;
    if (prebuilts[key]?.status === "ready" || prebuilts[key]?.status === "loading") return;
    setPrebuilts((prev) => ({ ...prev, [key]: { status: "loading" } }));
    try {
      const r = await fetch(`/api/build-forge/releases/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repoName)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setPrebuilts((prev) => ({
        ...prev,
        [key]: {
          status: "ready",
          hasRelease: data.hasRelease,
          release: data.release,
          assets: data.assets || [],
          defaultBranch: data.defaultBranch,
        },
      }));
    } catch (e: any) {
      setPrebuilts((prev) => ({ ...prev, [key]: { status: "error", error: e?.message || "failed to load" } }));
    }
  }, [prebuilts]);

  // ── Meta-repo per-file browser (SharpCollection / Ghostpack-CompiledBinaries) ─
  interface MetaBinaryFile {
    path: string;
    name: string;
    subdir: string;
    ext: string;
    size: number;
    download_url: string;
  }
  interface MetaBinaryPayload {
    status: "loading" | "ready" | "error";
    branch?: string;
    total?: number;
    truncated?: boolean;
    groups?: Record<string, MetaBinaryFile[]>;
    error?: string;
    downloadingUrl?: string | null;
    filter?: string;
  }
  const [metaBinaries, setMetaBinaries] = useState<Record<string, MetaBinaryPayload>>({});

  const fetchMetaBinaries = useCallback(async (repo: BuildRepo) => {
    const key = repo.id;
    if (metaBinaries[key]?.status === "ready" || metaBinaries[key]?.status === "loading") return;
    setMetaBinaries((prev) => ({ ...prev, [key]: { status: "loading" } }));
    try {
      const qs = repo.defaultBranch ? `?branch=${encodeURIComponent(repo.defaultBranch)}` : "";
      const r = await fetch(`/api/build-forge/meta-binaries/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repoName)}${qs}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.hint || j?.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      setMetaBinaries((prev) => ({
        ...prev,
        [key]: {
          status: "ready",
          branch: data.branch,
          total: data.total,
          truncated: data.truncated,
          groups: data.groups,
          filter: "",
        },
      }));
    } catch (e: any) {
      setMetaBinaries((prev) => ({ ...prev, [key]: { status: "error", error: e?.message || "failed to load" } }));
    }
  }, [metaBinaries]);

  const downloadMetaFile = useCallback(async (repo: BuildRepo, file: MetaBinaryFile) => {
    setMetaBinaries((prev) => ({ ...prev, [repo.id]: { ...prev[repo.id]!, downloadingUrl: file.download_url } }));
    try {
      const res = await fetch("/api/build-forge/releases/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repo.owner,
          repo: repo.repoName,
          assetUrl: file.download_url,
          assetName: file.name,
          assetSize: file.size,
          kind: "binary",
          description: `${repo.name} / ${file.subdir} / ${file.name}`,
          tags: ["prebuilt", "per-file", file.subdir.split("/")[0] || "root"],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setMetaBinaries((prev) => ({ ...prev, [repo.id]: { ...prev[repo.id]!, downloadingUrl: null } }));
      fetchCollection();
      alert(json.message || "Download complete.");
    } catch (e: any) {
      setMetaBinaries((prev) => ({ ...prev, [repo.id]: { ...prev[repo.id]!, downloadingUrl: null } }));
      alert(`Download failed: ${e?.message || e}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMetaFilter = (repoId: string, filter: string) => {
    setMetaBinaries((prev) => prev[repoId] ? ({ ...prev, [repoId]: { ...prev[repoId], filter } }) : prev);
  };

  const downloadPrebuilt = useCallback(async (repo: BuildRepo, asset: PrebuiltAsset) => {
    setPrebuilts((prev) => ({ ...prev, [repo.id]: { ...prev[repo.id]!, downloadingUrl: asset.url } }));
    try {
      const res = await fetch("/api/build-forge/releases/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repo.owner,
          repo: repo.repoName,
          assetUrl: asset.url,
          assetName: asset.name,
          assetSize: asset.size,
          kind: asset.kind,
          description: repo.description,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPrebuilts((prev) => ({ ...prev, [repo.id]: { ...prev[repo.id]!, downloadingUrl: null } }));
      // Refresh the Collection tab's list so the new item shows up
      fetchCollection();
      alert(json.message || "Download complete.");
    } catch (e: any) {
      setPrebuilts((prev) => ({ ...prev, [repo.id]: { ...prev[repo.id]!, downloadingUrl: null } }));
      alert(`Download failed: ${e?.message || e}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Data fetching ────────────────────────────────────────────

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch("/api/build-forge/repos");
      const data = await res.json();
      setRepos(data.repos || []);
    } catch { /* ignore */ }
    setLoadingRepos(false);
  }, []);

  const fetchBuilds = useCallback(async () => {
    setLoadingBuilds(true);
    try {
      const res = await fetch("/api/build-forge/builds?limit=50");
      const data = await res.json();
      setBuilds(data.builds || []);
    } catch { /* ignore */ }
    setLoadingBuilds(false);
  }, []);

  const fetchCollection = useCallback(async () => {
    setLoadingCollection(true);
    try {
      const res = await fetch("/api/build-forge/binary-collection");
      const data = await res.json();
      setCollection(data.items || []);
    } catch { /* ignore */ }
    setLoadingCollection(false);
  }, []);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);
  useEffect(() => {
    if (activeTab === "builds") fetchBuilds();
    if (activeTab === "collection") fetchCollection();
  }, [activeTab, fetchBuilds, fetchCollection]);

  // Poll running builds
  useEffect(() => {
    const hasRunning = builds.some((b) => b.status === "running" || b.status === "queued");
    if (!hasRunning) return;
    const interval = setInterval(() => { fetchBuilds(); fetchRepos(); }, 3000);
    return () => clearInterval(interval);
  }, [builds, fetchBuilds, fetchRepos]);

  // ── GitHub search ────────────────────────────────────────────

  const searchGitHub = useCallback(async () => {
    if (searchQuery.length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/build-forge/github-search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      setSearchResults(data.repos || []);
    } catch { /* ignore */ }
    setSearching(false);
  }, [searchQuery]);

  useEffect(() => {
    if (!showSearch || searchQuery.length < 2) return;
    const timer = setTimeout(searchGitHub, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, showSearch, searchGitHub]);

  // ── Actions ──────────────────────────────────────────────────

  const addRepo = async (ghRepo: GitHubSearchResult) => {
    try {
      const res = await fetch("/api/build-forge/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: ghRepo.owner,
          repoName: ghRepo.name,
          gitUrl: ghRepo.clone_url,
          description: ghRepo.description,
          language: ghRepo.language,
          defaultBranch: ghRepo.default_branch,
          visibility: ghRepo.visibility,
          avatarUrl: ghRepo.avatar_url,
          stars: ghRepo.stars,
        }),
      });
      if (res.ok) {
        setShowSearch(false);
        setSearchQuery("");
        setSearchResults([]);
        fetchRepos();
      }
    } catch { /* ignore */ }
  };

  const triggerBuild = async () => {
    if (!buildDialog || !buildTarget) return;
    setTriggeringBuild(true);
    try {
      await fetch("/api/build-forge/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: buildDialog.id,
          target: buildTarget,
          branch: buildBranch || buildDialog.defaultBranch,
          environment: buildEnv,
          architecture: buildArch,
          buildProfile,
        }),
      });
      setBuildDialog(null);
      setActiveTab("builds");
      fetchBuilds();
    } catch { /* ignore */ }
    setTriggeringBuild(false);
  };

  const openBuildDialog = (repo: BuildRepo) => {
    setBuildDialog(repo);
    setBuildTarget(repo.targets[0]?.name || "");
    setBuildBranch(repo.defaultBranch);
    setBuildEnv(repo.defaultEnvironment || "linux");
    setBuildArch(repo.defaultArch || "x64");
    setBuildProfile("release");
  };

  const downloadBuild = (buildId: string) => {
    window.open(`/api/build-forge/builds/${buildId}/download`, "_blank");
  };

  const saveToCollection = async (buildId: string) => {
    setSavingBuildId(buildId);
    try {
      const res = await fetch(`/api/build-forge/builds/${buildId}/save-to-collection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok || res.status === 409) {
        fetchBuilds();
        fetchCollection();
      }
    } catch { /* ignore */ }
    setSavingBuildId(null);
  };

  const showInFileSystem = async (buildId: string) => {
    const build = builds.find((b) => b.id === buildId);
    if (build?.artifactPath) {
      try {
        await navigator.clipboard.writeText(build.artifactPath);
      } catch { /* ignore */ }
      alert(`Artifact path (copied to clipboard):\n\n${build.artifactPath}`);
    }
  };

  const removeFromCollection = async (itemId: string) => {
    await fetch(`/api/build-forge/binary-collection/${itemId}`, { method: "DELETE" });
    fetchCollection();
    fetchBuilds();
  };

  const downloadCollectionItem = (itemId: string) => {
    window.open(`/api/build-forge/binary-collection/${itemId}?download`, "_blank");
  };

  // ── Helpers ──────────────────────────────────────────────────

  const getLatestSuccessBuild = (repo: BuildRepo): BuildRecord | null => {
    return repo.builds.find((b) => b.status === "success") || null;
  };

  // ── Stats ────────────────────────────────────────────────────

  const totalRepos = repos.length;
  const totalBuilds = builds.length;
  const successBuilds = builds.filter((b) => b.status === "success").length;
  const collectionCount = collection.length;

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Build Forge</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search GitHub repos, compile binaries on demand, and manage your binary collection for simulation testing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { fetchRepos(); fetchBuilds(); fetchCollection(); }}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card-hover transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> Add Repository
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Repositories", value: totalRepos, color: "text-foreground", icon: GitFork },
          { label: "Total Builds", value: totalBuilds, color: "text-accent", icon: Package },
          { label: "Successful", value: successBuilds, color: "text-success", icon: CheckCircle2 },
          { label: "Binary Collection", value: collectionCount, color: "text-purple", icon: Archive },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-muted uppercase">{s.label}</p>
              <s.icon className={cn("h-4 w-4", s.color)} />
            </div>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "repos" as const, label: "Repositories" },
          { key: "builds" as const, label: "Build History" },
          { key: "collection" as const, label: "Binary Collection" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2",
              activeTab === tab.key
                ? "text-accent border-accent"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.key === "collection" && collectionCount > 0 && (
              <span className="ml-1.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                {collectionCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════ REPOS TAB ═══════════════════════════ */}
      {activeTab === "repos" && (
        <div className="space-y-3">
          {loadingRepos ? (
            <LoadingState />
          ) : repos.length === 0 ? (
            <EmptyState icon={Hammer} message='No repositories added yet. Click "Add Repository" to search GitHub and add repos to your build list.' />
          ) : (
            repos.map((repo) => {
              const latestSuccess = getLatestSuccessBuild(repo);
              return (
                <div key={repo.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  {/* Repo header row */}
                  <div className="flex items-center gap-4 p-4">
                    <button onClick={() => {
                      const next = expandedRepo === repo.id ? null : repo.id;
                      setExpandedRepo(next);
                      if (next) fetchPrebuilts(repo);
                    }}>
                      {expandedRepo === repo.id ? (
                        <ChevronDown className="h-4 w-4 text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted" />
                      )}
                    </button>

                    {repo.avatarUrl ? (
                      <img src={repo.avatarUrl} alt="" className="h-9 w-9 rounded-lg" />
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-accent/15 flex items-center justify-center">
                        <GitFork className="h-5 w-5 text-accent" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{repo.name}</span>
                        <span className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          repo.visibility === "public"
                            ? "bg-status-active/15 text-status-active border-status-active/30"
                            : "bg-status-draft/15 text-status-draft border-status-draft/30"
                        )}>
                          {repo.visibility}
                        </span>
                        {repo.language && (
                          <span className="inline-flex items-center rounded-full border border-border bg-transparent px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {repo.language}
                          </span>
                        )}
                        {/* Prebuilt availability badge — shows which kind of
                            prebuilt is on offer so users know at a glance. */}
                        {repo.prebuiltInfo?.available && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success"
                            title={
                              repo.prebuiltInfo.kind === "meta-repo"
                                ? "This repo IS a bundle of precompiled binaries — click Get prebuilt"
                                : repo.prebuiltInfo.kind === "release-assets"
                                  ? `GitHub Release ${repo.prebuiltInfo.tag || ""} has ${repo.prebuiltInfo.assetCount || 0} binary asset(s)`
                                  : "Prebuilt source zip available from default branch"
                            }
                          >
                            <Download className="h-3 w-3" /> Prebuilt
                            {repo.prebuiltInfo.kind === "meta-repo" && " bundle"}
                            {repo.prebuiltInfo.kind === "release-assets" && repo.prebuiltInfo.tag && ` ${repo.prebuiltInfo.tag}`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{repo.description}</p>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Star className="h-3 w-3" />
                      {repo.stars.toLocaleString()}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">{repo.targets.length} targets</span>

                      {/* Download button — only if a successful build exists */}
                      {latestSuccess && (
                        <button
                          onClick={() => downloadBuild(latestSuccess.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 transition-colors"
                          title={`Download ${latestSuccess.artifactName} (${formatSize(latestSuccess.artifactSize)})`}
                        >
                          <Download className="h-3 w-3" /> Download
                        </button>
                      )}

                      {/* Prebuilt action — differs by repo kind:
                          - meta-repo → "Browse binaries" (expand + show per-file picker)
                          - release-assets → "Get prebuilt" (one-click download of curated primary asset)
                      */}
                      {!latestSuccess && repo.prebuiltInfo?.available && repo.prebuiltInfo.kind === "meta-repo" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedRepo(repo.id);
                            fetchMetaBinaries(repo);
                            fetchPrebuilts(repo);
                          }}
                          className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 transition-colors"
                          title="Browse individual precompiled binaries in this repo"
                        >
                          <Download className="h-3 w-3" /> Browse binaries
                        </button>
                      )}
                      {!latestSuccess && repo.prebuiltInfo?.available && repo.prebuiltInfo.kind !== "meta-repo" && repo.prebuiltInfo.primaryAssetUrl && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadPrebuilt(repo, {
                              name: repo.prebuiltInfo!.primaryAssetName!,
                              url: repo.prebuiltInfo!.primaryAssetUrl!,
                              size: repo.prebuiltInfo!.primaryAssetSize || 0,
                              kind: "binary",
                            });
                          }}
                          className="flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/20 transition-colors"
                          title={`Download ${repo.prebuiltInfo.primaryAssetName} directly from GitHub${repo.prebuiltInfo.primaryAssetSize ? ` (${formatSize(repo.prebuiltInfo.primaryAssetSize)})` : ""}`}
                        >
                          <Download className="h-3 w-3" /> Get prebuilt
                        </button>
                      )}

                      <button
                        onClick={() => openBuildDialog(repo)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                          // Demote Build to secondary when a prebuilt is already available
                          (repo.prebuiltInfo?.available && !latestSuccess)
                            ? "border border-border text-foreground hover:bg-card-hover"
                            : "bg-accent text-white hover:bg-accent/90"
                        )}
                      >
                        <Play className="h-3 w-3" /> Build
                      </button>
                    </div>
                  </div>

                  {/* ── Expanded section ────────────────────────── */}
                  {expandedRepo === repo.id && (
                    <div className="border-t border-border bg-background/50 p-4 space-y-2">
                      {/* Meta-repo per-file binary browser (SharpCollection, etc.) */}
                      {repo.prebuiltInfo?.kind === "meta-repo" && (
                        <MetaBinariesPanel
                          repo={repo}
                          state={metaBinaries[repo.id]}
                          onLoad={() => fetchMetaBinaries(repo)}
                          onDownload={(f) => downloadMetaFile(repo, f)}
                          onFilter={(v) => setMetaFilter(repo.id, v)}
                        />
                      )}

                      {/* Prebuilt releases (lazy-fetched) */}
                      <PrebuiltReleasesPanel
                        repo={repo}
                        state={prebuilts[repo.id]}
                        onDownload={(asset) => downloadPrebuilt(repo, asset)}
                        onRetry={() => fetchPrebuilts(repo)}
                      />

                      {/* Build targets */}
                      <p className="text-[10px] font-semibold text-muted uppercase mb-2 mt-3">Build Targets</p>
                      {repo.targets.map((t) => (
                        <div key={t.name} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                          <div className="flex items-center gap-3">
                            <Box className="h-4 w-4 text-accent" />
                            <div>
                              <span className="text-sm font-medium text-foreground">{t.name}</span>
                              <p className="text-[11px] text-muted-foreground">{t.description}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {t.supported_environments.map((e) => (
                              <span key={e} className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                                {e}
                              </span>
                            ))}
                            <button
                              onClick={() => { openBuildDialog(repo); setBuildTarget(t.name); }}
                              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors"
                            >
                              <Play className="h-3 w-3" /> Build
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Recent builds with 3 action buttons */}
                      {repo.builds.length > 0 && (
                        <>
                          <p className="text-[10px] font-semibold text-muted uppercase mt-4 mb-2">Recent Builds</p>
                          {repo.builds.map((b) => (
                            <div key={b.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                              <div className="flex items-center gap-3">
                                <StatusIcon status={b.status} />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-foreground">{b.target}</span>
                                    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{b.branch}</span>
                                    <span className="text-[10px] text-muted-foreground">{b.environment}/{b.architecture}</span>
                                  </div>
                                  {b.status === "success" && b.artifactName && (
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                      {b.artifactName} ({formatSize(b.artifactSize)}) &middot; SHA256: {b.artifactHash.slice(0, 12)}...
                                    </p>
                                  )}
                                  {b.status === "failed" && b.errorSummary && (
                                    <p className="text-[11px] text-severity-high mt-0.5">{b.errorSummary.slice(0, 80)}</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {b.durationMs > 0 && (
                                  <span className="text-[10px] text-muted-foreground">{Math.round(b.durationMs / 1000)}s</span>
                                )}
                                <span className="text-[10px] text-muted-foreground">{new Date(b.startedAt).toLocaleString()}</span>

                                {/* ── 3 Action buttons for successful builds ── */}
                                {b.status === "success" && b.artifactName && (
                                  <div className="flex items-center gap-1 ml-2">
                                    {/* 1. Download */}
                                    <button
                                      onClick={() => downloadBuild(b.id)}
                                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-success hover:bg-success/10 transition-colors"
                                      title="Download binary"
                                    >
                                      <Download className="h-3 w-3" />
                                    </button>

                                    {/* 2. Save to Binary Collection */}
                                    <button
                                      onClick={() => saveToCollection(b.id)}
                                      disabled={b.savedToCollection || savingBuildId === b.id}
                                      className={cn(
                                        "flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors",
                                        b.savedToCollection
                                          ? "border-purple/30 bg-purple/10 text-purple cursor-default"
                                          : "border-border text-accent hover:bg-accent/10"
                                      )}
                                      title={b.savedToCollection ? "Saved to collection" : "Save to Binary Collection"}
                                    >
                                      {savingBuildId === b.id ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : b.savedToCollection ? (
                                        <CheckCircle2 className="h-3 w-3" />
                                      ) : (
                                        <BookmarkPlus className="h-3 w-3" />
                                      )}
                                    </button>

                                    {/* 3. Show in File System */}
                                    <button
                                      onClick={() => showInFileSystem(b.id)}
                                      className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors"
                                      title="Show binary in file system"
                                    >
                                      <FolderOpen className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ═══════════════════ BUILDS TAB ══════════════════════════ */}
      {activeTab === "builds" && (
        <div className="space-y-2">
          {loadingBuilds ? (
            <LoadingState />
          ) : builds.length === 0 ? (
            <EmptyState icon={Package} message="No builds yet. Trigger a build from the Repositories tab." />
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-background/50">
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase">Status</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase">Repository</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase">Target</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase">Branch</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase">Env / Arch</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase">Artifact</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted uppercase">Duration</th>
                    <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-muted uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {builds.map((b) => (
                    <tr key={b.id} className="border-b border-border last:border-0 hover:bg-card-hover/50 transition-colors">
                      <td className="px-4 py-3"><StatusIcon status={b.status} /></td>
                      <td className="px-4 py-3 text-foreground font-medium">{b.repo?.name || b.repoId.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{b.target}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{b.branch}</span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted-foreground">{b.environment} / {b.architecture}</td>
                      <td className="px-4 py-3">
                        {b.artifactName ? (
                          <div className="flex items-center gap-1.5">
                            <FileDown className="h-3 w-3 text-success" />
                            <span className="text-[11px] text-foreground">{b.artifactName}</span>
                            <span className="text-[10px] text-muted-foreground">({formatSize(b.artifactSize)})</span>
                          </div>
                        ) : b.status === "failed" ? (
                          <span className="text-[11px] text-severity-high" title={b.errorSummary}>{b.errorSummary?.slice(0, 40) || "Failed"}</span>
                        ) : b.status === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin text-accent" />
                        ) : (
                          <span className="text-[11px] text-muted-foreground">&mdash;</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted-foreground">{b.durationMs > 0 ? `${Math.round(b.durationMs / 1000)}s` : "—"}</td>
                      <td className="px-4 py-3">
                        {b.status === "success" && b.artifactName ? (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => downloadBuild(b.id)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-success hover:bg-success/10 transition-colors" title="Download">
                              <Download className="h-3 w-3" /> <span className="hidden xl:inline">Download</span>
                            </button>
                            <button
                              onClick={() => saveToCollection(b.id)}
                              disabled={b.savedToCollection || savingBuildId === b.id}
                              className={cn(
                                "flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-colors",
                                b.savedToCollection ? "border-purple/30 bg-purple/10 text-purple cursor-default" : "border-border text-accent hover:bg-accent/10"
                              )}
                              title={b.savedToCollection ? "Saved" : "Save to Collection"}
                            >
                              {savingBuildId === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : b.savedToCollection ? <CheckCircle2 className="h-3 w-3" /> : <BookmarkPlus className="h-3 w-3" />}
                              <span className="hidden xl:inline">{b.savedToCollection ? "Saved" : "Save"}</span>
                            </button>
                            <button onClick={() => showInFileSystem(b.id)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover transition-colors" title="Show in File System">
                              <FolderOpen className="h-3 w-3" />
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ BINARY COLLECTION TAB ═══════════════ */}
      {activeTab === "collection" && (
        <div className="space-y-3">
          {loadingCollection ? (
            <LoadingState />
          ) : collection.length === 0 ? (
            <EmptyState
              icon={Archive}
              message="No binaries saved yet. Build a repo and click the bookmark icon to save artifacts here for simulation testing."
            />
          ) : (
            <>
              {/* Info banner */}
              <div className="flex items-center gap-3 rounded-xl border border-accent/20 bg-accent/5 p-3">
                <Swords className="h-5 w-5 text-accent shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Binaries saved here are ready for adversary emulation, red-team simulation, and detection regression testing.
                </p>
              </div>

              {collection.map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-4">
                    {/* Icon */}
                    <div className="h-10 w-10 rounded-lg bg-purple/15 flex items-center justify-center shrink-0">
                      <HardDrive className="h-5 w-5 text-purple" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{item.name}</span>
                        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{item.target}</span>
                        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{item.environment}/{item.architecture}</span>
                        {item.language && (
                          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{item.language}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[11px] text-muted-foreground">{item.binaryName}</span>
                        <span className="text-[10px] text-muted-foreground">{formatSize(item.fileSize)}</span>
                        <span className="text-[10px] text-muted-foreground">from {item.repoName}</span>
                        <span className="text-[10px] text-muted-foreground">{item.branch}</span>
                        {item.commitSha && (
                          <span className="text-[10px] font-mono text-muted-foreground">{item.commitSha.slice(0, 8)}</span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">{item.description}</p>
                      )}
                      {/* Tags */}
                      {item.tags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5">
                          {item.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center rounded-full bg-accent/10 border border-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* SHA badge */}
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <ShieldCheck className="h-3 w-3 text-success" />
                        SHA256: {item.sha256.slice(0, 16)}...
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Saved {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => downloadCollectionItem(item.id)}
                        className="flex items-center gap-1 rounded-lg border border-success/30 bg-success/10 px-2.5 py-1.5 text-[11px] font-medium text-success hover:bg-success/20 transition-colors"
                        title="Download binary"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </button>
                      <button
                        onClick={() => removeFromCollection(item.id)}
                        className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-severity-high/10 hover:text-severity-high hover:border-severity-high/30 transition-colors"
                        title="Remove from collection"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ═══════════════════ GITHUB SEARCH MODAL ════════════════ */}
      {showSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm" onClick={() => setShowSearch(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-border p-4">
              <Search className="h-5 w-5 text-muted" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search GitHub repositories (e.g., osquery, sigma, caldera)..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
              />
              {searching && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {searchResults.length === 0 && searchQuery.length >= 2 && !searching ? (
                <p className="text-center text-sm text-muted-foreground py-8">No repositories found</p>
              ) : (
                searchResults.map((r) => {
                  const alreadyAdded = repos.some((rr) => rr.name === r.full_name);
                  return (
                    <div key={r.full_name} className="flex items-center gap-3 rounded-lg p-3 hover:bg-card-hover transition-colors">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" className="h-8 w-8 rounded-lg" />
                      ) : (
                        <div className="h-8 w-8 rounded-lg bg-accent/15 flex items-center justify-center">
                          <GitFork className="h-4 w-4 text-accent" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{r.full_name}</span>
                          {r.language && <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{r.language}</span>}
                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground"><Star className="h-3 w-3" /> {r.stars.toLocaleString()}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{r.description}</p>
                      </div>
                      {alreadyAdded ? (
                        <span className="flex items-center gap-1 text-[11px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Added</span>
                      ) : (
                        <button onClick={() => addRepo(r)} className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors">
                          <Plus className="h-3 w-3" /> Add
                        </button>
                      )}
                    </div>
                  );
                })
              )}
              {searchQuery.length < 2 && (
                <p className="text-center text-sm text-muted-foreground py-8">Type at least 2 characters to search GitHub</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════ BUILD CONFIG MODAL ═════════════════ */}
      {buildDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setBuildDialog(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-border p-4">
              <h2 className="text-lg font-semibold text-foreground">Build Configuration</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{buildDialog.name}</p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-muted uppercase">Target</label>
                <select value={buildTarget} onChange={(e) => setBuildTarget(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-input p-2 text-sm text-foreground focus:border-input-focus focus:outline-none">
                  {buildDialog.targets.map((t) => (<option key={t.name} value={t.name}>{t.name} — {t.description}</option>))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted uppercase">Branch</label>
                <input type="text" value={buildBranch} onChange={(e) => setBuildBranch(e.target.value)} placeholder={buildDialog.defaultBranch} className="mt-1 w-full rounded-lg border border-border bg-input p-2 text-sm text-foreground placeholder:text-muted focus:border-input-focus focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted uppercase flex items-center gap-1"><Monitor className="h-3 w-3" /> Environment</label>
                  <select value={buildEnv} onChange={(e) => setBuildEnv(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-input p-2 text-sm text-foreground focus:border-input-focus focus:outline-none">
                    {["linux", "windows", "macos", "docker", "k8s"].map((e) => (<option key={e} value={e}>{e}</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted uppercase flex items-center gap-1"><Cpu className="h-3 w-3" /> Architecture</label>
                  <select value={buildArch} onChange={(e) => setBuildArch(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-input p-2 text-sm text-foreground focus:border-input-focus focus:outline-none">
                    {["x64", "arm64"].map((a) => (<option key={a} value={a}>{a}</option>))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted uppercase flex items-center gap-1"><Terminal className="h-3 w-3" /> Build Profile</label>
                <div className="mt-1 flex gap-2">
                  {(["release", "debug"] as const).map((p) => (
                    <button key={p} onClick={() => setBuildProfile(p)} className={cn("rounded-lg border px-4 py-1.5 text-xs font-medium transition-colors", buildProfile === p ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:bg-card-hover")}>{p}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border p-4">
              <button onClick={() => setBuildDialog(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card-hover transition-colors">Cancel</button>
              <button onClick={triggerBuild} disabled={triggeringBuild || !buildTarget} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
                {triggeringBuild ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start Build
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared Components ──────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success": return <CheckCircle2 className="h-4 w-4 text-success" />;
    case "failed": return <XCircle className="h-4 w-4 text-severity-high" />;
    case "running": case "queued": return <Loader2 className="h-4 w-4 animate-spin text-accent" />;
    case "timeout": return <Clock className="h-4 w-4 text-severity-medium" />;
    default: return <Clock className="h-4 w-4 text-muted" />;
  }
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted" />
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-16">
      <Icon className="h-12 w-12 text-muted mb-4" />
      <p className="text-sm text-muted-foreground text-center max-w-md">{message}</p>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Prebuilt Releases panel ───────────────────────────────────────────────
// Shown inside the expanded section of a repo card. Fetches the repo's latest
// GitHub release lazily (when the card first expands) and lets the user
// download binary assets + source archives directly into the Binary Collection.

interface _PrebuiltAsset {
  name: string;
  size: number;
  url: string;
  kind: "binary" | "source-zip" | "source-tar" | "branch-zip";
  content_type?: string;
}
interface _PrebuiltState {
  status: "loading" | "ready" | "error";
  hasRelease?: boolean;
  release?: { tag: string; name: string | null; html_url: string; published_at: string } | null;
  assets?: _PrebuiltAsset[];
  error?: string;
  downloadingUrl?: string | null;
}

function PrebuiltReleasesPanel({
  repo, state, onDownload, onRetry,
}: {
  repo: { id: string; owner: string; repoName: string };
  state: _PrebuiltState | undefined;
  onDownload: (asset: _PrebuiltAsset) => void;
  onRetry: () => void;
}) {
  if (!state || state.status === "loading") {
    return (
      <div className="mb-2">
        <p className="text-[10px] font-semibold text-muted uppercase mb-2">Prebuilt Releases</p>
        <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking GitHub Releases…
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mb-2">
        <p className="text-[10px] font-semibold text-muted uppercase mb-2">Prebuilt Releases</p>
        <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Could not load releases: {state.error}</span>
          <button onClick={onRetry} className="text-accent hover:underline text-[11px]">Retry</button>
        </div>
      </div>
    );
  }

  const assets = state.assets || [];
  const binaries = assets.filter((a) => a.kind === "binary");
  const archives = assets.filter((a) => a.kind !== "binary");

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-muted uppercase">
          Prebuilt Releases
          {state.release ? (
            <span className="ml-2 normal-case text-[10px] text-muted-foreground">
              {state.release.tag}{state.release.name && state.release.name !== state.release.tag ? ` — ${state.release.name}` : ""}
            </span>
          ) : (
            <span className="ml-2 normal-case text-[10px] text-muted-foreground">no release; source only</span>
          )}
        </p>
        {state.release?.html_url && (
          <a href={state.release.html_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground hover:text-accent">
            View on GitHub ↗
          </a>
        )}
      </div>

      {binaries.length > 0 && (
        <div className="rounded-lg border border-border bg-card mb-2 overflow-hidden">
          <div className="max-h-56 overflow-y-auto divide-y divide-border/40">
            {binaries.map((a) => {
              const isDownloading = state.downloadingUrl === a.url;
              return (
                <div key={a.url} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-foreground truncate" title={a.name}>{a.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      binary · {formatSize(a.size)}
                    </p>
                  </div>
                  <button
                    onClick={() => onDownload(a)}
                    disabled={isDownloading}
                    className="ml-2 rounded border border-border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-card-hover disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    {isDownloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    {isDownloading ? "Downloading…" : "Use"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Source / branch archives — always shown as fallback */}
      {archives.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {archives.map((a) => {
            const isDownloading = state.downloadingUrl === a.url;
            const label =
              a.kind === "source-zip" ? "Source zip (release)"
              : a.kind === "source-tar" ? "Source tarball (release)"
              : "Branch archive zip";
            return (
              <div key={a.url} className="flex items-center justify-between px-3 py-2 text-xs border-b last:border-b-0 border-border/40">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-foreground truncate" title={a.name}>{a.name}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
                <button
                  onClick={() => onDownload(a)}
                  disabled={isDownloading}
                  className="ml-2 rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-card-hover disabled:opacity-40 inline-flex items-center gap-1"
                >
                  {isDownloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Download
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-1.5 italic">
        Already compiled? Download any binary above to skip Build. Saved into the Binary Collection tab.
      </p>
    </div>
  );
}

// ── Meta-binaries per-file picker (SharpCollection / Ghostpack-CompiledBinaries) ─
// Lists every individual .exe/.dll/.ps1/.py/.zip in the repo, grouped by
// sub-directory. User picks what they actually need instead of downloading
// the whole zip.

interface _MetaBinaryFile {
  path: string;
  name: string;
  subdir: string;
  ext: string;
  size: number;
  download_url: string;
}
interface _MetaBinaryState {
  status: "loading" | "ready" | "error";
  branch?: string;
  total?: number;
  truncated?: boolean;
  groups?: Record<string, _MetaBinaryFile[]>;
  error?: string;
  downloadingUrl?: string | null;
  filter?: string;
}

function MetaBinariesPanel({
  repo, state, onLoad, onDownload, onFilter,
}: {
  repo: { id: string; name: string; defaultBranch: string };
  state: _MetaBinaryState | undefined;
  onLoad: () => void;
  onDownload: (f: _MetaBinaryFile) => void;
  onFilter: (v: string) => void;
}) {
  // Auto-trigger load on first render of this panel
  React.useEffect(() => {
    if (!state) onLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filter = state?.filter || "";
  const filteredGroups: Record<string, _MetaBinaryFile[]> = {};
  let total = 0;
  if (state?.groups) {
    for (const [subdir, files] of Object.entries(state.groups)) {
      const matches = filter
        ? files.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()) || subdir.toLowerCase().includes(filter.toLowerCase()))
        : files;
      if (matches.length > 0) {
        filteredGroups[subdir] = matches;
        total += matches.length;
      }
    }
  }

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-muted uppercase">
          Precompiled Binaries
          {state?.total !== undefined && (
            <span className="ml-2 normal-case text-[10px] text-muted-foreground">
              {total}/{state.total} files
              {state.branch && ` · branch: ${state.branch}`}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            placeholder="Filter (e.g. Rubeus, 4.7, .exe)"
            className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-mono text-foreground placeholder:text-muted w-56"
          />
          <button
            onClick={onLoad}
            disabled={state?.status === "loading"}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50 px-1"
            title="Reload the file list from GitHub"
          >
            <RefreshCw className={cn("h-3 w-3", state?.status === "loading" && "animate-spin")} />
          </button>
        </div>
      </div>

      {(!state || state.status === "loading") && (
        <div className="rounded-lg border border-border bg-card p-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Listing binaries from GitHub…
        </div>
      )}

      {state?.status === "error" && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
          {state.error}
        </div>
      )}

      {state?.status === "ready" && total === 0 && (
        <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          No binaries match{filter ? ` "${filter}"` : ""}.
        </div>
      )}

      {state?.status === "ready" && total > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-hidden max-h-96 overflow-y-auto">
          {Object.entries(filteredGroups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([subdir, files]) => (
              <div key={subdir} className="border-b border-border/40 last:border-0">
                <div className="px-3 py-1.5 bg-background/50 text-[10px] font-semibold text-muted-foreground flex items-center justify-between">
                  <span>{subdir}</span>
                  <span className="text-[10px] text-muted">{files.length} file{files.length === 1 ? "" : "s"}</span>
                </div>
                {files.map((f) => {
                  const isDownloading = state.downloadingUrl === f.download_url;
                  return (
                    <div key={f.path} className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-card-hover">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-foreground truncate" title={f.path}>{f.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {f.ext.toUpperCase()} · {formatSize(f.size)}
                        </p>
                      </div>
                      <button
                        onClick={() => onDownload(f)}
                        disabled={isDownloading}
                        className="ml-2 rounded border border-border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-card-hover disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        {isDownloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                        {isDownloading ? "…" : "Use"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      )}

      {state?.truncated && (
        <p className="text-[10px] text-warning mt-1 italic">
          ⚠ List truncated by GitHub. Apply a filter to narrow results.
        </p>
      )}
    </div>
  );
}
