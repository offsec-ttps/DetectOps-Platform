<#
.SYNOPSIS
  Resolve the Atomic Red Team Windows prerequisites that `Invoke-AtomicTest
  -GetPrereqs` cannot satisfy on its own: Windows capabilities, PSGallery
  modules, a PATH-resolvable curl, Sysmon, and the interactive data-file
  prereqs (credential files, user lists). Run this ONCE on the lab endpoint;
  afterwards re-run the platform's GetPrereqs staging to pick up the rest.

  Idempotent and defensive — every step is wrapped so one failure never aborts
  the run. Intended for an isolated Atomic Red Team lab endpoint you own.

.PARAMETER CredPassword
  Password for the current user, used only to build the DPAPI-encrypted
  credential file the T1098 password-policy atomics expect. Passed at runtime
  (never stored in this script). If omitted, the T1098 cred-file step is skipped.

.PARAMETER AtomicsRoot
  Path to the installed atomics folder. Default C:\AtomicRedTeam\atomics.
#>
param(
  [string]$CredPassword = "",
  [string]$AtomicsRoot  = "C:\AtomicRedTeam\atomics"
)

$ErrorActionPreference = "Continue"
$ext = Join-Path (Split-Path $AtomicsRoot -Parent) "ExternalPayloads"
New-Item -Type Directory $ext -Force -ErrorAction Ignore | Out-Null
function Step($name, $block) {
  Write-Host "=== $name ==="
  try { & $block; Write-Host "   OK: $name" }
  catch { Write-Host "   FAIL: $name -> $($_.Exception.Message)" }
}

# --- A. Windows capability: OpenSSH client (scp/sftp) -> T1105 #34-#37 --------
Step "OpenSSH.Client capability" {
  $cap = Get-WindowsCapability -Online -Name "OpenSSH.Client*" -ErrorAction Stop |
         Select-Object -First 1
  if ($cap.State -ne "Installed") { Add-WindowsCapability -Online -Name $cap.Name -ErrorAction Stop | Out-Null }
  Write-Host "   scp: $((Get-Command scp.exe -ErrorAction SilentlyContinue).Source)"
}

# --- B. curl in PATH (System32) -> T1048.002#1 T1071.001#2 T1105#18/19 T1614#1 -
Step "curl.exe in System32" {
  if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    $zip = Join-Path $ext "curl-win64.zip"
    Invoke-WebRequest "https://curl.se/windows/dl-8.4.0_6/curl-8.4.0_6-win64-mingw.zip" -OutFile $zip -UseBasicParsing
    $dst = Join-Path $ext "curl-extract"
    Remove-Item $dst -Recurse -Force -ErrorAction Ignore
    Expand-Archive $zip -DestinationPath $dst -Force
    $exe = Get-ChildItem $dst -Recurse -Filter curl.exe | Select-Object -First 1
    Copy-Item $exe.FullName "C:\Windows\System32\curl.exe" -Force
  }
  Write-Host "   curl: $((Get-Command curl.exe).Source)"
}

# --- C. Sysmon (Sysinternals) -> T1685#14 -------------------------------------
Step "Sysmon install" {
  if (-not (Get-Command Sysmon.exe -ErrorAction SilentlyContinue) -and -not (Test-Path "C:\Windows\Sysmon.exe")) {
    $zip = Join-Path $ext "Sysmon.zip"
    Invoke-WebRequest "https://download.sysinternals.com/files/Sysmon.zip" -OutFile $zip -UseBasicParsing
    $dst = Join-Path $ext "Sysmon"
    Expand-Archive $zip -DestinationPath $dst -Force
    & (Join-Path $dst "Sysmon.exe") -accepteula -i | Out-Null
  }
  Write-Host "   sysmon present: $([bool](Get-Service Sysmon* -ErrorAction SilentlyContinue))"
}

# --- D. PSGallery modules -> T1123#1 T1552.004#9 T1021.004#1 -------------------
Step "PSGallery bootstrap" {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  if (-not (Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue)) {
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope AllUsers | Out-Null
  }
  Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
}
foreach ($m in @("AudioDeviceCmdlets","AADInternals","VMware.PowerCLI")) {
  Step "Install-Module $m" {
    if (-not (Get-Module -ListAvailable -Name $m)) {
      Install-Module -Name $m -Force -Scope AllUsers -AllowClobber -ErrorAction Stop
    }
  }
}

# --- E. Data-file prereqs -----------------------------------------------------
# T1098 #10-#16: DPAPI credential file for the current user (lab only)
Step "T1098 credential file" {
  if ([string]::IsNullOrEmpty($CredPassword)) { Write-Host "   (skipped: no -CredPassword)"; return }
  $cf = "$env:LOCALAPPDATA\AtomicRedTeam\$env:USERNAME.txt"
  New-Item -Type Directory (Split-Path $cf) -Force -ErrorAction Ignore | Out-Null
  $sec = ConvertTo-SecureString $CredPassword -AsPlainText -Force
  (New-Object System.Management.Automation.PSCredential($env:USERNAME,$sec)) | Export-CliXml $cf
  Write-Host "   wrote $cf"
}
# T1110.003 #1: list of domain users at %temp%\users.txt
Step "T1110.003 users.txt" {
  $f = Join-Path $env:TEMP "users.txt"
  try   { (Get-ADUser -Filter * -ErrorAction Stop).SamAccountName | Set-Content $f }
  catch { (net user) -join "`n" | Set-Content $f }
  Write-Host "   wrote $f ($((Get-Content $f | Measure-Object -Line).Lines) lines)"
}

Write-Host ""
Write-Host "################ MANUAL / COMMERCIAL (not auto-staged) ################"
@"
These prerequisites require licensed/commercial software, interactive install,
or components absent from Windows Server 2016 Core/DC. Provision by hand:
  T1072  #1  Radmin Viewer      -> https://www.radmin.com/  (commercial)
  T1072  #2  PDQ Deploy         -> https://www.pdq.com/     (commercial)
  T1219  #8  NetSupport Manager -> https://www.netsupportmanager.com/ (commercial)
  T1219  #11 MSP360 Connect     -> https://www.msp360.com/  (commercial)
  T1550.002 #2 CrackMapExec     -> build/install manually at expected path
  T1071  #1  Telnet C2 server   -> set up a C2 listener manually
  T1105  #38 OneDrive updater   -> install OneDrive
  T1018  #22 SoftPerfect Netscan-> https://www.softperfect.com/ (freeware, manual URL)
  T1547.015 #1 Windows Terminal -> not available on Server 2016
  T1518.001 #12 MpCmdRun.exe    -> Microsoft Defender not installed on this DC
  T1564.006 #1 Portable VirtualBox (old) -> stages via GetPrereqs; verify
  T1003.001 #11 LSASS dump (.NET5) -> EXCLUDED (credential-dump poisons WinRM)
  Microsoft Office atomics       -> handled by scripts/install_office_dc.ps1
"@ | Write-Host
Write-Host "Done. Now re-run platform GetPrereqs staging to pick up the rest."
