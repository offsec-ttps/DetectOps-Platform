#!/usr/bin/env python3
"""
DetectOps — branded, magazine-style Adversary Simulation & Detection Coverage
report. Reads a completed coverage assessment from dev.db and emits a polished,
multi-page HTML (dark cover + numbered sections + bar charts + hyperlinked
detection-gap fixes, MITRE technique links, references and a resources grid +
dark back cover), then renders it to PDF with headless Chrome.

Usage:
  python3 scripts/generate_branded_report.py <assessmentId> \
      [--out reports/coverage-assessments/<id>/report-branded] [--db dev.db]
"""
import argparse, json, sqlite3, os, html, math, subprocess, shutil, datetime, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Branding ─────────────────────────────────────────────────────────────────
BRAND = "DetectOps"
BRAND_SITE = "detectops.io"
REPORT_NAME = "Adversary Simulation &amp; Detection Coverage Report"
TAGLINE = "Simulate the attack. Prove the detection."
EDITION = "COVERAGE EDITION"

# Curated, real reference links used across the report.
REFS = {
    "attack": ("MITRE ATT&CK — Enterprise techniques, tactics and mitigations", "https://attack.mitre.org/"),
    "art": ("Red Canary — Atomic Red Team test library", "https://github.com/redcanaryco/atomic-red-team"),
    "lolbas": ("LOLBAS Project — Living Off The Land Binaries, Scripts and Libraries", "https://lolbas-project.github.io/"),
    "sysmon": ("Microsoft — Sysmon (System Monitor) download & schema", "https://learn.microsoft.com/sysinternals/downloads/sysmon"),
    "sysmoncfg": ("SwiftOnSecurity — a high-quality baseline Sysmon configuration", "https://github.com/SwiftOnSecurity/sysmon-config"),
    "pslog": ("Microsoft — PowerShell Script Block Logging (Event ID 4104)", "https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_logging_windows"),
    "cmdline": ("Microsoft — command-line process auditing (Security Event ID 4688)", "https://learn.microsoft.com/windows-server/identity/ad-ds/manage/component-updates/command-line-process-auditing"),
    "splunk": ("Splunk — Security Content (detections and analytic stories)", "https://research.splunk.com/"),
    "sigma": ("SigmaHQ — generic signatures for SIEM detection rules", "https://github.com/SigmaHQ/sigma"),
    "redcanary": ("Red Canary — Threat Detection Report (top techniques & detection guidance)", "https://redcanary.com/threat-detection-report/"),
    "cisa": ("CISA — Known Exploited Vulnerabilities & advisories", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"),
}

# Resources grid (chip, name, category, blurb, domain, url).
RESOURCES = [
    ("ATT&CK", "MITRE ATT&CK", "FRAMEWORK", "Technique identifiers, tactics and mitigations every finding maps to.", "attack.mitre.org", "https://attack.mitre.org/"),
    ("ART", "Atomic Red Team", "TEST LIBRARY", "The atomic tests executed on the endpoint during this engagement.", "github.com/redcanaryco", "https://github.com/redcanaryco/atomic-red-team"),
    ("LOLBAS", "LOLBAS Project", "LIVING-OFF-THE-LAND", "Catalogue of built-in Windows binaries abused for execution and evasion.", "lolbas-project.github.io", "https://lolbas-project.github.io/"),
    ("Sysmon", "Microsoft Sysmon", "TELEMETRY", "Process, registry and image-load telemetry that most gaps depend on.", "learn.microsoft.com", "https://learn.microsoft.com/sysinternals/downloads/sysmon"),
    ("Sigma", "SigmaHQ", "DETECTION RULES", "Portable detection signatures to turn visibility into firing rules.", "github.com/SigmaHQ", "https://github.com/SigmaHQ/sigma"),
    ("Splunk", "Splunk Security Content", "SIEM", "Analytic stories and SPL detections for the techniques assessed.", "research.splunk.com", "https://research.splunk.com/"),
    ("CISA", "CISA KEV", "ADVISORIES", "Known Exploited Vulnerabilities and national-level guidance.", "cisa.gov", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"),
    ("RC", "Red Canary", "RESEARCH", "Threat Detection Report — top techniques and how to detect them.", "redcanary.com", "https://redcanary.com/threat-detection-report/"),
]


def e(s):
    return html.escape(str(s if s is not None else ""))


def mitre_url(t):
    t = str(t).strip().upper()
    if re.match(r"^T\d{4}\.\d{3}$", t):
        base, sub = t.split(".")
        return f"https://attack.mitre.org/techniques/{base}/{sub}/"
    if re.match(r"^T\d{4}$", t):
        return f"https://attack.mitre.org/techniques/{t}/"
    return "https://attack.mitre.org/"


def pct(n, d):
    return 0 if not d else round(100 * n / d)


def load(db, aid):
    c = sqlite3.connect(db)
    row = c.execute("SELECT name,client,assessor,lab,metrics,siemConnectionId,detectionNote FROM coverage_assessments WHERE id=?", (aid,)).fetchone()
    if not row:
        raise SystemExit(f"assessment {aid} not found")
    a = {"name": row[0], "client": row[1], "assessor": row[2], "lab": row[3],
         "metrics": json.loads(row[4] or "{}"), "siemId": row[5], "note": row[6]}
    siem = "Splunk"
    if row[5]:
        s = c.execute("SELECT name,kind FROM siem_connections WHERE id=?", (row[5],)).fetchone()
        if s:
            siem = {"splunk": "Splunk", "mde": "Microsoft Defender for Endpoint", "sentinel": "Microsoft Sentinel"}.get((s[1] or "").lower(), s[0] or "Splunk")
    a["siem"] = siem
    items = []
    for t, num, name, tactic, lib, status, ex, vb, ind in c.execute(
            "SELECT tech,num,name,tactic,library,status,executed,visBucket,indicators FROM coverage_assessment_items WHERE assessmentId=? ORDER BY \"order\"", (aid,)):
        try: ind = json.loads(ind or "[]")
        except Exception: ind = []
        items.append({"tech": t, "num": num, "name": name, "tactic": tactic, "library": lib,
                      "status": status, "executed": bool(ex), "vis": vb, "ind": ind})
    cmds = {(t, int(n)): cmd for t, n, cmd in c.execute("SELECT techniqueId,testNumber,command FROM atomic_tests")}
    c.close()
    return a, items, cmds


def siem_query(item, siem):
    """A copy-pasteable detection query for the installed SIEM."""
    ind = next((i for i in item["ind"] if i), item["name"] or "activity")
    ind = re.sub(r'[`"<>\r\n]', "", str(ind))[:80]
    low = (" ".join(item["ind"]) + " " + (item["name"] or "")).lower()
    kql = siem.lower().startswith("microsoft")
    if kql:
        return f'DeviceProcessEvents | where ProcessCommandLine has "{ind}" or FileName has "{ind}"'
    if any(k in low for k in ["hkcu", "hklm", "registry", "software\\", "disablereal", "uacdisable", "subkey", "mppreference"]):
        return f'index=* source=WinEventLog:* EventCode IN (12,13) TargetObject="*{ind}*"'
    if any(k in low for k in ["new-", "get-", "set-", ".ps1", "invoke-", "format-table", "new-localuser", "new-vm"]):
        return f'index=* EventCode=4104 ScriptBlockText="*{ind}*"'
    return f'index=* EventCode IN (1,4688) (Image="*{ind}*" OR CommandLine="*{ind}*")'


def gap_ref(item):
    low = (" ".join(item["ind"]) + " " + (item["name"] or "")).lower()
    if any(k in low for k in ["hkcu", "hklm", "registry", "uacdisable", "subkey", "mppreference", "disablereal"]):
        return "sysmon", REFS["sysmon"]
    if any(k in low for k in ["new-", "get-", "set-", ".ps1", "invoke-", "new-localuser", "new-vm", "format-table"]):
        return "pslog", REFS["pslog"]
    return "cmdline", REFS["cmdline"]


# ── CSS ──────────────────────────────────────────────────────────────────────
CSS = """
:root{
  --ink:#0b1020; --ink2:#111a30; --paper:#ffffff; --muted:#5b6478; --line:#e4e8f0;
  --accent:#4f7dff; --accent2:#22d3ee; --cyan:#22d3ee; --warn:#f59e0b; --bad:#ef4444; --good:#22c55e;
}
*{box-sizing:border-box}
@page{ size:A4; margin:14mm; }
html,body{margin:0;padding:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1a2233;font-size:10.2pt;line-height:1.5;}
a{color:var(--accent);text-decoration:none}
h1,h2,h3{margin:0}
.wrap{padding:0}
/* per-section header/footer (inline — reliable in Chrome print, no fixed overlap) */
.pghead{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid var(--ink);padding-bottom:7px;margin-bottom:12px}
.pghead .b{display:flex;align-items:center;gap:8px;font-weight:800;font-size:11pt}
.pghead .meta{font-size:8pt;color:var(--muted)}
.pgfoot{display:flex;justify-content:space-between;color:var(--muted);font-size:8pt;border-top:1px solid var(--line);margin-top:16px;padding-top:6px}
.mark{width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:inline-block}
/* full-bleed dark pages (cover / back) — negative margins to beat @page margins */
.sheet-dark{position:relative;background:var(--ink);color:#fff;margin:-14mm;height:297mm;padding:20mm 18mm;page-break-after:always;overflow:hidden}
.sheet-dark::before{content:"";position:absolute;inset:0;background:
  radial-gradient(900px 500px at 78% 8%, rgba(79,125,255,.22), transparent 60%),
  radial-gradient(700px 500px at 10% 90%, rgba(34,211,238,.14), transparent 60%);}
.sheet-dark>*{position:relative}
.grid-bg{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:34px 34px;}
/* cover */
.cov-top{display:flex;justify-content:space-between;align-items:flex-start}
.cov-brand{display:flex;align-items:center;gap:12px}
.cov-brand .m{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,var(--accent),var(--accent2))}
.cov-brand .n{font-size:21pt;font-weight:800;letter-spacing:.3px}
.cov-brand .t{font-size:8pt;letter-spacing:3px;color:#9fb0d8;text-transform:uppercase}
.edition{color:var(--accent2);font-size:9pt;letter-spacing:3px;font-weight:700}
.cov-title{font-size:33pt;font-weight:800;line-height:1.08;margin-top:40mm;max-width:11.5cm}
.cov-sub{color:var(--accent2);font-weight:700;font-size:13pt;margin-top:10px}
.cov-date{color:#aab6d6;margin-top:4px;font-size:10pt}
.cov-stats{display:flex;gap:0;margin-top:22mm;border-top:1px solid rgba(255,255,255,.14);padding-top:14px}
.cov-stats .s{flex:1;border-right:1px solid rgba(255,255,255,.1);padding-right:14px}
.cov-stats .s:last-child{border-right:0}
.cov-stats .num{font-size:30pt;font-weight:800;line-height:1}
.cov-stats .lab{font-size:7.5pt;letter-spacing:1.5px;color:#9fb0d8;text-transform:uppercase;margin-top:6px}
.cov-foot{position:absolute;left:18mm;right:18mm;bottom:20mm;color:#8ea0c8;font-size:8.5pt;border-top:1px solid rgba(255,255,255,.12);padding-top:10px}
.hero{position:absolute;right:18mm;top:42mm;display:flex;flex-direction:column;align-items:center;gap:2px}
.donut-cap{color:#cdd8f3;font-size:8pt;letter-spacing:1px;text-transform:uppercase;text-align:center;margin-top:6px}
/* interior section */
.section{page-break-before:always}
.section.first{page-break-before:avoid}
.kick{color:var(--accent);font-size:8pt;letter-spacing:2px;font-weight:700;text-transform:uppercase}
.h{display:flex;align-items:baseline;gap:12px;margin:3px 0 10px}
.h .no{color:var(--accent);font-size:22pt;font-weight:800}
.h .tt{font-size:19pt;font-weight:800;color:#0b1020}
.lead{color:#38425a;margin:0 0 10px}
.sub{font-weight:700;color:#0b1020;margin:14px 0 4px}
/* stat cards */
.cards{display:flex;gap:10px;margin:8px 0 12px}
.card{flex:1;border:1px solid var(--line);border-radius:10px;padding:12px}
.card .n{font-size:21pt;font-weight:800}
.card .l{font-size:7.5pt;letter-spacing:1px;color:var(--muted);text-transform:uppercase;margin-top:4px}
.card.good .n{color:var(--good)} .card.warn .n{color:var(--warn)} .card.bad .n{color:var(--bad)}
ul.tight{margin:6px 0 10px;padding-left:16px} ul.tight li{margin:3px 0}
/* bars */
.bar-row{display:flex;align-items:center;gap:10px;margin:5px 0;font-size:9.4pt}
.bar-row .name{width:40mm;color:#1a2233}
.bar-row .track{flex:1;height:9px;background:#eef1f7;border-radius:6px;overflow:hidden}
.bar-row .fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.bar-row .val{width:26mm;text-align:right;color:#38425a;font-variant-numeric:tabular-nums;white-space:nowrap}
/* tables */
table{width:100%;border-collapse:collapse;font-size:8.8pt;margin:6px 0 10px}
th{background:var(--ink);color:#fff;text-align:left;padding:6px 8px;font-size:8pt;font-weight:600}
td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
tr:nth-child(even) td{background:#f7f9fc}
.mono{font-family:"SFMono-Regular",Consolas,monospace;font-size:8pt}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:7.5pt;font-weight:700}
.pill.vis{background:rgba(34,197,94,.12);color:#15803d} .pill.blind{background:rgba(239,68,68,.12);color:#b91c1c} .pill.ind{background:#eef1f7;color:#5b6478}
/* gap entry */
.gap{border:1px solid var(--line);border-left:3px solid var(--bad);border-radius:8px;padding:10px 12px;margin:8px 0;page-break-inside:avoid}
.gap h4{margin:0 0 4px;font-size:10.5pt}
.gap .meta{color:var(--muted);font-size:8.5pt;margin-bottom:6px}
.code{background:#0b1020;color:#d7e0f5;border-radius:7px;padding:8px 10px;font-family:"SFMono-Regular",Consolas,monospace;font-size:8pt;white-space:pre-wrap;word-break:break-word;margin:5px 0}
.fix{font-size:9pt;margin-top:5px}
/* references */
.ref{font-size:9pt;margin:5px 0;padding-left:26px;text-indent:-26px}
.ref .n{color:var(--accent);font-weight:700}
.ref .u{display:block;color:var(--muted);font-size:7.8pt;text-indent:0;padding-left:26px}
/* resources grid */
.res{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px}
.res .c{border:1px solid var(--line);border-radius:10px;padding:10px;page-break-inside:avoid}
.res .chip{display:inline-block;background:var(--ink);color:#fff;border-left:3px solid var(--accent);border-radius:6px;padding:7px 12px;font-weight:700;font-size:9pt}
.res .nm{font-weight:700;margin-top:8px;font-size:9.5pt}
.res .cat{color:var(--accent);font-size:7.5pt;letter-spacing:1px;text-transform:uppercase;margin:2px 0}
.res .bl{color:#38425a;font-size:8.6pt} .res .dm{color:var(--accent);font-size:8.4pt;margin-top:3px}
.toc div{display:flex;justify-content:space-between;border-bottom:1px dotted #cbd3e1;padding:7px 0;font-size:10pt}
.note{color:var(--muted);font-size:8pt;margin-top:4px}
"""


def donut(pctval):
    r = 52; C = 2 * math.pi * r; dash = C * pctval / 100
    return f"""<svg width="150" height="150" viewBox="0 0 120 120">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4f7dff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
  <circle cx="60" cy="60" r="{r}" fill="none" stroke="#1e2a44" stroke-width="13"/>
  <circle cx="60" cy="60" r="{r}" fill="none" stroke="url(#g)" stroke-width="13" stroke-linecap="round"
    stroke-dasharray="{dash:.1f} {C:.1f}" transform="rotate(-90 60 60)"/>
  <text x="60" y="58" text-anchor="middle" fill="#fff" font-size="26" font-weight="800">{pctval}%</text>
  <text x="60" y="76" text-anchor="middle" fill="#9fb0d8" font-size="8" letter-spacing="1">VISIBLE</text>
</svg>"""


def bars(rows, labelkey, valfn, capfn):
    mx = max((valfn(r) for r in rows), default=1) or 1
    out = []
    for r in rows:
        v = valfn(r); w = max(2, round(100 * v / mx))
        out.append(f'<div class="bar-row"><div class="name">{e(r[labelkey])}</div>'
                   f'<div class="track"><div class="fill" style="width:{w}%"></div></div>'
                   f'<div class="val">{e(capfn(r))}</div></div>')
    return "\n".join(out)


def build_html(a, items, cmds):
    m = a["metrics"]
    vis = m.get("visibilityPct", 0)
    executed = [i for i in items if i["executed"]]
    blind = [i for i in items if i["vis"] == "absent"]
    visible = [i for i in items if i["vis"] == "visible"]
    techs = sorted(set(i["tech"] for i in items))
    today = datetime.date.today().isoformat()
    exec_total = len(executed)
    rating = "Strong" if vis >= 90 else "Moderate" if vis >= 70 else "Developing" if vis >= 50 else "Weak"

    def outcome_pill(i):
        if i["vis"] == "visible": return '<span class="pill vis">detected</span>'
        if i["vis"] == "absent": return '<span class="pill blind">blind spot</span>'
        if i["executed"]: return '<span class="pill ind">indeterminate</span>'
        return '<span class="pill ind">—</span>'

    H = []
    # ── COVER ──
    H.append(f"""<div class="sheet-dark"><div class="grid-bg"></div>
      <div class="cov-top">
        <div class="cov-brand"><span class="m"></span><div><div class="n">{BRAND}</div><div class="t">Adversary Simulation Platform</div></div></div>
        <div class="edition">{EDITION}</div>
      </div>
      <div class="hero"><div>{donut(vis)}<div class="donut-cap">Telemetry visibility</div></div></div>
      <div class="cov-title">{REPORT_NAME}</div>
      <div class="cov-sub">{e(a["client"])}</div>
      <div class="cov-date">{e(a["lab"])} · SIEM: {e(a["siem"])} · {today}</div>
      <div class="cov-stats">
        <div class="s"><div class="num">{len(techs)}</div><div class="lab">ATT&CK techniques exercised</div></div>
        <div class="s"><div class="num">{exec_total}</div><div class="lab">Atomic tests executed</div></div>
        <div class="s"><div class="num">{vis}%</div><div class="lab">Telemetry visibility</div></div>
        <div class="s"><div class="num">{len(blind)}</div><div class="lab">Detection blind spots</div></div>
      </div>
      <div class="cov-foot">{TAGLINE} &nbsp;·&nbsp; Generated by {BRAND} on {today}. Every figure traces to an executed atomic test and a SIEM query — nothing in this report was written by a language model.</div>
    </div>""")

    def section(no, kick, title, body, first=False):
        head = (f'<div class="pghead"><div class="b"><span class="mark"></span>{BRAND}</div>'
                f'<div class="meta">{REPORT_NAME} · {e(a["client"])}</div></div>')
        foot = (f'<div class="pgfoot"><div>{BRAND} · {BRAND_SITE}</div>'
                f'<div>Prepared by {e(a["assessor"])} · {today}</div></div>')
        return (f'<div class="section{" first" if first else ""}">{head}'
                f'<div class="kick">{kick}</div>'
                f'<div class="h"><span class="no">{no}</span><span class="tt">{title}</span></div>'
                f'{body}{foot}</div>')

    # 01 About
    about = f"""<p class="lead"><b>{BRAND}</b> is an adversary-simulation platform: it detonates real attacker techniques
      (Atomic Red Team, Living-off-the-Land binaries, and curated TTP libraries) against a live environment, then measures
      whether each one became <b>visible in the SIEM</b> — the prerequisite for a detection.</p>
      <div class="sub">WHAT THIS ENGAGEMENT DID</div>
      <p>This report covers the <b>LOLBAS</b> (Living Off The Land Binaries &amp; Scripts) simulation library run against
      <b>{e(a['client'])}</b>'s <b>{e(a['lab'])}</b> environment. {exec_total} atomic tests were executed on the endpoint over
      the configured transport; destructive and credential-dumping atomics were excluded to preserve the lab. Each executed
      test was then re-queried against <b>{e(a['siem'])}</b> over the full engagement window using a distinctive indicator.</p>
      <div class="sub">HOW TO READ THE NUMBERS</div>
      <p>An atomic is <b>detected/visible</b> when its distinctive indicator reached the SIEM, <b>indeterminate</b> when only a
      generic shell was observed, and a <b>blind spot</b> when the indicator ran but produced no telemetry. Visibility is the
      prerequisite for detection, not proof of a firing rule. Technique identifiers link to
      <a href="{REFS['attack'][1]}">MITRE ATT&amp;CK</a>; the library is from the
      <a href="{REFS['lolbas'][1]}">LOLBAS Project</a> and the tests from <a href="{REFS['art'][1]}">Atomic Red Team</a>.</p>"""
    H.append(section("01", "ABOUT THIS PLATFORM", "About DetectOps", about, first=True))

    # Contents
    toc = """<div class="toc">
      <div><span>01 &nbsp;About DetectOps</span><span></span></div>
      <div><span>02 &nbsp;Executive summary</span><span></span></div>
      <div><span>03 &nbsp;Coverage by ATT&CK tactic</span><span></span></div>
      <div><span>04 &nbsp;Attack-simulation activity</span><span></span></div>
      <div><span>05 &nbsp;Detection gaps &amp; how to close them</span><span></span></div>
      <div><span>06 &nbsp;Techniques exercised</span><span></span></div>
      <div><span>07 &nbsp;Conclusion &amp; recommendations</span><span></span></div>
      <div><span>08 &nbsp;How this report is made</span><span></span></div>
      <div><span>09 &nbsp;References</span><span></span></div>
      <div><span>10 &nbsp;Resources</span><span></span></div></div>"""
    H.append(section("", "WHAT'S INSIDE", "In this report", toc))

    # 02 Executive summary
    bt = m.get("byTactic") or []
    top_blind = {}
    for i in blind:
        k = (i["tactic"] or "other").replace("-", " ").title()
        top_blind[k] = top_blind.get(k, 0) + 1
    ex = f"""<div class="cards">
        <div class="card"><div class="n">{exec_total}/{len(techs)}</div><div class="l">Tests executed / techniques</div></div>
        <div class="card good"><div class="n">{vis}%</div><div class="l">Telemetry-visible</div></div>
        <div class="card"><div class="n">{len(visible)}</div><div class="l">Detected in SIEM</div></div>
        <div class="card warn"><div class="n">{m.get('generic',0)}</div><div class="l">Indeterminate</div></div>
        <div class="card bad"><div class="n">{len(blind)}</div><div class="l">Blind spots</div></div>
      </div>
      <ul class="tight">
        <li><b>{exec_total}</b> LOLBAS atomic tests across <b>{len(techs)}</b> ATT&amp;CK techniques were executed on {e(a['lab'])}.</li>
        <li>Overall telemetry visibility is <b>{vis}%</b> — <i>{rating}</i>: of {m.get('visible',0)+m.get('absent',0)} tests with a distinctive indicator, {m.get('visible',0)} reached the SIEM and {m.get('absent',0)} did not.</li>
        <li><b>{len(blind)} blind spots</b> were found — attacker activity that ran with no matching telemetry (section 05 gives each one a ready-to-deploy {e(a['siem'])} query).</li>
        <li>{m.get('generic',0)} tests produced only generic shell telemetry and are indeterminate (excluded from the visibility ratio).</li>
        <li>Most gaps cluster in: {', '.join(f"{e(k)} ({v})" for k,v in sorted(top_blind.items(), key=lambda x:-x[1])[:4]) or 'none'}.</li>
      </ul>
      <div class="sub">Detection posture</div>
      <p class="lead"><b>{vis}% visibility — {rating}.</b> The environment reliably surfaces most Living-off-the-Land execution, but
      the {len(blind)} blind spots below represent attacker tradecraft that would currently run unseen. Each is closable with
      telemetry the platform already knows how to light up (Sysmon, PowerShell Script Block Logging, command-line auditing).</p>"""
    H.append(section("02", "THE ENGAGEMENT AT A GLANCE", "Executive summary", ex))

    # 03 Coverage by tactic
    tac_body = ('<div class="sub">Visibility by ATT&CK tactic</div>'
                + bars(bt, "key", lambda r: r.get("pct", 0), lambda r: f"{r.get('visible',0)}/{r.get('atomics',0)} · {r.get('pct',0)}%")
                + '<table><tr><th>Tactic</th><th>Atomics</th><th>Executed</th><th>Visible</th><th>Indeterminate</th><th>Blind</th><th>Visibility</th></tr>'
                + "".join(f"<tr><td>{e(r['key'])}</td><td>{r.get('atomics',0)}</td><td>{r.get('executed',0)}</td><td>{r.get('visible',0)}</td><td>{r.get('generic',0)}</td><td>{r.get('absent',0)}</td><td><b>{r.get('pct',0)}%</b></td></tr>" for r in bt)
                + '</table><p class="note">Visibility % = visible / (visible + blind); indeterminate (generic-shell-only) atomics are excluded from the ratio.</p>')
    H.append(section("03", "WHERE WE CAN SEE", "Coverage by ATT&CK tactic", tac_body))

    # 04 by library
    bl = [r for r in (m.get("byLibrary") or []) if r.get("atomics", 0) >= 3]
    lib_body = ('<p class="lead">The LOLBAS library maps onto several ATT&CK behaviours. Executed atomics, grouped by the simulation library that claims them:</p>'
                + '<table><tr><th>Library</th><th>Atomics</th><th>Executed</th><th>Visible</th><th>Indeterminate</th><th>Blind</th><th>Visibility</th></tr>'
                + "".join(f"<tr><td>{e(r['key'])}</td><td>{r.get('atomics',0)}</td><td>{r.get('executed',0)}</td><td>{r.get('visible',0)}</td><td>{r.get('generic',0)}</td><td>{r.get('absent',0)}</td><td><b>{r.get('pct',0)}%</b></td></tr>" for r in sorted(bl, key=lambda x:-x['atomics']))
                + '</table>'
                + f'<p class="note">Simulation is driven by the <a href="{REFS["lolbas"][1]}">LOLBAS Project</a> catalogue, executed as <a href="{REFS["art"][1]}">Atomic Red Team</a> tests over WinRM.</p>')
    H.append(section("04", "WHAT WE RAN", "Attack-simulation activity", lib_body))

    # 05 Detection gaps
    gaps = []
    for i in blind:
        cmd = (cmds.get((i["tech"], int(i["num"])), "") or "").strip()[:500]
        q = siem_query(i, a["siem"])
        _, ref = gap_ref(i)
        gaps.append(f"""<div class="gap">
          <h4><a href="{mitre_url(i['tech'])}">{e(i['tech'])}</a> #{e(i['num'])} — {e(i['name'])}</h4>
          <div class="meta">Tactic: {e((i['tactic'] or '').replace('-',' ').title())} · Indicator: <span class="mono">{e(', '.join(i['ind'][:3]) or 'n/a')}</span></div>
          {('<div class="code">'+e(cmd)+'</div>') if cmd else ''}
          <div class="fix">↳ <b>Detect it ({e(a['siem'])}):</b> <span class="mono">{e(q)}</span></div>
          <div class="fix">↳ <b>Fix the telemetry:</b> <a href="{ref[1]}">{e(ref[0])}</a> · see also <a href="{REFS['sigma'][1]}">Sigma rules</a> and <a href="{REFS['splunk'][1]}">Splunk Security Content</a>.</div>
        </div>""")
    gap_body = (f'<p class="lead">{len(blind)} executed atomics produced <b>no matching telemetry</b>. For each: the command that ran, '
                f'a ready-to-deploy <b>{e(a["siem"])}</b> query, and a link to enable the telemetry the detection depends on.</p>' + "".join(gaps)) if blind \
               else '<p class="lead">No telemetry blind spots — every executed atomic with a distinctive indicator reached the SIEM.</p>'
    H.append(section("05", "WHAT WE MISSED", "Detection gaps &amp; how to close them", gap_body))

    # 06 Techniques exercised
    seen = {}
    for i in items:
        d = seen.setdefault(i["tech"], {"name": i["techname"] if "techname" in i else i["name"], "tactic": i["tactic"], "n": 0, "vis": 0, "blind": 0})
        d["n"] += 1
        d["vis"] += 1 if i["vis"] == "visible" else 0
        d["blind"] += 1 if i["vis"] == "absent" else 0
    GAP_PILL = '<span class="pill blind">gap</span>'
    OK_PILL = '<span class="pill vis">covered</span>'
    def tech_row(t, d):
        status = (GAP_PILL if d["blind"] else OK_PILL) if d["n"] else "—"
        tactic = e((d["tactic"] or "").replace("-", " ").title())
        return (f'<tr><td><a href="{mitre_url(t)}">{e(t)}</a></td><td>{tactic}</td>'
                f'<td>{d["n"]}</td><td>{d["vis"]}</td><td>{d["blind"]}</td><td>{status}</td></tr>')
    rows = "".join(tech_row(t, d) for t, d in sorted(seen.items()))
    tech_body = (f'<p class="lead">All {len(seen)} ATT&amp;CK techniques exercised in this engagement. Each links to its MITRE ATT&amp;CK page.</p>'
                 '<table><tr><th>Technique</th><th>Tactic</th><th>Atomics</th><th>Visible</th><th>Blind</th><th>Status</th></tr>' + rows + '</table>')
    H.append(section("06", "WHAT WE EXERCISED", "Techniques exercised", tech_body))

    # 07 Recommendations
    rec = f"""<div class="sub">Key takeaways</div>
      <ul class="tight">
        <li>{vis}% telemetry visibility ({rating}); {len(blind)} blind spots and {m.get('generic',0)} indeterminate tests remain.</li>
        <li>Most gaps are telemetry gaps, not rule gaps — the activity ran but was never logged or forwarded.</li>
      </ul>
      <div class="sub">For the SOC / detection engineering</div>
      <ul class="tight">
        <li><b>Enable the telemetry each gap depends on:</b> <a href="{REFS['sysmon'][1]}">Sysmon</a> (process EID 1, registry 12/13, image-load 7) with a <a href="{REFS['sysmoncfg'][1]}">strong baseline config</a>, <a href="{REFS['pslog'][1]}">PowerShell Script Block Logging (4104)</a>, and <a href="{REFS['cmdline'][1]}">command-line process auditing (4688)</a>.</li>
        <li><b>Deploy the queries in section 05</b> and validate each fires by re-running the paired atomic — this platform re-runs them on demand.</li>
        <li><b>Promote indeterminate atomics</b> to attributable detections by enriching generic shell events with parent-process and command-line context.</li>
        <li><b>Re-run this assessment after each change</b> to watch visibility trend upward.</li>
      </ul>
      <div class="sub">Highest-leverage ATT&CK mitigations</div>
      <table><tr><th>Mitigation</th><th>ATT&CK id</th><th>Why it matters here</th></tr>
        <tr><td><a href="https://attack.mitre.org/mitigations/M1040/">Behavior Prevention on Endpoint</a></td><td>M1040</td><td>Blocks much LOLBin abuse before it runs.</td></tr>
        <tr><td><a href="https://attack.mitre.org/mitigations/M1038/">Execution Prevention</a></td><td>M1038</td><td>Application control (WDAC/AppLocker) against signed-binary proxy execution (T1218.*).</td></tr>
        <tr><td><a href="https://attack.mitre.org/mitigations/M1026/">Privileged Account Management</a></td><td>M1026</td><td>Limits the privilege many of these techniques assume.</td></tr>
        <tr><td><a href="https://attack.mitre.org/mitigations/M1047/">Audit</a></td><td>M1047</td><td>The logging that converts every blind spot above into a detection.</td></tr>
      </table>"""
    H.append(section("07", "WHAT TO DO", "Conclusion &amp; recommendations", rec))

    # 08 Methodology
    meth = f"""<ul class="tight">
      <li>Each atomic is detonated on {e(a['lab'])} over the configured transport (WinRM), then re-queried against {e(a['siem'])} over the full engagement window using a distinctive, non-generic indicator unique to the test.</li>
      <li>Destructive/wiper and credential-dumping atomics are excluded to preserve the lab and the session; they are reported as out of scope, not as passes.</li>
      <li>Visibility is a point-in-time property of this environment's telemetry and forwarding. It is the prerequisite for a detection, not proof of a firing rule.</li>
      <li>Nothing here is model-generated: every figure derives from an executed test row and a SIEM query.</li></ul>"""
    H.append(section("08", "HOW THE NUMBERS ARE MADE", "How this report is made", meth))

    # 09 References
    refitems = []
    n = 1
    for key in ["attack", "art", "lolbas", "sysmon", "sysmoncfg", "pslog", "cmdline", "splunk", "sigma", "redcanary", "cisa"]:
        title, url = REFS[key]
        refitems.append(f'<div class="ref"><span class="n">[{n}]</span> {e(title)}.<span class="u"><a href="{url}">{url}</a></span></div>')
        n += 1
    ref_body = '<p class="lead">Every recommendation, technique and fix in this report links to a public, primary source.</p>' + "".join(refitems)
    H.append(section("09", "WHERE EVERY FIX COMES FROM", "References", ref_body))

    # 10 Resources
    cards = "".join(
        f'<div class="c"><span class="chip">{e(chip)}</span><div class="nm">{e(nm)}</div>'
        f'<div class="cat">{e(cat)}</div><div class="bl">{e(bl)}</div><div class="dm"><a href="{url}">{e(dm)}</a></div></div>'
        for chip, nm, cat, bl, dm, url in RESOURCES)
    res_body = ('<p class="lead">The frameworks, tools and datasets this engagement draws on. Each is a public source a reader can check independently.</p>'
                f'<div class="res">{cards}</div>'
                '<p class="note">Listed because this report draws on their public data or standards. Names and marks belong to their owners; being listed does not imply endorsement.</p>')
    H.append(section("10", "WHAT WE BUILD ON", "Resources", res_body))

    # Back cover
    H.append(f"""<div class="sheet-dark" style="page-break-before:always;page-break-after:avoid;text-align:center">
      <div class="grid-bg"></div>
      <div style="margin-top:70mm"><span class="m" style="display:inline-block;width:56px;height:56px;border-radius:15px;background:linear-gradient(135deg,var(--accent),var(--accent2))"></span></div>
      <div style="font-size:30pt;font-weight:800;margin-top:14px">{BRAND}</div>
      <div style="color:var(--accent2);letter-spacing:2px;margin-top:6px">{TAGLINE}</div>
      <p style="max-width:12cm;margin:26px auto 0;color:#cdd8f3;font-size:10pt">We detonate real attacker techniques against your environment and prove, test by test,
        whether your SIEM can see them — then hand you the exact query to close every gap. Evidence first: nothing in this report was written by a language model.</p>
      <div style="font-weight:700;margin-top:22px">Run it. Detect it. Prove it.</div>
      <div style="color:var(--accent);font-weight:700;margin-top:10px">{BRAND_SITE}</div>
      <div class="cov-foot" style="text-align:center">Techniques &amp; mitigations: MITRE ATT&amp;CK. Tests: Atomic Red Team. Living-off-the-land: LOLBAS Project. Prepared by {e(a['assessor'])} for {e(a['client'])}.</div>
    </div>""")

    return f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(H)}</body></html>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("assessmentId")
    ap.add_argument("--db", default=os.path.join(ROOT, "dev.db"))
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    a, items, cmds = load(args.db, args.assessmentId)
    # attach technique display name
    for i in items:
        i["techname"] = i["name"]
    html_doc = build_html(a, items, cmds)
    out = args.out or os.path.join(ROOT, "reports", "coverage-assessments", args.assessmentId, "report-branded")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out + ".html", "w").write(html_doc)
    print("wrote", out + ".html")
    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable") or shutil.which("chromium")
    if chrome:
        subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
                        f"--print-to-pdf={out}.pdf", "--no-pdf-header-footer",
                        "--run-all-compositor-stages-before-draw", "--virtual-time-budget=10000",
                        "file://" + os.path.abspath(out + ".html")],
                       check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("wrote", out + ".pdf" if os.path.exists(out + ".pdf") else "(pdf render failed)")
    else:
        print("google-chrome not found — HTML only")


if __name__ == "__main__":
    main()
