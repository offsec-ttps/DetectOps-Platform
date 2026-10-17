#!/usr/bin/env python3
"""Inventory every external resource the Atomic Red Team library needs to run.

For an offline / air-gapped lab, an atomic whose `get_prereq_command` downloads a
payload from the internet (ProcDump, PsExec, mimikatz, plink, …) cannot run until
that payload is staged locally. This tool reads the platform's `atomic_tests`
table and extracts, for every test, the external resources its dependencies and
input arguments require — producing a manifest an operator can mirror once and
serve to isolated endpoints.

Usage:
  python3 scripts/atomic_dependency_inventory.py [dev.db] [out_basepath]
Outputs <out_basepath>.json (full manifest) and <out_basepath>.md (summary).
Defaults: dev.db  ->  reports/atomic-dependency-inventory.{json,md}
"""
import sqlite3, json, re, collections, sys, datetime

DB = sys.argv[1] if len(sys.argv) > 1 else "dev.db"
OUT = sys.argv[2] if len(sys.argv) > 2 else "reports/atomic-dependency-inventory"

URL_RE = re.compile(r'https?://[^\s"\'\\\)\]<>]+')
EXT_RE = re.compile(
    r'\.(exe|dll|sys|elf|so|bin|ps1|psm1|bat|cmd|vbs|js|hta|htm|html|sh|py|jar|'
    r'zip|7z|gz|tar|msi|iso|dmg|pkg|apk|docx?|docm|xlsx?|xlsm|pptx?|pptm|pdf|png|'
    r'jpe?g|lnk|scr|cpl|reg|xml|ya?ml|txt|csv|dat)\b', re.I)


def plats(s):
    try:
        return [p.lower() for p in json.loads(s or "[]")]
    except Exception:
        return []


def primary_platform(pl):
    for p in ("windows", "linux", "macos", "containers"):
        if p in pl:
            return p
    return pl[0] if pl else "unknown"


def main():
    con = sqlite3.connect(DB)
    rows = con.execute(
        "SELECT techniqueId, testNumber, testName, platforms, dependencies FROM atomic_tests"
    ).fetchall()
    con.close()

    total = len(rows)
    with_deps = 0
    with_fetch = 0
    url_to_atomics = collections.defaultdict(set)
    deps_by_platform = collections.Counter()
    ext_counts = collections.Counter()
    resources = {}

    for tid, num, name, platforms, deps_s in rows:
        pl = plats(platforms)
        try:
            deps = json.loads(deps_s or "[]")
        except Exception:
            deps = []
        if not deps:
            continue
        with_deps += 1
        deps_by_platform[primary_platform(pl)] += 1
        atom = f"{tid}#{num}"
        fetched = False
        for d in deps:
            gp = d.get("get_prereq_command", "") or ""
            for u in URL_RE.findall(gp):
                u = u.rstrip('.,;')
                url_to_atomics[u].add(atom)
                fetched = True
                if u not in resources:
                    m = EXT_RE.search(u)
                    resources[u] = {"ext": m.group(1).lower() if m else "other",
                                    "filename": u.split("/")[-1][:100]}
                    ext_counts[resources[u]["ext"]] += 1
        if fetched:
            with_fetch += 1

    summary = {
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "totalAtomics": total,
        "atomicsWithDependencies": with_deps,
        "atomicsWithDownloadablePrereq": with_fetch,
        "atomicsWithDepsByPlatform": dict(deps_by_platform),
        "distinctExternalResources": len(resources),
        "resourcesByType": dict(ext_counts.most_common()),
    }
    ranked = sorted(url_to_atomics.items(), key=lambda kv: -len(kv[1]))
    manifest = {
        "summary": summary,
        "resources": [
            {"url": u, "ext": resources[u]["ext"], "filename": resources[u]["filename"],
             "neededByCount": len(atoms), "neededBy": sorted(atoms)}
            for u, atoms in ranked
        ],
    }

    with open(OUT + ".json", "w") as f:
        json.dump(manifest, f, indent=2)

    lines = [
        "# Atomic Red Team — External Dependency Inventory", "",
        f"_Generated {summary['generatedAt']} from `{DB}`._", "",
        "External resources each atomic's `get_prereq_command` downloads from the "
        "internet. On an offline/air-gapped endpoint these must be staged locally "
        "before the atomic can run.", "",
        "## Summary", "",
        "| Metric | Count |", "|---|---|",
        f"| Atomics in library | {summary['totalAtomics']} |",
        f"| Atomics declaring dependencies | {summary['atomicsWithDependencies']} |",
        f"| Atomics that download a prereq (offline-blocking) | {summary['atomicsWithDownloadablePrereq']} |",
        f"| **Distinct external resources to stage** | **{summary['distinctExternalResources']}** |",
        "",
        "### Dependencies by platform", "", "| Platform | Atomics |", "|---|---|",
    ]
    for p, c in sorted(summary["atomicsWithDepsByPlatform"].items(), key=lambda kv: -kv[1]):
        lines.append(f"| {p} | {c} |")
    lines += ["", "### Resources by file type", "", "| Type | Distinct resources |", "|---|---|"]
    for ext, c in summary["resourcesByType"].items():
        lines.append(f"| {ext} | {c} |")
    lines += ["", "## All external resources (most-used first)", "",
              "| # atomics | Type | Resource |", "|---|---|---|"]
    for u, atoms in ranked:
        lines.append(f"| {len(atoms)} | {resources[u]['ext']} | {u} |")
    lines.append("")
    with open(OUT + ".md", "w") as f:
        f.write("\n".join(lines))

    print(json.dumps(summary, indent=2))
    print(f"\nwrote {OUT}.json and {OUT}.md ({len(resources)} resources)")


if __name__ == "__main__":
    main()
