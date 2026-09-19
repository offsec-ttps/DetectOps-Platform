//! Cross-platform OS-service install/uninstall/status for the BAS agent.
//!
//! One agent per endpoint, auto-start on boot, auto-restart on crash. The
//! heavy platform logic lives here so the install scripts stay thin.
//!
//!   Linux   → systemd unit   (/etc/systemd/system/bas-agent.service, or --user)
//!   macOS   → launchd plist  (/Library/LaunchDaemons/com.detectops.bas-agent.plist)
//!   Windows → SCM service     (registered via the windows-service crate)
//!
//! `--dry-run` prints the generated unit/plist without writing or activating —
//! useful for review + CI on a host that isn't the target OS / lacks root.

use std::path::{Path, PathBuf};
use std::process::Command;

pub struct ServiceOpts {
    pub data_dir: String,
    pub dry_run: bool,
    /// systemd only: install into the per-user unit dir + use `systemctl --user`.
    pub user_mode: bool,
    /// systemd only: override the unit directory (testing without root).
    pub unit_dir: Option<String>,
}

#[allow(dead_code)]
const SERVICE_NAME: &str = "bas-agent";
#[allow(dead_code)]
const WIN_SERVICE_NAME: &str = "BasAgent"; // used on Windows builds
#[allow(dead_code)]
const MAC_LABEL: &str = "com.detectops.bas-agent"; // used on macOS builds

fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "bas_agent".into())
}

/// The stable path the service binary should live at — inside the data dir, so
/// boot-time service start doesn't depend on where the operator ran the
/// installer from (e.g. a Downloads folder that later gets cleaned up).
#[allow(dead_code)]
fn staged_binary(data_dir: &str) -> PathBuf {
    let name = if cfg!(windows) { "bas_agent.exe" } else { "bas_agent" };
    Path::new(data_dir).join(name)
}

/// Copy the running binary to its stable location (unless already there) so the
/// service survives the original download being moved/deleted, and survives
/// reboots. Returns the stable path to register with the service.
#[allow(dead_code)]
fn stage_binary(data_dir: &str, dry_run: bool) -> Result<PathBuf, String> {
    let dest = staged_binary(data_dir);
    if dry_run { return Ok(dest); }
    std::fs::create_dir_all(data_dir).map_err(|e| format!("create {data_dir}: {e}"))?;
    let current = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let same = std::fs::canonicalize(&current).ok() == std::fs::canonicalize(&dest).ok()
        && std::fs::canonicalize(&current).is_ok();
    if !same {
        std::fs::copy(&current, &dest).map_err(|e| format!("copy binary to {}: {e}", dest.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
        }
        println!("staged binary → {}", dest.display());
    }
    Ok(dest)
}

// ─── Linux: systemd ─────────────────────────────────────────────────────────
#[cfg(target_os = "linux")]
fn systemd_unit(data_dir: &str, exe: &str) -> String {
    format!(
        "[Unit]\n\
         Description=DetectOps BAS Agent (defensive breach-and-attack-simulation sensor)\n\
         After=network-online.target\n\
         Wants=network-online.target\n\n\
         [Service]\n\
         Type=simple\n\
         ExecStart={exe} run --data-dir {data_dir}\n\
         Restart=always\n\
         RestartSec=5\n\
         # BAS tests + telemetry capture need privilege; scope this down per your policy.\n\
         User=root\n\
         NoNewPrivileges=false\n\n\
         [Install]\n\
         WantedBy=multi-user.target\n",
        exe = exe,
        data_dir = data_dir,
    )
}

#[cfg(target_os = "linux")]
pub fn install(opts: &ServiceOpts) -> Result<(), String> {
    // Stage the binary into the data dir so reboot-start doesn't depend on the
    // installer's original location.
    let staged = stage_binary(&opts.data_dir, opts.dry_run)?;
    let unit = systemd_unit(&opts.data_dir, &staged.to_string_lossy());
    if opts.dry_run {
        println!("# systemd unit ({} mode):\n{}", if opts.user_mode { "user" } else { "system" }, unit);
        return Ok(());
    }
    let dir = opts.unit_dir.clone().unwrap_or_else(|| {
        if opts.user_mode {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/root".into());
            format!("{home}/.config/systemd/user")
        } else {
            "/etc/systemd/system".into()
        }
    });
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir}: {e}"))?;
    let path = PathBuf::from(&dir).join(format!("{SERVICE_NAME}.service"));
    std::fs::write(&path, unit).map_err(|e| format!("write {}: {e}", path.display()))?;
    println!("wrote {}", path.display());

    let sc = |args: &[&str]| -> bool {
        let mut a: Vec<&str> = Vec::new();
        if opts.user_mode { a.push("--user"); }
        a.extend_from_slice(args);
        Command::new("systemctl").args(&a).status().map(|s| s.success()).unwrap_or(false)
    };
    if sc(&["daemon-reload"]) && sc(&["enable", "--now", SERVICE_NAME]) {
        println!("service {SERVICE_NAME} enabled + started.");
    } else {
        eprintln!(
            "warning: systemctl not available or insufficient privilege. Unit written; activate manually:\n  \
             sudo systemctl daemon-reload && sudo systemctl enable --now {SERVICE_NAME}"
        );
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn uninstall(opts: &ServiceOpts) -> Result<(), String> {
    let dir = opts.unit_dir.clone().unwrap_or_else(|| "/etc/systemd/system".into());
    let path = PathBuf::from(&dir).join(format!("{SERVICE_NAME}.service"));
    let sc = |args: &[&str]| {
        let mut a: Vec<&str> = Vec::new();
        if opts.user_mode { a.push("--user"); }
        a.extend_from_slice(args);
        let _ = Command::new("systemctl").args(&a).status();
    };
    sc(&["disable", "--now", SERVICE_NAME]);
    let _ = std::fs::remove_file(&path);
    sc(&["daemon-reload"]);
    println!("service {SERVICE_NAME} removed.");
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn status(opts: &ServiceOpts) -> Result<(), String> {
    let mut a: Vec<&str> = Vec::new();
    if opts.user_mode { a.push("--user"); }
    a.extend_from_slice(&["is-active", SERVICE_NAME]);
    let out = Command::new("systemctl").args(&a).output().map_err(|e| e.to_string())?;
    println!("{}", String::from_utf8_lossy(&out.stdout).trim());
    Ok(())
}

// ─── macOS: launchd ─────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
fn launchd_plist(data_dir: &str, exe: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\n\
         \t<key>Label</key><string>{label}</string>\n\
         \t<key>ProgramArguments</key><array>\n\
         \t\t<string>{exe}</string><string>run</string><string>--data-dir</string><string>{data_dir}</string>\n\
         \t</array>\n\
         \t<key>RunAtLoad</key><true/>\n\
         \t<key>KeepAlive</key><true/>\n\
         </dict></plist>\n",
        label = MAC_LABEL, exe = exe, data_dir = data_dir,
    )
}

#[cfg(target_os = "macos")]
pub fn install(opts: &ServiceOpts) -> Result<(), String> {
    let staged = stage_binary(&opts.data_dir, opts.dry_run)?;
    let plist = launchd_plist(&opts.data_dir, &staged.to_string_lossy());
    if opts.dry_run { println!("# launchd plist:\n{}", plist); return Ok(()); }
    let path = format!("/Library/LaunchDaemons/{MAC_LABEL}.plist");
    std::fs::write(&path, &plist).map_err(|e| format!("write {path}: {e} (needs sudo)"))?;
    println!("wrote {path}");
    let ok = Command::new("launchctl").args(["bootstrap", "system", &path]).status().map(|s| s.success()).unwrap_or(false);
    if ok { println!("launchd daemon bootstrapped."); }
    else { eprintln!("warning: launchctl bootstrap failed; run: sudo launchctl bootstrap system {path}"); }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn uninstall(_opts: &ServiceOpts) -> Result<(), String> {
    let path = format!("/Library/LaunchDaemons/{MAC_LABEL}.plist");
    let _ = Command::new("launchctl").args(["bootout", "system", &path]).status();
    let _ = std::fs::remove_file(&path);
    println!("launchd daemon removed.");
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn status(_opts: &ServiceOpts) -> Result<(), String> {
    let out = Command::new("launchctl").args(["print", &format!("system/{MAC_LABEL}")]).output().map_err(|e| e.to_string())?;
    println!("{}", if out.status.success() { "loaded" } else { "not loaded" });
    Ok(())
}

// ─── Windows: SCM via the windows-service crate ─────────────────────────────
#[cfg(windows)]
pub fn install(opts: &ServiceOpts) -> Result<(), String> {
    use windows_service::service::{ServiceAccess, ServiceErrorControl, ServiceInfo, ServiceStartType, ServiceType};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    use std::ffi::OsString;

    // Stage the binary into ProgramData so boot-time start doesn't depend on the
    // installer's original location (e.g. a Downloads folder).
    let staged = stage_binary(&opts.data_dir, opts.dry_run)?;

    // The service entry point runs `service-run` so SCM gets a real dispatcher.
    let info = ServiceInfo {
        name: OsString::from(WIN_SERVICE_NAME),
        display_name: OsString::from("DetectOps BAS Agent"),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: staged.clone(),
        launch_arguments: vec![
            OsString::from("service-run"),
            OsString::from("--data-dir"),
            OsString::from(opts.data_dir.clone()),
        ],
        dependencies: vec![],
        account_name: None, // LocalSystem
        account_password: None,
    };
    if opts.dry_run {
        println!("# Windows SCM service '{}' (AutoStart) → {} service-run --data-dir {}",
            WIN_SERVICE_NAME, staged.display(), opts.data_dir);
        return Ok(());
    }
    // Need CONNECT (to talk to the SCM) + CREATE_SERVICE. Both require an
    // elevated (Administrator) token — OpenSCManager fails otherwise.
    let mgr = ServiceManager::local_computer(
        None::<&str>,
        ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE,
    ).map_err(|e| format!(
        "open SCM: {e:?}\n  → Run this from an ELEVATED PowerShell (right-click → Run as administrator).",
    ))?;

    // If a prior install left the service behind, CreateService fails with
    // ERROR_SERVICE_EXISTS (1073). Detect that and adopt/restart it instead.
    let svc = match mgr.create_service(&info, ServiceAccess::CHANGE_CONFIG | ServiceAccess::START) {
        Ok(s) => s,
        Err(e) => {
            let dbg = format!("{e:?}");
            if dbg.contains("1073") {
                // Already exists → open it and (re)start.
                let existing = mgr
                    .open_service(WIN_SERVICE_NAME, ServiceAccess::CHANGE_CONFIG | ServiceAccess::START)
                    .map_err(|e2| format!("service exists but could not be opened: {e2:?}"))?;
                let _ = existing.start(&[] as &[&std::ffi::OsStr]);
                println!("Windows service {WIN_SERVICE_NAME} already installed — (re)started.");
                return Ok(());
            }
            let hint = if dbg.contains("os error 5") || dbg.contains("(5)") {
                "\n  → Access denied. Run from an ELEVATED PowerShell (Run as administrator)."
            } else {
                "\n  → Run from an ELEVATED PowerShell. If a 'BasAgent' service already exists, run `bas_agent.exe service uninstall` first (or `sc delete BasAgent`)."
            };
            return Err(format!("create service: {dbg}{hint}"));
        }
    };
    svc.set_description("Defensive breach-and-attack-simulation sensor.").ok();

    // Auto-restart on crash (the SCM equivalent of systemd Restart=always) so an
    // unexpected exit doesn't leave the node offline until the next reboot. Set
    // via sc.exe — version-independent across windows-service crate releases.
    let _ = Command::new("sc").args([
        "failure", WIN_SERVICE_NAME,
        "reset=", "86400",
        "actions=", "restart/5000/restart/10000/restart/30000",
    ]).status();

    svc.start(&[] as &[&std::ffi::OsStr]).map_err(|e| format!("start service: {e:?}"))?;
    println!("Windows service {WIN_SERVICE_NAME} installed (AutoStart, auto-restart) + started.");
    Ok(())
}

#[cfg(windows)]
pub fn uninstall(_opts: &ServiceOpts) -> Result<(), String> {
    use windows_service::service::ServiceAccess;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    let mgr = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|e| format!("open SCM: {e:?}\n  → Run from an ELEVATED PowerShell."))?;
    let svc = match mgr.open_service(WIN_SERVICE_NAME, ServiceAccess::STOP | ServiceAccess::DELETE) {
        Ok(s) => s,
        Err(e) => {
            let dbg = format!("{e:?}");
            if dbg.contains("1060") { println!("Windows service {WIN_SERVICE_NAME} is not installed."); return Ok(()); }
            return Err(format!("open service: {dbg}\n  → Run from an ELEVATED PowerShell."));
        }
    };
    let _ = svc.stop();
    svc.delete().map_err(|e| format!("delete service: {e:?}"))?;
    println!("Windows service {WIN_SERVICE_NAME} removed.");
    Ok(())
}

#[cfg(windows)]
pub fn status(_opts: &ServiceOpts) -> Result<(), String> {
    use windows_service::service::ServiceAccess;
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    let mgr = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|e| format!("open SCM: {e}"))?;
    match mgr.open_service(WIN_SERVICE_NAME, ServiceAccess::QUERY_STATUS) {
        Ok(svc) => {
            let s = svc.query_status().map_err(|e| e.to_string())?;
            println!("{:?}", s.current_state);
        }
        Err(_) => println!("not installed"),
    }
    Ok(())
}
