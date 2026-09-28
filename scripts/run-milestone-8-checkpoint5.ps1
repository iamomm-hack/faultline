[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8899 is occupied' }
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-economic-settlement-tests.ps1 -Shard v3-hold-upgrade
if ($LASTEXITCODE -ne 0) { throw 'Checkpoint 5 fresh-ledger shard failed' }
