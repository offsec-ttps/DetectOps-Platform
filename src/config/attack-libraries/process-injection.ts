import type { LibraryDef, TechniqueDef } from "@/lib/attack-sim/types";

const techniques: TechniqueDef[] = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WINDOWS — REMOTE THREAD & DLL INJECTION (T1055.001)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: "dll-injection-classic",
    name: "DLL Injection (CreateRemoteThread)",
    category: "Process Injection",
    variant: "classic",
    description: "Classic DLL injection: OpenProcess → VirtualAllocEx → WriteProcessMemory → CreateRemoteThread(LoadLibraryA). High-signal injection in Sysmon EC10.",
    summary: "DLL injection via CreateRemoteThread — the bread-and-butter primitive.",
    abuse: "Open a higher-privs process, inject code/DLL, inherit its context and permissions.",
    labSetup: ["Windows endpoint", "Sysmon EC8 (CreateRemoteThread)", "Process hierarchy logging"],
    attackTechniques: ["T1055.001"],
    tactic: "privilege-escalation",
    platforms: ["windows"],
    severity: "high",
    chainNarrative: [
      "Enumerate high-value target processes (lsass, explorer, svchost).",
      "OpenProcess with PROCESS_ALL_ACCESS.",
      "VirtualAllocEx allocates writable memory in target.",
      "WriteProcessMemory writes DLL path or shellcode.",
      "CreateRemoteThread calls kernel32!LoadLibraryA in target context.",
    ],
    atomics: [
      { techniqueId: "T1055.001", nameIncludes: ["CreateRemoteThread", "DLL"], why: "Classic DLL injection via CreateRemoteThread." },
    ],
    simulateNote: "Verify Sysmon EC8 (CreateRemoteThread) and EC6 (Image Load) captured.",
    runnableOnSar: true,
    detection: {
      summary: "CreateRemoteThread from unsigned/suspicious parent to sensitive process (lsass, svchost, services) is high-signal.",
      dataSources: ["Sysmon EC8 (CreateRemoteThread)", "Sysmon EC10 (SetRemoteThreadContext)", "Process hierarchy"],
      queries: [
        {
          format: "spl",
          title: "CreateRemoteThread to sensitive process",
          query: `index=* EventCode=8 (TargetImage IN ("*\\\\lsass.exe","*\\\\svchost.exe","*\\\\services.exe","*\\\\explorer.exe")) | stats count by SourceImage, TargetImage, TargetProcessId`,
        },
        {
          format: "sigma",
          title: "Sigma: Remote Thread to LSASS",
          query: `title: Remote Thread Creation to LSASS\nlogsource:\n  product: windows\n  category: create_remote_thread\ndetection:\n  selection:\n    TargetImage|endswith: '\\\\lsass.exe'\n  condition: selection\nlevel: high`,
        },
      ],
    },
    mitigations: [
      { title: "Monitor CreateRemoteThread", kind: "edr", mitreId: "M1027", detail: "Alert on EC8 from unsigned parents; correlate with DLL load." },
      { title: "Code Integrity (CCI)", kind: "config", mitreId: "M1040", detail: "Enable Code Integrity to block unsigned DLL load in protected processes." },
      { title: "AMSI + Script Block Logging", kind: "config", mitreId: "M1538", detail: "Monitor PowerShell-based injection staging via AMSI." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.001", url: "https://attack.mitre.org/techniques/T1055/001/" },
      { title: "Red Canary Threat Detection Report — CreateRemoteThread", url: "https://redcanary.com/threat-detection-report/" },
    ],
  },

  {
    key: "process-hollowing",
    name: "Process Hollowing",
    category: "Process Injection",
    variant: "runpe",
    description: "Spawn process suspended → unmap original image via NtUnmapViewOfSection → write payload at image base → resume. Triggers Sysmon EC25 (Process Tampering).",
    summary: "Process Hollowing: suspend → unmap → write payload → resume. Triggers EC25.",
    abuse: "Spawn legitimate process, replace image entirely, execute malicious code under benign parent.",
    labSetup: ["Windows endpoint", "Sysmon EC25 (Process Tampering)", "Sysmon EC1 (Process Creation)", "Memory forensics"],
    attackTechniques: ["T1055.012"],
    tactic: "defense-evasion",
    platforms: ["windows"],
    severity: "critical",
    chainNarrative: [
      "CreateProcess with CREATE_SUSPENDED flag.",
      "NtUnmapViewOfSection unmaps original image from memory.",
      "Allocate memory at original image base.",
      "Write malicious PE headers, sections, relocation table.",
      "Update remote PEB→ImageBaseAddress and ThreadContext.RIP.",
      "ResumeThread executes payload under benign parent process name.",
    ],
    atomics: [
      { techniqueId: "T1055.012", nameIncludes: ["Hollowing", "RunPE"], why: "Classic process hollowing via NtUnmapViewOfSection." },
    ],
    simulateNote: "Verify Sysmon EC25 (Process Tampering: image unmapped and replaced).",
    runnableOnSar: true,
    detection: {
      summary: "Suspended process creation + EC9 (raw disk read of image) + EC25 (process tampering) = hollowing signature.",
      dataSources: ["Sysmon EC1 (CREATE_SUSPENDED)", "Sysmon EC9 (RawAccessRead)", "Sysmon EC25 (Process Tampering)"],
      queries: [
        {
          format: "spl",
          title: "Suspended process + tampering events",
          query: `index=* EventCode=25 (Image IN ("*\\\\svchost.exe","*\\\\explorer.exe")) | stats count by Image, User, ProcessId | where count > 0`,
        },
        {
          format: "sigma",
          title: "Sigma: Process Tampering Detection",
          query: `title: Process Tampering - Hollowing\nlogsource:\n  product: windows\n  category: process_tampering\ndetection:\n  selection:\n    Tampering|contains: 'Unmapped'\n  condition: selection\nlevel: high`,
        },
      ],
    },
    mitigations: [
      { title: "Detect EC25 (Process Tampering)", kind: "edr", mitreId: "M1027", detail: "Alert on EC25 events — strong hollowing signal." },
      { title: "Monitor NtUnmapViewOfSection", kind: "edr", mitreId: "M1027", detail: "Low-level API monitoring for image unmapping attempts." },
      { title: "Memory Integrity", kind: "config", mitreId: "M1040", detail: "Enable Virtualization-Based Security (VBS) + Memory Tagging Extension (MTE) on ARM64." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.012 — Process Hollowing", url: "https://attack.mitre.org/techniques/T1055/012/" },
      { title: "Sysmon EC25 — Process Tampering", url: "https://learn.microsoft.com/en-us/sysinternals/downloads/sysmon" },
    ],
  },

  {
    key: "apc-injection-early-bird",
    name: "APC Injection (Early Bird)",
    category: "Process Injection",
    variant: "early-bird",
    description: "Queue APC to suspended initial thread before process launches. Executes in alertable wait state. Signature: suspended process + QueueUserAPC.",
    summary: "APC to suspended thread before process runs — executes before legitimate code.",
    abuse: "Queue payload to fresh process before main() executes; inherits context without remote thread creation.",
    labSetup: ["Windows endpoint", "Sysmon EC1 (CREATE_SUSPENDED)", "ETW APC events", "Thread state monitoring"],
    attackTechniques: ["T1055.004"],
    tactic: "defense-evasion",
    platforms: ["windows"],
    severity: "high",
    chainNarrative: [
      "CreateProcess with CREATE_SUSPENDED.",
      "Allocate memory for APC payload.",
      "WriteProcessMemory writes shellcode.",
      "QueueUserAPC queues payload to initial thread.",
      "ResumeThread runs; initial thread enters alertable wait, APC fires.",
      "Payload executes before legitimate process initialization.",
    ],
    atomics: [
      { techniqueId: "T1055.004", nameIncludes: ["APC", "Early"], why: "APC injection to suspended initial thread." },
    ],
    simulateNote: "Verify QueueUserAPC call and suspended process creation correlation.",
    runnableOnSar: true,
    detection: {
      summary: "Suspended process creation + QueueUserAPC events = APC injection signature.",
      dataSources: ["Sysmon EC1 (CREATE_SUSPENDED flag)", "ETW (QueueUserAPC)", "Thread context modification"],
      queries: [
        {
          format: "spl",
          title: "QueueUserAPC events in context",
          query: `index=* EventCode=APC OR EventType=QueueUserAPC | stats count by Image, ProcessId, ThreadId`,
        },
        {
          format: "sigma",
          title: "Sigma: APC Queue to Suspended Process",
          query: `title: APC Injection (Early Bird)\nlogsource:\n  product: windows\n  category: apc_queue\ndetection:\n  selection:\n    ProcessCreationFlags: 'CREATE_SUSPENDED'\n  condition: selection\nlevel: medium`,
        },
      ],
    },
    mitigations: [
      { title: "Monitor QueueUserAPC", kind: "edr", mitreId: "M1027", detail: "Alert on QueueUserAPC to user-mode targets." },
      { title: "Thread creation monitoring", kind: "edr", mitreId: "M1027", detail: "Correlate suspended process creation with alertable wait dispatch." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.004 — Asynchronous Procedure Call", url: "https://attack.mitre.org/techniques/T1055/004/" },
    ],
  },

  {
    key: "thread-execution-hijacking",
    name: "Thread Execution Hijacking",
    category: "Process Injection",
    variant: "context-modification",
    description: "Suspend target thread → GetThreadContext → modify RIP → SetThreadContext → resume. No remote thread creation (avoids EC8).",
    summary: "Hijack existing thread: suspend → modify RIP → resume. No CreateRemoteThread signature.",
    abuse: "Redirect execution of an existing thread without creating a new one; evades CreateRemoteThread monitoring.",
    labSetup: ["Windows endpoint", "Thread suspend/resume events", "CPU register monitoring"],
    attackTechniques: ["T1055.003"],
    tactic: "defense-evasion",
    platforms: ["windows"],
    severity: "high",
    chainNarrative: [
      "Enumerate threads in target process.",
      "OpenThread with THREAD_GET_CONTEXT | THREAD_SET_CONTEXT.",
      "SuspendThread freezes target thread.",
      "GetThreadContext reads CPU state (RIP, RSP, etc.).",
      "Overwrite RIP to point to shellcode.",
      "SetThreadContext updates CPU state.",
      "ResumeThread continues; thread jumps to shellcode.",
    ],
    atomics: [
      { techniqueId: "T1055.003", nameIncludes: ["Hijack", "Thread"], why: "Thread execution hijacking via context modification." },
    ],
    simulateNote: "Monitor for GetThreadContext/SetThreadContext without corresponding CreateRemoteThread.",
    runnableOnSar: true,
    detection: {
      summary: "Unexpected GetThreadContext + SetThreadContext pattern (especially cross-process) is suspicious.",
      dataSources: ["ETW (GetThreadContext/SetThreadContext)", "Process memory inspection", "CPU state change monitoring"],
      queries: [
        {
          format: "spl",
          title: "GetThreadContext cross-process",
          query: `index=* EventType=GetThreadContext SourceProcessId != TargetProcessId | stats count by SourceImage, TargetImage`,
        },
        {
          format: "sigma",
          title: "Sigma: Thread Context Hijacking",
          query: `title: Thread Hijacking (Context Modification)\nlogsource:\n  product: windows\n  category: thread_hijacking\ndetection:\n  selection:\n    EventName: ['GetThreadContext','SetThreadContext']\n  condition: selection\nlevel: medium`,
        },
      ],
    },
    mitigations: [
      { title: "Monitor cross-process thread APIs", kind: "edr", mitreId: "M1027", detail: "Alert on SetThreadContext from external processes." },
      { title: "CPU register protection", kind: "config", mitreId: "M1040", detail: "Hardware-assisted bounds checking on register modification." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.003 — Thread Execution Hijacking", url: "https://attack.mitre.org/techniques/T1055/003/" },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WINDOWS — PE/CODE INJECTION VARIANTS (T1055.002, T1055.005, T1055.015)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: "reflective-dll-injection",
    name: "Reflective DLL Injection",
    category: "Process Injection",
    variant: "reflective-loader",
    description: "Manually map DLL into memory without loader artifacts. Reflective bootstrap parses PE, resolves IAT, applies relocations, executes DllMain. No on-disk load signature.",
    summary: "Manual PE mapping without DLL loader. Unbacked memory execution.",
    abuse: "Load DLL entirely from memory, avoiding on-disk footprint and DLL load monitoring.",
    labSetup: ["Windows endpoint", "Unbacked memory detection", "ETW image/DLL load events"],
    attackTechniques: ["T1055.001", "T1055.002"],
    tactic: "defense-evasion",
    platforms: ["windows"],
    severity: "high",
    chainNarrative: [
      "Embed reflective loader + PE payload in memory.",
      "VirtualAllocEx allocates RWX memory.",
      "WriteProcessMemory writes PE buffer + reflective loader.",
      "CreateRemoteThread calls reflective loader entry point.",
      "Loader manually parses PE headers, resolves IAT, applies relocations.",
      "Executes DllMain from loaded memory without on-disk DLL load.",
    ],
    atomics: [
      { techniqueId: "T1055.002", nameIncludes: ["Reflective", "DLL"], why: "Reflective DLL injection without on-disk load." },
    ],
    simulateNote: "Verify unbacked private RWX memory execution; check for absence of DLL load events.",
    runnableOnSar: true,
    detection: {
      summary: "Unbacked RWX memory execution + missing DLL load events = reflective injection signature.",
      dataSources: ["Unbacked memory detection", "Sysmon EC6/EC7 absence (no DLL load)", "Memory protection changes"],
      queries: [
        {
          format: "spl",
          title: "Unbacked executable memory",
          query: `index=* MemoryProtect=RWX MemoryRegionType=private | stats count by Image, MemoryAddress, MemorySize`,
        },
        {
          format: "sigma",
          title: "Sigma: Reflective Loader Execution",
          query: `title: Reflective Code Execution\nlogsource:\n  product: windows\n  category: memory_protection\ndetection:\n  selection:\n    MemoryProtect: RWX\n    ModuleLoaded: false\n  condition: selection\nlevel: high`,
        },
      ],
    },
    mitigations: [
      { title: "Detect unbacked RWX memory", kind: "edr", mitreId: "M1027", detail: "Alert on RWX allocation without corresponding on-disk module." },
      { title: "Memory integrity checking", kind: "config", mitreId: "M1040", detail: "Verify memory regions correspond to loaded modules." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.002 — Portable Executable Injection", url: "https://attack.mitre.org/techniques/T1055/002/" },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LINUX — PTRACE & /PROC INJECTION (T1055.008, T1055.009)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: "ptrace-injection",
    name: "Ptrace System Call Injection",
    category: "Process Injection",
    variant: "ptrace-poketext",
    description: "ptrace(PTRACE_ATTACH) → save registers → write shellcode via PTRACE_POKETEXT → SetRegs → detach. Classic Linux injection.",
    summary: "Ptrace-based code injection: attach → write → modify registers → detach.",
    abuse: "Debug any process running as same or lower UID; inject code without new process.",
    labSetup: ["Linux endpoint (glibc/musl)", "auditd SYSCALL logging", "strace/ltrace tracking"],
    attackTechniques: ["T1055.008"],
    tactic: "privilege-escalation",
    platforms: ["linux"],
    severity: "high",
    chainNarrative: [
      "Identify target process PID.",
      "ptrace(PTRACE_ATTACH, pid) — only works if UID matches or is root.",
      "Wait for SIGSTOP, indicating attach complete.",
      "PTRACE_GETREGS saves CPU state (RIP, RSP, RAX, etc.).",
      "PTRACE_POKETEXT/PTRACE_POKEDATA writes shellcode to text/data segment.",
      "PTRACE_SETREGS updates RIP to shellcode entry point.",
      "PTRACE_DETACH resumes target; target jumps to shellcode.",
    ],
    atomics: [
      { techniqueId: "T1055.008", nameIncludes: ["ptrace", "inject"], why: "Ptrace-based process injection on Linux." },
    ],
    simulateNote: "Verify auditd SYSCALL log captures ptrace attach and POKETEXT operations.",
    runnableOnSar: false,  // SAR lab is Windows-only
    detection: {
      summary: "Unexpected ptrace(PTRACE_ATTACH) from non-debugger process is suspicious.",
      dataSources: ["auditd SYSCALL (syscall=101 ptrace)", "process strace audit", "debugger detection"],
      queries: [
        {
          format: "spl",
          title: "auditd SYSCALL — ptrace ATTACH",
          query: `index=* auditd syscall=101 a0=16 | stats count by auid, comm, pid | where auid != root`,
        },
        {
          format: "sigma",
          title: "Sigma: Ptrace Injection Detection",
          query: `title: Ptrace Process Injection\nlogsource:\n  product: linux\n  category: ptrace_syscall\ndetection:\n  selection:\n    syscall: ['ptrace']\n    call: 'PTRACE_ATTACH'\n  condition: selection\nlevel: medium`,
        },
      ],
    },
    mitigations: [
      { title: "Restrict ptrace via kernel module", kind: "config", mitreId: "M1040", detail: "Disable ptrace for non-root or specific UID ranges." },
      { title: "Monitor ptrace syscalls", kind: "edr", mitreId: "M1027", detail: "Alert on ptrace from non-debugger processes." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.008 — Ptrace System Calls", url: "https://attack.mitre.org/techniques/T1055/008/" },
    ],
  },

  {
    key: "proc-mem-injection",
    name: "Proc Memory Injection (/proc/[pid]/mem)",
    category: "Process Injection",
    variant: "proc-mem-write",
    description: "Parse /proc/[pid]/maps → locate executable region → open /proc/[pid]/mem → seek → write shellcode. Fileless but noisy in proc.",
    summary: "/proc/[pid]/mem injection: locate text → write → execute.",
    abuse: "Write directly to process memory via filesystem interface; no ptrace permission needed.",
    labSetup: ["Linux endpoint", "proc filesystem audit", "memory region tracking"],
    attackTechniques: ["T1055.009"],
    tactic: "privilege-escalation",
    platforms: ["linux"],
    severity: "high",
    chainNarrative: [
      "Parse /proc/[pid]/maps to find executable (r-xp) regions.",
      "Identify suitable RWX or RW region for payload.",
      "open(/proc/[pid]/mem, O_RDWR) — must run as same or higher privilege.",
      "lseek to target address in virtual address space.",
      "write/process_vm_writev writes shellcode.",
      "Trigger code execution via signal delivery or thread entry point modification.",
    ],
    atomics: [
      { techniqueId: "T1055.009", nameIncludes: ["proc", "mem"], why: "/proc/[pid]/mem direct memory injection." },
    ],
    simulateNote: "Monitor /proc access audit; verify memory modifications recorded.",
    runnableOnSar: false,
    detection: {
      summary: "Unexpected write to /proc/[pid]/mem followed by code execution is injection signature.",
      dataSources: ["auditd file access (/proc/[pid]/mem)", "memory event tracing", "process execution correlation"],
      queries: [
        {
          format: "spl",
          title: "auditd /proc/[pid]/mem writes",
          query: `index=* auditd name="/proc/*/mem" access=write | stats count by auid, exe | where auid != root`,
        },
        {
          format: "sigma",
          title: "Sigma: /proc Memory Write Injection",
          query: `title: Direct Memory Write via /proc\nlogsource:\n  product: linux\n  category: file_access\ndetection:\n  selection:\n    path: '/proc/*/mem'\n    mode: 'write'\n  condition: selection\nlevel: medium`,
        },
      ],
    },
    mitigations: [
      { title: "Restrict /proc/[pid]/mem", kind: "config", mitreId: "M1040", detail: "Disable /proc/[pid]/mem write by ACL." },
      { title: "Memory write audit", kind: "edr", mitreId: "M1027", detail: "Alert on /proc memory writes from unprivileged users." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.009 — Proc Memory", url: "https://attack.mitre.org/techniques/T1055/009/" },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MACOS — DYLD & MACH (T1055.001, T1574.006)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: "dyld-preload-injection",
    name: "DYLD_INSERT_LIBRARIES (macOS)",
    category: "Process Injection",
    variant: "dyld-preload",
    description: "Set DYLD_INSERT_LIBRARIES=/path/to/malicious.dylib in process launch environment. dyld loads library before main(); constructor executes automatically.",
    summary: "DYLD_INSERT_LIBRARIES: preload malicious library before main().",
    abuse: "Force dyld to load attacker library before standard libraries; constructor code executes.",
    labSetup: ["macOS endpoint (10.13+)", "dyld audit", "code signature verification"],
    attackTechniques: ["T1574.006"],
    tactic: "persistence",
    platforms: ["macos"],
    severity: "medium",
    chainNarrative: [
      "Compile malicious .dylib with __attribute__((constructor)) init function.",
      "Set DYLD_INSERT_LIBRARIES=/path/to/lib.dylib in process launch environment.",
      "Launch target application without hardened runtime.",
      "dyld preloads library before main().",
      "Constructor function executes before application code.",
    ],
    atomics: [
      { techniqueId: "T1574.006", nameIncludes: ["DYLD", "preload"], why: "DYLD_INSERT_LIBRARIES injection on macOS." },
    ],
    simulateNote: "Verify dyld load audit captures library load; check code signature validation.",
    runnableOnSar: false,
    detection: {
      summary: "Unexpected DYLD_INSERT_LIBRARIES in process environment or dylib load without signature.",
      dataSources: ["EndpointSecurity ES_EVENT_TYPE_NOTIFY_EXEC", "dyld_shared_cache audit", "code signature events"],
      queries: [
        {
          format: "spl",
          title: "DYLD_INSERT_LIBRARIES environment variable",
          query: `index=* os=macos event_type=exec environment contains="DYLD_INSERT_LIBRARIES" | stats count by process, parent_process`,
        },
        {
          format: "sigma",
          title: "Sigma: DYLD Preload Injection",
          query: `title: DYLD Preload Library Injection\nlogsource:\n  product: macos\n  category: process_creation\ndetection:\n  selection:\n    EnvironmentVariables|contains: 'DYLD_INSERT_LIBRARIES'\n  condition: selection\nlevel: medium`,
        },
      ],
    },
    mitigations: [
      { title: "Hardened Runtime Entitlements", kind: "config", mitreId: "M1040", detail: "Enable Hardened Runtime to restrict DYLD_INSERT_LIBRARIES." },
      { title: "Code Signature Verification", kind: "config", mitreId: "M1049", detail: "Verify library signatures before load." },
    ],
    references: [
      { title: "MITRE ATT&CK T1574.006 — Dyld Environment Variables", url: "https://attack.mitre.org/techniques/T1574/006/" },
    ],
  },

  // Additional technique stubs (to be expanded with full details in production)
  // These are provided as templates for completion:

  {
    key: "process-doppelganging",
    name: "Process Doppelgänging (TxF)",
    category: "Process Injection",
    variant: "txf-transaction",
    description: "NTFS Transactions: NtCreateTransaction → write malicious payload into transacted file → NtCreateSection → NtRollbackTransaction → NtCreateProcessEx. Erases disk traces.",
    summary: "TxF-based process creation: transact → rollback → execute.",
    abuse: "Execute code via transacted file, leaving no on-disk evidence.",
    labSetup: ["Windows endpoint", "Transaction audit", "NTFS journal monitoring"],
    attackTechniques: ["T1055.013"],
    tactic: "defense-evasion",
    platforms: ["windows"],
    severity: "critical",
    chainNarrative: [
      "Create temporary file.",
      "NtCreateTransaction creates NTFS transaction context.",
      "Write malicious payload within transaction.",
      "NtCreateSection creates image section from transacted file.",
      "NtRollbackTransaction reverts disk changes (file deleted).",
      "NtCreateProcessEx spawns process from in-memory section.",
    ],
    atomics: [
      { techniqueId: "T1055.013", nameIncludes: ["Doppel", "TxF", "Transaction"], why: "Process Doppelgänging via NTFS transactions." },
    ],
    simulateNote: "Monitor transaction events and file rollback patterns.",
    runnableOnSar: true,
    detection: {
      summary: "Transaction creation + section mapping + rollback = doppelgänging signature.",
      dataSources: ["ETW (Transaction events)", "NTFS journal", "Section mapping audit"],
      queries: [
        {
          format: "spl",
          title: "NTFS Transaction + NtCreateSection",
          query: `index=* EventType=NtCreateTransaction OR EventType=NtRollbackTransaction | stats count by ProcessImage, TransactionId`,
        },
        {
          format: "sigma",
          title: "Sigma: Process Doppelgänging",
          query: `title: Process Doppelgänging (Transactional)\nlogsource:\n  product: windows\n  category: process_creation\ndetection:\n  selection:\n    TransactionUsed: true\n    FilePath|endswith: '.exe'\n  condition: selection\nlevel: critical`,
        },
      ],
    },
    mitigations: [
      { title: "Disable NTFS Transactions", kind: "config", mitreId: "M1040", detail: "Disable TxF via registry (HKLM\\System\\CurrentControlSet\\Services\\TxF)." },
      { title: "Monitor transaction events", kind: "edr", mitreId: "M1027", detail: "Alert on unusual transaction activity." },
    ],
    references: [
      { title: "MITRE ATT&CK T1055.013 — Process Doppelgänging", url: "https://attack.mitre.org/techniques/T1055/013/" },
    ],
  },

  {
    key: "module-stomping",
    name: "Module Stomping / DLL Hollowing",
    category: "Process Injection",
    variant: "dll-overwrite",
    description: "Load legitimate signed DLL → overwrite mapped code sections with payload → execute from DLL base. Evades memory allocation alerts.",
    summary: "Load legit DLL, overwrite it with payload, execute.",
    abuse: "Reuse signed DLL's memory as RWX; avoids VirtualAllocEx alerts.",
    labSetup: ["Windows endpoint", "Memory modification detection", "Code integrity monitoring"],
    attackTechniques: ["T1055.001"],
    tactic: "defense-evasion",
    platforms: ["windows"],
    severity: "high",
    chainNarrative: [
      "Load legitimate signed DLL (e.g., kernel32, ntdll).",
      "Locate mapped code region (RX).",
      "VirtualProtect changes to RW.",
      "memcpy overwrites DLL code with payload.",
      "VirtualProtect changes back to RX.",
      "Jump to payload within DLL base address.",
    ],
    atomics: [
      { techniqueId: "T1055.001", nameIncludes: ["Stomp", "Module"], why: "Module stomping / DLL code overwrite." },
    ],
    simulateNote: "Verify memory protection change + code overwrite pattern.",
    runnableOnSar: true,
    detection: {
      summary: "Legitimate module loaded + memory protection change + code modification = stomping.",
      dataSources: ["Sysmon EC6/EC7 (DLL load)", "Memory protection change events", "Code integrity violation"],
      queries: [
        {
          format: "spl",
          title: "Memory protection RX→RW on signed DLL",
          query: `index=* EventType=MemoryProtect OldProtect=RX NewProtect=RW ModuleSignature=valid | stats count by Module, ProcessImage`,
        },
        {
          format: "sigma",
          title: "Sigma: Module Stomping",
          query: `title: DLL Code Overwrite Detection\nlogsource:\n  product: windows\n  category: memory_protection\ndetection:\n  selection:\n    OriginalProtect: 'PAGE_EXECUTE_READ'\n    NewProtect: 'PAGE_EXECUTE_READWRITE'\n  condition: selection\nlevel: high`,
        },
      ],
    },
    mitigations: [
      { title: "Code Integrity (CCI)", kind: "config", mitreId: "M1040", detail: "Prevent code modification in loaded modules." },
      { title: "Monitor RX→RW transitions", kind: "edr", mitreId: "M1027", detail: "Alert on permission change from execute-only to writeable." },
    ],
    references: [
      { title: "Mockingjay Research — RWX Section Reuse", url: "https://www.securityjoes.com/post/process-mockingjay-echoing-rwx-in-userland-to-achieve-code-execution" },
    ],
  },
];

export const PROCESS_INJECTION_LIBRARY: LibraryDef = {
  key: "process-injection",
  moduleId: "detectops.process-injection-sim",
  name: "Process Injection",
  shortName: "Process Injection",
  category: "privilege-escalation",
  icon: "Syringe",
  description: "Process Injection techniques (T1055) across Windows, Linux, and macOS — DLL Injection, Process Hollowing, APC Injection, Ptrace, DYLD preload, and more. Each technique maps to Atomic Red Team tests, Sysmon/ETW telemetry, and detection queries (SPL + Sigma).",
  techniques,
};
