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
    # Hardening: host is spliced into the WSMan URL, so it must be a bare
    # hostname / IP (no "/", "@", "?", "#" that would redirect the request to a
    # different endpoint), and only the PowerShell path is supported — the raw
    # "cmd" branch would run the whole command string as an executable name.
    import re
    if not isinstance(host, str) or not re.fullmatch(r"[A-Za-z0-9.\-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\]", host):
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": "invalid host"}))
        return
    if scheme not in ("http", "https") or transport not in ("basic", "ntlm", "kerberos", "credssp", "plaintext", "ssl", "certificate"):
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": "invalid scheme/transport"}))
        return
    if not (0 < port < 65536):
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": "invalid port"}))
        return
    if shell != "powershell":
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": "only shell=powershell is supported"}))
        return
    timeout = max(5, min(timeout, 3600))
    try:
        from winrm.protocol import Protocol
        proto_kwargs = dict(transport=transport, username=user, password=pw,
                            read_timeout_sec=timeout + 15, operation_timeout_sec=timeout)
        if scheme == "https":
            # Validate the server certificate by default. Only an explicit
            # certValidation:"ignore" in the request disables it (for a self-signed
            # lab); never silently skip validation. A ca_trust_path pins a CA.
            proto_kwargs["server_cert_validation"] = "ignore" if req.get("certValidation") == "ignore" else "validate"
            if req.get("caTrustPath"):
                proto_kwargs["ca_trust_path"] = req["caTrustPath"]
        p = Protocol(f"{scheme}://{host}:{port}/wsman", **proto_kwargs)
        if shell == "powershell":
            # Run via `powershell -EncodedCommand`, avoiding pywinrm's run_ps CLIXML
            # post-processing (buggy in some versions).
            import base64
            enc = base64.b64encode(command.encode("utf-16-le")).decode()
            exe, cmd_args = "powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc]
        else:
            exe, cmd_args = command, []
        # Low-level open/run/close with a guaranteed close_shell in finally: on a
        # command timeout or mid-run drop, the WSMan shell is still released so it
        # cannot leak and exhaust MaxShellsPerUser (which wedges WinRM over a long
        # sweep). This is the source fix for the recurring WinRM hang.
        shell_id = p.open_shell()
        try:
            command_id = p.run_command(shell_id, exe, cmd_args)
            try:
                std_out, std_err, status_code = p.get_command_output(shell_id, command_id)
            finally:
                try: p.cleanup_command(shell_id, command_id)
                except Exception: pass
            print(json.dumps({
                "exitCode": status_code,
                "stdout": std_out.decode(errors="replace"),
                "stderr": std_err.decode(errors="replace")[-4000:],
            }))
        finally:
            try: p.close_shell(shell_id)
            except Exception: pass
    except Exception as e:
        print(json.dumps({"exitCode": -1, "stdout": "", "stderr": f"winrm error: {e}"}))

if __name__ == "__main__":
    main()
