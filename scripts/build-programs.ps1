$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'sparse'
$env:CARGO_NET_OFFLINE = 'true'

& npm.cmd run bootstrap:ids
if ($LASTEXITCODE -ne 0) { throw 'Program ID bootstrap failed' }

if (-not (Test-Path -LiteralPath 'artifacts')) {
  New-Item -ItemType Directory -Path 'artifacts' | Out-Null
}

& cargo build-sbf --manifest-path programs\faultline_gate\Cargo.toml --sbf-out-dir artifacts\gate
if ($LASTEXITCODE -ne 0) { throw 'faultline_gate SBF build failed' }

$treasuryVersions = @('v1', 'v2', 'v3')
$hashes = [ordered]@{}
foreach ($version in $treasuryVersions) {
  $outDir = "artifacts\treasury\$version"
  if (-not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  }
  & cargo build-sbf --manifest-path programs\faultline_treasury\Cargo.toml --no-default-features --features $version --sbf-out-dir $outDir
  if ($LASTEXITCODE -ne 0) { throw "faultline_treasury $version SBF build failed" }
  $soPath = Join-Path $outDir 'faultline_treasury.so'
  $hash = (Get-FileHash $soPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $hashes[$version] = $hash
  Set-Content -LiteralPath (Join-Path $outDir 'executable.sha256') -Value "$hash`n" -Encoding ascii
  $manifest = [ordered]@{
    schema = 'faultline.build.v1'
    milestone = 2
    program = 'faultline_treasury'
    program_id = (Get-Content -Raw .localnet\ids.json | ConvertFrom-Json).'faultline-treasury-program'
    build = $version
    cargo_features = @($version)
    sbf_out_dir = $outDir.Replace('\', '/')
    executable_sha256 = $hash
    toolchain = [ordered]@{
      solana = (& solana --version)
      cargo_build_sbf = (& cargo build-sbf --version)
      anchor_crates = '0.30.1'
    }
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outDir 'build-manifest.json') -Encoding utf8
  Write-Output "Treasury $version SHA256: $hash"
}

if ($hashes['v1'] -eq $hashes['v2']) { throw 'Treasury v1 and v2 binaries are identical; refusing ambiguous demo artifacts' }
if ($hashes['v1'] -eq $hashes['v3']) { throw 'Treasury v1 and v3 binaries are identical; refusing ambiguous demo artifacts' }
if ($hashes['v2'] -eq $hashes['v3']) { throw 'Treasury v2 and v3 binaries are identical; refusing ambiguous demo artifacts' }

$rootManifest = [ordered]@{
  schema = 'faultline.milestone2.artifacts.v1'
  gate_sha256 = (Get-FileHash artifacts\gate\faultline_gate.so -Algorithm SHA256).Hash.ToLowerInvariant()
  treasury = $hashes
}
$rootManifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 artifacts\manifest.json
