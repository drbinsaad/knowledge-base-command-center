/** The queue fields of the existing App-shared barrier; identity and activation stay with the plugin. */
export interface SharedAppOperationBarrier {
  generation: number;
  tail: Promise<void>;
  logicalTail: Promise<void>;
  uncertainty: { message: string } | null;
}

interface LogicalOperationGuard {
  allowReadOnlyDrain: boolean;
  adoptUncertainty(): void;
  enter(): void;
  leave(): void;
}

interface AdapterWriteGuard {
  generation: number;
  isUnloaded(): boolean;
  hasActiveLogicalOperation(): boolean;
  adoptUncertainty(): void;
}

/** Serialize complete transactions, including their compensating writes, across replacement instances. */
export function queueAppLogicalOperation<T>(
  barrier: SharedAppOperationBarrier,
  operation: () => Promise<T>,
  guard: LogicalOperationGuard,
): Promise<T> {
  const guardedOperation = async (): Promise<T> => {
    if (barrier.uncertainty && !guard.allowReadOnlyDrain) {
      guard.adoptUncertainty();
      throw new Error(barrier.uncertainty.message);
    }
    guard.enter();
    try {
      return await operation();
    } finally {
      guard.leave();
    }
  };
  const queued = barrier.logicalTail.then(guardedOperation, guardedOperation);
  // A rejected operation remains rejected to its caller but never poisons the queue.
  barrier.logicalTail = queued.then(() => undefined, () => undefined);
  return queued;
}

/** Serialize adapter writes while preserving an already-started transaction's right to compensate. */
export function queueAppAdapterWrite(
  barrier: SharedAppOperationBarrier,
  write: () => Promise<void>,
  guard: AdapterWriteGuard,
): Promise<void> {
  const guardedWrite = async (): Promise<void> => {
    if (barrier.uncertainty) {
      guard.adoptUncertainty();
      throw new Error(barrier.uncertainty.message);
    }
    // Replacement startup waits for logicalTail. An old transaction must be
    // allowed to finish compensation after a partial primary write.
    if ((guard.isUnloaded() || barrier.generation !== guard.generation) && !guard.hasActiveLogicalOperation()) {
      throw new Error("This plugin instance was replaced before its queued write could start.");
    }
    await write();
  };
  const operation = barrier.tail.then(guardedWrite, guardedWrite);
  barrier.tail = operation.then(() => undefined, () => undefined);
  return operation;
}
