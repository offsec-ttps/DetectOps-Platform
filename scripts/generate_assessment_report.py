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
import argparse, json, os, subprocess, sqlite3, collections, datetime, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_MODULES = {
    "Active Directory": "detectops.ad-attack", "Hacktools": "detectops.hacktools",
    "Privilege Escalation": "detectops.privesc", "Lateral Movement": "detectops.lateral-movement",
    "UAC Bypass": "detectops.uac-bypass", "User to Admin": "detectops.user-to-admin",
    "User to SYSTEM": "detectops.user-to-system",
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


def siem_label(siem):
    s = (siem or "splunk").lower()
    if s in ("mde", "kql") or "defender" in s: return "Microsoft Defender for Endpoint (KQL)"
    if "sentinel" in s: return "Microsoft Sentinel (KQL)"
    return "Splunk (SPL)"


def cover(brand, client, assessor, lab, siem, title, today):
    L = [f"# {brand} — {title}", ""]
    L.append(f"### Prepared for: {client}")
    L.append("")
    L.append("| | |")
    L.append("|---|---|")
    L.append(f"| **Client** | {client} |")
    L.append(f"| **Prepared by** | {assessor} |")
    L.append(f"| **Platform** | {brand} |")
    L.append(f"| **Environment** | {lab} |")
    L.append(f"| **SIEM** | {siem_label(siem)} |")
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
            L.append(f"| {t} | {c['atomics']} | {c['exec']} | {c['visible']} | {c['generic-only']} | {c['absent']} | {pct(c['visible'], denom)}% |")
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
            L.append(f"| {t} | {n} |")
        L.append("")
        L.append("Representative gaps: " + "; ".join(
            f"`{r['tech']}` {r.get('name','')[:48]}" for r in blind[:5]) + ".\n")
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
            L.append(f"| {lib} | {c['atomics']} | {c['exec']} | {c['visible']} | {c['generic-only']} | {c['absent']} | {pct(c['visible'], denom)}% |")
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
        L.append(f"| {r['tech']} #{r.get('num','')} | {r.get('name','')[:50]} | {ex} | {outcome(r)} | {ind} |")
    L.append("")

    # What was detected
    visible = [r for r in executed if r.get("vis_bucket") == "visible"]
    L.append("## What was detected\n")
    L.append(f"{len(visible)} atomics produced a distinctive indicator that reached the SIEM — these are "
             "defensible with a rule keyed to that indicator.\n")
    if visible:
        L.append("| Technique | Atomic | Visible indicator |")
        L.append("|---|---|---|")
        for r in visible[:60]:
            L.append(f"| {r['tech']} #{r.get('num','')} | {r.get('name','')[:50]} | {', '.join((r.get('indicators') or [])[:2])} |")
        if len(visible) > 60:
            L.append(f"| … | {len(visible)-60} more | |")
        L.append("")

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
            L.append(f"### {r['tech']} #{r.get('num','')} — {r.get('name','')}\n")
            L.append(f"- **Tactic:** {(r.get('tactic') or '').replace('-', ' ').title()}  ·  "
                     f"**Indicator:** `{', '.join((r.get('indicators') or [])[:3]) or 'n/a'}`")
            if cmd:
                L.append("- **Command executed:**")
                L.append("")
                L.append("```")
                L.append(cmd.strip()[:600])
                L.append("```")
            L.append(f"- **Detect it ({siem_label(args.siem)}):** {siem_reco(r, args.siem)}")
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
        path_docx = f"{out_base}-{label}.docx"
        subprocess.run(["pandoc", "--toc", "--toc-depth=2",
                        "-f", "markdown-raw_html-raw_attribute-raw_tex",
                        path_md, "-o", path_docx], check=False)
        print("wrote", path_docx)
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
