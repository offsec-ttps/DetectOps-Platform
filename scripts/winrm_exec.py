#!/usr/bin/env python3
"""
WinRM execution helper for the enterprise-use-case runner.

The Node runner spawns this script and pipes a single JSON object on stdin:
  {"host": "10.0.1.14", "user": "Administrator", "password": "...",
   "transport": "basic", "scheme": "http"|"https", "port": 5985,
   "shell": "powershell"|"cmd", "command": "<script>", "timeout": 120}

It runs the command on the Windows host over WinRM and prints a single JSON
object on stdout:
  {"exitCode": 0, "stdout": "...", "stderr": "..."}

SECURITY: `transport: basic` over `scheme: http` (port 5985) sends credentials
to the endpoint in CLEARTEXT (base64, not encrypted). Only use it on an isolated
lab network (e.g. a Splunk Attack Range host-only subnet), which is how SAR
provisions WinRM by default. For any routed/production network use
`scheme: https` (port 5986) or Kerberos/NTLM transport so credentials are
protected in transit. The password is read from stdin (never argv/env) so it does
not appear in the process table.

Requires `pywinrm`. Run this trusted helper with plain `python3` (not `-I`), which
keeps the user site-packages where `pywinrm` is installed on the path.
"""
import sys, json

def main():
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": f"bad request json: {e}"}))
        return
    try:
        import winrm
    except Exception as e:
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": f"pywinrm not installed: {e}"}))
        return
    host = req.get("host"); user = req.get("user"); pw = req.get("password")
    transport = req.get("transport", "basic")
    scheme = req.get("scheme", "http")
    port = int(req.get("port", 5986 if scheme == "https" else 5985))
    shell = req.get("shell", "powershell")
    command = req.get("command", "")
    timeout = int(req.get("timeout", 120))
    if not host or not user:
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": "host and user required"}))
        return
    try:
        sess_kwargs = dict(auth=(user, pw), transport=transport,
                           read_timeout_sec=timeout + 15, operation_timeout_sec=timeout)
        if scheme == "https":
            # Validate the server certificate by default. Only an explicit
            # certValidation:"ignore" in the request disables it (for a self-signed
            # lab); never silently skip validation. A ca_trust_path pins a CA.
            cv = "ignore" if req.get("certValidation") == "ignore" else "validate"
            sess_kwargs["server_cert_validation"] = cv
            if req.get("caTrustPath"):
                sess_kwargs["ca_trust_path"] = req["caTrustPath"]
        s = winrm.Session(f"{scheme}://{host}:{port}/wsman", **sess_kwargs)
        if shell == "powershell":
            # Run via `powershell -EncodedCommand` through run_cmd, avoiding
            # pywinrm's run_ps CLIXML post-processing (buggy in some versions).
            import base64
            enc = base64.b64encode(command.encode("utf-16-le")).decode()
            r = s.run_cmd("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc])
        else:
            r = s.run_cmd(command)
        print(json.dumps({
            "exitCode": r.status_code,
            "stdout": r.std_out.decode(errors="replace"),
            "stderr": r.std_err.decode(errors="replace")[-4000:],
        }))
    except Exception as e:
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": f"winrm error: {e}"}))

if __name__ == "__main__":
    main()
