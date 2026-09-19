//! Job execution core: fetch a version-pinned bundle, verify its sha256, run
//! the declared executor with a hard timeout, ALWAYS run the cleanup, and
//! report a result.
//!
//! Security invariants (mirror the control plane):
//!   - The job carries only `bundle_hash` + addressing — never the command.
//!   - The agent fetches the bundle, re-hashes the served canonical bytes, and
//!     REFUSES to run on a mismatch.
//!   - Cleanup runs unconditionally (success, failure, or timeout) and its
//!     status is reported; a cleanup failure is surfaced, never swallowed.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use wait_timeout::ChildExt;

#[derive(Deserialize)]
pub struct Job {
    pub operation_id: String,
    pub technique: String,
    pub test_index: i64,
    pub bundle_hash: String,
    #[serde(default = "default_runtime")]
    pub max_runtime_ms: u64,
    // ── M5 security envelope ──
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub consent_ref: String,
    #[serde(default)]
    pub not_after: i64,        // unix seconds; job rejected after this
    #[serde(default)]
    pub signature: String,     // ed25519 over the canonical message, base64
}
fn default_runtime() -> u64 { 120_000 }

/// Verification context drawn from the persisted node config.
pub struct ExecCtx<'a> {
    pub cp_url: &'a str,
    pub node_id: &'a str,
    pub api_key: &'a str,
    pub signing_pubkey: &'a str,   // base64 ed25519 public key
    pub allowed_scope: &'a [String],
}

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// The canonical signed-job message — MUST match the control plane's
/// jobSigningMessage(): op_id, node_id, technique, test_index, bundle_hash,
/// scope, consent_ref, not_after, newline-joined. Built with OUR node_id, so a
/// job signed for another node won't verify here.
fn signing_message(ctx: &ExecCtx, job: &Job) -> String {
    [
        job.operation_id.as_str(), ctx.node_id, job.technique.as_str(),
        &job.test_index.to_string(), job.bundle_hash.as_str(), job.scope.as_str(),
        job.consent_ref.as_str(), &job.not_after.to_string(),
    ].join("\n")
}

/// Verify the job is authentic, fresh, for us, and in scope. Returns Err(reason)
/// to refuse (the caller reports a "blocked" result and does NOT execute).
fn verify_job(ctx: &ExecCtx, job: &Job) -> Result<(), String> {
    // 1. Signature must verify against the CP's enrolled public key.
    if ctx.signing_pubkey.is_empty() {
        return Err("agent has no signing key (re-enroll against an M5 control plane)".into());
    }
    let pk_bytes = B64.decode(ctx.signing_pubkey).map_err(|_| "bad signing pubkey".to_string())?;
    let pk: [u8; 32] = pk_bytes.as_slice().try_into().map_err(|_| "signing pubkey wrong length".to_string())?;
    let vk = VerifyingKey::from_bytes(&pk).map_err(|e| format!("bad signing pubkey: {e}"))?;
    let sig_bytes = B64.decode(&job.signature).map_err(|_| "unsigned/badly-encoded job".to_string())?;
    let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into().map_err(|_| "signature wrong length".to_string())?;
    let sig = Signature::from_bytes(&sig_arr);
    let msg = signing_message(ctx, job);
    vk.verify(msg.as_bytes(), &sig).map_err(|_| "job signature INVALID (forged/tampered/wrong-node)".to_string())?;

    // 2. Freshness (anti-replay).
    if job.not_after > 0 && now_unix() > job.not_after {
        return Err("job expired (not_after passed)".into());
    }

    // 3. Allowed-scope (empty = unrestricted).
    if !ctx.allowed_scope.is_empty() && !ctx.allowed_scope.iter().any(|s| s == &job.scope) {
        return Err(format!("scope '{}' not in this node's allowed scope {:?}", job.scope, ctx.allowed_scope));
    }
    Ok(())
}

#[derive(Deserialize)]
struct BundleResponse {
    #[serde(rename = "bundleHash")]
    bundle_hash: String,
    canonical: String,
}

#[derive(Deserialize)]
struct Bundle {
    executor: String,
    command: String,
    cleanup: String,
}

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

/// Map an ART executor name + a script body to a spawnable Command.
fn build_command(executor: &str, script: &str) -> Command {
    match executor {
        "powershell" => {
            // pwsh where available; the platform decides. -NoProfile for speed.
            let mut c = Command::new(if cfg!(windows) { "powershell" } else { "pwsh" });
            c.args(["-NoProfile", "-NonInteractive", "-Command", script]);
            c
        }
        "command_prompt" => {
            let mut c = Command::new("cmd");
            c.args(["/c", script]);
            c
        }
        "bash" => {
            let mut c = Command::new("bash");
            c.args(["-c", script]);
            c
        }
        // "sh", "manual", or anything else → POSIX sh (best-effort).
        _ => {
            let mut c = Command::new("sh");
            c.args(["-c", script]);
            c
        }
    }
}

struct RunOutput {
    exit_code: i32,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

fn run_with_timeout(executor: &str, script: &str, timeout: Duration) -> RunOutput {
    if script.trim().is_empty() {
        return RunOutput { exit_code: 0, stdout: String::new(), stderr: String::new(), timed_out: false };
    }
    let mut cmd = build_command(executor, script);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return RunOutput { exit_code: -1, stdout: String::new(), stderr: format!("spawn failed: {e}"), timed_out: false },
    };
    // Drain pipes after wait to avoid deadlock on large output: take handles now.
    let mut out_handle = child.stdout.take();
    let mut err_handle = child.stderr.take();

    let status = match child.wait_timeout(timeout) {
        Ok(Some(s)) => s,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            let (o, e) = drain(&mut out_handle, &mut err_handle);
            return RunOutput { exit_code: 124, stdout: o, stderr: format!("{e}\n[killed: exceeded {timeout:?}]"), timed_out: true };
        }
        Err(e) => return RunOutput { exit_code: -1, stdout: String::new(), stderr: format!("wait failed: {e}"), timed_out: false },
    };
    let (o, e) = drain(&mut out_handle, &mut err_handle);
    RunOutput { exit_code: status.code().unwrap_or(-1), stdout: o, stderr: e, timed_out: false }
}

fn drain(out: &mut Option<std::process::ChildStdout>, err: &mut Option<std::process::ChildStderr>) -> (String, String) {
    let mut o = String::new();
    let mut e = String::new();
    if let Some(h) = out.as_mut() { let _ = h.read_to_string(&mut o); }
    if let Some(h) = err.as_mut() { let _ = h.read_to_string(&mut e); }
    // Cap to keep result messages small (full blobs → object store in M6).
    o.truncate(8000);
    e.truncate(4000);
    (o, e)
}

/// POST a terminal result for an op (used for both real runs and policy blocks).
#[allow(clippy::too_many_arguments)]
fn report(client: &reqwest::blocking::Client, base: &str, ctx: &ExecCtx, job: &Job,
          exit_code: i32, execute_status: &str, cleanup_status: &str,
          stdout: &str, stderr: &str, cleanup_stdout: &str, cleanup_stderr: &str, dur_ms: u64) -> Result<(), String> {
    let body = serde_json::json!({
        "node_id": ctx.node_id, "api_key": ctx.api_key,
        "technique": job.technique, "test_index": job.test_index, "bundle_hash": job.bundle_hash,
        "exit_code": exit_code, "execute_status": execute_status, "cleanup_status": cleanup_status,
        "stdout": stdout, "stderr": stderr,
        "cleanup_stdout": cleanup_stdout, "cleanup_stderr": cleanup_stderr,
        "duration_ms": dur_ms,
    });
    let rr = client.post(format!("{base}/api/v1/jobs/{}/result", job.operation_id)).json(&body).send()
        .map_err(|e| format!("result post failed: {e}"))?;
    if !rr.status().is_success() { return Err(format!("result post HTTP {}", rr.status())); }
    Ok(())
}

/// Verify (signature/freshness/scope) + fetch + verify bundle, execute, cleanup,
/// and POST the result. Returns Ok(()) regardless of test outcome (a failed or
/// blocked test is still a reported run); Err only on protocol failures.
pub fn execute_job(
    client: &reqwest::blocking::Client,
    ctx: &ExecCtx,
    job: &Job,
) -> Result<(), String> {
    let base = ctx.cp_url.trim_end_matches('/');

    // 0. SECURITY GATE: verify the signed envelope before doing anything. On
    //    refusal, report a "blocked" run and do NOT fetch or execute the bundle.
    if let Err(reason) = verify_job(ctx, job) {
        eprintln!("REFUSED job {} → {reason}", job.operation_id);
        report(client, base, ctx, job, -1, "blocked", "ok", "", &format!("agent refused: {reason}"), "", "", 0)?;
        return Ok(());
    }

    // 1. Fetch the curated bundle.
    let resp = client
        .get(format!("{base}/api/v1/bundles"))
        .query(&[
            ("hash", job.bundle_hash.as_str()),
            ("technique", job.technique.as_str()),
            ("testIndex", &job.test_index.to_string()),
        ])
        .header("x-node-id", ctx.node_id)
        .header("x-node-key", ctx.api_key)
        .send()
        .map_err(|e| format!("bundle fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("bundle fetch HTTP {}", resp.status()));
    }
    let br: BundleResponse = resp.json().map_err(|e| format!("bad bundle response: {e}"))?;

    // 2. INTEGRITY: re-hash the served canonical bytes; refuse on mismatch.
    let computed = sha256_hex(&br.canonical);
    if computed != job.bundle_hash || br.bundle_hash != job.bundle_hash {
        return Err(format!("bundle hash mismatch (expected {}, got {})", job.bundle_hash, computed));
    }
    let bundle: Bundle = serde_json::from_str(&br.canonical).map_err(|e| format!("bad bundle content: {e}"))?;

    // 3. Execute (hard timeout).
    let started = Instant::now();
    let timeout = Duration::from_millis(job.max_runtime_ms);
    let exec = run_with_timeout(&bundle.executor, &bundle.command, timeout);
    let execute_status = if exec.timed_out { "blocked" } else if exec.exit_code == 0 { "success" } else { "failed" };

    // 4. ALWAYS cleanup (own timeout budget, capped at 60s).
    let clean = run_with_timeout(&bundle.executor, &bundle.cleanup, Duration::from_secs(60));
    let cleanup_status = if clean.exit_code == 0 && !clean.timed_out { "ok" } else { "failed" };

    // 5. Report — execute + cleanup output kept SEPARATE so the UI can show
    //    "simulation output" and "cleanup output" distinctly.
    report(client, base, ctx, job, exec.exit_code, execute_status, cleanup_status,
           &exec.stdout, &exec.stderr, &clean.stdout, &clean.stderr,
           started.elapsed().as_millis() as u64)?;
    println!("ran {} #{} → exec={} cleanup={} exit={}", job.technique, job.test_index, execute_status, cleanup_status, exec.exit_code);
    Ok(())
}
