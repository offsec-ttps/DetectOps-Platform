"use client";

/**
 * xterm.js-based terminal that streams process output from our backend SSE
 * route at /api/detection-lab/cloud/terminal/sessions/[id]/stream.
 *
 * For the MVP this is a "command runner" not a real PTY: you type commands
 * (Enter sends the buffered line) and see output. Good enough for PurpleSharp
 * / Invoke-AtomicTest / `whoami` style use cases.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Info, Loader2, Terminal as TerminalIcon, X, Zap } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { SarArchitectureServer } from "@/types/sar";

interface Props {
  rangeId: string;
  serverName: string;
  /** Optional. If omitted, defaults to 10.0.2.{last_octet from arch lookup or 10}. */
  serverIp?: string;
  architecture?: SarArchitectureServer[];
  /** IP of the Guacamole-hosting server (from result.guacamole_info.host_ip). */
  guacamoleHostIp?: string;
  onClose?: () => void;
}

const TOOLS: { id: string; label: string; placeholder: string; }[] = [
  { id: "whoami",           label: "whoami+uname",     placeholder: "" },
  { id: "system-info",      label: "system info",      placeholder: "" },
  { id: "purplesharp",      label: "PurpleSharp",      placeholder: "T1003.001" },
  { id: "atomic-red-team",  label: "Atomic Red Team",  placeholder: "T1003.001" },
  { id: "rta",              label: "RTA",              placeholder: "windows_credential_access" },
];

export default function TerminalPanel({ rangeId, serverName, serverIp, architecture, guacamoleHostIp, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<{ write: (d: string) => void; onData: (cb: (d: string) => void) => void; dispose: () => void; clear: () => void } | null>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const inputBufferRef = useRef<string>("");
  const esRef = useRef<EventSource | null>(null);

  const [status, setStatus] = useState<"idle" | "connecting" | "running" | "exited" | "error">("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [tool, setTool] = useState(TOOLS[0].id);
  const [toolArg, setToolArg] = useState("");

  // Look up the target server's OS from the range architecture. Windows hosts
  // don't run SSH — they're WinRM / RDP targets — so this panel's shell + SSH
  // tool buttons are useless for them. We surface that explicitly below.
  const archServer = architecture?.find((a) => a.name === serverName);
  const isWindows = (archServer?.os_type || "").toLowerCase() === "windows";

  // Resolve server IP: prefer prop, else compute from architecture, else default.
  const resolvedIp = (() => {
    if (serverIp) return serverIp;
    if (archServer && typeof archServer.ip_last_octet === "number") return `10.0.2.${archServer.ip_last_octet}`;
    return "10.0.2.10";
  })();

  // Initialize xterm once on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof window === "undefined" || !containerRef.current) return;

      // Dynamic import so xterm + its CSS only load when this component mounts
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("xterm-addon-fit"),
      ]);
      await import("xterm/css/xterm.css");

      if (cancelled || !containerRef.current) return;

      const term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        theme: {
          background: "#0a0a0a",
          foreground: "#e5e5e5",
          cursor: "#a3e635",
          selectionBackground: "#334155",
          black: "#1f2937", red: "#ef4444", green: "#22c55e",
          yellow: "#eab308", blue: "#3b82f6", magenta: "#a855f7",
          cyan: "#06b6d4", white: "#e5e5e5",
        },
        rows: 18,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      xtermRef.current = {
        write: (d) => term.write(d),
        onData: (cb) => term.onData(cb),
        dispose: () => term.dispose(),
        clear: () => term.clear(),
      };
      fitRef.current = { fit: () => fit.fit() };
      term.writeln(`\x1b[90m[Terminal ready — select a tool or click "Start session" to open a shell on ${serverName} (${resolvedIp}).]\x1b[0m`);

      // Handle user input: buffer until Enter, then POST the line (+\n) to /input
      term.onData((d) => {
        if (!sessionIdRef.current) return;
        for (const ch of d) {
          if (ch === "\r" || ch === "\n") {
            const line = inputBufferRef.current + "\n";
            inputBufferRef.current = "";
            term.write("\r\n");
            sendInput(sessionIdRef.current, line);
          } else if (ch === "\x7f" || ch === "\b") {
            // Backspace
            if (inputBufferRef.current.length > 0) {
              inputBufferRef.current = inputBufferRef.current.slice(0, -1);
              term.write("\b \b");
            }
          } else if (ch === "\x03") {
            // Ctrl+C — send SIGINT by posting it as input; not ideal but enough
            term.write("^C\r\n");
            sendInput(sessionIdRef.current, "\x03");
            inputBufferRef.current = "";
          } else {
            inputBufferRef.current += ch;
            term.write(ch);
          }
        }
      });
    })();

    return () => {
      cancelled = true;
      xtermRef.current?.dispose();
      if (esRef.current) esRef.current.close();
      if (sessionIdRef.current) {
        // Best-effort kill
        fetch(`/api/detection-lab/cloud/terminal/sessions/${sessionIdRef.current}/kill`, { method: "POST" }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle window resize → refit
  useEffect(() => {
    const onResize = () => fitRef.current?.fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const sendInput = useCallback(async (sid: string, data: string) => {
    try {
      await fetch(`/api/detection-lab/cloud/terminal/sessions/${sid}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
    } catch { /* ignore */ }
  }, []);

  const attachStream = useCallback((sid: string) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    const es = new EventSource(`/api/detection-lab/cloud/terminal/sessions/${sid}/stream`);
    esRef.current = es;
    const term = xtermRef.current;
    if (!term) return;

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.type === "stdout" || payload.type === "stderr") {
          term.write(payload.data.replace(/\n/g, "\r\n"));
        } else if (payload.type === "info") {
          term.write(`\x1b[90m${payload.data.replace(/\n/g, "\r\n")}\x1b[0m`);
        } else if (payload.type === "exit") {
          term.write(`\r\n\x1b[90m[process exited with code ${payload.code ?? "?"}]\x1b[0m\r\n`);
          setStatus("exited");
          setExitCode(payload.code ?? null);
          es.close();
        }
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      setStatus("error");
      // Do NOT auto-close — let the user see the last lines
    };
  }, []);

  const startShell = useCallback(async () => {
    xtermRef.current?.clear();
    setStatus("connecting");
    setExitCode(null);
    try {
      const res = await fetch("/api/detection-lab/cloud/terminal/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rangeId, serverName, serverIp: resolvedIp }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "failed to create session");
      sessionIdRef.current = json.session_id;
      setStatus("running");
      attachStream(json.session_id);
    } catch (e: any) {
      xtermRef.current?.write(`\r\n\x1b[31m[error] ${e?.message || e}\x1b[0m\r\n`);
      setStatus("error");
    }
  }, [rangeId, serverName, resolvedIp, attachStream]);

  const runTool = useCallback(async () => {
    xtermRef.current?.clear();
    setStatus("connecting");
    setExitCode(null);
    try {
      const res = await fetch("/api/detection-lab/cloud/terminal/run-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rangeId, serverName, serverIp: resolvedIp, tool, arg: toolArg }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "failed to run tool");
      sessionIdRef.current = json.session_id;
      setStatus("running");
      attachStream(json.session_id);
    } catch (e: any) {
      xtermRef.current?.write(`\r\n\x1b[31m[error] ${e?.message || e}\x1b[0m\r\n`);
      setStatus("error");
    }
  }, [rangeId, serverName, resolvedIp, tool, toolArg, attachStream]);

  const killCurrent = useCallback(async () => {
    if (!sessionIdRef.current) return;
    await fetch(`/api/detection-lab/cloud/terminal/sessions/${sessionIdRef.current}/kill`, { method: "POST" }).catch(() => {});
    setStatus("exited");
  }, []);

  // Windows targets: SSH on :22 isn't available. Hand off to Guacamole for
  // interactive access and Campaign Designer for ART simulation.
  if (isWindows) {
    const guacUrl = guacamoleHostIp ? `http://${guacamoleHostIp}:8080` : null;
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/5 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-warning/30 bg-warning/10">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          <span className="text-xs font-semibold text-foreground">Windows host — SSH terminal not available</span>
          <code className="text-[11px] font-mono text-muted-foreground">{serverName} · {resolvedIp}</code>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            SAR's Windows hosts are reached via <strong>WinRM</strong> (for automation) and <strong>RDP</strong> (for interactive access).
            An SSH client cannot shell into them. Use one of the paths below.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-background p-3 space-y-2">
              <div className="text-xs font-semibold text-foreground">Interactive access</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Open the Windows desktop through Guacamole (web RDP) in your browser.
                Requires an active WireGuard tunnel.
              </p>
              {guacUrl ? (
                <a
                  href={guacUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:bg-accent/10 border border-accent/30 rounded px-2 py-1"
                >
                  Open Guacamole <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">Guacamole host IP not available from range status.</p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-background p-3 space-y-2">
              <div className="text-xs font-semibold text-foreground">Run Atomic Red Team</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                SAR's <code className="font-mono">/attack-range/simulate</code> endpoint runs ART techniques
                over WinRM. Use it via Campaign Designer.
              </p>
              <Link
                href={`/campaign-designer?target=${encodeURIComponent(rangeId)}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:bg-accent/10 border border-accent/30 rounded px-2 py-1"
              >
                Go to Campaign Designer <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-card">
        <TerminalIcon className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-semibold text-foreground">{serverName}</span>
        <code className="text-[11px] font-mono text-muted-foreground">{resolvedIp}</code>
        <StatusChip status={status} exitCode={exitCode} />

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select
            value={tool} onChange={(e) => setTool(e.target.value)}
            className="text-[11px] rounded border border-border bg-background px-2 py-1"
          >
            {TOOLS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <input
            value={toolArg} onChange={(e) => setToolArg(e.target.value)}
            placeholder={TOOLS.find((t) => t.id === tool)?.placeholder || "arg"}
            className="text-[11px] font-mono rounded border border-border bg-background px-2 py-1 w-32"
          />
          <button
            onClick={runTool}
            disabled={status === "connecting" || status === "running"}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:bg-accent/10 border border-accent/30 rounded px-2 py-1 disabled:opacity-40"
          >
            <Zap className="h-3 w-3" /> Run tool
          </button>
          <div className="h-4 w-px bg-border mx-1" />
          <button
            onClick={startShell}
            disabled={status === "connecting" || status === "running"}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground hover:bg-card-hover border border-border rounded px-2 py-1 disabled:opacity-40"
          >
            Start shell
          </button>
          {status === "running" && (
            <button
              onClick={killCurrent}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-danger hover:bg-danger/5 border border-danger/30 rounded px-2 py-1"
            >
              Kill
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              title="Close terminal"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="h-[360px] bg-[#0a0a0a] p-2"
      />

      <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-card border-t border-border">
        Line-buffered: type a command, press Enter to send. Requires WireGuard tunnel. Runs via SAR's SSH keys.
      </div>
    </div>
  );
}

function StatusChip({ status, exitCode }: { status: string; exitCode: number | null }) {
  const cls = status === "running" ? "text-success bg-success/10 border-success/30"
            : status === "connecting" ? "text-accent bg-accent/10 border-accent/30"
            : status === "error" ? "text-danger bg-danger/10 border-danger/30"
            : status === "exited" ? "text-muted-foreground bg-muted/10 border-border"
            : "text-muted-foreground bg-muted/10 border-border";
  const label = status === "exited" && exitCode !== null ? `exited (${exitCode})` : status;
  return (
    <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1", cls)}>
      {status === "connecting" && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </span>
  );
}
