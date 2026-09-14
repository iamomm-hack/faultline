$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'sparse'
$env:CARGO_NET_OFFLINE = 'true'

& npm.cmd run bootstrap:ids
if ($LASTEXITCODE -ne 0) { throw 'Program ID bootstrap failed' }

& cargo build-sbf --manifest-path programs\faultline_gate\Cargo.toml --sbf-out-dir artifacts\gate
if ($LASTEXITCODE -ne 0) { throw 'faultline_gate SBF build failed' }

& cargo build-sbf --manifest-path programs\faultline_treasury\Cargo.toml --sbf-out-dir artifacts\treasury-v1
if ($LASTEXITCODE -ne 0) { throw 'faultline_treasury v1 SBF build failed' }

& cargo build-sbf --manifest-path programs\faultline_treasury\Cargo.toml --features v2 --sbf-out-dir artifacts\treasury-v2
if ($LASTEXITCODE -ne 0) { throw 'faultline_treasury v2 SBF build failed' }

$v1 = (Get-FileHash artifacts\treasury-v1\faultline_treasury.so -Algorithm SHA256).Hash.ToLowerInvariant()
$v2 = (Get-FileHash artifacts\treasury-v2\faultline_treasury.so -Algorithm SHA256).Hash.ToLowerInvariant()
if ($v1 -eq $v2) { throw 'Treasury v1 and v2 binaries are identical; refusing ambiguous demo artifacts' }

$manifest = [ordered]@{
  schema = 'faultline.milestone1.artifacts.v1'
  gate_sha256 = (Get-FileHash artifacts\gate\faultline_gate.so -Algorithm SHA256).Hash.ToLowerInvariant()
  treasury_v1_sha256 = $v1
  treasury_v2_sha256 = $v2
}
$manifest | ConvertTo-Json | Set-Content -Encoding utf8 artifacts\manifest.json
Write-Output "Treasury v1 SHA256: $v1"
Write-Output "Treasury v2 SHA256: $v2"
