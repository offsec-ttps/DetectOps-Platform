#!/usr/bin/env python3
"""
Minimal WinRM runner for LOTL execution against a Windows target (e.g. the SAR
Windows DC). Reads a JSON job from stdin and prints a JSON result to stdout, so
the Node executor can shell to it the same way the SAR pipeline shells to Python
tooling. Uses pywinrm (NTLM), which the rest of the platform already relies on.

stdin  : {"host","port","user","password","shell":"powershell|cmd","script","timeoutSec",
          "scheme":"http|https","certValidation":"validate|ignore"}
stdout : {"ok":true,"rc":int,"stdout":str,"stderr":str}  (ok:false + "error" on transport failure)

Secrets arrive on stdin only — never argv — so they do not appear in the process
list. This helper neither logs nor persists anything.

Transport security: WinRM over HTTP (5985) is what the SAR Attack Range exposes
(5986/HTTPS is not enabled on the lab DC). To avoid sending credentials or command
output in cleartext on that channel, we force NTLM MESSAGE-LEVEL ENCRYPTION
(message_encryption='always'): the SOAP body is encrypted end-to-end even over
http://. When a target DOES expose HTTPS, pass scheme="https" (default port 5986);
certValidation defaults to "ignore" for a lab's self-signed cert but can be set to
"validate" with a trusted CA. So the HTTP default is encrypted, and HTTPS is a
one-field opt-in — neither path is plaintext.
"""
import sys, json

def main():
    try:
        job = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad job json: {e}"})); return
    try:
        import winrm
    except Exception:
        print(json.dumps({"ok": False, "error": "pywinrm not installed in this interpreter"})); return

    host = job["host"]
    scheme = job.get("scheme", "http")
    port = int(job.get("port") or (5986 if scheme == "https" else 5985))
    endpoint = f"{scheme}://{host}:{port}/wsman"
    try:
        s = winrm.Session(
            endpoint,
            auth=(job["user"], job["password"]),
            transport="ntlm",
            # Encrypt the WinRM payload at the message layer regardless of scheme,
            # so credentials/commands are never cleartext on an http:// channel.
            message_encryption="always",
            server_cert_validation=("validate" if job.get("certValidation") == "validate" else "ignore"),
            read_timeout_sec=int(job.get("timeoutSec", 120)) + 15,
            operation_timeout_sec=int(job.get("timeoutSec", 120)),
        )
        if job.get("shell") == "cmd":
            r = s.run_cmd(job["script"])
        else:
            # Silence the PowerShell progress stream, which otherwise floods
            # stderr with CLIXML <Obj S="progress"> noise on every run_ps call.
            r = s.run_ps("$ProgressPreference='SilentlyContinue';\n" + job["script"])
        print(json.dumps({
            "ok": True,
            "rc": r.status_code,
            "stdout": r.std_out.decode("utf-8", "replace"),
            "stderr": r.std_err.decode("utf-8", "replace"),
        }))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)[:500]}))

if __name__ == "__main__":
    main()
