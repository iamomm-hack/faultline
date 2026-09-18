$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$localRoot = [IO.Path]::GetFullPath((Join-Path $root '.localnet'))
$ledger = [IO.Path]::GetFullPath((Join-Path $localRoot 'verifier-quorum'))
$evidence = Join-Path $localRoot 'verifier-quorum-evidence.log'
$ids = Get-Content -Raw (Join-Path $localRoot 'ids.json') | ConvertFrom-Json
$validatorExe = (Get-Command solana-test-validator.exe -ErrorAction Stop).Source
$solanaExe = (Get-Command solana.exe -ErrorAction Stop).Source
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$validator = $null

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

function Get-LogTail([string]$Path, [int]$Count = 40) {
  if (-not (Test-Path -LiteralPath $Path)) { return '<missing>' }
  $lines = @(Get-Content -LiteralPath $Path -Tail $Count -ErrorAction SilentlyContinue)
  if ($lines.Count -eq 0) { return '<empty>' }
  return ($lines -join [Environment]::NewLine)
}

function Write-Stage([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Write-Output $line
  Add-Content -LiteralPath $evidence -Value $line
}

function Write-ProcessDiagnostics(
  [string]$Stage, [string]$Command, [Diagnostics.Stopwatch]$Stopwatch,
  [Diagnostics.Process]$Process, [string]$ProcessStdout, [string]$ProcessStderr,
  [string]$ValidatorStdout, [string]$ValidatorStderr
) {
  $Process.Refresh()
  $exitState = if ($Process.HasExited) { "exited code=$($Process.ExitCode)" } else { 'still-running' }
  $diagnostic = @(
    "DIAGNOSTIC stage=$Stage", "command=$Command", "elapsed_ms=$($Stopwatch.ElapsedMilliseconds)",
    "owned_pid=$($Process.Id)", "exit_state=$exitState", "validator_slot=$(Get-ValidatorSlot)",
    '--- process stdout tail ---', (Get-LogTail $ProcessStdout),
    '--- process stderr tail ---', (Get-LogTail $ProcessStderr),
    '--- validator stdout tail ---', (Get-LogTail $ValidatorStdout),
    '--- validator stderr tail ---', (Get-LogTail $ValidatorStderr), '--- end diagnostic ---'
  ) -join [Environment]::NewLine
  Write-Output $diagnostic
  Add-Content -LiteralPath $evidence -Value $diagnostic
}

function Invoke-OwnedProcess {
  param(
    [Parameter(Mandatory)][string]$Stage,
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][int]$TimeoutSeconds,
    [Parameter(Mandatory)][string]$ProcessStdout,
    [Parameter(Mandatory)][string]$ProcessStderr,
    [Parameter(Mandatory)][string]$ValidatorStdout,
    [Parameter(Mandatory)][string]$ValidatorStderr
  )
  $quotedArguments = $Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
  $command = "$FilePath $($quotedArguments -join ' ')"
  Write-Stage "STAGE START name=$Stage timeout_seconds=$TimeoutSeconds command=$command validator_slot=$(Get-ValidatorSlot)"
  $stopwatch = [Diagnostics.Stopwatch]::StartNew()
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $quotedArguments -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "Failed to start owned process for $Stage" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  Write-Stage "STAGE PROCESS name=$Stage owned_pid=$($process.Id)"
  $nextHeartbeat = 30
  try {
    while ($true) {
      $process.Refresh()
      if ($process.HasExited) { break }
      if ($stopwatch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
        Set-Content -LiteralPath $ProcessStdout -Value $stdoutTask.Result
        Set-Content -LiteralPath $ProcessStderr -Value $stderrTask.Result
        Write-ProcessDiagnostics $Stage $command $stopwatch $process $ProcessStdout $ProcessStderr $ValidatorStdout $ValidatorStderr
        throw "$Stage exceeded its $TimeoutSeconds second deadline; terminated owned PID $($process.Id)"
      }
      if ($stopwatch.Elapsed.TotalSeconds -ge $nextHeartbeat) {
        Write-Stage "STAGE HEARTBEAT name=$Stage elapsed_seconds=$([math]::Floor($stopwatch.Elapsed.TotalSeconds)) owned_pid=$($process.Id) validator_slot=$(Get-ValidatorSlot)"
        $nextHeartbeat += 30
      }
      [void]$process.WaitForExit(250)
    }
    # With redirected streams on Windows, HasExited can become true before the
    # asynchronous stream readers and ExitCode property are finalized.
    $process.WaitForExit()
    Set-Content -LiteralPath $ProcessStdout -Value $stdoutTask.Result
    Set-Content -LiteralPath $ProcessStderr -Value $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      Write-ProcessDiagnostics $Stage $command $stopwatch $process $ProcessStdout $ProcessStderr $ValidatorStdout $ValidatorStderr
      throw "$Stage failed with exit code $($process.ExitCode)"
    }
    Write-Stage "STAGE COMPLETE name=$Stage elapsed_ms=$($stopwatch.ElapsedMilliseconds) exit_code=0 validator_slot=$(Get-ValidatorSlot)"
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

if ([IO.Path]::GetDirectoryName($ledger) -ne $localRoot) { throw 'Unsafe verifier-suite ledger path' }
if (Test-TcpPortListening 8899) { throw 'Port 8899 is LISTENING. Refusing to connect to or stop an unowned validator.' }
if (Test-Path -LiteralPath $ledger) {
  if ((Get-Item -LiteralPath $ledger).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to remove a linked verifier-suite ledger' }
  Remove-Item -LiteralPath $ledger -Recurse -Force
}
New-Item -ItemType Directory -Path $ledger | Out-Null
Set-Content -LiteralPath $evidence -Value 'Milestone 5 verifier-quorum localnet evidence'
$validatorStdout = Join-Path $localRoot 'verifier-quorum.validator.stdout.log'
$validatorStderr = Join-Path $localRoot 'verifier-quorum.validator.stderr.log'

try {
  Write-Stage 'STAGE START name=validator-readiness timeout_seconds=45 flags=--reset,--rpc-port=8899,--faucet-port=9900,--ticks-per-slot=1024,--log'
  $readinessWatch = [Diagnostics.Stopwatch]::StartNew()
  $validator = Start-Process -FilePath $validatorExe -ArgumentList @(
    '--reset', '--ledger', $ledger, '--rpc-port', '8899', '--faucet-port', '9900',
    '--mint', $ids.payer, '--ticks-per-slot', '1024', '--log'
  ) -RedirectStandardOutput $validatorStdout -RedirectStandardError $validatorStderr -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $localRoot 'verifier-quorum.pid') -Value $validator.Id
  Write-Stage "STAGE PROCESS name=validator-readiness owned_pid=$($validator.Id)"
  $ready = $false
  do {
    $validator.Refresh()
    if ($validator.HasExited) { throw "Validator $($validator.Id) exited. See $validatorStderr" }
    try {
      $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' -TimeoutSec 2
      $ready = $reply.result -eq 'ok'
    } catch { $ready = $false }
    if (-not $ready) { [void]$validator.WaitForExit(100) }
  } while (-not $ready -and $readinessWatch.Elapsed.TotalSeconds -lt 45)
  if (-not $ready) {
    Write-Stage "validator readiness exceeded 45 seconds; slot=$(Get-ValidatorSlot)`nstdout:`n$(Get-LogTail $validatorStdout)`nstderr:`n$(Get-LogTail $validatorStderr)"
    throw 'RPC health timeout'
  }
  Write-Stage "STAGE COMPLETE name=validator-readiness elapsed_ms=$($readinessWatch.ElapsedMilliseconds) owned_pid=$($validator.Id) validator_slot=$(Get-ValidatorSlot)"

  Invoke-OwnedProcess -Stage 'gate-deployment' -FilePath $solanaExe -Arguments @(
    'program', 'deploy', 'artifacts\gate\faultline_gate.so', '--program-id', '.localnet\faultline-gate-program.json',
    '--upgrade-authority', '.localnet\payer.json', '--keypair', '.localnet\payer.json', '--url', 'http://127.0.0.1:8899', '--commitment', 'confirmed', '--output', 'json'
  ) -TimeoutSeconds 600 -ProcessStdout (Join-Path $localRoot 'verifier-quorum.gate-deploy.stdout.log') -ProcessStderr (Join-Path $localRoot 'verifier-quorum.gate-deploy.stderr.log') -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr

  Invoke-OwnedProcess -Stage 'gate-finalization' -FilePath $solanaExe -Arguments @(
    'program', 'set-upgrade-authority', $ids.'faultline-gate-program', '--final', '--upgrade-authority', '.localnet\payer.json',
    '--keypair', '.localnet\payer.json', '--url', 'http://127.0.0.1:8899', '--commitment', 'confirmed', '--output', 'json'
  ) -TimeoutSeconds 180 -ProcessStdout (Join-Path $localRoot 'verifier-quorum.gate-finalize.stdout.log') -ProcessStderr (Join-Path $localRoot 'verifier-quorum.gate-finalize.stderr.log') -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr

  Invoke-OwnedProcess -Stage 'treasury-deployment' -FilePath $solanaExe -Arguments @(
    'program', 'deploy', 'artifacts\treasury\v1\faultline_treasury.so', '--program-id', '.localnet\faultline-treasury-program.json',
    '--upgrade-authority', '.localnet\payer.json', '--keypair', '.localnet\payer.json', '--url', 'http://127.0.0.1:8899', '--commitment', 'confirmed', '--max-len', '500000', '--output', 'json'
  ) -TimeoutSeconds 600 -ProcessStdout (Join-Path $localRoot 'verifier-quorum.treasury-deploy.stdout.log') -ProcessStderr (Join-Path $localRoot 'verifier-quorum.treasury-deploy.stderr.log') -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr

  $genesis = Invoke-RestMethod -Uri 'http://127.0.0.1:8899' -Method Post -ContentType 'application/json' -Body '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' -TimeoutSec 2
  $env:FAULTLINE_VERIFIER_GENESIS = $genesis.result
  Write-Stage "START PID=$($validator.Id) genesis=$($genesis.result) ledger=$ledger"

  Invoke-OwnedProcess -Stage 'typescript-verifier-suite' -FilePath $nodeExe -Arguments @(
    'node_modules/tsx/dist/cli.mjs', 'tests/verifier-quorum.spec.ts'
  ) -TimeoutSeconds 2700 -ProcessStdout (Join-Path $localRoot 'verifier-quorum.test.stdout.log') -ProcessStderr (Join-Path $localRoot 'verifier-quorum.test.stderr.log') -ValidatorStdout $validatorStdout -ValidatorStderr $validatorStderr

  Write-Stage "Verifier-quorum suite completed at slot $(Get-ValidatorSlot)"
  Write-Output 'MILESTONE-5 VERIFIER QUORUM ASSERTIONS 1-55 PASSED'
} finally {
  Remove-Item Env:FAULTLINE_VERIFIER_GENESIS -ErrorAction SilentlyContinue
  if ($validator) {
    $validator.Refresh()
    if (-not $validator.HasExited) {
      Write-Stage "STAGE CLEANUP terminating_owned_validator_pid=$($validator.Id)"
      Stop-Process -Id $validator.Id -Force
      $validator.WaitForExit()
    }
    Write-Stage "STOP ownedPID=$($validator.Id)"
    $validator.Dispose()
  }
}
