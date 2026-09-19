"""SentinelFlow smoke test — validates all endpoints without external services.

Run: cd backend && source .venv/bin/activate && python test_smoke.py
"""

import asyncio
import json
import sys

from httpx import ASGITransport, AsyncClient

from app.main import app

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
INFO = "\033[94mINFO\033[0m"


async def main():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        results = []

        # ── 1. Health check ──
        print(f"\n{'='*60}")
        print("  SentinelFlow Backend — Smoke Tests")
        print(f"{'='*60}\n")

        r = await c.get("/health")
        ok = r.status_code == 200 and r.json()["status"] == "ok"
        results.append(ok)
        print(f"[{PASS if ok else FAIL}] GET /health")
        print(f"  {INFO} Status: {r.json()['status']}")
        print(f"  {INFO} Services: {json.dumps(r.json()['services'], indent=2)}")

        # ─��� 2. OpenAPI docs accessible ──
        r = await c.get("/openapi.json")
        ok = r.status_code == 200 and "paths" in r.json()
        results.append(ok)
        paths = list(r.json()["paths"].keys())
        print(f"\n[{PASS if ok else FAIL}] GET /openapi.json")
        print(f"  {INFO} {len(paths)} paths registered: {paths}")

        # ── 3. Trigger pipeline (single technique) ──
        r = await c.post("/pipeline/trigger", json={
            "techniques": [{"technique_id": "T1059.001"}],
            "target_server": "ar-win-dc-default-pc-1",
            "siem_targets": "splunk",
            "lab_provider": "local",
            "auto_report": False,
        })
        ok = r.status_code == 202
        results.append(ok)
        run_id = r.json().get("run_id", "")
        print(f"\n[{PASS if ok else FAIL}] POST /pipeline/trigger (single technique)")
        print(f"  {INFO} Run ID: {run_id}")
        print(f"  {INFO} Response: {json.dumps(r.json(), indent=2)}")

        # Give background task a moment to start and fail (SAR unreachable)
        await asyncio.sleep(1)

        # ── 4. Check status ��─
        r = await c.get(f"/pipeline/{run_id}/status")
        ok = r.status_code == 200
        results.append(ok)
        status_data = r.json()
        print(f"\n[{PASS if ok else FAIL}] GET /pipeline/{run_id}/status")
        print(f"  {INFO} Pipeline status: {status_data['status']}")
        print(f"  {INFO} Progress: {json.dumps(status_data['progress'], indent=2)}")
        if status_data.get("error"):
            print(f"  {INFO} Error (expected — SAR not running): {status_data['error'][:80]}...")

        # ── 5. Trigger pipeline (batch techniques) ──
        r = await c.post("/pipeline/trigger", json={
            "techniques": [
                {"technique_id": "T1059.001"},
                {"technique_id": "T1003.001"},
                {"technique_id": "T1053.005"},
            ],
            "target_server": "ar-win-dc-default-pc-1",
            "siem_targets": "both",
            "auto_report": True,
        })
        ok = r.status_code == 202 and r.json()["techniques_count"] == 3
        results.append(ok)
        run_id_2 = r.json()["run_id"]
        print(f"\n[{PASS if ok else FAIL}] POST /pipeline/trigger (batch: 3 techniques, both SIEMs)")
        print(f"  {INFO} Run ID: {run_id_2}")
        print(f"  {INFO} Techniques count: {r.json()['techniques_count']}")

        await asyncio.sleep(1)

        # ── 6. List runs ──
        r = await c.get("/pipeline/runs")
        ok = r.status_code == 200 and r.json()["total"] >= 2
        results.append(ok)
        print(f"\n[{PASS if ok else FAIL}] GET /pipeline/runs")
        print(f"  {INFO} Total runs: {r.json()['total']}")
        for run in r.json()["runs"]:
            print(f"  {INFO}   {run['run_id']} — {run['status']} ({run['techniques_count']} techniques)")

        # ── 7. List runs with status filter ──
        r = await c.get("/pipeline/runs?status=failed")
        ok = r.status_code == 200
        results.append(ok)
        print(f"\n[{PASS if ok else FAIL}] GET /pipeline/runs?status=failed")
        print(f"  {INFO} Filtered total: {r.json()['total']}")

        # ── 8. Report endpoint (on failed run) ──
        r = await c.post(f"/pipeline/{run_id}/report", json={
            "pipeline_run_id": run_id,
        })
        ok = r.status_code in (200, 409)  # 409 if still running, 200 if done
        results.append(ok)
        print(f"\n[{PASS if ok else FAIL}] POST /pipeline/{run_id}/report")
        print(f"  {INFO} Status code: {r.status_code}")

        # ── 9. 404 for unknown run ──
        r = await c.get("/pipeline/run-nonexistent/status")
        ok = r.status_code == 404
        results.append(ok)
        print(f"\n[{PASS if ok else FAIL}] GET /pipeline/run-nonexistent/status -> 404")

        # ── 10. Lab ranges (SAR unreachable) ──
        r = await c.get("/lab/ranges")
        ok = r.status_code == 502  # Expected: SAR not running
        results.append(ok)
        print(f"\n[{PASS if ok else FAIL}] GET /lab/ranges -> 502 (SAR unreachable, expected)")

        # ── Summary ──
        passed = sum(results)
        total = len(results)
        print(f"\n{'='*60}")
        print(f"  Results: {passed}/{total} passed")
        if passed == total:
            print(f"  \033[92mAll tests passed!\033[0m")
        else:
            print(f"  \033[91m{total - passed} test(s) failed\033[0m")
        print(f"{'='*60}\n")

        return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
