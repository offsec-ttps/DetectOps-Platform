<#
.SYNOPSIS
  Install Microsoft Office (Word/Excel/PowerPoint/Outlook) on a lab endpoint via
  the official Office Deployment Tool (ODT), so the ~29 Office/VBA/COM atomics
  become testable. Downloads only from Microsoft's official CDN.

.NOTES
  CAVEATS — read before running on this lab:
    * The SAR endpoint is a DOMAIN CONTROLLER. Microsoft advises against running
      Office apps on a DC; do this only because it is a throwaway lab box.
    * Free disk was ~10.6 GB. A trimmed Current-channel install needs ~3-4 GB to
      download + unpack; monitor disk so the DC does not fill up (disk-full
      destabilises it). Consider expanding the VDI first.
    * This installs the RETAIL LTSC-2021 SKU and does NOT activate it (no product
      key, no sign-in): Office runs on its built-in trial/grace licence, which is
      what we want for testing. COM automation (Word.Application, Excel.Application,
      the Outlook object model, XLL/VBA) works on the trial, which is what the
      atomics need. Do not enter a key or sign in — leave it on the trial.
  Run elevated. Re-run is safe (ODT is idempotent).
#>
param(
  [string]$WorkDir = "C:\AtomicRedTeam\ExternalPayloads\ODT",
  [ValidateSet("64","32")] [string]$Bitness = "64"
)
$ErrorActionPreference = "Stop"
New-Item -Type Directory $WorkDir -Force -ErrorAction Ignore | Out-Null
try { Start-Transcript -Path (Join-Path $WorkDir "office_install.log") -Append | Out-Null } catch {}
# Server 2016 negotiates TLS 1.0 by default; download.microsoft.com requires 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 1. Fetch the Office Deployment Tool (official Microsoft Download Center).
#    This redirect URL always points at the current ODT self-extractor.
$odtExe = Join-Path $WorkDir "officedeploymenttool.exe"
if (-not (Test-Path $odtExe) -or (Get-Item $odtExe).Length -lt 1MB) {
  Write-Host "Downloading Office Deployment Tool..."
  Invoke-WebRequest "https://download.microsoft.com/download/6c1eeb25-cf8b-41d9-8d0d-cc1dbc032140/officedeploymenttool_20326-20112.exe" `
    -OutFile $odtExe -UseBasicParsing
}
Start-Process $odtExe -ArgumentList "/quiet","/extract:$WorkDir" -Wait

# 2. Trimmed configuration — core apps only, no Teams/OneDrive/Groove, to keep
#    the download small on a disk-constrained DC.
$cfg = Join-Path $WorkDir "config.xml"
@"
<Configuration>
  <Add OfficeClientEdition="$Bitness" Channel="PerpetualVL2021">
    <Product ID="ProPlus2021Retail">
      <Language ID="en-us" />
      <ExcludeApp ID="Teams" />
      <ExcludeApp ID="OneDrive" />
      <ExcludeApp ID="OneNote" />
      <ExcludeApp ID="Groove" />
      <ExcludeApp ID="Lync" />
      <ExcludeApp ID="Publisher" />
      <ExcludeApp ID="Access" />
    </Product>
  </Add>
  <Display Level="None" AcceptEULA="TRUE" />
  <Property Name="FORCEAPPSHUTDOWN" Value="TRUE" />
</Configuration>
"@ | Set-Content $cfg -Encoding ASCII

# 3. Download then install.
$setup = Join-Path $WorkDir "setup.exe"
Write-Host "Downloading Office payload (this is the multi-GB step)..."
Start-Process $setup -ArgumentList "/download","$cfg" -Wait
Write-Host "Installing Office..."
Start-Process $setup -ArgumentList "/configure","$cfg" -Wait

# 4. Verify COM registration.
$word = $null; try { $word = [Type]::GetTypeFromProgID("Word.Application") } catch {}
Write-Host ("Word.Application COM registered: {0}" -f ($null -ne $word))
Write-Host "Done. Re-run the platform GetPrereqs staging for the Office atomics."
