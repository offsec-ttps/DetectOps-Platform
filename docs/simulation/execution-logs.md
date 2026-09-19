# Execution Logs

**Route:** `/execution-logs` · **Sidebar:** Simulation → Execution Logs

A chronological history of simulation executions, sourced from the Splunk Attack Range runs (`GET /api/sar/simulations`). Use it to review what was run, when, against which target, with what result and logs.

## What you see

- Each run's techniques, target server, status (running / success / failure / timeout), duration, and captured stdout/stderr.
- SAR runs treat a non-zero exit as success when the logs show the atomic actually executed (some credential-dumping techniques, e.g. T1003/Mimikatz, disrupt the WinRM session and return non-zero even on success).

## Related run histories

- **Fleet** runs are visible per node (test-runs) in the [Fleet console](../labs/fleet-server.md).
- **Enterprise use-case** runs are recorded as `EnterpriseUseCaseRun` rows and shown on the use-case detail page.
- Platform-wide audit events are recorded via `logEvent()` (`/api/events`).
