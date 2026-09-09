import assert from "node:assert/strict";
import test from "node:test";
import { queueAppAdapterWrite, queueAppLogicalOperation, type SharedAppOperationBarrier } from "../src/app-operation-queue";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const barrier: SharedAppOperationBarrier = { generation: 1, tail: Promise.resolve(), logicalTail: Promise.resolve(), uncertainty: null };
  const state = { unloaded: false, depth: 0, adoptions: 0 };
  const logicalGuard = {
    allowReadOnlyDrain: false,
    adoptUncertainty: () => { state.adoptions += 1; },
    enter: () => { state.depth += 1; },
    leave: () => { state.depth -= 1; },
  };
  const writeGuard = {
    generation: 1,
    isUnloaded: () => state.unloaded,
    hasActiveLogicalOperation: () => state.depth > 0,
    adoptUncertainty: () => { state.adoptions += 1; },
  };
  return { barrier, state, logicalGuard, writeGuard };
}

test("rejected adapter writes and logical operations do not poison subsequent work", async () => {
  const { barrier, state, logicalGuard, writeGuard } = harness();
  const events: string[] = [];
  const failedWrite = queueAppAdapterWrite(barrier, async () => { events.push("failed write"); throw new Error("adapter failure"); }, writeGuard);
  const nextWrite = queueAppAdapterWrite(barrier, async () => { events.push("next write"); }, writeGuard);
  await assert.rejects(failedWrite, /adapter failure/);
  await nextWrite;
  const failedOperation = queueAppLogicalOperation(barrier, async () => { events.push("failed operation"); throw new Error("logical failure"); }, logicalGuard);
  const nextOperation = queueAppLogicalOperation(barrier, async () => { events.push("next operation"); return 42; }, logicalGuard);
  await assert.rejects(failedOperation, /logical failure/);
  assert.equal(await nextOperation, 42);
  await Promise.all([barrier.tail, barrier.logicalTail]);
  assert.equal(state.depth, 0);
  assert.deepEqual(events, ["failed write", "next write", "failed operation", "next operation"]);
});

test("replacement or unload fences standalone writes queued before the lifecycle change", async () => {
  for (const change of ["replace", "unload"]) {
    const { barrier, state, writeGuard } = harness();
    const gate = deferred();
    barrier.tail = gate.promise;
    let writes = 0;
    const pending = queueAppAdapterWrite(barrier, async () => { writes += 1; }, writeGuard);
    if (change === "replace") barrier.generation += 1;
    else state.unloaded = true;
    gate.resolve();
    await assert.rejects(pending, /replaced before its queued write/);
    assert.equal(writes, 0);
  }
});

test("replacement reads wait through an old logical transaction's partial-write compensation", async () => {
  const { barrier, state, logicalGuard, writeGuard } = harness();
  const primaryStarted = deferred();
  const rejectPrimary = deferred();
  const compensationStarted = deferred();
  const finishCompensation = deferred();
  const events: string[] = [];
  const transaction = queueAppLogicalOperation(barrier, async () => {
    try {
      await queueAppAdapterWrite(barrier, async () => {
        events.push("primary started");
        primaryStarted.resolve();
        await rejectPrimary.promise;
        throw new Error("primary may have partially written");
      }, writeGuard);
    } catch {
      await queueAppAdapterWrite(barrier, async () => {
        events.push("compensation started");
        compensationStarted.resolve();
        await finishCompensation.promise;
        events.push("compensation committed");
      }, writeGuard);
    }
  }, logicalGuard);
  await primaryStarted.promise;
  // This is the unchanged startup read barrier used by activateAppWriteBarrier.
  let replacementRead = false;
  const readBarrier = Promise.all([
    barrier.tail.then(() => undefined, () => undefined),
    barrier.logicalTail.then(() => undefined, () => undefined),
  ]).then(() => { replacementRead = true; events.push("replacement read"); });
  barrier.generation += 1;
  state.unloaded = true;
  rejectPrimary.resolve();
  await compensationStarted.promise;
  assert.equal(replacementRead, false);
  assert.equal(state.depth, 1);
  finishCompensation.resolve();
  await Promise.all([transaction, readBarrier]);
  assert.equal(state.depth, 0);
  assert.deepEqual(events, ["primary started", "compensation started", "compensation committed", "replacement read"]);
});

test("shared uncertainty is checked when queued work starts and blocks both queues", async () => {
  const { barrier, state, logicalGuard, writeGuard } = harness();
  const gate = deferred();
  barrier.tail = gate.promise;
  barrier.logicalTail = gate.promise;
  let writes = 0;
  let operations = 0;
  const write = queueAppAdapterWrite(barrier, async () => { writes += 1; }, writeGuard);
  const operation = queueAppLogicalOperation(barrier, async () => { operations += 1; }, logicalGuard);
  barrier.uncertainty = { message: "Uncertain primary state" };
  gate.resolve();
  await Promise.all([
    assert.rejects(write, /Uncertain primary state/),
    assert.rejects(operation, /Uncertain primary state/),
  ]);
  assert.equal(writes, 0);
  assert.equal(operations, 0);
  assert.equal(state.adoptions, 2);
  assert.equal(state.depth, 0);
});

test("a read-only recovery drain may run under uncertainty but cannot use it to write", async () => {
  const { barrier, state, logicalGuard, writeGuard } = harness();
  barrier.uncertainty = { message: "Uncertain primary state" };
  let writes = 0;
  const result = await queueAppLogicalOperation(barrier, async () => {
    await assert.rejects(queueAppAdapterWrite(barrier, async () => { writes += 1; }, writeGuard), /Uncertain primary state/);
    return "capture retained";
  }, { ...logicalGuard, allowReadOnlyDrain: true });
  assert.equal(result, "capture retained");
  assert.equal(writes, 0);
  assert.equal(state.depth, 0);
});
