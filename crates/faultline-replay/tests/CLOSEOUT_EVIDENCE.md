# Milestone 7 Checkpoint 5 closeout evidence

This sanitized report records the successful Windows closeout run. Raw command logs, process identifiers, absolute paths, temporary-directory names, and signing seeds are intentionally not tracked.

## Validation totals

- Bounded closeout runner: 29 stages, 29 owned stage processes, zero retries, all stages passed.
- Focused runner tests: 60 distinct test executions. This comprises 6 frame/schema/signing tests, 16 format tests, 7 Checkpoint 2 tests, 1 assertion-8 test, 8 Checkpoint 3 tests, 7 focused coordinator/production-worker assertion tests, and 15 separately bounded adversarial/cleanup tests.
- Complete replay workspace all-target suite: 49 tests passed. Forty-six overlap the focused runner; the complete suite adds 3 supplemental tests.
- Feature-gated adversarial tests not present in the ordinary complete suite: 14. Therefore the combined unique replay test inventory is 63, not 109.
- Root workspace: 32 tests passed independently of the replay workspace.
- Assertion ledger: assertions 1 through 28 occur exactly once with no gaps or duplicates.

## Real three-worker consensus

Both shards launched the canonical production worker executable. These deterministic identity records were produced only under explicit Checkpoint 4 test-vector mode; the Assertion 28 telemetry shards separately used production identity mode and OS-CSPRNG identities/nonces.

### v2 — `Violated`

- Receipt: `5a4a5a0b78fe3f8d9eb0bdd21effaba40dc604cb6c08ae498ca59d248e649b99`
- Commitment: `a0403e0034e04e607d327c0b25c2ce9600bea6fc7d5cb6e1718935d4c3471e88`
- Ordinal 0: identity `992QsRZRM8H59Kd96VCPhu8HQZTuXaZUE9i99Cf9jVZ4`; nonce `ee37af3a42128ec081f4c16fb77c6ba73ca77ac2b877594bf9aea6a6c7587d07`; signature `5Pfr3CDAukPjesCf25RS5HHdGYApUPk5kqHXMhS35aWU5NrvQbsvbYNKdVjw3SjWBH787XykpmLrJkDizovNquN2`.
- Ordinal 1: identity `9VNoSABNshf46oaW9cJATi4i3pTPcLMRmCxBTdXLXAQf`; nonce `1bf038c3a99e54fa8fa15d87ff6b8a3a7b8fa1d98d96511bc2ec0a76ab48d9da`; signature `oBWv4c6cfJxoNkyy2rCWFXY7FTtgCzaH115mjAVKtSvqzYJuDfSLQCzJYHHCQ4p5TS5vjipkWuxB1Jtcy2KedgL`.
- Ordinal 2: identity `5CwiTeTWofME9j6iksUYpPjQx4Bu5ycsthHT9LCt6ocQ`; nonce `f0243e6c8267b04bd330af95397c765d7c7518145d8e67a709deb7722c3bea3b`; signature `fnF2JqDrFNJaZbFaJQpNRWBiMZfRquWfHETDV5n94Z7hmWtb8BaQKuSDvxT8fd5UTbiCK5BMDo8yE4mYD3SSXGq`.

### v3 — `Preserved`

- Receipt: `51462394c3bf6daee0c221afa21e56099d5dc97e7b2ac39b83952426f1fabd51`
- Commitment: `9c0d32ec40a308c16fcb057cdc36b3f08b661db22bfb43eac11df029176e2edc`
- Ordinal 0: identity `992QsRZRM8H59Kd96VCPhu8HQZTuXaZUE9i99Cf9jVZ4`; nonce `7c975424e4a903d7686ac5509b4b7ac6dc32241c56ce83557921d5e0e64cd536`; signature `2YYCvsYjVr76183Ey9DW7iqXgZmBmVzvkHARbXiVC51zUzTfMwhBvv2pXPiX1M2wTHnKrFJEr22fkA9AoVyvibGf`.
- Ordinal 1: identity `9VNoSABNshf46oaW9cJATi4i3pTPcLMRmCxBTdXLXAQf`; nonce `2c890741e9cd0ec964c891b97257e9c53b00d8ca2a9d07a305495b87ad4a805b`; signature `48hTfPd98iPjSzHXeQHqFuGRWzeXAJ8oAEp6dLKmfeeY71rwr4NRKogpn9ujRWxSiEEAUtRdry3TbRkSEFMdRhDp`.
- Ordinal 2: identity `5CwiTeTWofME9j6iksUYpPjQx4Bu5ycsthHT9LCt6ocQ`; nonce `0b86af2201ccf6ff9fbbca28ed699464fa11a5abd643a5deff3009b0c7418e9a`; signature `4mDxWa5YbQMtc9T3T8BAhxhDc7734byjTCtLrJP2YnzVUvwAYCubBMeAqLQA3Y5EkXBdzwrwGHXUHwXf7R5PGe82`.

The three authenticated projections agreed exactly in each shard. The disagreement and mixed eligible/ineligible test returned `WORKER_DISAGREEMENT` and no aggregate intents. Substitution, replay, wrong job hash, wrong nonce/ordinal/identity, and altered signature were rejected before aggregation.

## Assertion 28 trusted Windows telemetry

The successful Assertion 28 v2 and v3 shards used the real production worker and production identity mode. Each reported three ordered records, three launches, zero retries, exit status zero, `completed` termination, verified cleanup, queried-back matching limits, nonzero peak process and Job memory, and no telemetry collection error.

| Candidate | Ordinal | Peak process bytes | Peak Job bytes | Launch-to-exit ms | Cleanup ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| v2 | 0 | 8,290,304 | 8,290,304 | 197 | 10 |
| v2 | 1 | 8,314,880 | 8,314,880 | 182 | 24 |
| v2 | 2 | 8,282,112 | 8,282,112 | 186 | 20 |
| v3 | 0 | 7,372,800 | 7,372,800 | 193 | 18 |
| v3 | 1 | 7,372,800 | 7,372,800 | 204 | 7 |
| v3 | 2 | 7,364,608 | 7,364,608 | 195 | 16 |

The applied and queried-back limits matched for every worker:

- active processes: `1`;
- process memory: `536870912` bytes;
- Job memory: `536870912` bytes;
- user-mode CPU: `250000000` 100-nanosecond units;
- wall timeout: `30000` milliseconds;
- cleanup grace: `5000` milliseconds;
- stdout: `8388608` bytes; and
- stderr: `1048576` bytes.

The signed `process_peak_memory_bytes = "0"` sentinel remained unchanged and was not used as measured evidence.

## Failure and cleanup evidence

Separately bounded real fixture-process shards exercised the following closed mappings:

- crash and panic: `RUNNER_CRASH` (`0x00030002`);
- actual test-only internal failure: `RUNNER_INTERNAL` (`0x00030001`);
- wall and CPU expiration: `RUNNER_TIMEOUT` (`0x00030003`);
- process/Job memory enforcement: `RUNNER_MEMORY_LIMIT` (`0x00030004`);
- stdout, stderr, partial, trailing, malformed, and missing response: `RUNNER_OUTPUT_LIMIT_OR_MALFORMED_OUTPUT` (`0x00030005`);
- active-process violation: `RUNNER_ISOLATION_SETUP` (`0x00030006`);
- cleanup obstruction: `RUNNER_CLEANUP` (`0x00030007`);
- authenticated disagreement: `WORKER_DISAGREEMENT` (`0x00040001`); and
- substitution or invalid authentication: `INVALID_SIGNATURE_OR_IDENTITY` (`0x00010009`).

The runner checked after every worker shard and at final closeout: zero worker/fixture processes, zero worker run-directory or IPC residue, and no automatic retry. Assertion 28 telemetry additionally confirmed all owned processes exited, all owned handles closed, and both shard run directories were removed.

## Hash, dependency, and source-boundary audit

- Root `Cargo.lock` SHA-256: `72c1a405a694b6658fc53fc0f086b729afe23ef2780dfd8729d5d3d2b701f0f7`.
- Replay `Cargo.lock` SHA-256: `d43c2b9caa874e5aa069247b6e50ea0c7eb367cb6724c749abb4eed6c65427e0`.
- Direct replay pins remain LiteSVM `0.1.0`, the replay Solana family `1.18.22`, `solana_rbpf` `0.8.3`, and target-specific direct `windows-sys` `0.61.2`.
- Neither on-chain program crate is reachable from the replay dependency root.
- Checkpoint 1 format-only receipt hashes remain v2 `34fbbeec13719f3f3d655a841a7e6a4f30469f1208c7cd345b10d938833b763f` and v3 `f0325d9d847009900492f89831efc80fdad67fb189b6da1bba4b7984c8613eff`.
- Checkpoint 3 runtime receipt hashes remain the distinct v2 and v3 hashes recorded above.
- Worker IPC schemas, canonical JSON, receipts, worker-message digests, signatures, commitments, classifications, consensus projections, attestation intents, fixtures, manifests, policies, artifacts, and on-chain data were unchanged.
- Production changes are confined to coordinator/Windows telemetry plumbing. The production worker source still contains no subprocess, shell, direct-networking, dynamic-plugin, fault-injection, or fallback-key callsite.
- No path under `programs/**` changed. Milestone 8 was not started.

Known limitation: Windows Job Objects enforce the frozen process, memory, CPU, active-process, and cleanup limits, but they do not provide OS-enforced filesystem or network sandboxing. This closeout does not claim otherwise.
