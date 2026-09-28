export const DEFAULT_SLOT_WAIT_DEADLINE_MS = 8 * 60_000;
export const CHECKPOINT4_REFUND_SLOT_WAIT_DEADLINE_MS = 13 * 60_000;
export const CHECKPOINT5_UPGRADE_SLOT_WAIT_DEADLINE_MS = 13 * 60_000;
export const SLOT_WAIT_HEARTBEAT_MS = 15_000;

export async function waitForRequiredSlot(options: {
  target: bigint;
  label: string;
  getSlot: () => Promise<bigint>;
  advance: (count: number) => Promise<void>;
  deadlineMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  onHeartbeat?: (elapsedMs: number, current: bigint, target: bigint, count: number) => void;
}): Promise<{ actual: bigint; count: number }> {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? DEFAULT_SLOT_WAIT_DEADLINE_MS;
  const heartbeatMs = options.heartbeatMs ?? SLOT_WAIT_HEARTBEAT_MS;
  const startedAt = now();
  const deadline = startedAt + deadlineMs;
  let nextHeartbeat = startedAt + heartbeatMs;
  let count = 0;
  let current = await options.getSlot();
  while (current < options.target) {
    const observedAt = now();
    if (observedAt >= deadline) throw new Error(`${options.label}: slot advance deadline exceeded target=${options.target}`);
    if (observedAt >= nextHeartbeat) {
      options.onHeartbeat?.(observedAt - startedAt, current, options.target, count);
      nextHeartbeat = observedAt + heartbeatMs;
    }
    await options.advance(count);
    count++;
    current = await options.getSlot();
  }
  return { actual: current, count };
}
