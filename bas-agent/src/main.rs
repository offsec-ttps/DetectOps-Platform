//! DetectOps BAS fleet agent.
//!
//! A lightweight, defensive breach-and-attack-simulation sensor. It is deployed
//! on an endpoint the customer owns, enrolls with the control plane using a
//! one-time token, then beacons liveness. In later milestones it pulls and runs
//! ONLY version-pinned, consent-gated Atomic Red Team tests from a curated
//! catalogue (never raw commands) and always runs their cleanup.
//!
//! M1 scope (this build): `enroll` (one-time → node.toml) and `run` (HTTP
//! heartbeat loop). Job execution + NATS land in later milestones.
//!
//! Design constraints: negligible footprint, outbound-only networking, secrets
//! at rest in an ACL-restricted node.toml.

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

mod service;
mod executor;
#[cfg(windows)]
mod win_service;

#[derive(Parser)]
#[command(name = "bas_agent", version, about = "DetectOps BAS fleet agent")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// One-time registration: exchange an enrollment token for a node identity.
    Enroll {
        #[arg(long)]
        token: String,
        #[arg(long)]
        url: String,
        #[arg(long, default_value = default_data_dir())]
        data_dir: String,
    },
    /// Long-running daemon: re-authorize → heartbeat loop (and, later, job execution).
    Run {
        #[arg(long, default_value = default_data_dir())]
        data_dir: String,
    },
    /// Install / uninstall / status of the OS service (systemd | launchd | SCM).
    Service {
        #[command(subcommand)]
        action: ServiceAction,
    },
    /// (Windows, hidden) SCM entry point — invoked by the service manager, not by hand.
    #[command(hide = true)]
    ServiceRun {
        #[arg(long, default_value = default_data_dir())]
        data_dir: String,
    },
    /// Print the resolved node identity (debug).
    Whoami {
        #[arg(long, default_value = default_data_dir())]
        data_dir: String,
    },
}

#[derive(Subcommand)]
enum ServiceAction {
    /// Register the OS service (auto-start on boot, restart on crash).
    Install {
        #[arg(long, default_value = default_data_dir())]
        data_dir: String,
        /// Print the generated unit/plist without writing or activating it.
        #[arg(long)]
        dry_run: bool,
        /// systemd: install into the per-user unit dir (systemctl --user).
        #[arg(long)]
        user: bool,
        /// systemd: override the unit directory (testing without root).
        #[arg(long)]
        unit_dir: Option<String>,
    },
    /// Stop + remove the OS service.
    Uninstall {
        #[arg(long, default_value = default_data_dir())]
        data_dir: String,
        #[arg(long)]
        user: bool,
        #[arg(long)]
        unit_dir: Option<String>,
    },
    /// Report whether the service is active.
    Status {
        #[arg(long)]
        user: bool,
    },
}

/// Persisted node identity. Written 0600 (best-effort ACL on Windows).
#[derive(Serialize, Deserialize, Clone)]
struct NodeConfig {
    node_id: String,
    api_key: String,
    control_plane_url: String,
    heartbeat_url: String,
    heartbeat_interval_s: u64,
    allowed_scope: Vec<String>,
    #[serde(default)]
    consent_ref: Option<String>,
    /// ed25519 public key (base64) the control plane signs jobs with. The agent
    /// refuses to run any job whose signature doesn't verify against this.
    #[serde(default)]
    signing_pubkey: String,
}

#[derive(Serialize)]
struct HostFacts {
    hostname: String,
    os: String,
    os_version: String,
    arch: String,
}

#[derive(Serialize)]
struct EnrollRequest<'a> {
    enrollment_token: &'a str,
    host_facts: HostFacts,
    agent_version: &'a str,
    /// When re-enrolling on a host that already has a node.toml, send the
    /// existing node id so the control plane re-keys the SAME node in place
    /// instead of creating a duplicate "ghost" node.
    #[serde(skip_serializing_if = "Option::is_none")]
    node_id: Option<&'a str>,
}

#[derive(Deserialize)]
struct EnrollResponse {
    node_id: String,
    api_key: String,
    #[serde(default)]
    allowed_scope: Vec<String>,
    heartbeat_url: String,
    #[serde(default = "default_interval")]
    heartbeat_interval_s: u64,
    #[serde(default)]
    consent_ref: Option<String>,
    #[serde(default)]
    signing_pubkey: String,
}

#[derive(Serialize)]
struct AuthorizeRequest<'a> {
    node_id: &'a str,
    api_key: &'a str,
    agent_version: &'a str,
}

#[derive(Deserialize)]
struct AuthorizeResponse {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    allowed_scope: Vec<String>,
    #[serde(default)]
    heartbeat_url: Option<String>,
    #[serde(default)]
    heartbeat_interval_s: Option<u64>,
    #[serde(default)]
    consent_ref: Option<String>,
}

#[derive(Serialize)]
struct HostMetrics {
    cpu: f32,
    ram_used: u64,
    ram_total: u64,
    os: String,
    /// Whether the agent runs with elevated privilege (root / Administrator /
    /// SYSTEM). Lets the console show which hosts run high vs low privilege.
    elevated: bool,
    /// Effective user the agent runs as (e.g. "NT AUTHORITY\\SYSTEM", "root").
    user: String,
    /// Coarse integrity/privilege level: system | high | medium | user | root.
    integrity: String,
}

#[derive(Serialize)]
struct HeartbeatRequest<'a> {
    node_id: &'a str,
    api_key: &'a str,
    status: &'a str,
    agent_version: &'a str,
    host: HostMetrics,
}

#[derive(Deserialize)]
struct HeartbeatDirectives {
    #[serde(default)]
    terminate: bool,
}

#[derive(Deserialize)]
struct HeartbeatResponse {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    directives: Option<HeartbeatDirectives>,
}

const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");
fn default_interval() -> u64 { 5 }
fn default_data_dir() -> &'static str {
    if cfg!(windows) { "C:\\ProgramData\\BasAgent" } else { "/var/lib/bas-agent" }
}

fn config_path(data_dir: &str) -> PathBuf { Path::new(data_dir).join("node.toml") }

fn host_facts() -> HostFacts {
    let hostname = sysinfo::System::host_name().unwrap_or_else(|| "unknown".into());
    let os = sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.into());
    let os_version = sysinfo::System::os_version().unwrap_or_default();
    HostFacts { hostname, os, os_version, arch: std::env::consts::ARCH.into() }
}

/// Privilege facts (elevated, user, integrity). Computed once — privilege can't
/// change during the process lifetime — using only std::process (no extra deps).
fn privilege_facts() -> &'static (bool, String, String) {
    use std::sync::OnceLock;
    static CACHE: OnceLock<(bool, String, String)> = OnceLock::new();
    CACHE.get_or_init(compute_privilege)
}

#[cfg(windows)]
fn compute_privilege() -> (bool, String, String) {
    use std::process::Command;
    let user = Command::new("whoami").output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let groups = Command::new("whoami").args(["/groups"]).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    // SIDs: S-1-5-18 = SYSTEM; S-1-16-16384 = System integrity;
    // S-1-16-12288 = High integrity (elevated); S-1-16-8192 = Medium.
    if user.to_lowercase().contains("nt authority\\system") || groups.contains("S-1-5-18") || groups.contains("S-1-16-16384") {
        (true, user, "system".into())
    } else if groups.contains("S-1-16-12288") {
        (true, user, "high".into())
    } else if groups.contains("S-1-16-8192") {
        (false, user, "medium".into())
    } else {
        (false, user, "user".into())
    }
}

#[cfg(not(windows))]
fn compute_privilege() -> (bool, String, String) {
    use std::process::Command;
    let user = Command::new("id").arg("-un").output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let uid = Command::new("id").arg("-u").output().ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u32>().ok());
    let root = uid == Some(0);
    (root, user, if root { "root".into() } else { "user".into() })
}

fn host_metrics(sys: &mut sysinfo::System) -> HostMetrics {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu = sys.global_cpu_usage();
    let (elevated, user, integrity) = privilege_facts().clone();
    HostMetrics {
        cpu,
        ram_used: sys.used_memory(),
        ram_total: sys.total_memory(),
        os: std::env::consts::OS.into(),
        elevated,
        user,
        integrity,
    }
}

fn write_config(data_dir: &str, cfg: &NodeConfig) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let p = config_path(data_dir);
    let body = toml::to_string_pretty(cfg).expect("serialize node.toml");
    std::fs::write(&p, body)?;
    // Best-effort 0600 on unix; on Windows rely on ProgramData ACLs.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn read_config(data_dir: &str) -> Result<NodeConfig, String> {
    let p = config_path(data_dir);
    let body = std::fs::read_to_string(&p)
        .map_err(|e| format!("cannot read {}: {e} — run `bas_agent enroll` first", p.display()))?;
    toml::from_str(&body).map_err(|e| format!("malformed node.toml: {e}"))
}

fn enroll(token: &str, url: &str, data_dir: &str) -> Result<(), String> {
    let base = url.trim_end_matches('/');
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    // Re-enroll in place when this host already has an identity for the same
    // control plane — avoids creating duplicate "ghost" nodes on re-runs.
    let existing = read_config(data_dir).ok().filter(|c| c.control_plane_url.trim_end_matches('/') == base);
    if let Some(c) = &existing {
        println!("re-enrolling existing node {} (in place)", c.node_id);
    }
    let req = EnrollRequest {
        enrollment_token: token,
        host_facts: host_facts(),
        agent_version: AGENT_VERSION,
        node_id: existing.as_ref().map(|c| c.node_id.as_str()),
    };
    let resp = client
        .post(format!("{base}/api/v1/enroll-node"))
        .json(&req)
        .send()
        .map_err(|e| format!("enroll request failed: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let msg = resp.text().unwrap_or_default();
        return Err(format!("enroll rejected (HTTP {code}): {msg}"));
    }
    let er: EnrollResponse = resp.json().map_err(|e| format!("bad enroll response: {e}"))?;
    let cfg = NodeConfig {
        node_id: er.node_id,
        api_key: er.api_key,
        control_plane_url: base.to_string(),
        heartbeat_url: er.heartbeat_url,
        heartbeat_interval_s: er.heartbeat_interval_s.max(1),
        allowed_scope: er.allowed_scope,
        consent_ref: er.consent_ref,
        signing_pubkey: er.signing_pubkey,
    };
    write_config(data_dir, &cfg).map_err(|e| format!("cannot persist node.toml: {e}"))?;
    println!("enrolled as node {} (scope: {:?})", cfg.node_id, cfg.allowed_scope);
    println!("config written to {}", config_path(data_dir).display());
    Ok(())
}

/// Re-authorize at startup: re-confirm the node is active and refresh runtime
/// config. Returns the (possibly updated) heartbeat URL + interval, or an error
/// when the control plane says terminate (revoked / bad key).
fn authorize(client: &reqwest::blocking::Client, cfg: &NodeConfig) -> Result<(String, u64), String> {
    let req = AuthorizeRequest { node_id: &cfg.node_id, api_key: &cfg.api_key, agent_version: AGENT_VERSION };
    // IMPORTANT: always heartbeat to the address WE enrolled with
    // (control_plane_url), never the server's self-reported origin. The server
    // can't reliably know how we reach it across NAT / bridged VMs / reverse
    // proxies — its `origin` may be localhost or an unreachable interface. The
    // agent is the authority on its own callback address.
    let heartbeat_url = heartbeat_url_for(cfg);

    let resp = match client
        .post(format!("{}/api/v1/authorize-node", cfg.control_plane_url.trim_end_matches('/')))
        .json(&req)
        .send()
    {
        Ok(r) => r,
        Err(e) => {
            // Network not ready (common right after a reboot) — DON'T exit.
            // Proceed with the enrolled config; the heartbeat thread retries
            // until the control plane is reachable, and a real revocation
            // surfaces there as a 401.
            eprintln!("authorize network error ({e}) — proceeding; heartbeat will retry");
            return Ok((heartbeat_url, cfg.heartbeat_interval_s));
        }
    };
    if resp.status().as_u16() == 401 {
        return Err("authorize 401 — node revoked or key invalid".into());
    }
    if !resp.status().is_success() {
        // Soft-fail: a transient CP blip shouldn't stop a healthy agent.
        eprintln!("warning: authorize HTTP {} — using enrolled config", resp.status());
        return Ok((heartbeat_url, cfg.heartbeat_interval_s));
    }
    let ar: AuthorizeResponse = match resp.json::<AuthorizeResponse>() {
        Ok(a) => a,
        Err(e) => { eprintln!("authorize: bad response ({e}) — using enrolled config"); return Ok((heartbeat_url, cfg.heartbeat_interval_s)); }
    };
    let _ = (ar.ok, ar.allowed_scope, ar.consent_ref, ar.heartbeat_url);  // server values are advisory
    Ok((heartbeat_url, ar.heartbeat_interval_s.unwrap_or(cfg.heartbeat_interval_s).max(1)))
}

/// The heartbeat endpoint, always derived from the address we enrolled with.
fn heartbeat_url_for(cfg: &NodeConfig) -> String {
    format!("{}/api/v1/node-status", cfg.control_plane_url.trim_end_matches('/'))
}

/// Interruptible sleep: wakes early if `stop` is set. Sleeps `secs` in 1s slices.
fn sleep_interruptible(stop: &Arc<AtomicBool>, secs: u64) {
    for _ in 0..secs.max(1) {
        if stop.load(Ordering::SeqCst) { return; }
        thread::sleep(Duration::from_secs(1));
    }
}

/// Heartbeat loop — runs on its OWN thread so liveness never depends on the
/// job-poll/execute path. A node therefore stays "online" while a long atomic
/// test is running, and a misbehaving poll can't starve the heartbeat. On a
/// 401/terminate it sets `stop`, which also unwinds the poll thread.
fn heartbeat_loop(stop: Arc<AtomicBool>, cfg: NodeConfig, heartbeat_url: String, interval: u64) {
    let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(15)).build() {
        Ok(c) => c,
        Err(e) => { eprintln!("heartbeat: client build failed: {e}"); stop.store(true, Ordering::SeqCst); return; }
    };
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_usage();

    while !stop.load(Ordering::SeqCst) {
        let metrics = host_metrics(&mut sys);
        let hb = HeartbeatRequest {
            node_id: &cfg.node_id, api_key: &cfg.api_key, status: "online",
            agent_version: AGENT_VERSION, host: metrics,
        };
        match client.post(&heartbeat_url).json(&hb).send() {
            Ok(resp) => {
                if resp.status().as_u16() == 401 {
                    eprintln!("heartbeat 401 — node revoked or key invalid; stopping.");
                    stop.store(true, Ordering::SeqCst);
                    return;
                }
                if resp.status().is_success() {
                    if let Ok(hr) = resp.json::<HeartbeatResponse>() {
                        if hr.directives.map(|d| d.terminate).unwrap_or(false) {
                            eprintln!("control plane requested terminate; stopping.");
                            stop.store(true, Ordering::SeqCst);
                            return;
                        }
                    }
                } else {
                    eprintln!("heartbeat HTTP {}", resp.status());
                }
            }
            Err(e) => eprintln!("heartbeat error: {e}"),   // transient — keep beating
        }
        sleep_interruptible(&stop, interval);
    }
}

/// The agent's main loop. Re-authorizes once, spawns the heartbeat thread, then
/// polls for jobs and executes them on THIS thread until `stop` is set or the
/// control plane terminates us.
fn run_loop_until(data_dir: &str, stop: Arc<AtomicBool>) {
    let cfg = match read_config(data_dir) {
        Ok(c) => c,
        Err(e) => { eprintln!("error: {e}"); return; }
    };
    let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(15)).build() {
        Ok(c) => c,
        Err(e) => { eprintln!("error: {e}"); return; }
    };

    // Startup re-authorize.
    let (heartbeat_url, interval) = match authorize(&client, &cfg) {
        Ok(v) => v,
        Err(e) => { eprintln!("{e}; exiting."); return; }
    };

    println!("bas_agent {} running — node {} → heartbeat {} every {}s",
        AGENT_VERSION, cfg.node_id, heartbeat_url, interval);

    // Heartbeat on a dedicated thread (independent of job work).
    let hb_handle = {
        let stop = stop.clone();
        let cfg = cfg.clone();
        let url = heartbeat_url.clone();
        thread::spawn(move || heartbeat_loop(stop, cfg, url, interval))
    };

    // Main thread: poll for jobs + execute. A separate client so a long job
    // body never contends with the heartbeat client.
    let poll_client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15)).build().unwrap_or(client);

    // Diagnostic: prove the poll loop actually started. A node that heartbeats
    // but never logs this line is running a stale binary without job polling.
    println!("job-poll loop active → GET {}/api/v1/jobs/poll/{} every {}s",
        cfg.control_plane_url.trim_end_matches('/'), cfg.node_id, interval);

    let mut idle_cycles: u64 = 0;
    while !stop.load(Ordering::SeqCst) {
        match poll_job(&poll_client, &cfg) {
            PollResult::Job(job) => {
                idle_cycles = 0;
                println!("poll → job {} ({} #{})", job.operation_id, job.technique, job.test_index);
                let ctx = executor::ExecCtx {
                    cp_url: &cfg.control_plane_url,
                    node_id: &cfg.node_id,
                    api_key: &cfg.api_key,
                    signing_pubkey: &cfg.signing_pubkey,
                    allowed_scope: &cfg.allowed_scope,
                };
                if let Err(e) = executor::execute_job(&poll_client, &ctx, &job) {
                    eprintln!("job {} error: {e}", job.operation_id);
                }
                continue;   // drain: immediately check for the next queued op
            }
            PollResult::Terminate => { stop.store(true, Ordering::SeqCst); break; }
            PollResult::None | PollResult::Error => {
                // Periodic proof-of-life for the poll loop (every ~10 idle cycles)
                // so an idle-but-healthy node is distinguishable from a dead loop.
                idle_cycles += 1;
                if idle_cycles % 10 == 0 { println!("poll: idle ({} cycles, no queued jobs)", idle_cycles); }
            }
        }
        // No job this round — wait a poll interval before asking again. This is
        // what prevents a tight poll spin from ever pegging a core.
        sleep_interruptible(&stop, interval);
    }

    stop.store(true, Ordering::SeqCst);
    let _ = hb_handle.join();
}

enum PollResult { Job(executor::Job), None, Terminate, Error }

fn poll_job(client: &reqwest::blocking::Client, cfg: &NodeConfig) -> PollResult {
    let url = format!("{}/api/v1/jobs/poll/{}", cfg.control_plane_url.trim_end_matches('/'), cfg.node_id);
    match client.get(&url).header("x-node-key", &cfg.api_key).send() {
        Ok(resp) => {
            let code = resp.status().as_u16();
            if code == 204 { return PollResult::None; }
            if code == 401 { return PollResult::Terminate; }
            if !resp.status().is_success() { eprintln!("poll HTTP {code}"); return PollResult::Error; }
            match resp.json::<executor::Job>() {
                Ok(job) => PollResult::Job(job),
                Err(e) => { eprintln!("poll: bad job json: {e}"); PollResult::Error }
            }
        }
        Err(e) => { eprintln!("poll error: {e}"); PollResult::Error }
    }
}

fn run(data_dir: &str) -> Result<(), String> {
    // Foreground run: a stop flag that's only set by the (future) Ctrl-C handler.
    let stop = Arc::new(AtomicBool::new(false));
    {
        let s = stop.clone();
        let _ = ctrlc_set(move || s.store(true, Ordering::SeqCst));
    }
    run_loop_until(data_dir, stop);
    Ok(())
}

/// Minimal Ctrl-C hook without an extra dependency: best-effort, no-op if it
/// can't be installed. (A fuller build can use the `ctrlc` crate.)
fn ctrlc_set<F: Fn() + Send + 'static>(_f: F) -> Result<(), ()> { Ok(()) }

fn svc_opts(data_dir: String, dry_run: bool, user: bool, unit_dir: Option<String>) -> service::ServiceOpts {
    service::ServiceOpts { data_dir, dry_run, user_mode: user, unit_dir }
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.cmd {
        Cmd::Enroll { token, url, data_dir } => enroll(&token, &url, &data_dir),
        Cmd::Run { data_dir } => run(&data_dir),
        Cmd::ServiceRun { data_dir } => {
            // Windows: SCM invokes this; hand off to the service dispatcher.
            // Other OSes: behaves like a plain foreground `run`.
            #[cfg(windows)]
            { win_service::run_dispatcher() }
            #[cfg(not(windows))]
            { run(&data_dir) }
        }
        Cmd::Service { action } => match action {
            ServiceAction::Install { data_dir, dry_run, user, unit_dir } =>
                service::install(&svc_opts(data_dir, dry_run, user, unit_dir)),
            ServiceAction::Uninstall { data_dir, user, unit_dir } =>
                service::uninstall(&svc_opts(data_dir, false, user, unit_dir)),
            ServiceAction::Status { user } =>
                service::status(&svc_opts(default_data_dir().to_string(), false, user, None)),
        },
        Cmd::Whoami { data_dir } => read_config(&data_dir).map(|c| {
            println!("node_id={}\nscope={:?}\ncp={}", c.node_id, c.allowed_scope, c.control_plane_url);
        }),
    };
    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}
