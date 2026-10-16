#!/usr/bin/env python3
"""
Enterprise coverage-assessment report pipeline.

Reads a BAS sweep result file (JSONL: one record per atomic with
tech/num/tactic/status/executed/observed) plus branding, aggregates coverage by
ATT&CK tactic and by simulation library, writes a branded Markdown report, then
renders DOCX (pandoc) and PDF (LibreOffice).

Usage:
  python3 scripts/generate_assessment_report.py \
      --results sweep_results.jsonl --out reports/coverage \
      --assessor RuSecure --client UnicornSecrets --lab "Splunk SAR"

Outputs: <out>.md, <out>.docx, <out>.pdf
Reusable: point --results at any sweep JSONL; branding flags are free text.
"""
import argparse, json, os, subprocess, sqlite3, collections, datetime, shutil, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The simulation libraries whose per-library coverage we break out.
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
        except: pass
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

def pct(n, d): return 0 if not d else round(100 * n / d)

def aggregate(rows, libmap):
    runnable = [r for r in rows if r.get("status") != "n/a"]  # exclude not-windows-applicable
    executed = [r for r in runnable if r.get("executed")]
    observed = [r for r in runnable if r.get("observed")]
    by_tactic = collections.defaultdict(lambda: [0, 0, 0])  # tested, executed, observed
    for r in runnable:
        t = (r.get("tactic") or "other").replace("-", " ").title()
        by_tactic[t][0] += 1
        by_tactic[t][1] += 1 if r.get("executed") else 0
        by_tactic[t][2] += 1 if r.get("observed") else 0
    by_lib = collections.defaultdict(lambda: [0, 0, 0])
    for r in runnable:
        for lib in libmap.get(r["tech"], ()):
            by_lib[lib][0] += 1
            by_lib[lib][1] += 1 if r.get("executed") else 0
            by_lib[lib][2] += 1 if r.get("observed") else 0
    return runnable, executed, observed, dict(by_tactic), dict(by_lib)

def md_report(rows, args):
    libmap = library_techniques()
    runnable, executed, observed, by_tactic, by_lib = aggregate(rows, libmap)
    na = len([r for r in rows if r.get("status") == "n/a"])
    today = datetime.date.today().isoformat()
    L = []
    L.append(f"# Atomic Red Team Coverage Assessment — {args.client}\n")
    L.append(f"**Assessor:** {args.assessor}  |  **Client:** {args.client}  |  "
             f"**Environment:** {args.lab}  |  **Date:** {today}\n")
    L.append("## Executive summary\n")
    L.append(f"{args.assessor} executed the Windows Atomic Red Team library against "
             f"{args.client}'s {args.lab} lab and measured, per atomic, whether it ran on "
             f"the endpoint and whether its activity was observable in the SIEM.\n")
    L.append("| Metric | Result |\n|---|---|")
    L.append(f"| Atomics attempted (Windows, non-destructive, on-host) | {len(runnable)} |")
    L.append(f"| Executed on the endpoint | **{len(executed)} / {len(runnable)} ({pct(len(executed), len(runnable))}%)** |")
    L.append(f"| Observable in SIEM (telemetry present) | **{len(observed)} / {len(runnable)} ({pct(len(observed), len(runnable))}%)** |")
    if na: L.append(f"| Skipped (not Windows-applicable) | {na} |")
    L.append("")
    L.append("*\"Observable\" means the atomic's activity produced telemetry the SIEM "
             "ingested — the prerequisite for a detection. Turning observability into "
             "firing detections is covered in the recommendations.*\n")

    L.append("## Coverage by ATT&CK tactic\n")
    L.append("| Tactic | Atomics | Executed | Observable | Observability |\n|---|---|---|---|---|")
    for t in sorted(by_tactic, key=lambda k: -by_tactic[k][0]):
        a, e, o = by_tactic[t]
        L.append(f"| {t} | {a} | {e} | {o} | {pct(o, a)}% |")
    L.append("")

    if by_lib:
        L.append("## Coverage by simulation library\n")
        L.append("| Library | Atomics | Executed | Observable | Observability |\n|---|---|---|---|---|")
        for lib in LIB_MODULES:
            if lib in by_lib:
                a, e, o = by_lib[lib]
                L.append(f"| {lib} | {a} | {e} | {o} | {pct(o, a)}% |")
        L.append("")

    # Top gaps: executed but not observable (SIEM blind spots)
    blind = [r for r in executed if not r.get("observed")]
    L.append("## Notable blind spots (executed, not observable in SIEM)\n")
    if blind:
        L.append("| Technique | Atomic | Tactic |\n|---|---|---|")
        for r in blind[:40]:
            L.append(f"| {r['tech']} | {r.get('name','')[:60]} | {(r.get('tactic') or '').replace('-',' ')} |")
        if len(blind) > 40: L.append(f"| … | {len(blind)-40} more | |")
    else:
        L.append("None — every executed atomic produced observable telemetry.")
    L.append("")
    L.append("## Recommendations\n")
    L.append("See `detection-improvement-recommendations.md`. The highest-impact items: "
             "deploy a comprehensive Sysmon configuration (enable Event ID 8/10/25) and "
             "command-line process auditing (Security 4688), which convert the blind spots "
             "above into detectable telemetry; then add rule logic for the gap techniques.\n")
    L.append("## Scope and limitations\n")
    L.append(f"- Assessed the Windows atomics installed on the {args.lab} domain controller; "
             "destructive/wiper atomics were excluded to preserve the lab.\n"
             "- Coverage is a point-in-time snapshot of the lab's telemetry and detection "
             "configuration. Re-run after each change to track improvement.\n"
             "- Container and Cloud libraries require Linux/cloud endpoints the lab does not provide.\n")
    return "\n".join(L)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--out", default="reports/coverage")
    ap.add_argument("--assessor", default="RuSecure")
    ap.add_argument("--client", default="UnicornSecrets")
    ap.add_argument("--lab", default="Splunk SAR")
    args = ap.parse_args()
    rows = load_results(args.results)
    md = md_report(rows, args)
    out = os.path.join(ROOT, args.out) if not os.path.isabs(args.out) else args.out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out + ".md", "w").write(md)
    print("wrote", out + ".md", f"({len(rows)} records)")
    # Markdown -> DOCX (pandoc)
    if shutil.which("pandoc"):
        subprocess.run(["pandoc", out + ".md", "-o", out + ".docx"], check=False)
        print("wrote", out + ".docx")
        # DOCX -> PDF (LibreOffice headless)
        soffice = shutil.which("libreoffice") or shutil.which("soffice")
        if soffice:
            subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir",
                            os.path.dirname(out), out + ".docx"],
                           check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print("wrote", out + ".pdf" if os.path.exists(out + ".pdf") else "(pdf conversion failed)")
    else:
        print("pandoc not found — Markdown only")

if __name__ == "__main__":
    main()
