import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(new URL("../scripts/run-economic-settlement-tests.ps1", import.meta.url), "utf8");

test("Checkpoint 5 keeps the normal deployment cadence without an invented snapshot workaround", () => {
  assert.match(runner, /\$flags = '--reset --rpc-port 8899 --faucet-port 9900 --ticks-per-slot 1024 --log'/);
  assert.match(runner, /'--mint', \$ids\.payer, '--ticks-per-slot', '1024', '--log'/);
  assert.doesNotMatch(runner, /4096|FinalizedSlotGuard|full-snapshot-interval-slots|incremental-snapshot-interval-slots|disable-snapshots|no-snapshots/);
});

test("Checkpoint 5 evidence is isolated by attempt", () => {
  assert.match(runner, /\$attemptId = "\$\(Get-Date -Format 'yyyyMMdd-HHmmss-fff'\)-\$PID"/);
  assert.match(runner, /\$attemptPrefix = "economic-settlement-\$currentShard-attempt-\$attemptId"/);
  for (const suffix of ["evidence", "validator.stdout", "validator.stderr", "test.stdout", "test.stderr"]) {
    assert.match(runner, new RegExp(`\\$attemptPrefix\\.${suffix.replace(".", "\\.")}\\.log`));
  }
  assert.doesNotMatch(runner, /Set-Content -LiteralPath \$evidence -Value "Faultline shard phase=\$phase shard=\$currentShard"\s*$/m);
});

test("Checkpoint 5 cleanup is restricted to owned localnet paths", () => {
  assert.match(runner, /\$ledger = \[IO\.Path\]::GetFullPath\(\(Join-Path \$localRoot/);
  assert.match(runner, /GetDirectoryName\(\$ledger\) -ne \$localRoot/);
  assert.match(runner, /Refusing linked Milestone 8 ledger cleanup/);
  assert.match(runner, /Remove-Item -LiteralPath \$ledger -Recurse -Force/);
  assert.match(runner, /Join-Path \$localRoot "economic-settlement-\$currentShard\.pid"/);
});
