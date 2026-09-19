/**
 * GET /api/v1/agent/prepare?os=windows   (AGENT-FACING — one-time host prep)
 *
 * Returns a script that installs the simulation tooling a fleet endpoint needs
 * (Atomic Red Team module + atomics, PurpleSharp) into a stable local path, so
 * simulations run fast without downloading anything at run time. Run once per
 * endpoint, elevated. Public like any installer — it only fetches standard,
 * open-source red-team tooling from their official repos.
 */

import { NextRequest, NextResponse } from "next/server";

const WIN_BASE = "C:\\ProgramData\\AtomicRedTeam";

function windowsScript(): string {
  return `# DetectOps fleet host preparation — run ONCE in an elevated PowerShell.
# Installs Atomic Red Team (Invoke-AtomicRedTeam module + atomics) and PurpleSharp
# to ${WIN_BASE} so fleet simulations run locally with no per-run download.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = '${WIN_BASE}'
$psd1 = Join-Path $base 'invoke-atomicredteam\\Invoke-AtomicRedTeam.psd1'

Write-Host '==> Installing Atomic Red Team (module + atomics)…'
if (-not (Test-Path $psd1)) {
  IEX (New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/redcanaryco/invoke-atomicredteam/master/install-atomicredteam.ps1')
  Install-AtomicRedTeam -InstallPath $base -getAtomics -Force
} else {
  Write-Host '    already present — skipping.'
}
Import-Module $psd1 -Force
Write-Host '==> Atomic Red Team ready.'

# PurpleSharp (optional Windows AD adversary-simulation binary)
$psDir = Join-Path $base 'PurpleSharp'
$psExe = Join-Path $psDir 'PurpleSharp.exe'
if (-not (Test-Path $psExe)) {
  try {
    New-Item -ItemType Directory -Force -Path $psDir | Out-Null
    $rel = (Invoke-WebRequest 'https://api.github.com/repos/mvelazc0/PurpleSharp/releases/latest' -UseBasicParsing -Headers @{ 'User-Agent' = 'detectops' } | ConvertFrom-Json)
    $asset = $rel.assets | Where-Object { $_.name -like '*x64*.exe' -or $_.name -like 'PurpleSharp*.exe' } | Select-Object -First 1
    if ($asset) {
      Invoke-WebRequest $asset.browser_download_url -OutFile $psExe -UseBasicParsing -Headers @{ 'User-Agent' = 'detectops' }
      Write-Host '==> PurpleSharp installed.'
    } else { Write-Host '==> PurpleSharp release asset not found — skipped.' }
  } catch { Write-Host "==> PurpleSharp download skipped: $_" }
}

Write-Host ''
Write-Host 'Fleet host prep complete. You can now run fleet simulations from the Campaign Designer.'
`;
}

function unixNote(os: string): string {
  return `# Fleet host prep for ${os}: install PowerShell (pwsh) + Atomic Red Team, e.g.:
#   pwsh -c "IEX (New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/redcanaryco/invoke-atomicredteam/master/install-atomicredteam.ps1'); Install-AtomicRedTeam -InstallPath /opt/AtomicRedTeam -getAtomics -Force"
# (Windows is the primary fleet target; adjust paths for your distro.)
`;
}

export async function GET(req: NextRequest) {
  const os = (req.nextUrl.searchParams.get("os") || "windows").toLowerCase();
  const body = os === "windows" ? windowsScript() : unixNote(os);
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
