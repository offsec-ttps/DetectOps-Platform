#!/usr/bin/env python3
"""Validate config/ransomware-emulation/plans/*.json against the local atomic catalogue.

For every chain step: each testGuid must exist in atomic_tests (dev.db) and run on
Windows; steps must cite a declared source. Prints a per-gang availability matrix and
writes config/ransomware-emulation/VALIDATION.md. Exit 1 when any plan has errors.
"""
import glob, json, os, sqlite3, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANS = os.path.join(ROOT, "config", "ransomware-emulation", "plans")

db = sqlite3.connect(os.path.join(ROOT, "dev.db"))
atomics = {r[0]: r for r in db.execute("select testGuid, techniqueId, testNumber, testName, platforms from atomic_tests")}
gangs = {r[0] for r in db.execute("select name from ransomware_gangs")}

rows, failed = [], False
for path in sorted(glob.glob(os.path.join(PLANS, "*.json"))):
    errs = []
    try:
        plan = json.load(open(path))
    except Exception as e:
        rows.append((os.path.basename(path), 0, 0, 0, 0, [f"invalid JSON: {e}"])); failed = True; continue
    if plan.get("gang") not in gangs:
        errs.append(f"gang {plan.get('gang')!r} not in ransomware_gangs")
    src_ids = {s.get("id") for s in plan.get("sources", [])}
    steps = plan.get("chain", [])
    mapped = sig = 0
    for st in steps:
        if not set(st.get("sourceRefs", [])) & src_ids:
            errs.append(f"step {st.get('order')} {st.get('techniqueId')}: no valid sourceRefs")
        ok = 0
        for a in st.get("atomics", []):
            row = atomics.get(a.get("testGuid"))
            if not row:
                errs.append(f"step {st.get('order')}: testGuid {a.get('testGuid')} not in local catalogue")
            elif "windows" not in (row[4] or ""):
                errs.append(f"step {st.get('order')}: {row[1]}#{row[2]} is not a Windows test")
            else:
                ok += 1
        mapped += 1 if ok else 0
        sig += 1 if st.get("signature") else 0
    failed |= bool(errs)
    rows.append((plan.get("gang", path), len(steps), sig, mapped, len(steps) - mapped, errs))

out = ["# Ransomware emulation plan validation", "",
       "| Gang | Steps | Signature steps | Steps with atomics | Gaps | Errors |", "|---|---|---|---|---|---|"]
for g, n, s, m, gap, errs in rows:
    out.append(f"| {g} | {n} | {s} | {m} | {gap} | {len(errs)} |")
for g, *_, errs in rows:
    for e in errs:
        out.append(f"- **{g}**: {e}")
open(os.path.join(ROOT, "config", "ransomware-emulation", "VALIDATION.md"), "w").write("\n".join(out) + "\n")
print("\n".join(out))
sys.exit(1 if failed else 0)
