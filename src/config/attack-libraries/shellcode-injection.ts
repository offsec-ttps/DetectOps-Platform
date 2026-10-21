import type { LibraryDef, TechniqueDef, DetectionQuery, Mitigation, Reference, CuratedAtomic } from "@/lib/attack-sim/types";

/**
 * Shellcode Injection library — a DEFENSIVE catalog for SOC simulation and
 * detection engineering, built from the "Shellcode Injection Technique Catalog"
 * and "Shellcode Injection Techniques: Basic to Advanced" reference documents.
 *
 * Scope and safety (same contract as every attack library on this platform):
 *   - Entries describe each technique at the level a detection engineer needs —
 *     what it does, the telemetry it produces, the correlated detection
 *     primitives and the mitigations. No payloads, loaders, shellcode, or
 *     step-by-step procedures are shipped.
 *   - The Simulate leg runs ONLY vetted Atomic Red Team tests already in the
 *     local atomic library (curated per entry). Entries with no vetted local test
 *     are catalogued for coverage mapping (runnableOnSar=false), like Process
 *     Doppelgänging in the Process Injection library.
 *   - Detections are built around correlating stages (target → memory operation →
 *     execution trigger), not single API names — the document's core thesis.
 *   - Run only in isolated lab VMs with benign marker actions; tag every run.
 */

// ── Reusable detection primitives (named as in the reference catalog) ────────
interface Prim { summary: string; sources: string[]; spl: { title: string; query: string }; sigma: { title: string; query: string } }
const Y = (lines: string[]) => lines.join("\n");
const SYSMON = 'sourcetype="XmlWinEventLog:Microsoft-Windows-Sysmon/Operational"';
const ETWTI = 'sourcetype="etw:threatintel"';
const AUDITD = 'sourcetype="linux:audit"';
const MACES = 'sourcetype="macos:endpointsecurity"';
const SYS_PROCS = "    - 'C:\\Windows\\System32\\'";

const P: Record<string, Prim> = {
  // ── Windows ──
  remote_shellcode_injection: {
    summary: "A source process opens another process with write/thread-creation rights and then starts a thread inside it.",
    sources: ["Sysmon EID 10 (ProcessAccess, write-capable GrantedAccess)", "Sysmon EID 8 (CreateRemoteThread)"],
    spl: { title: "Write-capable process access followed by a remote thread", query: `index=* ${SYSMON} (EventCode=8 OR (EventCode=10 GrantedAccess IN ("0x1F3FFF","0x1FFFFF","0x1F0FFF","0x143A","0x1478"))) | eval src=SourceImage, tgt=TargetImage | stats dc(EventCode) as stages values(EventCode) as eids count by src, tgt | where stages>=2` },
    sigma: { title: "Sigma: Remote thread in a sensitive process from a non-system source", query: Y(["title: Remote Thread Created In Sensitive Process By Non-System Source", "status: experimental", "logsource:", "  product: windows", "  category: create_remote_thread", "detection:", "  selection:", "    TargetImage|endswith:", "      - '\\explorer.exe'", "      - '\\svchost.exe'", "      - '\\winlogon.exe'", "      - '\\RuntimeBroker.exe'", "  filter_system:", "    SourceImage|startswith:", SYS_PROCS, "  condition: selection and not filter_system", "level: high"]) },
  },
  rwx_memory_allocation: {
    summary: "Memory is allocated RWX, or flipped RW→RX, shortly before it is executed.",
    sources: ["ETW Threat-Intelligence (remote protect/alloc events) or EDR memory telemetry"],
    spl: { title: "Remote memory-protection change to executable (ETW-TI / EDR feed)", query: `index=* ${ETWTI} EventName IN ("KERNEL_THREATINT_TASK_PROTECTVM_REMOTE","KERNEL_THREATINT_TASK_ALLOCVM_REMOTE") ProtectionMask IN ("PAGE_EXECUTE_READWRITE","PAGE_EXECUTE_READ") | stats count by host, SourceImage, TargetImage, ProtectionMask` },
    sigma: { title: "Sigma: Executable memory protection change in another process", query: Y(["title: Executable Memory Protection Change In Remote Process", "status: experimental", "logsource:", "  product: windows", "  category: memory_protection", "detection:", "  selection:", "    NewProtect|contains: 'PAGE_EXECUTE_READWRITE'", "  condition: selection", "level: high"]) },
  },
  unbacked_memory_execution: {
    summary: "A thread starts at an address that is not backed by any loaded module.",
    sources: ["Sysmon EID 8 (StartModule empty)", "Sysmon EID 10 (CallTrace UNKNOWN frames)"],
    spl: { title: "Remote thread with no backing start module", query: `index=* ${SYSMON} EventCode=8 (StartModule="" OR isnull(StartModule) OR StartModule="-") | stats count by SourceImage, TargetImage, StartAddress` },
    sigma: { title: "Sigma: Remote thread starting in unbacked memory", query: Y(["title: Remote Thread Starting In Unbacked Memory", "status: experimental", "logsource:", "  product: windows", "  category: create_remote_thread", "detection:", "  selection:", "    StartModule: ''", "  condition: selection", "level: high"]) },
  },
  apc_into_remote_thread: {
    summary: "An APC is queued onto a thread in a different process.",
    sources: ["ETW Threat-Intelligence QUEUEUSERAPC_REMOTE", "EDR APC telemetry"],
    spl: { title: "Cross-process APC queue (ETW-TI / EDR feed)", query: `index=* ${ETWTI} EventName="KERNEL_THREATINT_TASK_QUEUEUSERAPC_REMOTE" | stats count by host, SourceImage, TargetImage` },
    sigma: { title: "Sigma: APC queued into another process", query: Y(["title: APC Queued Into Remote Process", "status: experimental", "logsource:", "  product: windows", "  service: etw-threat-intelligence", "detection:", "  selection:", "    EventName: 'KERNEL_THREATINT_TASK_QUEUEUSERAPC_REMOTE'", "  condition: selection", "level: high"]) },
  },
  early_bird_pattern: {
    summary: "A child process is created, then immediately accessed by its creator before it has initialised.",
    sources: ["Sysmon EID 1 (ProcessCreate)", "Sysmon EID 10 (ProcessAccess)"],
    spl: { title: "Creator accesses its own fresh child within seconds", query: `index=* ${SYSMON} (EventCode=1 OR EventCode=10) | eval child=if(EventCode=1,Image,TargetImage), parent=if(EventCode=1,ParentImage,SourceImage), guid=if(EventCode=1,ProcessGuid,TargetProcessGUID) | stats values(EventCode) as eids min(_time) as t0 max(_time) as t1 by host, guid, parent, child | where mvcount(eids)>=2 AND (t1-t0)<5` },
    sigma: { title: "Sigma: Write-capable access to a sacrificial child process", query: Y(["title: Write-Capable Access To Likely Sacrificial Process", "status: experimental", "logsource:", "  product: windows", "  category: process_access", "detection:", "  selection:", "    GrantedAccess:", "      - '0x1F3FFF'", "      - '0x1FFFFF'", "      - '0x143A'", "    TargetImage|endswith:", "      - '\\rundll32.exe'", "      - '\\RuntimeBroker.exe'", "      - '\\WerFault.exe'", "      - '\\notepad.exe'", "  condition: selection", "level: medium"]) },
  },
  thread_context_hijack: {
    summary: "A thread is suspended, its context is modified remotely, then it is resumed.",
    sources: ["ETW Threat-Intelligence SETTHREADCONTEXT_REMOTE", "EDR thread-state telemetry"],
    spl: { title: "Remote SetThreadContext (ETW-TI / EDR feed)", query: `index=* ${ETWTI} EventName="KERNEL_THREATINT_TASK_SETTHREADCONTEXT_REMOTE" | stats count by host, SourceImage, TargetImage` },
    sigma: { title: "Sigma: Remote thread-context modification", query: Y(["title: Thread Context Modified In Remote Process", "status: experimental", "logsource:", "  product: windows", "  service: etw-threat-intelligence", "detection:", "  selection:", "    EventName: 'KERNEL_THREATINT_TASK_SETTHREADCONTEXT_REMOTE'", "  condition: selection", "level: high"]) },
  },
  section_mapping_injection: {
    summary: "A section object is created and mapped into both the injector and a different target process.",
    sources: ["ETW Threat-Intelligence MAPVIEW_REMOTE", "EDR section-mapping telemetry"],
    spl: { title: "Cross-process section view mapping (ETW-TI / EDR feed)", query: `index=* ${ETWTI} EventName="KERNEL_THREATINT_TASK_MAPVIEW_REMOTE" | stats count by host, SourceImage, TargetImage, ProtectionMask` },
    sigma: { title: "Sigma: Section view mapped into a remote process", query: Y(["title: Section View Mapped Into Remote Process", "status: experimental", "logsource:", "  product: windows", "  service: etw-threat-intelligence", "detection:", "  selection:", "    EventName: 'KERNEL_THREATINT_TASK_MAPVIEW_REMOTE'", "  condition: selection", "level: high"]) },
  },
  module_stomp_execution: {
    summary: "A legitimate module is loaded, then its executable region is modified or executed.",
    sources: ["Sysmon EID 7 (ImageLoad)", "ETW Threat-Intelligence PROTECTVM_REMOTE"],
    spl: { title: "Image load followed by protection change on the same process", query: `index=* (${SYSMON} EventCode=7 OR (${ETWTI} EventName="KERNEL_THREATINT_TASK_PROTECTVM_REMOTE")) | eval proc=coalesce(Image,TargetImage) | stats values(EventCode) as eids values(EventName) as ev by host, proc | where mvfind(eids,"7")>=0 AND mvfind(ev,"PROTECTVM")>=0` },
    sigma: { title: "Sigma: Code overwrite inside a loaded module", query: Y(["title: Executable Region Of Loaded Module Overwritten", "status: experimental", "logsource:", "  product: windows", "  category: memory_protection", "detection:", "  selection:", "    OriginalProtect: 'PAGE_EXECUTE_READ'", "    NewProtect: 'PAGE_EXECUTE_READWRITE'", "  condition: selection", "level: high"]) },
  },
  callback_execution_anomaly: {
    summary: "Code runs through a callback or dispatcher rather than a normal thread entry; the call stack contains unbacked frames.",
    sources: ["Sysmon EID 10 (CallTrace with UNKNOWN frames)", "EDR call-stack telemetry"],
    spl: { title: "Process access whose call trace passes through unbacked memory", query: `index=* ${SYSMON} EventCode=10 CallTrace="*UNKNOWN*" NOT SourceImage IN ("*\\\\MsMpEng.exe","*\\\\csrss.exe") | stats count by SourceImage, TargetImage, GrantedAccess` },
    sigma: { title: "Sigma: Process access with an unbacked call-trace frame", query: Y(["title: Process Access With Unbacked Call Trace Frame", "status: experimental", "logsource:", "  product: windows", "  category: process_access", "detection:", "  selection:", "    CallTrace|contains: 'UNKNOWN'", "  condition: selection", "level: medium"]) },
  },
  process_tampering: {
    summary: "The process image in memory no longer matches the image on disk (hollowing / herpaderping family).",
    sources: ["Sysmon EID 25 (ProcessTampering)", "Sysmon EID 1 (ProcessCreate)"],
    spl: { title: "Sysmon process tampering events", query: `index=* ${SYSMON} EventCode=25 | stats count by Image, Type, host` },
    sigma: { title: "Sigma: Process image tampering", query: Y(["title: Process Image Tampering Detected", "status: stable", "logsource:", "  product: windows", "  category: process_tampering", "detection:", "  selection:", "    Type:", "      - 'Image is replaced'", "      - 'Image is locked for access'", "  condition: selection", "level: high"]) },
  },
  direct_syscall_stub: {
    summary: "System calls originate from outside ntdll (direct) or return into unexpected locations (indirect), bypassing user-mode hooks.",
    sources: ["Sysmon EID 10 (CallTrace without ntdll frame)", "ETW-TI / EDR call-stack telemetry"],
    spl: { title: "Process access whose call trace has no ntdll frame", query: `index=* ${SYSMON} EventCode=10 NOT CallTrace="*ntdll.dll*" | stats count by SourceImage, TargetImage, GrantedAccess` },
    sigma: { title: "Sigma: Process access bypassing ntdll", query: Y(["title: Process Access Without ntdll In Call Trace", "status: experimental", "logsource:", "  product: windows", "  category: process_access", "detection:", "  filter:", "    CallTrace|contains: 'ntdll.dll'", "  condition: not filter", "level: medium"]) },
  },
  // ── Linux ──
  ptrace_attach_write_execute: {
    summary: "ptrace attach followed by memory poke and register rewrite from a non-debugger process.",
    sources: ["auditd ptrace syscall records", "eBPF / uprobe telemetry (dlopen from unexpected thread)"],
    spl: { title: "ptrace attach/poke/setregs from a non-debugger", query: `index=* ${AUDITD} type=SYSCALL (syscall=ptrace OR syscall=101) a0 IN ("4","5","d","10","4206") NOT exe IN ("/usr/bin/gdb","/usr/bin/strace","/usr/bin/ltrace","/usr/bin/lldb") | stats count by host, exe, comm, ppid, auid` },
    sigma: { title: "Sigma: ptrace use by a non-debugger", query: Y(["title: Ptrace Syscall By Non-Debugger Process", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'SYSCALL'", "    syscall: 'ptrace'", "  filter_debuggers:", "    exe|endswith:", "      - '/gdb'", "      - '/strace'", "      - '/ltrace'", "      - '/lldb'", "  condition: selection and not filter_debuggers", "level: medium"]) },
  },
  proc_mem_write: {
    summary: "A process writes to another process's /proc/<pid>/mem.",
    sources: ["auditd PATH records for /proc/<pid>/mem", "eBPF file-write telemetry"],
    spl: { title: "Access to /proc/<pid>/mem", query: `index=* ${AUDITD} type=PATH name="/proc/*/mem" | stats count by host, name, comm, exe` },
    sigma: { title: "Sigma: /proc/<pid>/mem access", query: Y(["title: Access To Another Process Memory Via Procfs", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'PATH'", "    name|re: '^/proc/[0-9]+/mem$'", "  condition: selection", "level: high"]) },
  },
  remote_process_memory_write: {
    summary: "process_vm_writev targets another process's address space.",
    sources: ["auditd process_vm_writev syscall records"],
    spl: { title: "process_vm_writev syscall", query: `index=* ${AUDITD} type=SYSCALL (syscall=process_vm_writev OR syscall=311) | stats count by host, exe, comm, auid` },
    sigma: { title: "Sigma: process_vm_writev", query: Y(["title: Cross-Process Memory Write Via process_vm_writev", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'SYSCALL'", "    syscall: 'process_vm_writev'", "  condition: selection", "level: high"]) },
  },
  memfd_fileless_execution: {
    summary: "memfd_create followed by execution from the anonymous in-memory file.",
    sources: ["auditd memfd_create / execveat records"],
    spl: { title: "memfd_create then execveat by the same process", query: `index=* ${AUDITD} type=SYSCALL (syscall=memfd_create OR syscall=execveat OR syscall=319 OR syscall=322) | stats values(syscall) as sc count by host, pid, exe | where mvcount(sc)>=2` },
    sigma: { title: "Sigma: memfd_create use", query: Y(["title: Anonymous In-Memory File Created Via memfd_create", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'SYSCALL'", "    syscall: 'memfd_create'", "  condition: selection", "level: medium"]) },
  },
  shared_memory_execution: {
    summary: "Shared memory is mapped executable and run by another process.",
    sources: ["auditd mmap records (PROT_EXEC)", "/dev/shm object creation"],
    spl: { title: "Executable mapping of shared memory", query: `index=* ${AUDITD} type=SYSCALL syscall=mmap a2 IN ("5","7") | stats count by host, exe, comm` },
    sigma: { title: "Sigma: Executable file under /dev/shm", query: Y(["title: Executable Content Staged In /dev/shm", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'PATH'", "    name|startswith: '/dev/shm/'", "  condition: selection", "level: medium"]) },
  },
  seccomp_notify_abuse: {
    summary: "A seccomp filter with a user-notification listener is installed by a non-supervisor process.",
    sources: ["auditd seccomp syscall records"],
    spl: { title: "seccomp filter install with a notify listener", query: `index=* ${AUDITD} type=SYSCALL (syscall=seccomp OR syscall=317) a0=1 a1 IN ("8","9","c") | stats count by host, exe, comm` },
    sigma: { title: "Sigma: seccomp listener install", query: Y(["title: Seccomp User-Notification Listener Installed", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'SYSCALL'", "    syscall: 'seccomp'", "  condition: selection", "level: medium"]) },
  },
  anon_rwx_mapping: {
    summary: "Anonymous RWX mappings appear in a process (in-memory loaders, reflective objects).",
    sources: ["auditd mmap records", "/proc/<pid>/maps sampling via EDR"],
    spl: { title: "Anonymous RWX mmap", query: `index=* ${AUDITD} type=SYSCALL syscall=mmap a2="7" | stats count by host, exe, comm` },
    sigma: { title: "Sigma: RWX anonymous mapping", query: Y(["title: Anonymous RWX Memory Mapping", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'SYSCALL'", "    syscall: 'mmap'", "    a2: '7'", "  condition: selection", "level: medium"]) },
  },
  ld_preload_modification: {
    summary: "/etc/ld.so.preload is written, or LD_PRELOAD is set for launched processes.",
    sources: ["auditd file watch on /etc/ld.so.preload", "Process environment capture"],
    spl: { title: "Writes to /etc/ld.so.preload", query: `index=* ${AUDITD} (type=PATH name="/etc/ld.so.preload" OR key="ld_preload") | stats count by host, name, key` },
    sigma: { title: "Sigma: ld.so.preload modified", query: Y(["title: Dynamic Linker Preload File Modified", "status: experimental", "logsource:", "  product: linux", "  service: auditd", "detection:", "  selection:", "    type: 'PATH'", "    name: '/etc/ld.so.preload'", "  condition: selection", "level: high"]) },
  },
  elf_integrity_change: {
    summary: "An installed ELF binary changes on disk (for example its dynamic section).",
    sources: ["File-integrity monitoring (AIDE/FIM)", "Package-manager hash verification"],
    spl: { title: "Modified system binaries (FIM)", query: `index=* sourcetype IN ("linux:fim","aide") path IN ("/usr/bin/*","/usr/sbin/*","/usr/lib/*") change_type=modified | stats count by host, path` },
    sigma: { title: "Sigma: System binary modified", query: Y(["title: System ELF Binary Modified On Disk", "status: experimental", "logsource:", "  product: linux", "  category: file_change", "detection:", "  selection:", "    TargetFilename|startswith:", "      - '/usr/bin/'", "      - '/usr/sbin/'", "  condition: selection", "level: medium"]) },
  },
  // ── macOS ──
  task_port_acquisition: {
    summary: "A process obtains the Mach task port of another process.",
    sources: ["Endpoint Security GET_TASK events"],
    spl: { title: "task_for_pid / get-task events", query: `index=* ${MACES} event_type IN ("ES_EVENT_TYPE_NOTIFY_GET_TASK","ES_EVENT_TYPE_AUTH_GET_TASK") | stats count by process.executable.path, target.executable.path` },
    sigma: { title: "Sigma: Task port acquisition", query: Y(["title: Mach Task Port Acquired For Another Process", "status: experimental", "logsource:", "  product: macos", "  service: endpointsecurity", "detection:", "  selection:", "    event_type: 'ES_EVENT_TYPE_NOTIFY_GET_TASK'", "  condition: selection", "level: medium"]) },
  },
  remote_mach_memory_write: {
    summary: "Remote Mach memory is allocated and written (inferred by correlating task-port access with later memory/thread events).",
    sources: ["Endpoint Security GET_TASK + MPROTECT/REMOTE_THREAD_CREATE correlation"],
    spl: { title: "Task-port access followed by executable change in the target", query: `index=* ${MACES} event_type IN ("ES_EVENT_TYPE_NOTIFY_GET_TASK","ES_EVENT_TYPE_NOTIFY_MPROTECT","ES_EVENT_TYPE_NOTIFY_REMOTE_THREAD_CREATE") | stats values(event_type) as ev min(_time) as t0 max(_time) as t1 by target.executable.path | where mvcount(ev)>=2 AND (t1-t0)<10` },
    sigma: { title: "Sigma: Remote memory activity via task port", query: Y(["title: Cross-Process Memory Activity After Task Port Acquisition", "status: experimental", "logsource:", "  product: macos", "  service: endpointsecurity", "detection:", "  selection:", "    event_type:", "      - 'ES_EVENT_TYPE_NOTIFY_GET_TASK'", "      - 'ES_EVENT_TYPE_NOTIFY_MPROTECT'", "  condition: selection", "level: medium"]) },
  },
  remote_executable_memory: {
    summary: "Memory in another task is made executable.",
    sources: ["Endpoint Security MPROTECT events"],
    spl: { title: "Executable protection change (MPROTECT)", query: `index=* ${MACES} event_type="ES_EVENT_TYPE_NOTIFY_MPROTECT" protection IN ("*EXEC*") | stats count by process.executable.path` },
    sigma: { title: "Sigma: Executable mprotect", query: Y(["title: Memory Made Executable Via mprotect", "status: experimental", "logsource:", "  product: macos", "  service: endpointsecurity", "detection:", "  selection:", "    event_type: 'ES_EVENT_TYPE_NOTIFY_MPROTECT'", "    protection|contains: 'EXEC'", "  condition: selection", "level: medium"]) },
  },
  remote_thread_creation: {
    summary: "A thread is created in another process.",
    sources: ["Endpoint Security REMOTE_THREAD_CREATE events"],
    spl: { title: "Remote thread creation", query: `index=* ${MACES} event_type="ES_EVENT_TYPE_NOTIFY_REMOTE_THREAD_CREATE" | stats count by process.executable.path, target.executable.path` },
    sigma: { title: "Sigma: Remote thread creation", query: Y(["title: Remote Thread Created In Another Process", "status: experimental", "logsource:", "  product: macos", "  service: endpointsecurity", "detection:", "  selection:", "    event_type: 'ES_EVENT_TYPE_NOTIFY_REMOTE_THREAD_CREATE'", "  condition: selection", "level: high"]) },
  },
  thread_state_hijack: {
    summary: "A thread's register state is rewritten by another process.",
    sources: ["Endpoint Security THREAD_SET_STATE events"],
    spl: { title: "Thread state modified remotely", query: `index=* ${MACES} event_type="ES_EVENT_TYPE_NOTIFY_THREAD_SET_STATE" | stats count by process.executable.path, target.executable.path` },
    sigma: { title: "Sigma: Thread state set", query: Y(["title: Thread State Modified By Another Process", "status: experimental", "logsource:", "  product: macos", "  service: endpointsecurity", "detection:", "  selection:", "    event_type: 'ES_EVENT_TYPE_NOTIFY_THREAD_SET_STATE'", "  condition: selection", "level: high"]) },
  },
  dyld_environment_injection: {
    summary: "DYLD_INSERT_LIBRARIES is set for a newly executed process.",
    sources: ["Endpoint Security EXEC events (environment)"],
    spl: { title: "Exec with DYLD_INSERT_LIBRARIES", query: `index=* ${MACES} event_type="ES_EVENT_TYPE_NOTIFY_EXEC" env="*DYLD_INSERT_LIBRARIES=*" | stats count by process.executable.path, env` },
    sigma: { title: "Sigma: DYLD_INSERT_LIBRARIES", query: Y(["title: Process Launched With DYLD_INSERT_LIBRARIES", "status: experimental", "logsource:", "  product: macos", "  category: process_creation", "detection:", "  selection:", "    Environment|contains: 'DYLD_INSERT_LIBRARIES='", "  condition: selection", "level: high"]) },
  },
  dylib_hijack_execution: {
    summary: "A dylib is loaded from a user-writable or application-controlled path.",
    sources: ["Endpoint Security MMAP events", "Objective-See dylib monitoring"],
    spl: { title: "dylib mapped from a writable path", query: `index=* ${MACES} event_type="ES_EVENT_TYPE_NOTIFY_MMAP" path IN ("/Users/*","/tmp/*","/private/tmp/*") path="*.dylib" | stats count by process.executable.path, path` },
    sigma: { title: "Sigma: dylib from writable path", query: Y(["title: Dylib Loaded From User-Writable Path", "status: experimental", "logsource:", "  product: macos", "  service: endpointsecurity", "detection:", "  selection:", "    event_type: 'ES_EVENT_TYPE_NOTIFY_MMAP'", "    path|endswith: '.dylib'", "    path|startswith:", "      - '/Users/'", "      - '/private/tmp/'", "  condition: selection", "level: medium"]) },
  },
  ipc_staged_injection: {
    summary: "XPC/Mach IPC activity precedes remote memory or thread activity.",
    sources: ["Endpoint Security GET_TASK from XPC services", "Unified logging (XPC)"],
    spl: { title: "Task-port access by an XPC service", query: `index=* ${MACES} event_type="ES_EVENT_TYPE_NOTIFY_GET_TASK" process.executable.path="*.xpc/*" | stats count by process.executable.path, target.executable.path` },
    sigma: { title: "Sigma: XPC service acquiring a task port", query: Y(["title: XPC Service Acquires Task Port", "status: experimental", "logsource:", "  product: macos", "  service: endpointsecurity", "detection:", "  selection:", "    event_type: 'ES_EVENT_TYPE_NOTIFY_GET_TASK'", "    process.executable.path|contains: '.xpc/'", "  condition: selection", "level: medium"]) },
  },
};

// ── Per-OS lab setup, mitigations and references ─────────────────────────────
type Os = "win" | "lin" | "mac";
const OS_LABEL: Record<Os, string> = { win: "windows", lin: "linux", mac: "macos" };

const LAB: Record<Os, string[]> = {
  win: ["Windows endpoint (isolated VM / attack range)", "Sysmon EID 1, 7, 8, 10, 25", "ETW Threat-Intelligence or EDR memory telemetry (optional)", "PowerShell Script Block Logging"],
  lin: ["Linux host (isolated VM)", "auditd with syscall and file-watch rules", "eBPF / Falco or Sysmon for Linux (optional)"],
  mac: ["macOS host (isolated VM)", "Endpoint Security client (EDR or Objective-See tooling)", "Unified logging"],
};

const MIT: Record<Os, Mitigation[]> = {
  win: [
    { title: "Exploit Protection: ACG / CIG / CFG", kind: "config", mitreId: "M1050", detail: "Enable Arbitrary Code Guard, Code Integrity Guard and Control Flow Guard (Exploit Protection / WDAC) for high-value processes to block dynamic code and unsigned module loads." },
    { title: "Behavioural EDR with injection prevention", kind: "edr", mitreId: "M1040", detail: "Use an EDR that consumes ETW Threat-Intelligence and kernel callbacks and inspects call stacks, not just user-mode API hooks." },
    { title: "Sysmon with a tuned config", kind: "config", mitreId: "M1047", detail: "Enable EID 8, 10 and 25 and forward to the SIEM; tune out known-good sources rather than disabling the events." },
    { title: "Attack Surface Reduction rules", kind: "asr", mitreId: "M1040", detail: "Enable 'Block Office applications from injecting code into other processes' and 'Block credential stealing from LSASS'." },
    { title: "Protected Process Light for LSASS", kind: "config", mitreId: "M1043", detail: "Run LSASS as PPL / Credential Guard so injection into it is blocked even with SeDebugPrivilege." },
  ],
  lin: [
    { title: "Restrict ptrace (Yama) and drop CAP_SYS_PTRACE", kind: "config", mitreId: "M1026", detail: "Set kernel.yama.ptrace_scope to 2 or 3 and remove CAP_SYS_PTRACE from workloads that do not need it." },
    { title: "seccomp profiles for containers", kind: "config", mitreId: "M1038", detail: "Deny ptrace, process_vm_writev and memfd_create in container seccomp profiles unless required." },
    { title: "auditd rules and forwarding", kind: "config", mitreId: "M1047", detail: "Audit ptrace, process_vm_writev, memfd_create, execveat and writes to /etc/ld.so.preload; forward to the SIEM." },
    { title: "noexec on /dev/shm and /tmp", kind: "config", mitreId: "M1038", detail: "Mount scratch and shared-memory filesystems noexec,nosuid,nodev." },
    { title: "SELinux / AppArmor confinement", kind: "config", mitreId: "M1038", detail: "Confine services so they cannot open other processes' memory or load arbitrary libraries." },
  ],
  mac: [
    { title: "SIP, Hardened Runtime and library validation", kind: "config", mitreId: "M1038", detail: "Keep System Integrity Protection on and ship apps with Hardened Runtime + library validation so DYLD_* injection and unsigned dylibs are ignored." },
    { title: "Constrain task_for_pid", kind: "config", mitreId: "M1026", detail: "Restrict the debugger/get-task-allow entitlements and root use; monitor any non-developer use of task_for_pid." },
    { title: "Endpoint Security monitoring", kind: "edr", mitreId: "M1047", detail: "Deploy an Endpoint Security client alerting on GET_TASK, REMOTE_THREAD_CREATE, THREAD_SET_STATE, MPROTECT and EXEC-with-DYLD." },
    { title: "Notarisation and Gatekeeper", kind: "config", mitreId: "M1045", detail: "Require signed, notarised code to reduce the chance of an attacker-controlled dylib or loader executing." },
  ],
};

const OS_REFS: Record<Os, Reference[]> = {
  win: [
    { title: "Sysmon (Microsoft Sysinternals)", url: "https://learn.microsoft.com/sysinternals/downloads/sysmon" },
    { title: "AV-Comparatives — Process Injection Certification Test 2024", url: "https://www.av-comparatives.org/wp-content/uploads/2024/05/avc_ProcessInjection_2024_Kaspersky.pdf" },
    { title: "Google Cloud — Staying Hidden on the Endpoint: Evading Detection with Shellcode", url: "https://cloud.google.com/blog/topics/threat-intelligence/staying-hidden-on-the-endpoint-evading-detection-with-shellcode" },
  ],
  lin: [
    { title: "MITRE ATT&CK — Ptrace System Calls (T1055.008)", url: "https://attack.mitre.org/techniques/T1055/008/" },
    { title: "Security Scientist — Ptrace System Calls (T1055.008) Q&A", url: "https://www.securityscientist.net/blog/12-questions-and-answers-about-ptrace-system-calls-t1055-008/" },
    { title: "ManageEngine — Defense Evasion (TA0005) detection guide", url: "https://www.manageengine.com/log-management/mitre-attack/defense-evasion.html" },
  ],
  mac: [
    { title: "Apple Developer — Endpoint Security", url: "https://developer.apple.com/documentation/endpointsecurity" },
    { title: "Objective-See — Detecting (Evil) Dylibs", url: "https://objective-see.org/blog/blog_0x89.html" },
  ],
};

// ── Technique specs ──────────────────────────────────────────────────────────
// tid + m drive the Simulate leg: m=undefined → all local ART tests for tid;
// m=[terms] → only tests whose name contains a term; m=[] → coverage-only.
interface Spec {
  k: string; n: string; os: Os; cat: string;
  a: string[]; tid: string; m?: string[]; run: boolean;
  stealth: string; sev: TechniqueDef["severity"];
  beh: string; st: [string, string, string]; tel: string[]; pr: string[];
}
const SPECS: Spec[] = [
  // ── Windows · Remote Thread & Native API ──
  { k: "classic-remote-thread", n: "Classic remote shellcode injection", os: "win", cat: "Remote Thread & Native API", a: ["T1055"], tid: "T1055", m: ["CreateRemoteThread"], run: true, stealth: "Low (standard)", sev: "high",
    beh: "A process opens another process with write and thread-creation rights, places a buffer in it and starts a new remote thread there — the baseline injection chain.",
    st: ["Open a handle with write/thread rights to a victim process", "Allocate and write a buffer in the remote process", "Start a remote thread at the written buffer"],
    tel: ["Sysmon EID 10 (write-capable GrantedAccess)", "Sysmon EID 8 (CreateRemoteThread)", "Cross-process memory write"], pr: ["remote_shellcode_injection", "unbacked_memory_execution", "rwx_memory_allocation"] },
  { k: "ntcreatethreadex-native", n: "NtCreateThreadEx / native-API remote injection", os: "win", cat: "Remote Thread & Native API", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "Low / Moderate", sev: "high",
    beh: "The same remote-thread chain implemented through lower-level native (ntdll) exports instead of documented Win32 calls, to sidestep user-mode API hooks.",
    st: ["Obtain a process handle via native APIs", "Allocate and write remotely via native memory APIs", "Start the thread through NtCreateThreadEx"],
    tel: ["Native-API use from unusual callers", "Sysmon EID 8", "Remote allocation (EDR/ETW-TI)"], pr: ["remote_shellcode_injection", "unbacked_memory_execution", "direct_syscall_stub"] },
  { k: "rtlcreateuserthread", n: "RtlCreateUserThread injection", os: "win", cat: "Remote Thread & Native API", a: ["T1055"], tid: "T1055", m: ["RtlCreateUserThread"], run: true, stealth: "Low / Moderate", sev: "high",
    beh: "Remote thread creation through the undocumented RtlCreateUserThread export; telemetry looks like a remote thread with a non-image start address.",
    st: ["Open the victim process", "Place a buffer in the remote process", "Create the thread with RtlCreateUserThread"],
    tel: ["Sysmon EID 8", "Unusual thread start address"], pr: ["remote_shellcode_injection", "unbacked_memory_execution"] },
  { k: "etwp-create-etw-thread", n: "EtwpCreateEtwThread injection", os: "win", cat: "Remote Thread & Native API", a: ["T1055"], tid: "T1055", m: ["EtwpCreateEtwThread"], run: true, stealth: "Moderate", sev: "medium",
    beh: "A buffer is executed through an ETW-related internal thread-creation routine, so the thread originates from an unusual API path.",
    st: ["Use the current process as the target", "Stage a buffer in executable memory", "Start execution through the ETW thread-creation routine"],
    tel: ["Local RWX allocation", "Thread start in unbacked memory", "ETW-internal API use"], pr: ["unbacked_memory_execution", "callback_execution_anomaly"] },
  // ── Windows · Self-Injection & Local Runners ──
  { k: "self-createthread", n: "Self-injection via CreateThread", os: "win", cat: "Self-Injection & Local Runners", a: ["T1055"], tid: "T1055", m: ["CreateThread WinAPI"], run: true, stealth: "Low", sev: "medium",
    beh: "A process allocates executable memory in itself, copies a buffer in and runs it on a new local thread (a 'shellcode runner'); no cross-process access occurs.",
    st: ["The current process is its own target", "Allocate, fill and protect executable memory locally", "Start a new local thread at the buffer"],
    tel: ["Local RWX or RW→RX transition", "Thread start in unbacked memory"], pr: ["rwx_memory_allocation", "unbacked_memory_execution"] },
  { k: "self-fibers", n: "Self-injection via fibers", os: "win", cat: "Self-Injection & Local Runners", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "Moderate", sev: "medium",
    beh: "Local execution of a buffer through the fiber APIs (CreateFiber / SwitchToFiber) instead of a new thread, so no new-thread event marks the transfer of control.",
    st: ["The current process is its own target", "Stage a buffer in executable memory", "Transfer control with a fiber switch"],
    tel: ["Fiber API use", "Unusual execution context"], pr: ["rwx_memory_allocation", "callback_execution_anomaly"] },
  { k: "office-vba-runner", n: "Shellcode runner via Office macro (VBA)", os: "win", cat: "Self-Injection & Local Runners", a: ["T1055"], tid: "T1055", m: ["via VBA"], run: true, stealth: "Low", sev: "medium",
    beh: "Macro code inside an Office process allocates executable memory in that process and runs a buffer locally.",
    st: ["The Office process is its own target", "Allocate executable memory from macro code", "Run the buffer locally"],
    tel: ["Office process allocating RWX memory", "Office spawning unusual children", "Sysmon EID 1 / 7 for Office"], pr: ["rwx_memory_allocation", "unbacked_memory_execution"] },
  // ── Windows · APC & Thread Hijacking ──
  { k: "classic-apc", n: "Classic APC injection", os: "win", cat: "APC & Thread Hijacking", a: ["T1055.004"], tid: "T1055.004", m: ["Process Injection via C#"], run: true, stealth: "Moderate", sev: "high",
    beh: "A buffer is written into another process and an asynchronous procedure call is queued to one of its threads; it runs when that thread enters an alertable state.",
    st: ["Select a victim process and thread", "Write a buffer into the remote process", "Queue an APC that runs when the thread becomes alertable"],
    tel: ["QueueUserAPC / NtQueueApcThread against another process", "Thread state", "Remote memory write"], pr: ["apc_into_remote_thread", "remote_shellcode_injection"] },
  { k: "early-bird-apc", n: "Early Bird APC injection", os: "win", cat: "APC & Thread Hijacking", a: ["T1055.004"], tid: "T1055.004", m: ["EarlyBird"], run: true, stealth: "High", sev: "high",
    beh: "A child process is created suspended, a buffer is queued to its main thread as an APC before it initialises, then the process is resumed so the buffer runs first.",
    st: ["Create a suspended child process", "Write a buffer into the child", "Queue an APC to the main thread, then resume"],
    tel: ["Suspended child process creation", "Early APC before module initialisation", "Process lineage (Sysmon EID 1 / 10)"], pr: ["early_bird_pattern", "apc_into_remote_thread"] },
  { k: "ntqueueapcthreadex", n: "NtQueueApcThreadEx injection", os: "win", cat: "APC & Thread Hijacking", a: ["T1055.004"], tid: "T1055.004", m: ["NtQueueApcThreadEx"], run: true, stealth: "Moderate / High", sev: "high",
    beh: "APC injection through the native NtQueueApcThread[Ex] interface, which can run the routine without a conventional alertable wait.",
    st: ["Select a victim thread", "Write a buffer into the remote process", "Queue the APC through the native interface"],
    tel: ["Native APC APIs", "Thread execution at an unbacked address"], pr: ["apc_into_remote_thread", "unbacked_memory_execution"] },
  { k: "thread-hijack", n: "Thread hijacking", os: "win", cat: "APC & Thread Hijacking", a: ["T1055.003"], tid: "T1055.003", run: true, stealth: "Moderate", sev: "high",
    beh: "An existing thread in a target process is suspended, its saved context is rewritten to point at a buffer, and it is resumed — no new thread is created.",
    st: ["Select a victim thread in the target", "Write a buffer into the target process", "Suspend, rewrite the context, resume"],
    tel: ["Thread suspension then Get/SetThreadContext", "Instruction-pointer change"], pr: ["thread_context_hijack", "remote_shellcode_injection"] },
  { k: "child-thread-hijack", n: "Child-process thread hijack", os: "win", cat: "APC & Thread Hijacking", a: ["T1055.003"], tid: "T1055.003", m: [], run: false, stealth: "Moderate / High", sev: "high",
    beh: "Thread hijacking applied to the initial thread of a freshly created suspended child process.",
    st: ["Create a suspended child process", "Write a buffer into the child", "Redirect its initial thread's context, then resume"],
    tel: ["Suspended child process", "Thread-context modification"], pr: ["thread_context_hijack", "early_bird_pattern"] },
  { k: "atom-bombing", n: "Atom bombing", os: "win", cat: "APC & Thread Hijacking", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "The global atom table is used as a data carrier into a target, then APCs make the target copy and run the data — no direct cross-process write call appears.",
    st: ["Use the global atom table as the transfer channel", "Make the target retrieve the data into executable memory", "Trigger execution with APCs"],
    tel: ["Atom-table activity", "APC queuing against the target", "Executable-protection change inside the target"], pr: ["apc_into_remote_thread", "callback_execution_anomaly"] },
  // ── Windows · Section Mapping & Module Stomping ──
  { k: "section-mapping", n: "Section mapping injection", os: "win", cat: "Section Mapping & Module Stomping", a: ["T1055"], tid: "T1055", m: ["Section View"], run: true, stealth: "High", sev: "high",
    beh: "Shared executable memory is created as a section object and mapped into both the injector and the target, so the buffer appears in the target without a conventional cross-process write API call.",
    st: ["Create a shared section object", "Map it into the injector and the target", "Start a thread in the mapped view"],
    tel: ["NtCreateSection / NtMapViewOfSection (local + remote)", "Thread start in the mapped view", "ETW cross-process section mapping"], pr: ["section_mapping_injection", "unbacked_memory_execution"] },
  { k: "split-permission-section", n: "Split-permission section injection (W^X evasion)", os: "win", cat: "Section Mapping & Module Stomping", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "Very High", sev: "high",
    beh: "A section-mapping variant where the writing process only ever holds a writable view and the executing process only an executable view, so no single process holds writable+executable memory — defeating process-centric W^X heuristics.",
    st: ["Create a section with disjoint writer/executor views", "Map RW in one process and RX in the other", "Start a thread in the executable view"],
    tel: ["Cross-process section mapping with disjoint permissions", "Thread creation in the executable view"], pr: ["section_mapping_injection", "unbacked_memory_execution"] },
  { k: "pe-injection", n: "Portable Executable (PE) injection", os: "win", cat: "Section Mapping & Module Stomping", a: ["T1055.002"], tid: "T1055.002", run: true, stealth: "Moderate", sev: "high",
    beh: "A complete PE image, rather than a bare buffer, is copied into another process and executed there.",
    st: ["Select a victim process", "Copy a full PE image into it", "Start execution at the image entry"],
    tel: ["Large cross-process write", "Thread start in unbacked memory"], pr: ["remote_shellcode_injection", "unbacked_memory_execution"] },
  { k: "module-stomping", n: "Phantom DLL / module stomping", os: "win", cat: "Section Mapping & Module Stomping", a: ["T1055.001"], tid: "T1055.001", m: [], run: false, stealth: "High", sev: "high",
    beh: "A legitimate signed DLL is loaded into the target and its executable region is overwritten with a buffer, so the code runs from memory that appears image-backed.",
    st: ["Load a benign signed module in the target", "Overwrite its executable region", "Run the code from the module's address range"],
    tel: ["Signed module load (Sysmon EID 7)", "Memory modification of a module region", "Unbacked-looking execution"], pr: ["module_stomp_execution", "unbacked_memory_execution"] },
  { k: "mavinject-dll", n: "DLL injection via a signed utility (mavinject)", os: "win", cat: "Section Mapping & Module Stomping", a: ["T1055.001"], tid: "T1055.001", m: ["mavinject"], run: true, stealth: "Low", sev: "medium",
    beh: "DLL injection driven by a signed, built-in utility instead of custom code — a living-off-the-land route to loading a DLL in another process.",
    st: ["Choose a victim process", "Use a built-in signed utility to request the load", "The DLL loads inside the victim"],
    tel: ["Process creation of the utility with injection arguments", "Image load of the DLL in the target (Sysmon EID 7)"], pr: ["remote_shellcode_injection", "module_stomp_execution"] },
  // ── Windows · Callback & GUI Execution ──
  { k: "callback-execution", n: "Callback execution injection", os: "win", cat: "Callback & GUI Execution", a: ["T1055"], tid: "T1055", m: ["UuidFromStringA", "UUID custom"], run: true, stealth: "Moderate / High", sev: "medium",
    beh: "A buffer is executed by passing its address to an API that invokes a callback (enumeration, certificate-store, locale or timer APIs), so execution begins in a callback context rather than at a thread entry point.",
    st: ["The current process is the target", "Stage a buffer in executable memory", "Pass it to a callback-taking API"],
    tel: ["Callback registration", "Execution in an unexpected context", "Unbacked call-trace frames"], pr: ["callback_execution_anomaly", "rwx_memory_allocation", "unbacked_memory_execution"] },
  { k: "threadpool-workitem", n: "Thread-pool work-item injection", os: "win", cat: "Callback & GUI Execution", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "medium",
    beh: "A buffer is queued as a thread-pool work item (TpAllocWork / TpPostWork) so a pool thread executes it.",
    st: ["Use the current or a remote process", "Stage a buffer", "Queue it as a thread-pool work item"],
    tel: ["Thread-pool APIs", "Abnormal work-item execution"], pr: ["callback_execution_anomaly", "unbacked_memory_execution"] },
  { k: "peb-callback-table", n: "PEB callback-table hijack", os: "win", cat: "Callback & GUI Execution", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "A pointer in the process's PEB kernel-callback table is redirected so a window-message dispatch transfers control to a buffer.",
    st: ["Select a GUI process", "Place a buffer and redirect a callback-table entry", "Trigger a window message"],
    tel: ["PEB manipulation", "Callback redirection"], pr: ["callback_execution_anomaly", "remote_shellcode_injection"] },
  { k: "extra-window-memory", n: "Extra Window Memory injection", os: "win", cat: "Callback & GUI Execution", a: ["T1055.011"], tid: "T1055.011", run: true, stealth: "High", sev: "high",
    beh: "Window-class extra memory and window messages are used to redirect a GUI process's execution to a buffer.",
    st: ["Select a GUI process", "Place a buffer via shared memory and window-class data", "Trigger execution with a window message"],
    tel: ["GUI API behaviour against another process", "Shared memory", "Cross-process memory access to a GUI process"], pr: ["remote_shellcode_injection", "callback_execution_anomaly"] },
  { k: "listplanting", n: "ListPlanting", os: "win", cat: "Callback & GUI Execution", a: ["T1055.015"], tid: "T1055.015", run: true, stealth: "High", sev: "high",
    beh: "A buffer is placed in the memory of a ListView/TreeView control in a GUI process and execution is triggered through control messages.",
    st: ["Select a GUI process with a list control", "Write a buffer into the control's memory", "Trigger execution with control messages"],
    tel: ["UI-process memory writes", "Abnormal control behaviour"], pr: ["remote_shellcode_injection", "callback_execution_anomaly"] },
  // ── Windows · Process Lifecycle & Syscall Evasion ──
  { k: "process-hollowing", n: "Shellcode via process hollowing", os: "win", cat: "Process Lifecycle & Syscall Evasion", a: ["T1055.012"], tid: "T1055.012", run: true, stealth: "Moderate / High", sev: "high",
    beh: "A process is created suspended, its original image is replaced in memory with a buffer and it is resumed, so the code runs under a trusted process name.",
    st: ["Create a suspended trusted-looking process", "Replace its in-memory image", "Resume the process"],
    tel: ["Sysmon EID 25 (ProcessTampering)", "Suspended process creation", "Image / memory mismatch"], pr: ["process_tampering", "early_bird_pattern", "unbacked_memory_execution"] },
  { k: "cmdline-spoof-injection", n: "Command-line argument spoofing + injection", os: "win", cat: "Process Lifecycle & Syscall Evasion", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "After creating a suspended process, its PEB command line is rewritten so the logged arguments differ from what actually runs, then injection proceeds.",
    st: ["Create a suspended process with benign arguments", "Rewrite its PEB command line", "Inject, then resume"],
    tel: ["Suspended process creation", "PEB rewrite", "Command-line mismatch between event log and memory"], pr: ["early_bird_pattern", "process_tampering"] },
  { k: "rwx-memory-hunting", n: "RWX memory hunting", os: "win", cat: "Process Lifecycle & Syscall Evasion", a: ["T1055"], tid: "T1055", m: ["Read-Write-Execute"], run: true, stealth: "High", sev: "high",
    beh: "Instead of allocating new memory, the injector locates an existing RWX region in the target and writes into it, avoiding a suspicious allocation event.",
    st: ["Enumerate the target's memory regions", "Write into an existing RWX region", "Trigger execution in that region"],
    tel: ["Cross-process write to an existing RWX region", "Process memory enumeration"], pr: ["rwx_memory_allocation", "remote_shellcode_injection"] },
  { k: "direct-indirect-syscalls", n: "Direct & indirect syscall execution", os: "win", cat: "Process Lifecycle & Syscall Evasion", a: ["T1106"], tid: "T1106", m: ["Syscall"], run: true, stealth: "High", sev: "high",
    beh: "System calls are issued from custom stubs (direct) or by jumping to ntdll's own syscall instruction (indirect), so user-mode hooks and call-stack inspection are bypassed.",
    st: ["Resolve system-call numbers without the hooked export", "Issue the calls from a stub or via ntdll's syscall instruction", "Use them for the allocate/write/execute chain"],
    tel: ["Syscall instruction outside ntdll or unusual return addresses", "Call-stack anomalies"], pr: ["direct_syscall_stub", "unbacked_memory_execution"] },
  // ── Linux · ptrace & procfs ──
  { k: "linux-ptrace", n: "ptrace shellcode injection", os: "lin", cat: "ptrace & procfs", a: ["T1055.008"], tid: "T1055.008", m: [], run: false, stealth: "Moderate", sev: "high",
    beh: "A process attaches to another with ptrace, writes a buffer into its memory and rewrites its registers so execution continues there.",
    st: ["Attach to the target with ptrace", "Poke a buffer into its memory", "Rewrite registers and detach"],
    tel: ["ptrace attach / poke / setregs", "Debugger-like relationship from a non-debugger parent"], pr: ["ptrace_attach_write_execute"] },
  { k: "linux-proc-mem", n: "/proc/<pid>/mem injection", os: "lin", cat: "ptrace & procfs", a: ["T1055.009"], tid: "T1055.009", run: true, stealth: "Moderate", sev: "high",
    beh: "A buffer is written straight into a target's memory through its procfs mem file, optionally followed by control-flow redirection.",
    st: ["Open the target's procfs memory file", "Write into the target's memory", "Redirect execution"],
    tel: ["/proc/<pid>/mem open/write", "Process access from a non-debugging parent"], pr: ["proc_mem_write", "ptrace_attach_write_execute"] },
  { k: "linux-process-vm-writev", n: "process_vm_writev injection", os: "lin", cat: "ptrace & procfs", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "Moderate", sev: "high",
    beh: "Direct remote memory write between processes via process_vm_writev — the Linux analogue of WriteProcessMemory.",
    st: ["Identify a target process", "Write into its address space with process_vm_writev", "Trigger execution"],
    tel: ["process_vm_writev syscall", "Remote memory write"], pr: ["remote_process_memory_write", "ptrace_attach_write_execute"] },
  { k: "linux-libc-dlopen-mode", n: "__libc_dlopen_mode() runtime library injection", os: "lin", cat: "ptrace & procfs", a: ["T1055.008"], tid: "T1055.008", m: [], run: false, stealth: "Moderate / High", sev: "high",
    beh: "A running process is attached with ptrace and made to call the C library's dlopen routine, so it loads a chosen shared object.",
    st: ["Attach to the target with ptrace", "Redirect it into the C library's library-load routine", "Resume so the library loads"],
    tel: ["ptrace attach then register rewrite", "Uprobe on __libc_dlopen_mode / dlopen from an unexpected thread"], pr: ["ptrace_attach_write_execute"] },
  { k: "linux-seccomp-notify", n: "Seccomp-notify injection", os: "lin", cat: "ptrace & procfs", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "A seccomp user-notification listener is abused to read or modify another process's memory or syscall results.",
    st: ["Install a filter with a notify listener in the target's tree", "Intercept and alter syscalls", "Influence the target's memory or flow"],
    tel: ["seccomp filter / listener creation", "Unusual syscall interception"], pr: ["seccomp_notify_abuse", "remote_process_memory_write"] },
  // ── Linux · Fileless & Shared Memory ──
  { k: "linux-memfd-loader", n: "memfd_create fileless loader", os: "lin", cat: "Fileless & Shared Memory", a: ["T1620"], tid: "T1620", m: [], run: false, stealth: "High", sev: "high",
    beh: "A loader places an ELF/buffer in an anonymous in-memory file (memfd_create) and executes it, leaving no disk artifact.",
    st: ["Create an anonymous memory file", "Fill it with the image", "Execute it from memory"],
    tel: ["memfd_create then execveat", "Execution from anonymous memory"], pr: ["memfd_fileless_execution", "anon_rwx_mapping"] },
  { k: "linux-shared-memory", n: "Shared-memory injection", os: "lin", cat: "Fileless & Shared Memory", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "System V or POSIX shared memory is used to stage a buffer that another process maps executable and runs.",
    st: ["Create a shared-memory object", "Stage a buffer in it", "Have another process map it executable"],
    tel: ["shmget / shm_open", "mmap with PROT_EXEC", "Execution from a shared region"], pr: ["shared_memory_execution"] },
  { k: "linux-phantom-shm", n: "POSIX phantom shared memory (split permission)", os: "lin", cat: "Fileless & Shared Memory", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "Very High", sev: "high",
    beh: "A writer process fills a POSIX shared-memory object and unlinks its name (leaving only RAM frames); an executor process maps it executable — cross-process W^X separation.",
    st: ["Create and fill a shared-memory object", "Unlink its name so only memory remains", "Map it executable in a second process"],
    tel: ["shm_unlink of a recently written object", "Phantom shared-memory frames", "Executable mapping in the second process"], pr: ["shared_memory_execution"] },
  { k: "linux-reflective-so", n: "Reflective shared-object injection", os: "lin", cat: "Fileless & Shared Memory", a: ["T1620"], tid: "T1620", m: [], run: false, stealth: "High", sev: "high",
    beh: "A custom in-memory loader maps and relocates a shared object from an anonymous RWX mapping, so no library file ever exists on disk.",
    st: ["Allocate anonymous executable memory", "Map and relocate the object in memory", "Run its entry code"],
    tel: ["Anonymous RWX mappings in /proc/<pid>/maps", "No backing file for executed code"], pr: ["anon_rwx_mapping", "memfd_fileless_execution"] },
  { k: "linux-vfork-shared-space", n: "vfork shared address-space injection", os: "lin", cat: "Fileless & Shared Memory", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "Exploits vfork's shared address space: a child writes memory that the suspended parent then executes, so the executing process never allocated or wrote it.",
    st: ["Parent calls vfork and suspends", "Child writes into the shared address space", "Parent executes the child-written memory"],
    tel: ["vfork followed by executable mappings", "Execution of memory the process did not write"], pr: ["anon_rwx_mapping", "shared_memory_execution"] },
  // ── Linux · Dynamic Linker ──
  { k: "linux-ld-preload", n: "LD_PRELOAD and /etc/ld.so.preload injection", os: "lin", cat: "Dynamic Linker", a: ["T1574.006"], tid: "T1574.006", m: ["ld.so.preload", "LD_PRELOAD"], run: true, stealth: "Low / Moderate", sev: "medium",
    beh: "A shared object is loaded into new processes via the LD_PRELOAD environment variable or /etc/ld.so.preload, running constructor code and overriding library functions system-wide.",
    st: ["Choose a shared object to preload", "Register it via the environment or the preload file", "It loads into every newly started process"],
    tel: ["/etc/ld.so.preload modification", "LD_PRELOAD in process environment"], pr: ["ld_preload_modification"] },
  { k: "linux-dt-needed", n: "DT_NEEDED dynamic-section infection", os: "lin", cat: "Dynamic Linker", a: ["T1574.006"], tid: "T1574.006", m: [], run: false, stealth: "Moderate", sev: "high",
    beh: "An ELF binary on disk is modified so its dynamic section lists an extra needed library, which the loader then loads at every start.",
    st: ["Select an ELF binary", "Modify its dynamic section on disk", "The loader pulls in the extra library at launch"],
    tel: ["ELF header / dynamic-section modification", "Binary hash change", "Non-sequential DT_NEEDED entries"], pr: ["elf_integrity_change"] },
  { k: "linux-vdso-hijack", n: "vDSO hijacking", os: "lin", cat: "Dynamic Linker", a: ["T1055.014"], tid: "T1055.014", m: [], run: false, stealth: "High", sev: "high",
    beh: "The vDSO mapping, shared with every process, is modified to redirect control flow.",
    st: ["Locate the target's vDSO mapping", "Modify it", "Control flow is redirected on the next call"],
    tel: ["vDSO anomalies", "Memory modification of a shared mapping"], pr: ["proc_mem_write", "ptrace_attach_write_execute"] },
  // ── macOS · Mach Task & Thread ──
  { k: "macos-task-for-pid", n: "task_for_pid shellcode injection", os: "mac", cat: "Mach Task & Thread", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "Moderate", sev: "high",
    beh: "A process obtains the Mach task port of another, allocates and writes memory in it, marks it executable and starts execution — the canonical macOS injection chain.",
    st: ["Obtain the target's task port", "Allocate, write and mark memory executable", "Start execution in the target"],
    tel: ["task_for_pid / get-task events", "Remote memory allocate / write / protect", "Remote thread creation"], pr: ["task_port_acquisition", "remote_mach_memory_write", "remote_executable_memory", "remote_thread_creation"] },
  { k: "macos-thread-state-hijack", n: "Mach thread-state hijack", os: "mac", cat: "Mach Task & Thread", a: ["T1055.003"], tid: "T1055.003", m: [], run: false, stealth: "Moderate / High", sev: "high",
    beh: "An existing target thread is suspended and its register state rewritten so it continues at a buffer.",
    st: ["Obtain the target's task port", "Suspend a thread and rewrite its register state", "Resume it"],
    tel: ["Mach thread APIs", "Register / instruction-pointer modification"], pr: ["task_port_acquisition", "thread_state_hijack"] },
  { k: "macos-isolated-remote-thread", n: "Isolated remote thread spawning (thread_create_running)", os: "mac", cat: "Mach Task & Thread", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "A new isolated thread with its own stack is created in the target so existing threads are untouched and execution is crash-resilient.",
    st: ["Obtain the target's task port", "Prepare an isolated stack and mark memory executable", "Create and run a new thread"],
    tel: ["Unbacked executable pages", "Newly spawned Mach threads"], pr: ["task_port_acquisition", "remote_thread_creation", "remote_executable_memory"] },
  // ── macOS · Dylib & IPC ──
  { k: "macos-dyld-insert", n: "Dylib injection via DYLD_INSERT_LIBRARIES", os: "mac", cat: "Dylib & IPC", a: ["T1574.006"], tid: "T1574.006", m: ["DYLD_INSERT_LIBRARIES"], run: true, stealth: "Low / Moderate", sev: "medium",
    beh: "A library is loaded into a new process by setting DYLD_INSERT_LIBRARIES at launch.",
    st: ["Choose a library to insert", "Launch the target with the environment variable set", "The library loads at start"],
    tel: ["Environment variable on exec", "Dylib load", "Process creation"], pr: ["dyld_environment_injection", "dylib_hijack_execution"] },
  { k: "macos-dylib-hijack", n: "Dylib hijacking", os: "mac", cat: "Dylib & IPC", a: ["T1574.004"], tid: "T1574.004", m: [], run: false, stealth: "Moderate", sev: "high",
    beh: "A malicious dylib is placed where a vulnerable application searches for a library, so a trusted application loads it.",
    st: ["Find an application with a weak library search path", "Place a dylib in the searched path", "The application loads it"],
    tel: ["Dylib load from a writable path", "File creation in an application search path"], pr: ["dylib_hijack_execution"] },
  { k: "macos-dlopen-dlsym", n: "dlopen / dlsym loader", os: "mac", cat: "Dylib & IPC", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "Moderate", sev: "medium",
    beh: "A loader resolves and runs code dynamically through dlopen/dlsym, executing a buffer from a dynamically loaded image.",
    st: ["Load an image dynamically", "Resolve an entry symbol", "Call it"],
    tel: ["Dynamic library load", "Symbol resolution"], pr: ["dylib_hijack_execution", "remote_executable_memory"] },
  { k: "macos-xpc-staging", n: "XPC / IPC-based injection staging", os: "mac", cat: "Dylib & IPC", a: ["T1055"], tid: "T1055", m: [], run: false, stealth: "High", sev: "high",
    beh: "XPC or Mach IPC messages are used to pass a buffer or stage execution between processes.",
    st: ["Establish an XPC / Mach IPC channel", "Pass the staged data to a peer", "Trigger execution in the peer"],
    tel: ["XPC connections", "Mach ports", "Cross-process memory activity"], pr: ["ipc_staged_injection", "task_port_acquisition"] },
];

// ── Builder ──────────────────────────────────────────────────────────────────
const attackUrl = (id: string) => {
  const [t, s] = id.split(".");
  return `https://attack.mitre.org/techniques/${t}/${s ? s + "/" : ""}`;
};

function build(s: Spec): TechniqueDef {
  const prims = s.pr.map((p) => P[p]).filter(Boolean);
  const queries: DetectionQuery[] = [];
  for (const p of prims.slice(0, 3)) {
    queries.push({ format: "spl", title: p.spl.title, query: p.spl.query });
    queries.push({ format: "sigma", title: p.sigma.title, query: p.sigma.query });
  }
  const dataSources = [...new Set([...s.tel, ...prims.flatMap((p) => p.sources)])];

  let atomics: CuratedAtomic[] = [];
  if (s.run && s.m === undefined) atomics = [{ techniqueId: s.tid, why: `Vetted Atomic Red Team test(s) for ${s.tid} (${s.n}).` }];
  else if (s.run && s.m && s.m.length) atomics = [{ techniqueId: s.tid, nameIncludes: s.m, why: `Vetted Atomic Red Team test(s) matching "${s.m.join('" / "')}" under ${s.tid}.` }];

  const runnable = atomics.length > 0 && s.os === "win";
  return {
    key: s.k, name: s.n, category: s.cat, variant: `Stealth: ${s.stealth}`,
    description: s.beh,
    attackTechniques: s.a, tactic: "defense-evasion", platforms: [OS_LABEL[s.os]], severity: s.sev,
    summary: s.beh.split(/(?<=\.)\s/)[0],
    abuse: `Used by malware and red-team tooling to run code inside another process (or the caller itself) so activity inherits a trusted process identity and avoids process-centric detections. Evasion level: ${s.stealth}.`,
    labSetup: LAB[s.os],
    chainNarrative: [
      `Target selection: ${s.st[0]}.`,
      `Memory operation: ${s.st[1]}.`,
      `Execution trigger: ${s.st[2]}.`,
      "Post-injection behaviour (lab): a benign marker action only — no real C2 or payload infrastructure.",
    ],
    atomics,
    simulateNote: atomics.length
      ? "Run only in an isolated lab VM. Tag the run so telemetry can be traced to this technique, and correlate the allocate/write/trigger stages rather than a single API call."
      : "No vetted local atomic for this entry — it is catalogued for detection-engineering and coverage mapping. Validate analytics with your own authorised tooling in an isolated range.",
    runnableOnSar: runnable,
    detection: {
      summary: `Correlate stages, not single API names. ${prims.slice(0, 2).map((p) => p.summary).join(" ")}`,
      dataSources,
      queries,
    },
    mitigations: MIT[s.os],
    references: [{ title: `MITRE ATT&CK ${s.a[0]}`, url: attackUrl(s.a[0]) }, ...OS_REFS[s.os]],
  };
}

const techniques: TechniqueDef[] = SPECS.map(build);

export const SHELLCODE_INJECTION_LIBRARY: LibraryDef = {
  key: "shellcode-injection",
  moduleId: "detectops.shellcode-injection-sim",
  name: "Shellcode Injection",
  shortName: "Shellcode Injection",
  category: "privilege-escalation",
  icon: "Syringe",
  description: "Shellcode-injection techniques across Windows, Linux and macOS, from basic remote-thread and self-injection runners through APC, thread-hijack, section-mapping and syscall-evasion variants, to ptrace/procfs/memfd on Linux and Mach task-port/dylib injection on macOS. Each entry lists the telemetry it produces and the reusable detection primitives (SPL + Sigma) that correlate allocate → write → execute, plus mitigations; runnable entries map only to vetted Atomic Red Team tests.",
  techniques,
};

// Module-manifest catalog for the "attack-catalog" list view: one named entry per
// technique (uid), grouped by OS with a per-category domain facet. `match` narrows
// each entry's ATT&CK id to its own atomic tests so entries sharing an id (T1055…)
// do not duplicate rows.
const OS_GROUP: Record<Os, string> = { win: "Windows", lin: "Linux", mac: "macOS" };
const DOMAIN_DESC: Record<string, string> = {
  "Remote Thread & Native API": "Cross-process injection that ends in a remote thread, including native-API variants.",
  "Self-Injection & Local Runners": "A process runs a buffer inside itself (shellcode-runner style) — no cross-process access.",
  "APC & Thread Hijacking": "Execution via queued APCs or by rewriting an existing thread's context.",
  "Section Mapping & Module Stomping": "Shared-section mapping, split-permission views, PE/DLL injection and module overwrite.",
  "Callback & GUI Execution": "Execution triggered through callbacks, thread pools, PEB tables and GUI-control memory.",
  "Process Lifecycle & Syscall Evasion": "Hollowing, command-line spoofing, RWX reuse and direct/indirect syscalls.",
  "ptrace & procfs": "Linux injection through ptrace, procfs memory and process_vm_writev.",
  "Fileless & Shared Memory": "Linux in-memory loaders and shared-memory staging.",
  "Dynamic Linker": "Preload, dynamic-section and vDSO redirection on Linux.",
  "Mach Task & Thread": "macOS injection through Mach task ports and thread state.",
  "Dylib & IPC": "macOS dylib loading and XPC/IPC staging.",
};

export const SHELLCODE_CATALOG = (() => {
  const groups = new Map<string, { name: string; domain: string; description: string; techniques: Array<{ id: string; name: string; tactic: string; uid: string; match?: string[] }> }>();
  for (const s of SPECS) {
    const gk = `${s.os}|${s.cat}`;
    if (!groups.has(gk)) groups.set(gk, { name: OS_GROUP[s.os], domain: s.cat, description: DOMAIN_DESC[s.cat] || "", techniques: [] });
    groups.get(gk)!.techniques.push({ id: s.tid, name: s.n, tactic: "defense-evasion", uid: s.k, ...(s.m !== undefined ? { match: s.m } : {}) });
  }
  return [...groups.values()];
})();
