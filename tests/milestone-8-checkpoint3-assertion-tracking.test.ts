import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssertionTracker } from "./assertion-tracker.js";

test("active assertion is set during behavior, retained on failure, and cleared on pass", async () => {
  const output: string[] = [];
  const tracker = createAssertionTracker(message => output.push(message));

  await assert.rejects(
    tracker.run(33, "equivocation", async () => {
      assert.equal(tracker.active, 33);
      throw new Error("VerifierAlreadyAttested");
    }),
    /VerifierAlreadyAttested/
  );
  assert.equal(tracker.active, 33);
  assert.deepEqual(output, []);

  await tracker.run(34, "non-member rejection", async () => {
    assert.equal(tracker.active, 34);
  }, "expected=UnauthorizedVerifier");
  assert.equal(tracker.active, 0);
  assert.deepEqual(output, ["ASSERT 34 PASS non-member rejection expected=UnauthorizedVerifier"]);
});
