[CmdletBinding()]
param(
  [string]$AnchorExecutable = $env:FAULTLINE_ANCHOR_CLI,
  [string]$RustToolchain = '1.89.0',
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$cargoLock = Join-Path $repoRoot 'Cargo.lock'
$cargoLockBytes = [IO.File]::ReadAllBytes($cargoLock)
if ([string]::IsNullOrWhiteSpace($AnchorExecutable)) {
  $AnchorExecutable = (Get-Command anchor -ErrorAction Stop).Source
}
$version = (& $AnchorExecutable --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne 'anchor-cli 0.30.1') {
  throw "Anchor CLI 0.30.1 is required; observed '$version'."
}
$rustVersion = (& rustc "+$RustToolchain" --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $rustVersion.StartsWith("rustc $RustToolchain ")) {
  throw "Rust $RustToolchain is required; observed '$rustVersion'."
}

$ownedDirectory = Join-Path $repoRoot ("tmp\m8-idl-generation-{0}" -f $PID)
New-Item -ItemType Directory -Path $ownedDirectory -ErrorAction Stop | Out-Null
$previousRustToolchain = $env:RUSTUP_TOOLCHAIN
$previousRegistryProtocol = $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL
$previousPath = $env:PATH
$previousRealCargo = $env:FAULTLINE_REAL_CARGO
$env:RUSTUP_TOOLCHAIN = $RustToolchain
$env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'sparse'
try {
  $cargoExecutable = (Get-Command cargo -ErrorAction Stop).Source
  $cargoDirectory = Split-Path -Parent $cargoExecutable
  $cargoWrapperSource = Join-Path $ownedDirectory 'cargo-wrapper.rs'
  $cargoWrapper = Join-Path $ownedDirectory 'cargo.exe'
  $wrapperText = @'
use std::{env, process::{exit, Command}};
fn main() {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--faultline-wrapper-probe" { exit(0); }
    let real = env::var_os("FAULTLINE_REAL_CARGO").expect("FAULTLINE_REAL_CARGO");
    let status = Command::new(real).args(args)
        .env_remove("RUSTFLAGS").env_remove("CARGO_ENCODED_RUSTFLAGS")
        .status().expect("launch real cargo");
    exit(status.code().unwrap_or(1));
}
'@
  [IO.File]::WriteAllText($cargoWrapperSource, $wrapperText, [Text.UTF8Encoding]::new($false))
  & rustc "+$RustToolchain" $cargoWrapperSource -o $cargoWrapper
  if ($LASTEXITCODE -ne 0) { throw 'Cargo compatibility wrapper compilation failed.' }
  $env:FAULTLINE_REAL_CARGO = $cargoExecutable
  $filteredPath = @($previousPath.Split(';') | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and
    -not [IO.Path]::GetFullPath($_).TrimEnd('\').Equals([IO.Path]::GetFullPath($cargoDirectory).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
  }) -join ';'
  $env:PATH = "$ownedDirectory;$filteredPath"
  & cargo --faultline-wrapper-probe
  if ($LASTEXITCODE -ne 0) { throw 'Cargo compatibility wrapper was not selected.' }

  $gate = Join-Path $ownedDirectory 'faultline_gate.json'
  $treasury = Join-Path $ownedDirectory 'faultline_treasury.json'
  Push-Location $repoRoot
  try {
    & $AnchorExecutable idl build --program-name faultline_gate --out $gate --no-docs
    if ($LASTEXITCODE -ne 0) { throw 'Gate IDL generation failed.' }
    & $AnchorExecutable idl build --program-name faultline_treasury --out $treasury --no-docs
    if ($LASTEXITCODE -ne 0) { throw 'Treasury IDL generation failed.' }
  } finally {
    Pop-Location
  }
  $arguments = @(
    (Join-Path $PSScriptRoot 'normalize-milestone-8-idl.mjs'),
    '--gate', $gate,
    '--treasury', $treasury,
    '--destination', (Join-Path $repoRoot 'packages\faultline-idl')
  )
  if ($Check) { $arguments += '--check' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'IDL normalization or parity check failed.' }
} finally {
  $env:RUSTUP_TOOLCHAIN = $previousRustToolchain
  $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = $previousRegistryProtocol
  $env:PATH = $previousPath
  $env:FAULTLINE_REAL_CARGO = $previousRealCargo
  [IO.File]::WriteAllBytes($cargoLock, $cargoLockBytes)
  if (Test-Path -LiteralPath $ownedDirectory) {
    Remove-Item -LiteralPath $ownedDirectory -Recurse -Force
  }
}
