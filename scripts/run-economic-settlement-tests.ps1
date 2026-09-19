param(
  [ValidateSet('policy-funding', 'stakes-withdrawal')]
  [string]$Shard
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$localRoot = [IO.Path]::GetFullPath((Join-Path $root '.localnet'))
$ids = Get-Content -Raw (Join-Path $localRoot 'ids.json') | ConvertFrom-Json
$validatorExe = (Get-Command solana-test-validator.exe -ErrorAction Stop).Source
$solanaExe = (Get-Command solana.exe -ErrorAction Stop).Source
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
# Managed Windows hosts can inject both `Path` and `PATH`. Start-Process builds a
# case-insensitive environment dictionary and rejects that duplicate pair, so
# normalize only this runner process after resolving every executable above.
$processPathValue = [Environment]::GetEnvironmentVariable('Path', 'Process')
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPathValue, 'Process')
$shards = if ($Shard) { @($Shard) } else { @('policy-funding', 'stakes-withdrawal') }

function Test-TcpPortListening([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $connect.Wait(500)) { return $false }
    return $client.Connected
  } catch { return $false } finally { $client.Dispose() }
}

function Get-ValidatorSlot {
  try {
    $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' -TimeoutSec 2
    return [string]$reply.result
  } catch { return "unavailable: $($_.Exception.Message)" }
}

function Get-LogTail([string]$Path, [int]$Count = 50) {
  if (-not (Test-Path -LiteralPath $Path)) { return '<missing>' }
  $lines = @(Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue)
  if ($lines.Count -eq 0) { return '<empty>' }
  return ($lines -join [Environment]::NewLine)
}

function Write-Stage([string]$Evidence, [string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Write-Output $line
  Add-Content -LiteralPath $Evidence -Value $line
}

function Invoke-OwnedProcess {
  param(
    [Parameter(Mandatory)][string]$Evidence,
    [Parameter(Mandatory)][string]$Stage,
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][int]$TimeoutSeconds,
    [Parameter(Mandatory)][string]$ProcessStdout,
    [Parameter(Mandatory)][string]$ProcessStderr,
    [Parameter(Mandatory)][string]$ValidatorStdout,
    [Parameter(Mandatory)][string]$ValidatorStderr,
    [Parameter(Mandatory)][Diagnostics.Process]$ValidatorProcess
  )
  $quoted = $Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
  $command = "$FilePath $($quoted -join ' ')"
  Write-Stage $Evidence "STAGE START name=$Stage timeout_seconds=$TimeoutSeconds command=$command validator_slot=$(Get-ValidatorSlot)"
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $quoted -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Failed to start owned process for $Stage" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  Write-Stage $Evidence "STAGE PROCESS name=$Stage owned_pid=$($process.Id)"
  $nextHeartbeat = 30
  try {
    while ($true) {
      $process.Refresh()
      if ($process.HasExited) { break }
      $ValidatorProcess.Refresh()
      if ($ValidatorProcess.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
        throw "$Stage lost owned validator PID $($ValidatorProcess.Id); terminated owned PID $($process.Id)"
      }
      if ($watch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
        throw "$Stage exceeded its $TimeoutSeconds second deadline; terminated owned PID $($process.Id)"
      }
      if ($watch.Elapsed.TotalSeconds -ge $nextHeartbeat) {
        Write-Stage $Evidence "STAGE HEARTBEAT name=$Stage elapsed_seconds=$([math]::Floor($watch.Elapsed.TotalSeconds)) owned_pid=$($process.Id) validator_slot=$(Get-ValidatorSlot)"
        $nextHeartbeat += 30
      }
      [void]$process.WaitForExit(250)
    }
    $process.WaitForExit()
    Set-Content -LiteralPath $ProcessStdout -Value $stdoutTask.Result
    Set-Content -LiteralPath $ProcessStderr -Value $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      $diagnostic = @(
        "DIAGNOSTIC stage=$Stage command=$command elapsed_ms=$($watch.ElapsedMilliseconds) owned_pid=$($process.Id) exit_code=$($process.ExitCode) validator_slot=$(Get-ValidatorSlot)",
        '--- process stdout tail ---', (Get-LogTail $ProcessStdout),
        '--- process stderr tail ---', (Get-LogTail $ProcessStderr),
        '--- validator stdout tail ---', (Get-LogTail $ValidatorStdout),
        '--- validator stderr tail ---', (Get-LogTail $ValidatorStderr),
        '--- end diagnostic ---'
      ) -join [Environment]::NewLine
      Write-Output $diagnostic
      Add-Content -LiteralPath $Evidence -Value $diagnostic
      throw "$Stage failed with exit code $($process.ExitCode)"
    }
    Write-Stage $Evidence "STAGE COMPLETE name=$Stage elapsed_ms=$($watch.ElapsedMilliseconds) exit_code=0 validator_slot=$(Get-ValidatorSlot)"
    $stdout = Get-Content -LiteralPath $ProcessStdout -Raw -ErrorAction SilentlyContinue
    if ($stdout) { Write-Output $stdout.TrimEnd() }
    $stderr = Get-Content -LiteralPath $ProcessStderr -Raw -ErrorAction SilentlyContinue
    if ($stderr) { Write-Output $stderr.TrimEnd() }
  } finally {
    $process.Refresh()
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force; $process.WaitForExit() }
    $process.Dispose()
  }
}

if (Test-TcpPortListening 8899) {
  throw 'Port 8899 is LISTENING. Refusing to connect to or stop an unowned validator.'
}

foreach ($currentShard in $shards) {
  $validator = $null
  $ledger = [IO.Path]::GetFullPath((Join-Path $localRoot "economic-settlement-$currentShard"))
  $evidence = Join-Path $localRoot "economic-settlement-$currentShard-evidence.log"
  $validatorStdout = Join-Path $localRoot "economic-settlement-$currentShard.validator.stdout.log"
  $validatorStderr = Join-Path $localRoot "economic-settlement-$currentShard.validator.stderr.log"
  if ([IO.Path]::GetDirectoryName($ledger) -ne $localRoot) { throw "Unsafe ledger path for $currentShard" }
  if (Test-TcpPortListening 8899) { throw "Port 8899 is LISTENING before $currentShard" }
  if (Test-Path -LiteralPath $ledger) {
    if ((Get-Item -LiteralPath $ledger).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw "Refusing to remove reparse-point ledger for $currentShard"
    }
    Remove-Item -LiteralPath $ledger -Recurse -Force
  }
  New-Item -ItemType Directory -Path $ledger | Out-Null
  Set-Content -LiteralPath $evidence -Value "Milestone 6 Phase A shard=$currentShard"
  try {
    $flags = '--reset --rpc-port 8899 --faucet-port 9900 --ticks-per-slot 1024 --log'
    Write-Stage $evidence "STAGE START name=validator-readiness timeout_seconds=45 flags=$flags"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $validator = Start-Process -FilePath $validatorExe -ArgumentList @(
      '--reset', '--ledger', $ledger, '--rpc-port', '8899', '--faucet-port', '9900',
      '--mint', $ids.payer, '--ticks-per-slot', '1024', '--log'
    ) -RedirectStandardOutput $validatorStdout -RedirectStandardError $validatorStderr -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $localRoot "economic-settlement-$currentShard.pid") -Value $validator.Id
    Write-Stage $evidence "STAGE PROCESS name=validator-readiness owned_pid=$($validator.Id)"
    $ready = $false
    do {
      $validator.Refresh()
      if ($validator.HasExited) { throw "Validator $($validator.Id) exited. See $validatorStderr" }
      try {
        $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -TimeoutSec 2
        $ready = $reply.result -eq 'ok'
      } catch { $ready = $false }
      if (-not $ready) { [void]$validator.WaitForExit(100) }
    } while (-not $ready -and $watch.Elapsed.TotalSeconds -lt 45)
    if (-not $ready) { throw "RPC health timeout for $currentShard. stderr=$(Get-LogTail $validatorStderr)" }
    $initialSlot = Get-ValidatorSlot
    Write-Stage $evidence "STAGE COMPLETE name=validator-readiness elapsed_ms=$($watch.ElapsedMilliseconds) owned_pid=$($validator.Id) initial_slot=$initialSlot"

    Invoke-OwnedProcess -Evidence $evidence -Stage 'gate-deployment' -FilePath $solanaExe -Arguments @(
      'program', 'deploy', 'artifacts\gate\faultline_gate.so', '--program-id', '.localnet\faultline-gate-program.json',
      '--upgrade-authority', '.localnet\payer.json', '--keypair', '.localnet\payer.json', '--url', 'http://127.0.0.1:8899', '--commitment', 'confirmed', '--output', 'json'
    ) -TimeoutSeconds 600 -ProcessStdout (Join-Path $localRoot "economic-settlement-$currentShard.gate-deploy.stdout.log") -ProcessStderr (Join-Path $localRoot "economic-settlement-$currentShard.gate-deploy.stderr.log") -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr -ValidatorProcess $validator
    Invoke-OwnedProcess -Evidence $evidence -Stage 'gate-finalization' -FilePath $solanaExe -Arguments @(
      'program', 'set-upgrade-authority', $ids.'faultline-gate-program', '--final', '--upgrade-authority', '.localnet\payer.json',
      '--keypair', '.localnet\payer.json', '--url', 'http://127.0.0.1:8899', '--commitment', 'confirmed', '--output', 'json'
    ) -TimeoutSeconds 180 -ProcessStdout (Join-Path $localRoot "economic-settlement-$currentShard.gate-finalize.stdout.log") -ProcessStderr (Join-Path $localRoot "economic-settlement-$currentShard.gate-finalize.stderr.log") -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr -ValidatorProcess $validator
    Invoke-OwnedProcess -Evidence $evidence -Stage 'treasury-deployment' -FilePath $solanaExe -Arguments @(
      'program', 'deploy', 'artifacts\treasury\v1\faultline_treasury.so', '--program-id', '.localnet\faultline-treasury-program.json',
      '--upgrade-authority', '.localnet\payer.json', '--keypair', '.localnet\payer.json', '--url', 'http://127.0.0.1:8899', '--commitment', 'confirmed', '--max-len', '500000', '--output', 'json'
    ) -TimeoutSeconds 600 -ProcessStdout (Join-Path $localRoot "economic-settlement-$currentShard.treasury-deploy.stdout.log") -ProcessStderr (Join-Path $localRoot "economic-settlement-$currentShard.treasury-deploy.stderr.log") -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr -ValidatorProcess $validator

    $genesis = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' -TimeoutSec 2
    $env:FAULTLINE_ECONOMIC_GENESIS = $genesis.result
    $env:FAULTLINE_ECONOMIC_SHARD = $currentShard
    Write-Stage $evidence "START shard=$currentShard PID=$($validator.Id) genesis=$($genesis.result) ledger=$ledger flags=$flags initial_slot=$initialSlot"
    Write-Stage $evidence "STAGE START name=test-start timeout_seconds=15 validator_slot=$(Get-ValidatorSlot)"
    if (-not (Test-TcpPortListening 8899)) { throw "Validator stopped listening before test start for $currentShard" }
    Write-Stage $evidence "STAGE COMPLETE name=test-start elapsed_ms=0 validator_slot=$(Get-ValidatorSlot)"
    Invoke-OwnedProcess -Evidence $evidence -Stage "typescript-$currentShard" -FilePath $nodeExe -Arguments @(
      'node_modules/tsx/dist/cli.mjs', 'tests/economic-settlement.spec.ts', '--shard', $currentShard
    ) -TimeoutSeconds 2400 -ProcessStdout (Join-Path $localRoot "economic-settlement-$currentShard.test.stdout.log") -ProcessStderr (Join-Path $localRoot "economic-settlement-$currentShard.test.stderr.log") -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr -ValidatorProcess $validator
    Write-Stage $evidence "SHARD COMPLETE name=$currentShard final_slot=$(Get-ValidatorSlot)"
  } finally {
    Remove-Item Env:FAULTLINE_ECONOMIC_GENESIS -ErrorAction SilentlyContinue
    Remove-Item Env:FAULTLINE_ECONOMIC_SHARD -ErrorAction SilentlyContinue
    if ($validator) {
      $validator.Refresh()
      if (-not $validator.HasExited) {
        Write-Stage $evidence "STAGE CLEANUP terminating_owned_validator_pid=$($validator.Id)"
        Stop-Process -Id $validator.Id -Force
        $validator.WaitForExit()
      }
      Write-Stage $evidence "STOP ownedPID=$($validator.Id)"
      $validator.Dispose()
    }
    $cleanupWatch = [Diagnostics.Stopwatch]::StartNew()
    while ((Test-TcpPortListening 8899) -and $cleanupWatch.Elapsed.TotalSeconds -lt 15) {
      Start-Sleep -Milliseconds 100
    }
    if (Test-TcpPortListening 8899) { throw "Port 8899 remained occupied after owned cleanup for $currentShard" }
    Write-Stage $evidence "CLEANUP COMPLETE shard=$currentShard port_8899_free=true elapsed_ms=$($cleanupWatch.ElapsedMilliseconds)"
  }
}

if ($Shard) {
  Write-Output "MILESTONE-6 PHASE-A SHARD PASSED: $Shard"
} else {
  Write-Output 'MILESTONE-6 PHASE-A ASSERTIONS 1-60 PASSED'
}
