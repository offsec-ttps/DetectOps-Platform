#!/usr/bin/env python3
"""
Enterprise coverage-assessment report pipeline.

Reads a BAS sweep result file (JSONL: one record per atomic with
tech/num/tactic/status/executed/observed/vis_bucket/indicators) plus branding,
aggregates coverage by ATT&CK tactic and by simulation library, and writes TWO
branded reports — an Executive Summary and a Detailed Technical Report — each as
Markdown then DOCX (pandoc, with a table of contents) and PDF (LibreOffice).

Both reports open with a branded cover (brand + client) and a table of contents.
The technical report additionally lists, per executed atomic, the command that
ran, whether it was detected / indeterminate / a blind spot, and — keyed to the
SIEM that is actually installed (Splunk SPL or MDE KQL) — how to close each gap.

Usage:
  python3 scripts/generate_assessment_report.py \
      --results sweep.jsonl --out reports/coverage/<id>/report \
      --brand DetectOps --assessor RuSecure --client "SAR Lab (Internal)" \
      --lab "SAR Minimal" --siem splunk --report-type both

Outputs (report-type=both): <out>-executive.{md,docx,pdf} and
<out>-technical.{md,docx,pdf}.
"""
import argparse, json, os, subprocess, sqlite3, collections, datetime, shutil, re


# ── Markdown-injection hardening ─────────────────────────────────────────────
# Atomic commands / indicators / names come from the atomic library (community
# content + user custom atomics) and must never be able to alter the Markdown
# structure — otherwise a poisoned atomic could inject an image/link that makes
# pandoc fetch a URL (SSRF) or embed a local file into the client-facing report.
def esc(s):
    """Escape an untrusted value for an inline / table-cell context."""
    s = str(s if s is not None else "")
    s = s.replace("\\", "\\\\")
    for ch in "`*_[]<>|~":
        s = s.replace(ch, "\\" + ch)
    return s.replace("\r", " ").replace("\n", " ")


def code_inline(s):
    """Inline code span that can't break out via backticks in the content."""
    s = str(s if s is not None else "").replace("\r", " ").replace("\n", " ")
    n = max((len(r) for r in re.findall(r"`+", s)), default=0) + 1
    pad = " " if (s.startswith("`") or s.endswith("`")) else ""
    return f"{'`' * n}{pad}{s}{pad}{'`' * n}"


def code_block(s):
    """Fenced code block with a fence longer than any backtick run inside, so
    content can't terminate the block early and resume as Markdown."""
    s = str(s if s is not None else "")
    n = max(max((len(r) for r in re.findall(r"`+", s)), default=0) + 1, 3)
    fence = "`" * n
    return f"{fence}\n{s}\n{fence}"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_MODULES = {
    "Active Directory": "detectops.ad-attack", "Hacktools": "detectops.hacktools",
    "Privilege Escalation": "detectops.privesc", "Lateral Movement": "detectops.lateral-movement",
    "UAC Bypass": "detectops.uac-bypass", "User to Admin": "detectops.user-to-admin",
    "User to SYSTEM": "detectops.user-to-system",
    "Process Injection": "detectops.process-injection-sim", "Shellcode Injection": "detectops.shellcode-injection-sim",
}


def load_results(path):
    rows = []
    for line in open(path):
        try: rows.append(json.loads(line))
        except Exception: pass
    return rows


def library_techniques():
    """technique-id -> set of library names, from each module's manifest catalog."""
    m = collections.defaultdict(set)
    try:
        con = sqlite3.connect(f"{ROOT}/dev.db")
        for lib, mid in LIB_MODULES.items():
            r = con.execute("SELECT manifest FROM simulation_modules WHERE moduleId=?", (mid,)).fetchone()
            if not r: continue
            cat = json.loads(r[0]).get("contributes", {}).get("catalog", [])
            for g in cat:
                for t in g.get("techniques", []):
                    m[t["id"]].add(lib)
            # Analyst-added library entries (Module Builder) for this module.
            try:
                for (d,) in con.execute("SELECT doc FROM library_entries WHERE moduleId=? AND status='published' AND kind='technique'", (mid,)):
                    e = json.loads(d)
                    # Same rule as lib/library-entries/store.ts entryCatalogItems():
                    # linked atomics contribute their technique ids; a coverage-only
                    # entry (atomics: []) contributes its attack_id.
                    linked = [a["technique"] for a in (e.get("atomics") or []) if a.get("technique")]
                    for tid in (linked or ([e["attack_id"]] if e.get("attack_id") else [])):
                        m[tid].add(lib)
            except Exception:
                pass
        con.close()
    except Exception:
        pass
    return m


def load_commands():
    """(techniqueId, testNumber) -> (command, executor) from the atomic library."""
    m = {}
    try:
        con = sqlite3.connect(f"{ROOT}/dev.db")
        for tech, num, cmd, ex in con.execute(
                "SELECT techniqueId, testNumber, command, executorName FROM atomic_tests"):
            m[(tech, int(num))] = (cmd or "", ex or "")
        con.close()
    except Exception:
        pass
    return m


def pct(n, d): return 0 if not d else round(100 * n / d)


def visibility_buckets(executed):
    have = [r for r in executed if r.get("vis_bucket")]
    if not have:
        return None
    b = collections.Counter(r["vis_bucket"] for r in have)
    return {"visible": b.get("visible", 0), "generic-only": b.get("generic-only", 0),
            "absent": b.get("absent", 0), "total": len(have)}


def bucketed(runnable, keyfn):
    agg = collections.defaultdict(lambda: collections.Counter())
    for r in runnable:
        for k in keyfn(r):
            agg[k]["atomics"] += 1
            if r.get("executed"): agg[k]["exec"] += 1
            b = r.get("vis_bucket")
            if b: agg[k][b] += 1
    return agg


# ── SIEM-specific "how to detect this" guidance ──────────────────────────────
def siem_reco(r, siem):
    """A copy-pasteable detection query for the SIEM that is installed, keyed to
    the atomic's distinctive indicator and technique."""
    inds = [i for i in (r.get("indicators") or []) if i]
    ind = inds[0] if inds else (r.get("name", "") or "activity")
    # The query is emitted inside an inline code span — strip backticks/newlines
    # and quotes so a poisoned indicator can't break out of it.
    ind = re.sub(r'[`"\r\n]', "", str(ind))[:80]
    low = (" ".join(inds) + " " + (r.get("name", "") or "")).lower()
    tech = (r.get("tech", "") or "")
    s = (siem or "splunk").lower()
    kql = s in ("mde", "kql") or "defender" in s or "sentinel" in s or "kusto" in s
    if kql:
        if any(k in low for k in ["hkcu", "hklm", "registry", "software\\", "disablereal", "uacdisable", "subkey", "mppreference"]):
            return (f"`DeviceRegistryEvents | where RegistryKey has \"{ind}\" or RegistryValueName has \"{ind}\"` — "
                    "needs registry auditing in Defender advanced hunting.")
        if any(k in low for k in ["new-", "get-", "set-", ".ps1", "invoke-", "format-table", "powershell"]):
            return f"`DeviceEvents | where ActionType == \"PowerShellCommand\" | where AdditionalFields has \"{ind}\"` (script-block logging)."
        return f"`DeviceProcessEvents | where ProcessCommandLine has \"{ind}\" or FileName has \"{ind}\"`."
    # default: Splunk SPL
    if any(k in low for k in ["hkcu", "hklm", "registry", "software\\", "disablereal", "uacdisable", "subkey", "mppreference"]):
        return (f"`index=* source=WinEventLog:* EventCode IN (12,13) TargetObject=\"*{ind}*\"` — "
                "requires **Sysmon registry auditing (Event ID 12/13)**.")
    if any(k in low for k in ["new-", "get-", "set-", ".ps1", "invoke-", "format-table", "new-localuser", "new-vm"]):
        return (f"`index=* EventCode=4104 ScriptBlockText=\"*{ind}*\"` — "
                "requires **PowerShell Script Block Logging (Event ID 4104)**.")
    if "service" in low or "new-service" in low or tech.startswith("T1543"):
        return f"`index=* EventCode=7045 Service_File_Name=\"*{ind}*\"` — **Service install (Event ID 7045)**."
    if any(k in low for k in [".dll", ".exe", "rundll32", "mmc.exe", "routethecall"]):
        return (f"`index=* EventCode IN (1,4688) (Image=\"*{ind}*\" OR CommandLine=\"*{ind}*\")` — "
                "requires **Sysmon process creation (EID 1)** or **Security 4688 command-line auditing**.")
    return (f"`index=* (CommandLine=\"*{ind}*\" OR process=\"*{ind}*\")` — "
            "ensure process + command-line logging (Sysmon EID 1 / Security 4688).")


def evids(r):
    """Human label of the real Windows Event IDs + log sources observed carrying
    this atomic's indicator in the SIEM re-query. '—' when none were captured."""
    codes = [str(c) for c in (r.get("event_codes") or []) if str(c).strip()]
    srcs = [str(s) for s in (r.get("sources") or []) if str(s).strip()]
    if not codes and not srcs:
        return "—"
    parts = []
    if codes: parts.append("EID " + ", ".join(codes[:6]))
    if srcs: parts.append(" / ".join(srcs[:3]))
    return esc("  ·  ".join(parts))


def _sigma_logsource_and_sel(r):
    """(logsource-block, selection-block) for a Sigma rule, chosen from the REAL
    observed Event IDs when present, else from the technique/indicator heuristic."""
    inds = [i for i in (r.get("indicators") or []) if i]
    raw = str(inds[0] if inds else (r.get("name", "") or "activity"))
    ind = re.sub(r'[`"\r\n]', "", raw)[:80]
    tech = (r.get("tech", "") or "")
    low = (" ".join(inds) + " " + (r.get("name", "") or "")).lower()
    obs = set(str(c) for c in (r.get("event_codes") or []))
    reg_kw = ["hkcu", "hklm", "registry", "software\\", "mppreference", "uacdisable", "disablereal", "subkey"]
    ps_kw = ["powershell", "invoke-", ".ps1", "new-", "set-", "get-", "format-table"]
    if (obs & {"12", "13"}) or any(k in low for k in reg_kw):
        return ("    product: windows\n    category: registry_set",
                "        TargetObject|contains: '" + ind + "'")
    if ("4104" in obs) or any(k in low for k in ps_kw):
        return ("    product: windows\n    category: ps_script",
                "        ScriptBlockText|contains: '" + ind + "'")
    if ("7045" in obs) or tech.startswith("T1543") or "service" in low:
        return ("    product: windows\n    service: system",
                "        EventID: 7045\n        ServiceFileName|contains: '" + ind + "'")
    return ("    product: windows\n    category: process_creation",
            "        CommandLine|contains: '" + ind + "'")


def sigma_rule(r):
    """A minimal, deployable Sigma rule keyed to the atomic's distinctive indicator
    and the Windows log that should carry it — the rule to ship once the telemetry
    gap is closed (or to document an existing detection)."""
    logsrc, sel = _sigma_logsource_and_sel(r)
    tech = (r.get("tech", "") or "")
    name = re.sub(r"[\"':]", "", (r.get("name", "") or ""))[:60].strip()
    title = (tech + " " + name).strip() or "Atomic detection"
    tag = ("attack." + tech.lower()) if tech else "attack.execution"
    yml = ("title: " + title + "\n"
           "status: experimental\n"
           "description: Distinctive indicator of " + (tech or "the technique") + " seen during adversary simulation.\n"
           "logsource:\n" + logsrc + "\n"
           "detection:\n    selection:\n" + sel + "\n    condition: selection\n"
           "tags:\n    - " + tag + "\n"
           "level: medium")
    return yml


def siem_label(siem):
    s = (siem or "splunk").lower()
    if s in ("mde", "kql") or "defender" in s: return "Microsoft Defender for Endpoint (KQL)"
    if "sentinel" in s: return "Microsoft Sentinel (KQL)"
    return "Splunk (SPL)"


# ── References ───────────────────────────────────────────────────────────────
def mitre_url(tech):
    """Canonical MITRE ATT&CK technique page (handles sub-techniques Txxxx.yyy)."""
    t = re.sub(r"[^T0-9.]", "", str(tech or ""))
    if not re.match(r"^T\d{4}", t): return "https://attack.mitre.org/techniques/"
    return "https://attack.mitre.org/techniques/" + t.replace(".", "/")


# Telemetry-source documentation, keyed to the Windows log the recommendation relies on.
TELEMETRY_REFS = {
    "sysmon_proc": ("Sysmon EID 1 — Process creation (command line)", "https://learn.microsoft.com/sysinternals/downloads/sysmon#event-id-1-process-creation"),
    "sysmon_reg":  ("Sysmon EID 12/13 — Registry add/set", "https://learn.microsoft.com/sysinternals/downloads/sysmon#event-id-12-registryevent-object-createdelete"),
    "sysmon_file": ("Sysmon EID 11 — File create", "https://learn.microsoft.com/sysinternals/downloads/sysmon#event-id-11-filecreate"),
    "ps_sbl":      ("PowerShell Script Block Logging — EID 4104", "https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_logging_windows"),
    "sec_4688":    ("Security EID 4688 — Process creation + command line auditing", "https://learn.microsoft.com/windows-server/identity/ad-ds/manage/component-updates/command-line-process-auditing"),
    "svc_7045":    ("Security/System EID 7045 — Service installed", "https://learn.microsoft.com/windows/security/threat-protection/auditing/event-7045"),
    "schtask":     ("Security EID 4698 — Scheduled task created", "https://learn.microsoft.com/windows/security/threat-protection/auditing/event-4698"),
}

def telemetry_ref(r):
    """Pick the telemetry doc that matches the recommended detection for this row."""
    inds = [i for i in (r.get("indicators") or []) if i]
    low = (" ".join(inds) + " " + (r.get("name", "") or "") + " " + " ".join(str(c) for c in (r.get("event_codes") or []))).lower()
    tech = (r.get("tech", "") or "")
    if any(k in low for k in ["12", "13", "hkcu", "hklm", "registry", "software\\", "mppreference", "uacdisable"]): return TELEMETRY_REFS["sysmon_reg"]
    if any(k in low for k in ["4104", "powershell", "invoke-", ".ps1", "scriptblock"]): return TELEMETRY_REFS["ps_sbl"]
    if "7045" in low or "service" in low or tech.startswith("T1543"): return TELEMETRY_REFS["svc_7045"]
    if "4698" in low or "schtask" in low or tech.startswith("T1053"): return TELEMETRY_REFS["schtask"]
    if "11" in low or ".dll" in low or "filecreate" in low: return TELEMETRY_REFS["sysmon_file"]
    return TELEMETRY_REFS["sec_4688"]


def finding_block(r, cmds, siem, libmap):
    """A complete, SOC-implementable finding for ONE simulation: what ran (command),
    what was detected, what was missed, how to remediate, and references."""
    tech = r.get("tech", ""); num = r.get("num", "")
    key = (tech, int(num) if str(num).isdigit() else 1)
    cmd, ex = cmds.get(key, ("", ""))
    lib = r.get("library") or ", ".join(list(libmap.get(tech, ()))[:1]) or "—"
    tactic = (r.get("tactic") or "").replace("-", " ").title()
    status = r.get("status", ""); b = r.get("vis_bucket", "")
    inds = [i for i in (r.get("indicators") or []) if i]
    mref = mitre_url(tech); tref = telemetry_ref(r)
    L = [f"#### {esc(tech)} #{esc(num)} — {esc(r.get('name',''))}\n"]
    L.append(f"- **Tactic / Library:** {esc(tactic) or '—'} · {esc(lib)}   **Executor:** {esc(ex or '—')}")
    # What was SIMULATED
    if cmd:
        L.append("- **Simulated — command executed:**")
        L.append(""); L.append(code_block(cmd.strip()[:800])); L.append("")
    else:
        L.append("- **Simulated:** (command not in local catalogue)")
    # Outcome: detected / missed / not simulated
    if status == "n/a":
        L.append("- **Result:** ⚠️ **Not simulated** — the test is not present in the host's Atomic Red Team install.")
        L.append(f"- **Remediation:** update the atomics folder on the lab host (`Install-AtomicRedTeam -getAtomics -Force`) and re-run; or treat as catalogue-only.")
    elif not r.get("executed"):
        tail = re.sub(r"\s+", " ", str(r.get("tail", "")))[:160]
        L.append(f"- **Result:** ❌ **Not simulated** — the atomic did not execute. Detail: {code_inline(tail or 'no output within the per-atomic timeout')}")
        L.append("- **Remediation:** re-run with a longer per-atomic timeout; satisfy prerequisites (`-GetPrereqs`); some atomics need elevation / a domain / interactive session.")
    elif b == "visible":
        L.append(f"- **Detected:** ✅ distinctive indicator reached the SIEM — {code_inline(', '.join(inds[:3]) or 'indicator')}  ·  observed on **{evids(r)}**")
        L.append("- **Missed:** nothing — this activity is detectable with a rule keyed to the indicator above.")
        L.append(f"- **Maintain the detection ({esc(siem_label(siem))}):** {siem_reco(r, siem)}")
        L.append("- **Deployable Sigma:**"); L.append(""); L.append(code_block(sigma_rule(r))); L.append("")
    else:  # generic-only or absent
        if b == "generic-only":
            L.append(f"- **Detected:** ➖ only **generic process telemetry** (e.g. `powershell.exe`/`cmd.exe`) — not the distinctive indicator {code_inline(', '.join(inds[:3]) or '(none extracted)')}.")
            L.append("- **Missed:** the specific artefact that identifies THIS technique never reached the SIEM, so a precise rule cannot fire (a broad rule would be noisy).")
        else:
            L.append("- **Detected:** ❌ **blind spot** — the atomic ran but produced no matching telemetry in the SIEM.")
            L.append("- **Missed:** no attributable event for this activity at all.")
        L.append(f"- **Remediation — enable telemetry:** {tref[0]} (and forward it to the SIEM).")
        L.append(f"- **Remediation — detection ({esc(siem_label(siem))}):** {siem_reco(r, siem)}")
        L.append("- **Deployable Sigma (fires once the telemetry is flowing):**"); L.append(""); L.append(code_block(sigma_rule(r))); L.append("")
    L.append(f"- **References:** [MITRE ATT&CK {esc(tech)}]({mref}) · [{esc(tref[0])}]({tref[1]})\n")
    return "\n".join(L)


def cover(brand, client, assessor, lab, siem, title, today):
    brand, client, assessor, lab = esc(brand), esc(client), esc(assessor), esc(lab)
    L = [f"# {brand} — {title}", ""]
    L.append(f"### Prepared for: {client}")
    L.append("")
    L.append("| | |")
    L.append("|---|---|")
    L.append(f"| **Client** | {client} |")
    L.append(f"| **Prepared by** | {assessor} |")
    L.append(f"| **Generated with** | DetectOps |")
    L.append(f"| **Environment** | {lab} |")
    L.append(f"| **SIEM** | {esc(siem_label(siem))} |")
    L.append(f"| **Date** | {today} |")
    L.append("")
    return L


def toc(entries):
    L = ["## Table of contents", ""]
    for i, e in enumerate(entries, 1):
        L.append(f"{i}. {e}")
    L.append("")
    return L


def headline_table(runnable, executed, buckets, na):
    L = ["| Metric | Result |", "|---|---|"]
    L.append(f"| Atomics attempted (Windows, non-destructive, on-host) | {len(runnable)} |")
    L.append(f"| Executed on the endpoint | **{len(executed)} / {len(runnable)} ({pct(len(executed), len(runnable))}%)** |")
    if buckets:
        denom = buckets["visible"] + buckets["absent"]
        L.append(f"| **Telemetry-visible in SIEM (detectable)** | **{buckets['visible']} / {denom} ({pct(buckets['visible'], denom)}%)** |")
        L.append(f"| Attribution indeterminate (generic shell only) | {buckets['generic-only']} |")
        L.append(f"| **Telemetry blind spots (ran, no log)** | **{buckets['absent']}** |")
    if na:
        L.append(f"| Skipped (not applicable) | {na} |")
    L.append("")
    return L


def tactic_table(runnable, buckets):
    L = []
    if buckets:
        L.append("| Tactic | Atomics | Executed | Visible | Indeterminate | Blind | Visibility |")
        L.append("|---|---|---|---|---|---|---|")
        agg = bucketed(runnable, lambda r: [(r.get("tactic") or "other").replace("-", " ").title()])
        for t in sorted(agg, key=lambda k: -agg[k]["atomics"]):
            c = agg[t]; denom = c["visible"] + c["absent"]
            L.append(f"| {esc(t)} | {c['atomics']} | {c['exec']} | {c['visible']} | {c['generic-only']} | {c['absent']} | {pct(c['visible'], denom)}% |")
        L.append("")
    return L


# ── Executive Summary ────────────────────────────────────────────────────────
def executive_report(rows, runnable, executed, buckets, na, args, today):
    L = cover(args.brand, args.client, args.assessor, args.lab, args.siem, "Detection Coverage — Executive Summary", today)
    L += toc(["Table of contents", "Engagement at a glance", "Detection posture",
              "Top detection gaps", "Priority recommendations"])
    L.append("## Engagement at a glance\n")
    L.append(f"{args.assessor} executed a detection-coverage assessment against **{args.client}**'s "
             f"**{args.lab}** environment, detonating {len(runnable)} Windows atomic tests on the endpoint "
             f"and measuring, for each, whether its activity became **visible in the SIEM "
             f"({siem_label(args.siem)})** — the prerequisite for a detection. Destructive and "
             "credential-dumping atomics were excluded to preserve the lab.\n")
    L += headline_table(runnable, executed, buckets, na)
    if buckets:
        denom = buckets["visible"] + buckets["absent"]
        vis = pct(buckets["visible"], denom)
        rating = ("Strong" if vis >= 90 else "Moderate" if vis >= 70 else "Developing" if vis >= 50 else "Weak")
        L.append("## Detection posture\n")
        L.append(f"**Overall telemetry visibility: {vis}%** — _{rating}_. "
                 f"Of {denom} atomics that emitted a distinctive, attributable indicator, "
                 f"{buckets['visible']} reached the SIEM and {buckets['absent']} did not "
                 f"(**{buckets['absent']} blind spots**). {buckets['generic-only']} further atomics produced only "
                 "generic shell telemetry and are indeterminate (not counted for or against visibility).\n")
    # top gaps = blind spots grouped by tactic
    blind = [r for r in executed if r.get("vis_bucket") == "absent"]
    L.append("## Top detection gaps\n")
    if blind:
        bt = collections.Counter((r.get("tactic") or "other").replace("-", " ").title() for r in blind)
        L.append("| Tactic | Blind spots |")
        L.append("|---|---|")
        for t, n in bt.most_common(8):
            L.append(f"| {esc(t)} | {n} |")
        L.append("")
        L.append("Representative gaps: " + "; ".join(
            f"{code_inline(r['tech'])} {esc(r.get('name','')[:48])}" for r in blind[:5]) + ".\n")
    else:
        L.append("No telemetry blind spots — every executed atomic with a distinctive indicator reached the SIEM.\n")
    L.append("## Priority recommendations\n")
    L.append(f"1. **Close the {len(blind)} blind spots** itemised in the technical report — each lists a "
             f"ready-to-deploy {siem_label(args.siem)} query.\n"
             "2. **Enable the telemetry that most gaps depend on:** Sysmon (process EID 1, registry EID 12/13, "
             "image-load EID 7), PowerShell Script Block Logging (EID 4104), and Security command-line auditing "
             "(EID 4688 / 7045 service installs).\n"
             "3. **Promote indeterminate atomics to attributable detections** by enriching generic shell events "
             "with parent-process and command-line context.\n"
             "4. **Re-run this assessment after each change** to track visibility trending upward.\n")
    if args.detection_note:
        L.append("## Detection measurement note\n")
        L.append(args.detection_note + "\n")
    return "\n".join(L)


# ── Detailed Technical Report ────────────────────────────────────────────────
def technical_report(rows, runnable, executed, buckets, na, args, today, cmds, libmap):
    L = cover(args.brand, args.client, args.assessor, args.lab, args.siem, "Detection Coverage — Technical Report", today)
    L += toc(["Table of contents", "Methodology", "Coverage by ATT&CK tactic",
              "Coverage by simulation library", "Execution detail (what ran)",
              "What was detected", "What was missed — blind spots & how to detect them",
              "Scope → outcome map (simulated vs. detected)",
              "Per-simulation findings (detailed)",
              "Recommendations", "Scope and limitations"])
    L.append("## Methodology\n")
    L.append(f"Each atomic was detonated on **{args.lab}** over the configured transport, then re-queried "
             f"against **{siem_label(args.siem)}** over the full engagement window using a **distinctive "
             "indicator** (a non-generic process, script, argument, or registry value unique to the test). "
             "An atomic is **detected/visible** when that indicator reached the SIEM, **indeterminate** when "
             "only a generic shell (`powershell.exe`, `cmd.exe`) was observed, and a **blind spot** when the "
             "indicator ran but produced no matching telemetry. Visibility is the prerequisite for detection, "
             "not a firing rule.\n")
    L += ["## Coverage by ATT&CK tactic\n"] + tactic_table(runnable, buckets)
    if buckets:
        L.append("*Visibility % = visible / (visible + blind); indeterminate atomics are excluded from the ratio.*\n")
    # by library
    agg = bucketed(runnable, lambda r: [r.get("library")] if r.get("library") else list(libmap.get(r["tech"], ())))
    libs = [k for k in agg if k]
    if libs:
        L.append("## Coverage by simulation library\n")
        L.append("| Library | Atomics | Executed | Visible | Indeterminate | Blind | Visibility |")
        L.append("|---|---|---|---|---|---|---|")
        for lib in sorted(libs, key=lambda k: -agg[k]["atomics"]):
            c = agg[lib]; denom = c["visible"] + c["absent"]
            L.append(f"| {esc(lib)} | {c['atomics']} | {c['exec']} | {c['visible']} | {c['generic-only']} | {c['absent']} | {pct(c['visible'], denom)}% |")
        L.append("")

    def outcome(r):
        b = r.get("vis_bucket")
        if not r.get("executed"): return "not executed"
        return {"visible": "✅ detected", "generic-only": "➖ indeterminate", "absent": "❌ blind spot"}.get(b, "executed")

    # Execution detail — every runnable atomic, with outcome + indicator
    L.append("## Execution detail (what ran)\n")
    L.append("| Technique | Atomic | Executor | Outcome | Indicator |")
    L.append("|---|---|---|---|---|")
    for r in runnable:
        ex = cmds.get((r["tech"], int(r.get("num", 1))), ("", ""))[1] or ""
        ind = ", ".join((r.get("indicators") or [])[:2])
        L.append(f"| {esc(r['tech'])} #{esc(r.get('num',''))} | {esc(r.get('name','')[:50])} | {esc(ex)} | {outcome(r)} | {esc(ind)} |")
    L.append("")

    # What was detected
    visible = [r for r in executed if r.get("vis_bucket") == "visible"]
    L.append("## What was detected\n")
    L.append(f"{len(visible)} atomics produced a distinctive indicator that reached the SIEM — these are "
             "defensible with a rule keyed to that indicator.\n")
    if visible:
        L.append("| Technique | Atomic | Visible indicator | Event ID(s) / Log source |")
        L.append("|---|---|---|---|")
        for r in visible[:60]:
            L.append(f"| {esc(r['tech'])} #{esc(r.get('num',''))} | {esc(r.get('name','')[:50])} | {esc(', '.join((r.get('indicators') or [])[:2]))} | {evids(r)} |")
        if len(visible) > 60:
            L.append(f"| … | {len(visible)-60} more | | |")
        L.append("")
        L.append("*Event ID(s) / Log source = the actual Windows telemetry observed carrying each indicator "
                 "in the SIEM (e.g. Sysmon EID 1 process-create, 12/13 registry, 11 file-create; Security 4688/4104/7045).*\n")

    # What was missed — blind spots, each with command + SIEM query
    blind = [r for r in executed if r.get("vis_bucket") == "absent"]
    L.append(f"## What was missed — blind spots & how to detect them\n")
    if not blind:
        L.append("No telemetry blind spots — every executed atomic with a distinctive indicator reached the SIEM.\n")
    else:
        L.append(f"{len(blind)} atomics ran but produced **no matching telemetry**. For each: the command "
                 f"that executed and a ready-to-deploy **{siem_label(args.siem)}** query to close the gap.\n")
        for r in blind:
            cmd = cmds.get((r["tech"], int(r.get("num", 1))), ("", ""))[0]
            L.append(f"### {esc(r['tech'])} #{esc(r.get('num',''))} — {esc(r.get('name',''))}\n")
            L.append(f"- **Tactic:** {esc((r.get('tactic') or '').replace('-', ' ').title())}  ·  "
                     f"**Indicator:** {code_inline(', '.join((r.get('indicators') or [])[:3]) or 'n/a')}")
            if cmd:
                L.append("- **Command executed:**")
                L.append("")
                L.append(code_block(cmd.strip()[:600]))
            L.append(f"- **Detect it ({esc(siem_label(args.siem))}):** {siem_reco(r, args.siem)}")
            L.append("- **Portable Sigma rule (deploy once the telemetry is restored):**")
            L.append("")
            L.append(code_block(sigma_rule(r)))
            L.append("")

    # Scope → outcome map: the full "what we simulated vs. what happened vs. what
    # the SIEM saw" ledger — one row per attempted atomic, end to end.
    L.append("## Scope → outcome map (simulated vs. detected)\n")
    L.append("Every atomic in scope, mapped to the command simulated, whether it executed on the endpoint, "
             "and the detection outcome with the real Event ID(s)/log source observed — so the simulation "
             "scope and its outcomes are auditable at a glance.\n")
    L.append("| Technique | Atomic | Library | Command (simulated) | Executed | Detection | Event ID(s) / Source |")
    L.append("|---|---|---|---|---|---|---|")
    for r in runnable:
        cmd = (cmds.get((r["tech"], int(r.get("num", 1))), ("", ""))[0] or "").strip().replace("\n", " ")
        cmd_disp = code_inline(cmd[:70] + ("…" if len(cmd) > 70 else "")) if cmd else "—"
        lib = r.get("library") or ", ".join(list(libmap.get(r["tech"], ()))[:1]) or "—"
        ran = "✅" if r.get("executed") else "❌"
        L.append(f"| {esc(r['tech'])} #{esc(r.get('num',''))} | {esc(r.get('name','')[:40])} | {esc(lib)} | "
                 f"{cmd_disp} | {ran} | {outcome(r)} | {evids(r)} |")
    L.append("")

    # Per-simulation findings — a complete, SOC-implementable entry for EVERY
    # atomic in scope (simulated command, what detected, what missed, remediation,
    # references), grouped by library then technique so an engineer can act on each.
    L.append("## Per-simulation findings (detailed)\n")
    L.append("One entry per simulation: the exact command executed, what telemetry was detected, what was "
             "missed, the remediation (telemetry to enable + a deployable query/Sigma rule), and references — "
             "so a SOC engineer can reproduce and close each gap directly in their infrastructure.\n")
    def _libkey(r):
        return r.get("library") or (", ".join(list(libmap.get(r["tech"], ()))[:1]) or "General")
    groups = collections.defaultdict(list)
    for r in rows:
        groups[_libkey(r)].append(r)
    for lib in sorted(groups):
        grp = sorted(groups[lib], key=lambda r: (r.get("tech", ""), int(r.get("num", 1)) if str(r.get("num", "")).isdigit() else 0))
        L.append(f"### {esc(lib)}  ({len(grp)} simulations)\n")
        for r in grp:
            L.append(finding_block(r, cmds, args.siem, libmap))
    L.append("")

    L.append("## Recommendations\n")
    L.append(f"1. Deploy each {siem_label(args.siem)} query above and validate it fires by re-running the "
             "paired atomic.\n"
             "2. Ensure the underlying telemetry exists: **Sysmon** (EID 1 process, 7 image-load, 12/13 registry), "
             "**PowerShell Script Block Logging** (EID 4104), **Security command-line auditing** (EID 4688) and "
             "**service-install logging** (EID 7045).\n"
             "3. Forward all of the above to the SIEM and confirm indexing (a blind spot is often an unforwarded "
             "source rather than a missing rule).\n"
             "4. Re-run this assessment after changes to confirm each blind spot flips to visible.\n")
    if args.detection_note:
        L.append("## Detection measurement note\n")
        L.append(args.detection_note + "\n")
    L.append("## Scope and limitations\n")
    L.append(f"- Assessed the Windows atomics detonated on **{args.lab}**; destructive/wiper and "
             "credential-dumping atomics were excluded to preserve the lab and the WinRM session.\n"
             "- Coverage is a point-in-time snapshot of this environment's telemetry and detection configuration.\n"
             "- Non-Windows atomics require Linux/cloud endpoints this environment does not provide.\n")
    return "\n".join(L)


def render_one(md_text, out_base, label):
    """Write <out_base>-<label>.md and render DOCX (with TOC) + PDF."""
    path_md = f"{out_base}-{label}.md"
    open(path_md, "w").write(md_text)
    print("wrote", path_md)
    if shutil.which("pandoc"):
        # --sandbox: pandoc cannot read local files or fetch remote resources
        # (defuses any Markdown image/link an untrusted atomic could inject).
        # Disable raw HTML/TeX so inline passthrough can't reach LaTeX either.
        fmt = ["-f", "markdown-raw_html-raw_attribute-raw_tex"]
        path_docx = f"{out_base}-{label}.docx"
        subprocess.run(["pandoc", "--sandbox", "--toc", "--toc-depth=2", *fmt,
                        path_md, "-o", path_docx], check=False)
        print("wrote", path_docx)
        # PowerPoint deck — pandoc slices the report on headings into slides.
        path_pptx = f"{out_base}-{label}.pptx"
        subprocess.run(["pandoc", "--sandbox", *fmt, path_md, "-o", path_pptx], check=False)
        if os.path.exists(path_pptx):
            print("wrote", path_pptx)
        soffice = shutil.which("libreoffice") or shutil.which("soffice")
        if soffice and os.path.exists(path_docx):
            subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir",
                            os.path.dirname(out_base), path_docx],
                           check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print("wrote", f"{out_base}-{label}.pdf")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--out", default="reports/coverage")
    ap.add_argument("--brand", default="DetectOps")
    ap.add_argument("--assessor", default="RuSecure")
    ap.add_argument("--client", default="Client")
    ap.add_argument("--lab", default="Lab")
    ap.add_argument("--siem", default="splunk", help="installed SIEM: splunk | mde | sentinel")
    ap.add_argument("--report-type", default="both", choices=["executive", "technical", "both"])
    ap.add_argument("--detection-note", default="")
    args = ap.parse_args()
    if args.detection_note.startswith("@"):
        args.detection_note = open(args.detection_note[1:]).read().strip()

    rows = load_results(args.results)
    libmap = library_techniques()
    cmds = load_commands()
    runnable = [r for r in rows if r.get("status") != "n/a"]
    executed = [r for r in runnable if r.get("executed")]
    buckets = visibility_buckets(executed)
    na = len([r for r in rows if r.get("status") == "n/a"])
    today = datetime.date.today().isoformat()

    out = os.path.join(ROOT, args.out) if not os.path.isabs(args.out) else args.out
    os.makedirs(os.path.dirname(out), exist_ok=True)

    if args.report_type in ("executive", "both"):
        render_one(executive_report(rows, runnable, executed, buckets, na, args, today), out, "executive")
    if args.report_type in ("technical", "both"):
        render_one(technical_report(rows, runnable, executed, buckets, na, args, today, cmds, libmap), out, "technical")
    print(f"done ({len(rows)} records, siem={args.siem})")


if __name__ == "__main__":
    main()
