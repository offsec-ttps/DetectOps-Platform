//! Windows SCM service dispatcher (compiled only on Windows targets).
//!
//! `bas_agent service install` registers the service with launch args
//! `service-run --data-dir <D>`. SCM then starts the process with that
//! command; `service_dispatch()` hands control to the windows-service crate's
//! dispatcher, which registers a stop handler and runs the heartbeat loop on a
//! worker thread. Stopping the service signals the loop to exit cleanly.

#![cfg(windows)]

use std::ffi::OsString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use windows_service::define_windows_service;
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_dispatcher;

const WIN_SERVICE_NAME: &str = "BasAgent";

define_windows_service!(ffi_service_main, service_main);

/// Called from `main()` when the hidden `service-run` subcommand is invoked by SCM.
pub fn run_dispatcher() -> Result<(), String> {
    service_dispatcher::start(WIN_SERVICE_NAME, ffi_service_main).map_err(|e| e.to_string())
}

fn service_main(args: Vec<OsString>) {
    // args[0] is the service name; the data-dir is passed via the registered
    // launch arguments, so re-parse from std::env (SCM forwards them).
    let data_dir = parse_data_dir().unwrap_or_else(|| "C:\\ProgramData\\BasAgent".into());
    if let Err(e) = run_service(&data_dir) {
        // Best-effort: log to the agent file logger in a fuller build.
        eprintln!("service error: {e}");
    }
    let _ = args;
}

fn parse_data_dir() -> Option<String> {
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        if a == "--data-dir" { return it.next(); }
    }
    None
}

fn run_service(data_dir: &str) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_handler = stop.clone();

    let handle = service_control_handler::register(WIN_SERVICE_NAME, move |control| match control {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            stop_handler.store(true, Ordering::SeqCst);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    })
    .map_err(|e| e.to_string())?;

    let running = ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    };
    handle.set_service_status(running.clone()).map_err(|e| e.to_string())?;

    // Hand off to the shared agent loop, which polls `stop` between heartbeats.
    crate::run_loop_until(data_dir, stop.clone());

    handle
        .set_service_status(ServiceStatus { current_state: ServiceState::Stopped, ..running })
        .map_err(|e| e.to_string())?;
    Ok(())
}
