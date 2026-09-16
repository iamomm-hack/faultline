$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$localRoot = [IO.Path]::GetFullPath((Join-Path $root '.localnet'))
$evidence = Join-Path $localRoot 'proposal-state-machine-evidence.log'
$ids = Get-Content -Raw (Join-Path $localRoot 'ids.json') | ConvertFrom-Json
$validatorExe = (Get-Command solana-test-validator.exe -ErrorAction Stop).Source
if (Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 8899 is LISTENING. Refusing to connect to or stop an unowned validator.'
}
Set-Content -LiteralPath $evidence -Value 'Proposal state machine: three fresh localnet shards'
foreach ($shard in @('policy', 'terminal', 'authority')) {
  $validator = $null
  $ledger = [IO.Path]::GetFullPath((Join-Path $localRoot "proposal-$shard"))
  if ([IO.Path]::GetDirectoryName($ledger) -ne $localRoot) { throw 'Unsafe suite ledger path' }
  if (Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8899 is LISTENING before $shard. Refusing an existing ledger."
  }
  if (Test-Path -LiteralPath $ledger) {
    if ((Get-Item -LiteralPath $ledger).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a linked ledger' }
    Remove-Item -LiteralPath $ledger -Recurse -Force
  }
  New-Item -ItemType Directory -Path $ledger | Out-Null
  $outLog = Join-Path $localRoot "proposal-$shard.stdout.log"
  $errLog = Join-Path $localRoot "proposal-$shard.stderr.log"
  try {
    $validator = Start-Process -FilePath $validatorExe -ArgumentList @(
      '--reset', '--ledger', $ledger, '--rpc-port', '8899', '--faucet-port', '9900',
      '--mint', $ids.payer, '--log'
    ) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $localRoot "proposal-$shard.pid") -Value $validator.Id
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    $ready = $false
    do {
      $validator.Refresh()
      if ($validator.HasExited) { throw "Validator $($validator.Id) exited. See $errLog" }
      try {
        $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -TimeoutSec 2
        $ready = $reply.result -eq 'ok'
      } catch { $ready = $false }
      if (-not $ready) { Start-Sleep -Milliseconds 100 }
    } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
    if (-not $ready) { throw "RPC health timeout for $shard. See $errLog" }
    # Match the already-proven demo flow. Genesis-preloaded executable accounts cannot
    # be mutated by loader SetAuthority on this validator build; post-genesis deploys
    # create the genuine mutable loader-v3 ProgramData state required by the Guard.
    & solana program deploy artifacts\gate\faultline_gate.so --program-id .localnet\faultline-gate-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
    if ($LASTEXITCODE -ne 0) { throw "Gate loader-v3 deployment failed for $shard" }
    & solana program set-upgrade-authority $ids.'faultline-gate-program' --final --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --output json
    if ($LASTEXITCODE -ne 0) { throw "Gate finalization failed for $shard" }
    & solana program deploy artifacts\treasury\v1\faultline_treasury.so --program-id .localnet\faultline-treasury-program.json --upgrade-authority .localnet\payer.json --keypair .localnet\payer.json --url http://127.0.0.1:8899 --max-len 500000 --output json
    if ($LASTEXITCODE -ne 0) { throw "Treasury loader-v3 deployment failed for $shard" }
    $genesis = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' -TimeoutSec 2
    $env:FAULTLINE_PROPOSAL_GENESIS = $genesis.result
    $env:FAULTLINE_PROPOSAL_SHARD = $shard
    Add-Content -LiteralPath $evidence -Value "START shard=$shard PID=$($validator.Id) genesis=$($genesis.result) ledger=$ledger"
    & node.exe node_modules/tsx/dist/cli.mjs tests/proposal-state-machine.spec.ts --shard $shard
    if ($LASTEXITCODE -ne 0) { throw "Proposal $shard shard failed (exit $LASTEXITCODE). See $evidence" }
  } finally {
    Remove-Item Env:FAULTLINE_PROPOSAL_GENESIS -ErrorAction SilentlyContinue
    Remove-Item Env:FAULTLINE_PROPOSAL_SHARD -ErrorAction SilentlyContinue
    if ($validator) {
      $validator.Refresh()
      if (-not $validator.HasExited) {
        # This process object is exclusively the child created above, never a port/name lookup.
        Stop-Process -Id $validator.Id -Force
        $validator.WaitForExit()
      }
      Add-Content -LiteralPath $evidence -Value "STOP shard=$shard ownedPID=$($validator.Id)"
      $validator.Dispose()
    }
  }
}
Write-Output 'All three proposal-state-machine shards passed.'
