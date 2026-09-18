$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$localRoot = [IO.Path]::GetFullPath((Join-Path $root '.localnet'))
$ledger = [IO.Path]::GetFullPath((Join-Path $localRoot 'challenge-commit-reveal'))
$evidence = Join-Path $localRoot 'challenge-commit-reveal-evidence.log'
$ids = Get-Content -Raw (Join-Path $localRoot 'ids.json') | ConvertFrom-Json
$validatorExe = (Get-Command solana-test-validator.exe -ErrorAction Stop).Source
$validator = $null

if ([IO.Path]::GetDirectoryName($ledger) -ne $localRoot) {
  throw 'Unsafe challenge-suite ledger path'
}
if (Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 8899 is LISTENING. Refusing to connect to or stop an unowned validator.'
}
if (Test-Path -LiteralPath $ledger) {
  if ((Get-Item -LiteralPath $ledger).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Refusing to remove a linked challenge-suite ledger'
  }
  Remove-Item -LiteralPath $ledger -Recurse -Force
}
New-Item -ItemType Directory -Path $ledger | Out-Null
Set-Content -LiteralPath $evidence -Value 'Milestone 4 commit-reveal localnet evidence'
$stdoutLog = Join-Path $localRoot 'challenge-commit-reveal.stdout.log'
$stderrLog = Join-Path $localRoot 'challenge-commit-reveal.stderr.log'

try {
  Write-Output 'Validator flags: --reset --rpc-port 8899 --faucet-port 9900 --ticks-per-slot 1024 --log'
  $validator = Start-Process -FilePath $validatorExe -ArgumentList @(
    '--reset', '--ledger', $ledger, '--rpc-port', '8899', '--faucet-port', '9900',
    '--mint', $ids.payer, '--ticks-per-slot', '1024', '--log'
  ) -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $localRoot 'challenge-commit-reveal.pid') -Value $validator.Id
  $deadline = [DateTime]::UtcNow.AddSeconds(45)
  $ready = $false
  do {
    $validator.Refresh()
    if ($validator.HasExited) {
      throw "Validator $($validator.Id) exited. See $stderrLog"
    }
    try {
      $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -TimeoutSec 2
      $ready = $reply.result -eq 'ok'
    } catch {
      $ready = $false
    }
    if (-not $ready) { Start-Sleep -Milliseconds 100 }
  } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
  if (-not $ready) { throw "RPC health timeout. See $stderrLog" }

  $slotReply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' -TimeoutSec 2
  Write-Output "Validator slot after RPC readiness: $($slotReply.result)"

  & solana program deploy artifacts\gate\faultline_gate.so --program-id .localnet\faultline-gate-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Gate loader-v3 deployment failed' }
  & solana program set-upgrade-authority $ids.'faultline-gate-program' --final --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Gate finalization failed' }
  & solana program deploy artifacts\treasury\v1\faultline_treasury.so --program-id .localnet\faultline-treasury-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --max-len 500000 --output json
  if ($LASTEXITCODE -ne 0) { throw 'Treasury loader-v3 deployment failed' }

  $genesis = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' -TimeoutSec 2
  $env:FAULTLINE_CHALLENGE_GENESIS = $genesis.result
  Add-Content -LiteralPath $evidence -Value "START PID=$($validator.Id) genesis=$($genesis.result) ledger=$ledger"
  $slotReply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' -TimeoutSec 2
  Write-Output "Validator slot before assertions: $($slotReply.result)"

  & node.exe node_modules/tsx/dist/cli.mjs tests/challenge-commit-reveal.spec.ts
  if ($LASTEXITCODE -ne 0) {
    throw "Milestone 4 commit-reveal suite failed (exit $LASTEXITCODE). See $evidence"
  }

  $slotReply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' -TimeoutSec 2
  Write-Output "Validator slot after assertions: $($slotReply.result)"
  Write-Output 'MILESTONE-4 COMMIT-REVEAL ASSERTIONS 1-36 PASSED'
} finally {
  Remove-Item Env:FAULTLINE_CHALLENGE_GENESIS -ErrorAction SilentlyContinue
  if ($validator) {
    $validator.Refresh()
    if (-not $validator.HasExited) {
      Stop-Process -Id $validator.Id -Force
      $validator.WaitForExit()
    }
    Add-Content -LiteralPath $evidence -Value "STOP ownedPID=$($validator.Id)"
    $validator.Dispose()
  }
}
