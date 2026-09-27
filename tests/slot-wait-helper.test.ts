import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKPOINT4_REFUND_SLOT_WAIT_DEADLINE_MS,
  CHECKPOINT5_UPGRADE_SLOT_WAIT_DEADLINE_MS,
  waitForRequiredSlot
} from "./slot-wait-helper.js";

test("Checkpoint 4 refund wait reaches the exact required slot and emits bounded heartbeats", async () => {
  let slot = 83n;
  let now = 0;
  const heartbeats: bigint[] = [];
  const result = await waitForRequiredSlot({
    target: 128n,
    label: "m8-c4-refund-eligible",
    getSlot: async () => slot,
    advance: async () => { slot++; now += 15_000; },
    deadlineMs: CHECKPOINT4_REFUND_SLOT_WAIT_DEADLINE_MS,
    now: () => now,
    onHeartbeat: (_elapsed, current) => heartbeats.push(current)
  });
  assert.equal(result.actual, 128n);
  assert.equal(result.count, 45);
  assert(heartbeats.length > 0);
  assert(CHECKPOINT4_REFUND_SLOT_WAIT_DEADLINE_MS < 35 * 60_000);
  assert(CHECKPOINT5_UPGRADE_SLOT_WAIT_DEADLINE_MS < 40 * 60_000);
});

test("slot wait fails closed without reducing the required slot", async () => {
  let now = 0;
  await assert.rejects(() => waitForRequiredSlot({
    target: 128n,
    label: "bounded",
    getSlot: async () => 127n,
    advance: async () => { now += 1_000; },
    deadlineMs: 2_000,
    heartbeatMs: 500,
    now: () => now
  }), /bounded: slot advance deadline exceeded target=128/);
});
