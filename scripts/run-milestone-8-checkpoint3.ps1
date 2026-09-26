[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$freeGiB = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB
if ($freeGiB -lt 5) { throw 'Checkpoint 3 requires at least 5 GiB available memory' }
if (Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8899 is occupied' }
$env:CARGO_BUILD_JOBS = '1'
& cargo build --manifest-path crates\faultline-replay\Cargo.toml --locked --bin faultline --bin faultline-replay-worker
if ($LASTEXITCODE -ne 0) { throw 'Checkpoint 3 operator build failed' }
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-economic-settlement-tests.ps1 -Shard direct-attestation
if ($LASTEXITCODE -ne 0) { throw 'Checkpoint 3 fresh-ledger shard failed' }
