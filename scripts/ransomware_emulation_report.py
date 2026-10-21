#!/usr/bin/env python3
"""Per-ransomware-group detection coverage report from a coverage-assessment sweep.

A "Ransomware groups" sweep detonates the DEDUPED union of every selected group's
runnable atomics once. This script rebuilds each group's kill chain from its
emulation plan (config/ransomware-emulation/plans) and maps every sweep result
back onto the chain step it represents, so each group gets its own outcome:

  visible       atomic ran and its distinctive indicator reached the SIEM
  generic-only  ran; only generic process telemetry reached the SIEM
  absent        ran; nothing attributable reached the SIEM (blind spot)
  failed        atomic did not execute (prereq / transport error)
  not-run       atomic is not present in the host's Atomic Red Team install
  pending       sweep still running / observation not yet settled
  not-detonated mapped, but excluded by policy (impact / cred-dump / hijack)
  gap           no local atomic reproduces the procedure

Usage: python3 scripts/ransomware_emulation_report.py <assessmentId> [--siem splunk]
Writes reports/coverage-assessments/<id>/ransomware-emulation.{md,docx,pdf}.
"""
import argparse, collections, datetime, glob, importlib.util, json, os, re, sqlite3, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("gar", os.path.join(ROOT, "scripts", "generate_assessment_report.py"))
gar = importlib.util.module_from_spec(spec); spec.loader.exec_module(gar)
esc, pct, siem_reco, sigma_rule, evids, siem_label = gar.esc, gar.pct, gar.siem_reco, gar.sigma_rule, gar.evids, gar.siem_label

RANK = {"visible": 7, "generic-only": 6, "absent": 5, "pending": 4, "failed": 3, "not-run": 2, "not-detonated": 1, "gap": 0}
LABEL = {"pending": "Pending (sweep in progress)", "visible": "Visible", "generic-only": "Generic only", "absent": "Absent (blind spot)", "failed": "Failed to run",
         "not-run": "Not run (not installed)", "not-detonated": "Not detonated (policy)", "gap": "Gap (no atomic)"}
TACTIC_ORDER = ["initial-access", "execution", "persistence", "privilege-escalation", "defense-evasion", "defense-impairment",
                "stealth", "credential-access", "discovery", "lateral-movement", "collection", "command-and-control",
                "exfiltration", "impact"]


def j(s, fb):
    try: return json.loads(s) if s else fb
    except Exception: return fb


# Distinctive, query-able token from an atomic's command line — used when the SIEM
# re-query captured no indicator (generic-only / absent), so a recommendation keys
# on the real binary/cmdlet/argument instead of the test's display name.
_IND_PATTERNS = [
    r"netsh\s+interface\s+portproxy", r"\b(?:del|erase)(?:\s+/[a-z])+", r"\bnet1?\s+(?:share|user|group|view|localgroup|use)\b", r"\breg(?:\.exe)?\s+add\b",
    r"\bsc(?:\.exe)?\s+(?:create|config)\b", r"\b(?:Invoke|New|Set|Add|Get|Start|Remove|Enable|Disable)-[A-Za-z]+\b",
    r"\b[\w.-]+\.(?:exe|ps1|bat|vbs|dll|hta|js)\b",
    r"\b(?:mstsc|nmap|schtasks|wmic|psexec|tasklist|certutil|bitsadmin|rclone|winrar|rar|7z|crackmapexec|nltest|adfind|vssadmin|bcdedit|wevtutil|cmdkey|quser|qwinsta|ping|whoami|systeminfo|ipconfig|arp|route|curl|ssh|scp|sftp)\b",
]


def derive_indicator(cmd, defaults=None):
    defaults = defaults or {}
    # Substitute #{arg} with the atomic's default value (e.g. #{rar_exe} → the
    # WinRAR path) so the indicator is the real binary; unknown args are dropped.
    c = re.sub(r"#\{([^}]*)\}", lambda m: os.path.basename(str(defaults.get(m.group(1), ""))), cmd or "")
    for pat in _IND_PATTERNS:
        m = re.search(pat, c, re.I)
        if m and m.group(0).lower() not in ("powershell.exe", "cmd.exe"):
            return m.group(0)
    w = re.findall(r"[A-Za-z][\w.-]{3,}", c)
    return w[0] if w else ""


ARG_DEFAULTS = {}


def with_indicator(r, cmds):
    """Copy of r whose indicators fall back to a token derived from the command."""
    if not r or (r.get("indicators") or []):
        return r
    key = (r.get("tech"), int(r.get("num") or 0))
    ind = derive_indicator(cmds.get(key, ("", ""))[0], ARG_DEFAULTS.get(key))
    return {**r, "indicators": [ind] if ind else []}


def cell(s, n=140):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return esc(s[:n] + ("…" if len(s) > n else "")).replace("|", "\\|")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("assessment")
    ap.add_argument("--siem", default="splunk")
    args = ap.parse_args()
    if not re.fullmatch(r"[0-9a-f-]{36}", args.assessment):
        sys.exit("invalid assessment id")

    db = sqlite3.connect(os.path.join(ROOT, "dev.db"))
    db.row_factory = sqlite3.Row
    a = db.execute("select * from coverage_assessments where id=?", (args.assessment,)).fetchone()
    if not a: sys.exit("assessment not found")
    done = a["status"] in ("completed", "rendering", "failed", "cancelled")
    items = {}
    for r in db.execute("select * from coverage_assessment_items where assessmentId=?", (args.assessment,)):
        items[(r["tech"], r["num"])] = {
            "tech": r["tech"], "num": r["num"], "name": r["name"], "status": r["status"], "executed": bool(r["executed"]),
            "vis_bucket": r["visBucket"] or "", "indicators": j(r["indicators"], []),
            "event_codes": j(r["obsEventCodes"], []), "sources": j(r["obsSources"], []),
        }
    cmds = gar.load_commands()
    for tech, num, ia in db.execute("select techniqueId, testNumber, inputArguments from atomic_tests"):
        d = j(ia, {})
        if isinstance(d, dict):
            ARG_DEFAULTS[(tech, int(num))] = {k: (v.get("default") if isinstance(v, dict) else v) for k, v in d.items()}
    cat = {r["testGuid"]: r for r in db.execute("select testGuid, techniqueId, testNumber, testName, tactic, command from atomic_tests")}

    # Same exclusion policy as src/lib/coverage-assessment/exclusions.ts.
    DESTRUCTIVE = re.compile(r"vssadmin\s+delete|cipher\s+/w|(^|\s)format\s|bcdedit|wbadmin\s+delete|diskpart|shutdown|restart-computer|remove-item.*-recurse|stop-service.*(splunk|eventlog|winmgmt)|splunkforwarder|wevtutil\s+cl|clear-eventlog|set-mppreference\s+-disable|auditpol.*/disable|disable-windowsoptionalfeature", re.I)
    CRED = re.compile(r"mimikatz|sekurlsa|lsass|comsvcs|procdump|ntds|ntdsutil|reg\s+save.*(sam|security|system)|\bwce\b|pwdump|gsecdump|lazagne|out-minidump|rundll32.*minidump|nanodump|dumpert", re.I)
    HIJACK = re.compile(r"AppInit_DLLs|AppCertDLLs|Image File Execution Options[\s\S]*/v\s+Debugger|\bSilentProcessExit\b", re.I)

    def excluded(row, step_tactic):
        tid, tac, cmd = row["techniqueId"].upper(), (row["tactic"] or step_tactic or "").lower(), row["command"] or ""
        if "impact" in tac: return "impact (destructive)"
        if DESTRUCTIVE.search(cmd): return "destructive command"
        if tid.startswith("T1003") or CRED.search(cmd): return "credential dumping"
        if tid in ("T1546.009", "T1546.010", "T1546.012") or HIJACK.search(cmd): return "execution hijack"
        return ""

    scope = j(a["scope"], {})
    wanted = set(scope.get("gangs") or [])
    plans = []
    for f in sorted(glob.glob(os.path.join(ROOT, "config", "ransomware-emulation", "plans", "*.json"))):
        p = json.load(open(f))
        if not wanted or p["gang"] in wanted: plans.append(p)

    groups = []
    for p in plans:
        steps = []
        for st in sorted(p["chain"], key=lambda s: s.get("order", 0)):
            best, best_r, why = "gap", None, st.get("noAtomicReason") or "no local atomic"
            for at in st.get("atomics", []):
                row = cat.get(at.get("testGuid"))
                if not row: continue
                key = (row["techniqueId"], row["testNumber"])
                it = items.get(key)
                if it:
                    if it["vis_bucket"] in ("visible", "generic-only", "absent"):
                        o = it["vis_bucket"]
                    elif it["status"] == "pending" or (it["executed"] and not done):
                        o = "pending"   # not detonated yet / SIEM observation not settled
                    elif it["executed"]:
                        o = "absent"
                    elif it["status"] == "n/a":
                        o = "not-run"   # test number missing from the host's ART install
                    else:
                        o = "failed"
                    rr = dict(it)
                else:
                    reason = excluded(row, st.get("tactic"))
                    o = "not-detonated" if reason else "not-run"
                    rr = {"tech": row["techniqueId"], "num": row["testNumber"], "name": row["testName"], "indicators": [], "event_codes": [], "sources": []}
                    if reason: why = reason
                if RANK[o] > RANK[best]:
                    best, best_r = o, rr
            steps.append({**st, "outcome": best, "r": best_r, "why": why})
        c = collections.Counter(s["outcome"] for s in steps)
        ran = c["visible"] + c["generic-only"] + c["absent"]
        groups.append({"p": p, "steps": steps, "c": c, "ran": ran})

    today = datetime.date.today().isoformat()
    L = [f"# Ransomware Emulation — Detection Coverage by Group\n",
         f"**Assessment:** {esc(a['name'])}  ·  **Lab:** {esc(a['lab'])}  ·  **SIEM:** {siem_label(args.siem)}  ·  **Date:** {today}\n",
         "Each group's publicly reported attack chain (MITRE ATT&CK, CISA #StopRansomware, vendor research) was replayed with "
         "existing Atomic Red Team tests on the lab host, and every step was checked for SIEM visibility. "
         "**Visible** = the step's distinctive indicator reached the SIEM (detectable). **Generic only** = only generic process "
         "telemetry arrived (detection would be noisy). **Absent** = nothing attributable reached the SIEM (blind spot).\n"]

    # ── Overview ──
    tot = collections.Counter()
    for g in groups: tot.update(g["c"])
    ran_all = tot["visible"] + tot["generic-only"] + tot["absent"]
    L += ["## Overview\n",
          f"| Groups | Chain steps | Steps exercised | Visible | Generic only | Absent | Pending | Failed | Not run | Not detonated | Gaps |",
          "|---|---|---|---|---|---|---|---|---|---|---|",
          f"| {len(groups)} | {sum(len(g['steps']) for g in groups)} | {ran_all} | {tot['visible']} ({pct(tot['visible'], ran_all)}%) | "
          f"{tot['generic-only']} | {tot['absent']} | {tot['pending']} | {tot['failed']} | {tot['not-run']} | {tot['not-detonated']} | {tot['gap']} |\n"]

    L += ["## Coverage by group\n",
          "Visible % = visible steps ÷ steps exercised. Groups are sorted weakest-first.\n",
          "| Group | Steps | Exercised | Visible | Generic | Absent | Failed | Not run | Not detonated | Gaps | Visible % |",
          "|---|---|---|---|---|---|---|---|---|---|---|"]
    for g in sorted(groups, key=lambda g: (pct(g["c"]["visible"], g["ran"]), g["p"]["gang"].lower())):
        c = g["c"]
        L.append(f"| {esc(g['p'].get('displayName') or g['p']['gang'])} | {len(g['steps'])} | {g['ran']} | {c['visible']} | {c['generic-only']} | "
                 f"{c['absent']} | {c['failed']} | {c['not-run']} | {c['not-detonated']} | {c['gap']} | **{pct(c['visible'], g['ran'])}%** |")
    L.append("")

    # ── Cross-group blind spots ──
    blind = collections.defaultdict(lambda: {"groups": set(), "name": "", "r": None})
    for g in groups:
        for s in g["steps"]:
            if s["outcome"] in ("absent", "generic-only"):
                b = blind[s["techniqueId"]]
                b["groups"].add(g["p"].get("displayName") or g["p"]["gang"]); b["name"] = s["techniqueName"]; b["r"] = b["r"] or s["r"]
    if blind:
        L += ["## Most widespread blind spots\n",
              "Techniques that ran but were not (or only generically) visible, ranked by how many groups use them. "
              "Closing these first gives the largest cross-group coverage gain.\n",
              "| Technique | Groups affected | Recommended detection |", "|---|---|---|"]
        for tid, b in sorted(blind.items(), key=lambda kv: -len(kv[1]["groups"]))[:25]:
            L.append(f"| {esc(tid)} {cell(b['name'], 60)} | {len(b['groups'])} — {cell(', '.join(sorted(b['groups'])), 160)} | {siem_reco(with_indicator(b['r'], cmds), args.siem) if b['r'] else '—'} |")
        L.append("")

    # ── Per group ──
    L.append("## Group detail\n")
    for g in sorted(groups, key=lambda g: (g["p"].get("displayName") or g["p"]["gang"]).lower()):
        p, c = g["p"], g["c"]
        L += [f"### {esc(p.get('displayName') or p['gang'])}\n",
              f"*Status:* {esc(p.get('status', ''))}  ·  *Active since:* {esc(p.get('activeSince', ''))}" + (f"  ·  *Lineage:* {esc(p['lineage'])}" if p.get("lineage") else "") + "\n"]
        if p.get("insufficientReporting"):
            L.append("> Public TTP reporting on this group is thin; the chain contains only sourced steps.\n")
        if p.get("summary"): L.append(esc(p["summary"]) + "\n")
        L += [f"**Result:** {c['visible']} visible · {c['generic-only']} generic · {c['absent']} absent · {c['failed']} failed · "
              f"{c['not-run']} not run · {c['not-detonated']} not detonated · {c['gap']} gaps — "
              f"**{pct(c['visible'], g['ran'])}% of exercised steps visible**.\n",
              "| # | Tactic | Technique | Group procedure | Atomic | Outcome | Event IDs / sources |", "|---|---|---|---|---|---|---|"]
        for s in g["steps"]:
            r = s["r"]
            at = f"{esc(r['tech'])}#{r['num']} {cell(r.get('name'), 50)}" if r else "—"
            sig = " ★" if s.get("signature") else ""
            out = LABEL[s["outcome"]] + (f" — {cell(s['why'], 60)}" if s["outcome"] in ("not-detonated", "gap") else "")
            L.append(f"| {s.get('order')} | {esc(s.get('tactic', ''))} | {esc(s['techniqueId'])} {cell(s['techniqueName'], 40)}{sig} | "
                     f"{cell(s.get('procedure'), 160)} | {at} | {out} | {evids(r) if r and s['outcome'] in ('visible', 'generic-only') else '—'} |")
        L.append("\n★ = group-specific (distinctive) technique.\n")
        recs = [s for s in g["steps"] if s["outcome"] in ("absent", "generic-only") and s["r"]]
        if recs:
            L.append("**Recommendations — close these gaps first (group-specific steps first):**\n")
            for s in sorted(recs, key=lambda s: (not s.get("signature"), s.get("order", 0)))[:8]:
                L.append(f"- **{esc(s['techniqueId'])} {esc(s['techniqueName'])}**{' ★' if s.get('signature') else ''}: {siem_reco(with_indicator(s['r'], cmds), args.siem)}")
            first_sig = next((s for s in sorted(recs, key=lambda s: (not s.get("signature"), s.get("order", 0)))), None)
            if first_sig:
                L += ["", "Starter Sigma rule for the highest-priority gap:", "", "```yaml", sigma_rule(with_indicator(first_sig["r"], cmds)), "```"]
            L.append("")
        gaps = [s for s in g["steps"] if s["outcome"] == "gap"]
        if gaps:
            L.append("**Not testable by atomic (validate by detection review / purple-team):** " +
                     "; ".join(f"{esc(s['techniqueId'])} — {cell(s.get('noAtomicReason') or s['procedure'], 90)}" for s in gaps) + "\n")
        srcs = p.get("sources", [])
        if srcs:
            L.append("Sources: " + "; ".join(f"[{esc(x.get('publisher') or x['id'])}]({x['url']})" if x.get("url") else esc(x.get("title", "")) for x in srcs) + "\n")

    # ── Not run ──
    nr = sorted({(s["r"]["tech"], s["r"]["num"], s["r"]["name"]) for g in groups for s in g["steps"] if s["outcome"] == "not-run" and s["r"]})
    if nr:
        L += ["## Atomics not run (missing from the host's Atomic Red Team install)\n",
              "Update the host's Atomic Red Team atomics folder (these techniques/tests are absent or older there) and re-run to exercise these steps:\n",
              ", ".join(sorted({t for t, _, _ in nr})) + "\n"]

    out_dir = os.path.join(ROOT, "reports", "coverage-assessments", args.assessment)
    os.makedirs(out_dir, exist_ok=True)
    gar.render_one("\n".join(L) + "\n", os.path.join(out_dir, "ransomware"), "emulation")


if __name__ == "__main__":
    main()
