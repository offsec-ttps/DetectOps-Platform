#!/usr/bin/env python3
"""Run a PowerShell script on an allowlisted lab host over WinRM (operator helper).

Credentials come from labs/winrm.config.json (same allowlist the runner uses) and
are passed to scripts/winrm_exec.py on stdin — never printed or put on argv.

Usage: python3 scripts/lab_ps.py <host> <script.ps1 | -> [--timeout 300]
"""
import argparse, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument("host")
ap.add_argument("script", help="path to a .ps1 file, or - for stdin")
ap.add_argument("--timeout", type=int, default=300)
args = ap.parse_args()

cfg = json.load(open(os.path.join(ROOT, "labs", "winrm.config.json")))
c = cfg.get(args.host)
if not c:
    sys.exit(f"host {args.host} is not in the WinRM allowlist")
cmd = sys.stdin.read() if args.script == "-" else open(args.script).read()
scheme = "https" if c.get("scheme") == "https" else "http"
req = {"host": args.host, "user": c["user"], "password": c.get("password", ""), "transport": c.get("transport", "basic"),
       "scheme": scheme, "port": int(c.get("port") or (5986 if scheme == "https" else 5985)),
       "shell": "powershell", "command": cmd, "timeout": args.timeout}
p = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "winrm_exec.py")], input=json.dumps(req),
                   capture_output=True, text=True, timeout=args.timeout + 60)
try:
    r = json.loads((p.stdout.strip().splitlines() or ["{}"])[-1])
except Exception:
    print(p.stdout[-4000:], p.stderr[-2000:]); sys.exit(1)
sys.stdout.write(r.get("stdout", ""))
if r.get("stderr"):
    sys.stderr.write(r["stderr"][-3000:])
sys.exit(0 if r.get("exitCode", 1) == 0 else 1)
