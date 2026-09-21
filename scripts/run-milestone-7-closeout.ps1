[CmdletBinding()]
param(
    [string]$EvidenceDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) 'faultline-m7-closeout-evidence')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:CARGO_BUILD_JOBS = '1'

$Baseline = '633a46fb44a034484d14349cd62af4e6a548dcb9'
$RootLockHash = '72c1a405a694b6658fc53fc0f086b729afe23ef2780dfd8729d5d3d2b701f0f7'
$ReplayLockHash = 'd43c2b9caa874e5aa069247b6e50ea0c7eb367cb6724c749abb4eed6c65427e0'
$Repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ReplayManifest = 'crates/faultline-replay/Cargo.toml'
$Ledger = Join-Path $EvidenceDirectory 'stage-ledger.log'
$StageNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$OwnedPids = [System.Collections.Generic.List[int]]::new()

$AllowedDirtyFiles = @(
    'crates/faultline-replay/src/bin/faultline-replay-worker-fixture.rs',
    'crates/faultline-replay/src/coordinator.rs',
    'crates/faultline-replay/src/ipc.rs',
    'crates/faultline-replay/src/windows_job.rs',
    'crates/faultline-replay/tests/ASSERTIONS.md',
    'crates/faultline-replay/tests/CLOSEOUT_EVIDENCE.md',
    'crates/faultline-replay/tests/worker_isolation.rs',
    'scripts/run-milestone-7-closeout.ps1'
)

function Write-Ledger {
    param([string]$Message)
    $line = '{0:o} {1}' -f [DateTimeOffset]::Now, $Message
    Add-Content -LiteralPath $Ledger -Value $line -Encoding UTF8
    Write-Host $line
}

function Assert-MemoryGate {
    $sample = (Get-Counter '\Memory\Available Bytes').CounterSamples | Select-Object -First 1
    $available = [uint64]$sample.CookedValue
    if ($available -lt 5GB) {
        throw "memory gate failed: $available bytes available"
    }
    Write-Ledger "memory_gate=pass available_bytes=$available"
}

function Get-WorkerProcesses {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -in @('faultline-replay-worker', 'faultline-replay-worker-fixture')
    })
}

function Get-WorkerResidue {
    $found = @()
    $workspaceTmp = Join-Path $Repository 'tmp'
    if (Test-Path -LiteralPath $workspaceTmp) {
        $found += @(Get-ChildItem -LiteralPath $workspaceTmp -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like 'faultline-worker-run-*' })
    }
    $systemTmp = [System.IO.Path]::GetTempPath()
    $found += @(Get-ChildItem -LiteralPath $systemTmp -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^faultline-(worker|replay-run|ipc)-' })
    @($found)
}

function Assert-WorkerCleanup {
    param([string]$Stage)
    $workers = @(Get-WorkerProcesses)
    if ($workers.Count -ne 0) {
        throw "stage $Stage left worker processes: $($workers.Id -join ',')"
    }
    $residue = @(Get-WorkerResidue)
    if ($residue.Count -ne 0) {
        throw "stage $Stage left worker run-directory or IPC residue"
    }
    Write-Ledger "cleanup stage=$Stage worker_processes=0 run_residue=0"
}

function Assert-ExpectedDirtyTree {
    $entries = @(git -C $Repository status --porcelain=v1)
    if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
    $paths = @($entries | ForEach-Object { $_.Substring(3).Replace('\', '/') })
    $unexpected = @($paths | Where-Object { $_ -notin $AllowedDirtyFiles })
    if ($unexpected.Count -ne 0) {
        throw "unexpected dirty paths: $($unexpected -join ', ')"
    }
    Write-Ledger "dirty_tree=expected files=$($paths.Count)"
}

function Invoke-Stage {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$FileName,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][int]$TimeoutSeconds,
        [switch]$WorkerStage,
        [switch]$Heavy
    )

    if (-not $StageNames.Add($Name)) {
        throw "unchanged stage would be rerun: $Name"
    }
    if ($Heavy -or $WorkerStage) { Assert-MemoryGate }

    $safeName = $Name -replace '[^A-Za-z0-9_.-]', '_'
    $stdoutPath = Join-Path $EvidenceDirectory "$safeName.stdout.log"
    $stderrPath = Join-Path $EvidenceDirectory "$safeName.stderr.log"
    $start = [System.Diagnostics.Stopwatch]::StartNew()
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FileName
    $psi.Arguments = ($Arguments -join ' ')
    $psi.WorkingDirectory = $Repository
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $psi

    Write-Ledger "stage_start name=$Name timeout_seconds=$TimeoutSeconds command=$FileName $($psi.Arguments)"
    if (-not $process.Start()) { throw "failed to start stage $Name" }
    $OwnedPids.Add($process.Id)
    Write-Ledger "stage_pid name=$Name owned_pid=$($process.Id)"
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $nextHeartbeat = 10
    while (-not $process.WaitForExit(1000)) {
        if ($start.Elapsed.TotalSeconds -ge $nextHeartbeat) {
            Write-Ledger "heartbeat name=$Name owned_pid=$($process.Id) elapsed_ms=$($start.ElapsedMilliseconds)"
            $nextHeartbeat += 10
        }
        if ($start.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
            try { $process.Kill($true) } catch { if (-not $process.HasExited) { $process.Kill() } }
            $process.WaitForExit()
            [System.IO.File]::WriteAllText($stdoutPath, $stdoutTask.Result)
            [System.IO.File]::WriteAllText($stderrPath, $stderrTask.Result)
            Write-Ledger "stage_timeout name=$Name owned_pid=$($process.Id) elapsed_ms=$($start.ElapsedMilliseconds)"
            throw "stage timed out: $Name"
        }
    }
    $start.Stop()
    [System.IO.File]::WriteAllText($stdoutPath, $stdoutTask.Result)
    [System.IO.File]::WriteAllText($stderrPath, $stderrTask.Result)
    Write-Ledger "stage_complete name=$Name owned_pid=$($process.Id) elapsed_ms=$($start.ElapsedMilliseconds) exit_code=$($process.ExitCode)"
    if ($process.ExitCode -ne 0) {
        throw "stage failed: $Name (exit $($process.ExitCode)); see $stdoutPath and $stderrPath"
    }
    if ($WorkerStage) { Assert-WorkerCleanup -Stage $Name }
}

function Invoke-CargoTest {
    param(
        [string]$Name,
        [string[]]$CargoArguments,
        [int]$TimeoutSeconds = 120,
        [switch]$WorkerStage,
        [switch]$Heavy
    )
    Invoke-Stage -Name $Name -FileName 'cargo.exe' -Arguments $CargoArguments `
        -TimeoutSeconds $TimeoutSeconds -WorkerStage:$WorkerStage -Heavy:$Heavy
}

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
Set-Content -LiteralPath $Ledger -Value '' -Encoding UTF8
Set-Location -LiteralPath $Repository

try {
    Assert-ExpectedDirtyTree
    Assert-MemoryGate
    Assert-WorkerCleanup -Stage 'initial'

    Invoke-Stage -Name 'build_worker_binaries' -FileName 'cargo.exe' -TimeoutSeconds 600 -Heavy -Arguments @(
        'build', '--manifest-path', $ReplayManifest, '--bins', '--features', 'test-helper', '--locked'
    )

    Invoke-CargoTest 'frame_schema_signing_vectors' @('test','--manifest-path',$ReplayManifest,'--lib','ipc::tests','--locked','--','--nocapture','--test-threads=1')
    Invoke-CargoTest 'assertions_01_04' @('test','--manifest-path',$ReplayManifest,'--test','formats','--locked','--','--nocapture','--test-threads=1')
    Invoke-CargoTest 'assertions_05_07_09_12' @('test','--manifest-path',$ReplayManifest,'--test','checkpoint2','--locked','--','--nocapture','--test-threads=1')
    Invoke-CargoTest 'assertion_08' @('test','--manifest-path',$ReplayManifest,'--lib','trace::tests::assertion_08_expected_metadata_is_not_execution_input','--locked','--','--exact','--nocapture','--test-threads=1')
    Invoke-CargoTest 'assertions_17_23' @('test','--manifest-path',$ReplayManifest,'--test','checkpoint3','--locked','--','--nocapture','--test-threads=1')
    Invoke-CargoTest 'assertion_13' @('test','--manifest-path',$ReplayManifest,'--test','worker_isolation','assertion_13_digest_mismatched_evidence_is_invalid','--locked','--','--exact','--nocapture','--test-threads=1') 90 -WorkerStage
    Invoke-CargoTest 'assertion_14' @('test','--manifest-path',$ReplayManifest,'--test','worker_isolation','assertion_14_unsupported_program_requirement_is_unsupported_environment','--locked','--','--exact','--nocapture','--test-threads=1') 30
    Invoke-CargoTest 'assertion_24_real_v2' @('test','--manifest-path',$ReplayManifest,'--test','worker_isolation','assertion_24_real_three_worker_v2_consensus','--locked','--','--exact','--nocapture','--test-threads=1') 90 -WorkerStage
    Invoke-CargoTest 'assertion_25_real_v3' @('test','--manifest-path',$ReplayManifest,'--test','worker_isolation','assertion_25_real_three_worker_v3_consensus','--locked','--','--exact','--nocapture','--test-threads=1') 90 -WorkerStage
    Invoke-CargoTest 'assertion_26_disagreement' @('test','--manifest-path',$ReplayManifest,'--lib','coordinator::tests::assertion_26_disagreement_and_duplicates_emit_no_attestations','--locked','--','--exact','--nocapture','--test-threads=1') 90
    Invoke-CargoTest 'assertion_27_substitution' @('test','--manifest-path',$ReplayManifest,'--lib','coordinator::tests::assertion_16_and_27_substitution_replay_and_wrong_signature_are_rejected','--locked','--','--exact','--nocapture','--test-threads=1') 90
    Invoke-CargoTest 'assertion_28_real_telemetry' @('test','--manifest-path',$ReplayManifest,'--test','worker_isolation','assertion_28_real_v2_v3_production_workers_leave_no_owned_residue','--locked','--','--exact','--nocapture','--test-threads=1') 180 -WorkerStage

    $helper = @('test','--manifest-path',$ReplayManifest,'--lib','--features','test-helper')
    Invoke-CargoTest 'crash_shard' ($helper + @('windows_job::tests::assertion_15_crash_is_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'panic_shard' ($helper + @('windows_job::tests::assertion_15_panic_is_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'internal_failure_shard' ($helper + @('windows_job::tests::assertion_15_internal_worker_failure_is_executed_and_is_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'wall_timeout_shard' ($helper + @('windows_job::tests::assertion_16_wall_expiration_is_timeout_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 50 -WorkerStage -Heavy
    Invoke-CargoTest 'cpu_limit_shard' ($helper + @('windows_job::tests::cpu_limit_is_timeout_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 45 -WorkerStage -Heavy
    Invoke-CargoTest 'memory_limit_shard' ($helper + @('windows_job::tests::assertion_15_memory_limit_is_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 45 -WorkerStage -Heavy
    Invoke-CargoTest 'stdout_limit_shard' ($helper + @('windows_job::tests::stdout_limit_is_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'stderr_limit_shard' ($helper + @('windows_job::tests::stderr_limit_is_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'active_process_limit_shard' ($helper + @('windows_job::tests::active_process_limit_is_runner_fault','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'partial_response_shard' ($helper + @('windows_job::tests::partial_output_is_bounded_for_coordinator_rejection','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'trailing_response_shard' ($helper + @('windows_job::tests::trailing_output_is_bounded_for_coordinator_rejection','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'malformed_response_shard' ($helper + @('windows_job::tests::malformed_output_is_bounded_for_coordinator_rejection','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'missing_response_shard' ($helper + @('windows_job::tests::missing_output_is_bounded_for_coordinator_rejection','--locked','--','--exact','--nocapture','--test-threads=1')) 30 -WorkerStage
    Invoke-CargoTest 'cleanup_obstruction_shard' @('test','--manifest-path',$ReplayManifest,'--lib','coordinator::tests::cleanup_obstruction_exhausts_grace_and_maps_to_runner_cleanup','--locked','--','--exact','--nocapture','--test-threads=1') 20 -WorkerStage
    Invoke-CargoTest 'owned_handle_cleanup_shard' ($helper + @('windows_job::tests::owned_process_thread_pipe_and_job_handles_are_closed_after_success_and_failure','--locked','--','--exact','--nocapture','--test-threads=1')) 60 -WorkerStage

    Invoke-Stage -Name 'dependency_graph' -FileName 'cargo.exe' -TimeoutSeconds 120 -Arguments @('tree','--manifest-path',$ReplayManifest,'-p','faultline-replay','--locked')

    $assertionRows = @(Get-Content -LiteralPath (Join-Path $Repository 'crates/faultline-replay/tests/ASSERTIONS.md') |
        Where-Object { $_ -match '^\| ([0-9]+)\.' } |
        ForEach-Object { [int]$Matches[1] })
    if ($assertionRows.Count -ne 28 -or (@($assertionRows | Sort-Object -Unique).Count -ne 28) -or
        (Compare-Object $assertionRows (1..28))) {
        throw 'assertion ledger is not exactly 1 through 28 once each'
    }
    Write-Ledger 'assertion_ledger=pass count=28 unique=28'

    $rootHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Repository 'Cargo.lock')).Hash.ToLowerInvariant()
    $replayHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Repository 'crates/faultline-replay/Cargo.lock')).Hash.ToLowerInvariant()
    if ($rootHash -ne $RootLockHash -or $replayHash -ne $ReplayLockHash) { throw 'lockfile hash drift' }
    Write-Ledger "lockfiles=pass root=$rootHash replay=$replayHash"

    $programDiff = @(git -C $Repository diff --name-only $Baseline -- programs)
    $programStatus = @(git -C $Repository status --porcelain=v1 -- programs)
    if ($programDiff.Count -ne 0 -or $programStatus.Count -ne 0) { throw 'production Solana source changed' }
    Write-Ledger 'production_solana_source=unchanged'

    $workerSources = @(
        (Join-Path $Repository 'crates/faultline-replay/src/worker.rs'),
        (Join-Path $Repository 'crates/faultline-replay/src/bin/faultline-replay-worker.rs')
    )
    $forbidden = Select-String -Path $workerSources -Pattern 'std::process::Command|TcpStream|UdpSocket|LoadLibrary|libloading|cmd\.exe|powershell|fallback.{0,20}key' -CaseSensitive:$false
    if ($forbidden) { throw 'forbidden production worker callsite detected' }
    Write-Ledger 'production_worker_source_boundary=pass'

    Assert-WorkerCleanup -Stage 'final'
    Assert-ExpectedDirtyTree
    Write-Ledger "closeout=pass stages=$($StageNames.Count) owned_pids=$($OwnedPids.Count) retries=0"
}
catch {
    Write-Ledger "closeout=fail error=$($_.Exception.Message)"
    throw
}
