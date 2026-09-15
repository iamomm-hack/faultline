param(
  [ValidateSet('v2', 'v3')]
  [string]$Scenario = 'v2',
  [switch]$AllowVulnerableV2
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Scenario -eq 'v2' -and -not $AllowVulnerableV2) {
  throw 'Refusing to deploy intentionally vulnerable v2 without -AllowVulnerableV2. Root npm demo:exploit-v2 passes this flag for localnet only.'
}

if ($env:FAULTLINE_RPC_URL -and $env:FAULTLINE_RPC_URL -ne 'http://127.0.0.1:8899') {
  throw "Milestone 2 demos are localnet-only. Refusing RPC URL $env:FAULTLINE_RPC_URL"
}

& npm.cmd run build:programs
if ($LASTEXITCODE -ne 0) { throw 'Program build failed' }

$ledger = [IO.Path]::GetFullPath((Join-Path $root ".localnet\ledger-$Scenario"))
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $root '.localnet'))
if (-not $ledger.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to reset ledger outside $allowedRoot"
}
if (Test-Path -LiteralPath $ledger) { Remove-Item -LiteralPath $ledger -Recurse -Force }

$validatorLog = Join-Path $root ".localnet\validator-$Scenario.log"
$validatorErr = Join-Path $root ".localnet\validator-$Scenario.err.log"
$localIds = Get-Content -Raw .localnet\ids.json | ConvertFrom-Json
if (Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Refusing to attach to an existing validator on port 8899. Stop the owning process and rerun; this demo requires a fresh ledger.'
}
$validator = Start-Process -FilePath 'solana-test-validator.exe' -ArgumentList @('--reset', '--ledger', $ledger, '--rpc-port', '8899', '--faucet-port', '9900', '--mint', $localIds.payer, '--log') -RedirectStandardOutput $validatorLog -RedirectStandardError $validatorErr -WindowStyle Hidden -PassThru

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & cmd.exe /c "solana cluster-version -u http://127.0.0.1:8899 >nul 2>nul"
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "Local validator did not become ready. See $validatorErr" }

  & solana balance .localnet\payer.json -u http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Genesis payer funding check failed' }

  Write-Output 'Deploying real loader-v3 programs for Milestone 2...'
  & solana program deploy artifacts\gate\faultline_gate.so --program-id .localnet\faultline-gate-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Gate deployment failed' }
  & solana program set-upgrade-authority $localIds.'faultline-gate-program' --final --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Finalizing gate program failed' }
  & solana program deploy artifacts\treasury\v1\faultline_treasury.so --program-id .localnet\faultline-treasury-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --max-len 500000 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Treasury v1 deployment failed' }

  $bufferName = if ($Scenario -eq 'v2') { 'candidate-v2' } else { 'candidate-v3' }
  & solana program write-buffer "artifacts\treasury\$Scenario\faultline_treasury.so" --buffer ".localnet\$bufferName.json" --buffer-authority .localnet\proposer.json --fee-payer .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw "Writing $Scenario buffer failed" }

  & npx.cmd tsx tests\treasury-versions.spec.ts "--scenario=$Scenario"
  if ($LASTEXITCODE -ne 0) { throw "Treasury $Scenario scenario failed" }
} finally {
  if ($validator) {
    $validator.Refresh()
  }
  if ($validator -and -not $validator.HasExited) {
    Stop-Process -Id $validator.Id -Force
    $validator.WaitForExit()
  }
}
