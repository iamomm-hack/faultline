$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

& npm.cmd run build:programs
if ($LASTEXITCODE -ne 0) { throw 'Program build failed' }

$ledger = [IO.Path]::GetFullPath((Join-Path $root '.localnet\ledger'))
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $root '.localnet'))
if (-not $ledger.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to reset ledger outside $allowedRoot"
}
if (Test-Path -LiteralPath $ledger) { Remove-Item -LiteralPath $ledger -Recurse -Force }

$validatorLog = Join-Path $root '.localnet\validator.log'
$validatorErr = Join-Path $root '.localnet\validator.err.log'
$localIds = Get-Content -Raw .localnet\ids.json | ConvertFrom-Json
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

  Write-Output 'Deploying real loader-v3 programs...'
  & solana program deploy artifacts\gate\faultline_gate.so --program-id .localnet\faultline-gate-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Gate deployment failed' }
  & solana program set-upgrade-authority $localIds.'faultline-gate-program' --final --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Finalizing gate program failed' }
  & solana program deploy artifacts\treasury-v1\faultline_treasury.so --program-id .localnet\faultline-treasury-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --max-len 400000 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Treasury v1 deployment failed' }

  foreach ($buffer in @('candidate-approved', 'candidate-rejected', 'candidate-spare')) {
    & solana program write-buffer artifacts\treasury-v2\faultline_treasury.so --buffer ".localnet\$buffer.json" --buffer-authority .localnet\proposer.json --fee-payer .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
    if ($LASTEXITCODE -ne 0) { throw "Writing $buffer failed" }
  }

  & npx.cmd tsx tests\guard-upgrade.spec.ts
  if ($LASTEXITCODE -ne 0) { throw 'Guard proof failed' }
} finally {
  if ($validator -and -not $validator.HasExited) {
    Stop-Process -Id $validator.Id -Force
    $validator.WaitForExit()
  }
}
