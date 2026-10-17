#!/usr/bin/env python3
"""Stage (download) the external dependencies of every Windows atomic that declares
one, so they persist locally on the endpoint for offline runs.

Drives POST /api/atomic-prereqs in chunks (each item is one WinRM round-trip that
may download a payload via Invoke-AtomicTest -GetPrereqs). Reads the (technique,
testNumber) set from the atomic_tests table.

Usage:
  python3 scripts/stage_all_windows_prereqs.py <environmentId> \
      [--base http://localhost:3000] [--db dev.db] [--chunk 8] [--budget 90] \
      [--out reports/atomic-prereq-staging]
"""
import sqlite3, json, sys, time, argparse, urllib.request, datetime

ap = argparse.ArgumentParser()
ap.add_argument("environmentId")
ap.add_argument("--base", default="http://localhost:3000")
ap.add_argument("--db", default="dev.db")
ap.add_argument("--chunk", type=int, default=8)
ap.add_argument("--budget", type=int, default=90)
ap.add_argument("--out", default="reports/atomic-prereq-staging")
a = ap.parse_args()

con = sqlite3.connect(a.db)
rows = con.execute(
    "SELECT techniqueId, testNumber FROM atomic_tests "
    "WHERE platforms LIKE '%windows%' AND dependencies <> '[]' AND dependencies <> '' "
    "ORDER BY techniqueId, testNumber"
).fetchall()
con.close()
items = [{"tech": t, "num": n} for t, n in rows]
print(f"{len(items)} Windows atomics declare a dependency; staging in chunks of {a.chunk}")

results, roll = [], {"satisfied": 0, "missing": 0, "n/a": 0, "failed": 0}
url = a.base.rstrip("/") + "/api/atomic-prereqs"
for i in range(0, len(items), a.chunk):
    chunk = items[i:i + a.chunk]
    body = json.dumps({"environmentId": a.environmentId, "techniques": chunk, "budgetSec": a.budget}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    timeout = a.chunk * a.budget + 120
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read().decode())
        for it in d.get("results", []):
            results.append(it)
            roll[it.get("status", "failed")] = roll.get(it.get("status", "failed"), 0) + 1
        got = {k: d.get(k) for k in ("satisfied", "missing", "na", "failed")}
    except Exception as e:
        for it in chunk:
            results.append({**it, "status": "failed", "tail": f"driver error: {e}"})
            roll["failed"] += 1
        got = f"ERROR {e}"
    print(f"  [{i+len(chunk):4d}/{len(items)}] {str(got):60s} ({time.time()-t0:.0f}s)")

summary = {"generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
           "environmentId": a.environmentId, "total": len(results), **roll}
with open(a.out + ".json", "w") as f:
    json.dump({"summary": summary, "results": results}, f, indent=2)

lines = ["# Atomic Red Team — Windows dependency staging", "",
         f"_Generated {summary['generatedAt']} against env `{a.environmentId}`._", "",
         "| Status | Count |", "|---|---|",
         f"| satisfied (staged/present) | {roll['satisfied']} |",
         f"| missing (still unmet) | {roll['missing']} |",
         f"| n/a (not on host) | {roll['n/a']} |",
         f"| failed | {roll['failed']} |",
         f"| **total** | **{len(results)}** |", ""]
with open(a.out + ".md", "w") as f:
    f.write("\n".join(lines))

print("\n=== summary ===")
print(json.dumps(summary, indent=2))
print(f"wrote {a.out}.json / .md")
