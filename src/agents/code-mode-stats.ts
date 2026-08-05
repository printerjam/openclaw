import type { CodeModeBridgeMethod } from "./code-mode-worker-types.js";

const CODE_MODE_BRIDGE_METHODS = [
  "search",
  "describe",
  "call",
  "callValue",
  "nodes",
  "yield",
  "namespace",
  "agentSpawn",
  "agentWait",
  "skillsList",
  "skillsRead",
  "swarmNote",
] as const satisfies readonly CodeModeBridgeMethod[];

type CodeModeWorkerKind = "exec" | "resume";
type CodeModeOutcome = "completed" | "waiting" | "failed" | "aborted";
const CODE_MODE_CONTROLS = ["exec", "wait"] as const;
const CODE_MODE_WORKER_KINDS = ["exec", "resume"] as const;
const CODE_MODE_OUTCOMES = ["completed", "waiting", "failed", "aborted"] as const;

type CodeModeWorkerRunStats = {
  count: number;
  elapsedMs: number;
};

type CodeModeSnapshotStats = {
  count: number;
  totalBytes: number;
  maxBytes: number;
  serializationMs?: number;
};

export type CodeModeStats = {
  /** Once this object exists, omitted sparse counters mean observed zero. */
  controlCalls: Partial<Record<"exec" | "wait", number>>;
  bridgeCalls: Partial<Record<CodeModeBridgeMethod, number>>;
  workerRuns: Partial<Record<CodeModeWorkerKind, CodeModeWorkerRunStats>>;
  bridgeLifecycle: {
    registered?: number;
    started?: number;
    settled?: number;
    failed?: number;
    cancelRequested?: number;
    cancelledBeforeStart?: number;
    settledAfterCancel?: number;
    /** Outstanding bridge count sampled when stats leave one Code Mode attempt. */
    unresolvedAtExtraction?: number;
  };
  snapshots?: CodeModeSnapshotStats;
  outcomes: Partial<Record<CodeModeOutcome, number>>;
};

type CodeModeStatsOwner = {
  current?: {
    codeModeStats?: CodeModeStats;
  };
};

type CodeModeStatsRuntime = {
  unresolved: number;
};

const runtimeByStats = new WeakMap<CodeModeStats, CodeModeStatsRuntime>();

function incrementCounter<K extends string>(counters: Partial<Record<K, number>>, key: K): void {
  counters[key] = (counters[key] ?? 0) + 1;
}

function incrementLifecycle(
  stats: CodeModeStats | undefined,
  key: Exclude<keyof CodeModeStats["bridgeLifecycle"], "unresolvedAtExtraction">,
): void {
  if (stats) {
    stats.bridgeLifecycle[key] = (stats.bridgeLifecycle[key] ?? 0) + 1;
  }
}

function runtimeFor(stats: CodeModeStats): CodeModeStatsRuntime {
  const existing = runtimeByStats.get(stats);
  if (existing) {
    return existing;
  }
  const created = { unresolved: 0 };
  runtimeByStats.set(stats, created);
  return created;
}

export function createCodeModeStats(): CodeModeStats {
  return {
    controlCalls: {},
    bridgeCalls: {},
    workerRuns: {},
    bridgeLifecycle: {},
    outcomes: {},
  };
}

export function ensureCodeModeStats(owner?: CodeModeStatsOwner): CodeModeStats | undefined {
  const catalog = owner?.current;
  if (!catalog) {
    return undefined;
  }
  catalog.codeModeStats ??= createCodeModeStats();
  return catalog.codeModeStats;
}

export function cloneCodeModeStats(stats: CodeModeStats): CodeModeStats {
  const workerRuns: CodeModeStats["workerRuns"] = {};
  for (const kind of CODE_MODE_WORKER_KINDS) {
    const value = stats.workerRuns[kind];
    if (value) {
      workerRuns[kind] = { ...value };
    }
  }
  const clone: CodeModeStats = {
    controlCalls: { ...stats.controlCalls },
    bridgeCalls: { ...stats.bridgeCalls },
    workerRuns,
    bridgeLifecycle: { ...stats.bridgeLifecycle },
    ...(stats.snapshots ? { snapshots: { ...stats.snapshots } } : {}),
    outcomes: { ...stats.outcomes },
  };
  const runtime = runtimeByStats.get(stats);
  if (runtime) {
    clone.bridgeLifecycle.unresolvedAtExtraction = runtime.unresolved;
  }
  return clone;
}

export function mergeCodeModeStats(target: CodeModeStats, source: CodeModeStats): void {
  for (const control of CODE_MODE_CONTROLS) {
    const value = source.controlCalls[control];
    if (value !== undefined) {
      target.controlCalls[control] = (target.controlCalls[control] ?? 0) + value;
    }
  }
  for (const method of CODE_MODE_BRIDGE_METHODS) {
    const value = source.bridgeCalls[method];
    if (value !== undefined) {
      target.bridgeCalls[method] = (target.bridgeCalls[method] ?? 0) + value;
    }
  }
  for (const kind of CODE_MODE_WORKER_KINDS) {
    const value = source.workerRuns[kind];
    if (!value) {
      continue;
    }
    const current = target.workerRuns[kind] ?? { count: 0, elapsedMs: 0 };
    current.count += value.count;
    current.elapsedMs += value.elapsedMs;
    target.workerRuns[kind] = current;
  }
  for (const key of [
    "registered",
    "started",
    "settled",
    "failed",
    "cancelRequested",
    "cancelledBeforeStart",
    "settledAfterCancel",
  ] as const) {
    const value = source.bridgeLifecycle[key];
    if (value !== undefined) {
      target.bridgeLifecycle[key] = (target.bridgeLifecycle[key] ?? 0) + value;
    }
  }
  if (source.bridgeLifecycle.unresolvedAtExtraction !== undefined) {
    target.bridgeLifecycle.unresolvedAtExtraction = source.bridgeLifecycle.unresolvedAtExtraction;
  } else {
    delete target.bridgeLifecycle.unresolvedAtExtraction;
  }
  if (source.snapshots) {
    const current = target.snapshots ?? { count: 0, totalBytes: 0, maxBytes: 0 };
    current.count += source.snapshots.count;
    current.totalBytes += source.snapshots.totalBytes;
    current.maxBytes = Math.max(current.maxBytes, source.snapshots.maxBytes);
    if (source.snapshots.serializationMs !== undefined) {
      current.serializationMs = (current.serializationMs ?? 0) + source.snapshots.serializationMs;
    }
    target.snapshots = current;
  }
  for (const outcome of CODE_MODE_OUTCOMES) {
    const value = source.outcomes[outcome];
    if (value !== undefined) {
      target.outcomes[outcome] = (target.outcomes[outcome] ?? 0) + value;
    }
  }
}

export function recordCodeModeControlCall(
  stats: CodeModeStats | undefined,
  control: keyof CodeModeStats["controlCalls"],
): void {
  if (stats) {
    incrementCounter(stats.controlCalls, control);
  }
}

export function recordCodeModeBridgeRegistered(
  stats: CodeModeStats | undefined,
  method: CodeModeBridgeMethod,
): void {
  if (!stats) {
    return;
  }
  incrementCounter(stats.bridgeCalls, method);
  incrementLifecycle(stats, "registered");
  runtimeFor(stats).unresolved += 1;
}

export function recordCodeModeBridgeStarted(stats: CodeModeStats | undefined): void {
  incrementLifecycle(stats, "started");
}

export function recordCodeModeBridgeCancelRequested(stats: CodeModeStats | undefined): void {
  incrementLifecycle(stats, "cancelRequested");
}

export function recordCodeModeBridgeCancelledBeforeStart(stats: CodeModeStats | undefined): void {
  incrementLifecycle(stats, "cancelledBeforeStart");
}

export function recordCodeModeBridgeSettled(
  stats: CodeModeStats | undefined,
  options: { failed: boolean; settledAfterCancel: boolean },
): void {
  if (!stats) {
    return;
  }
  incrementLifecycle(stats, "settled");
  if (options.failed) {
    incrementLifecycle(stats, "failed");
  }
  if (options.settledAfterCancel) {
    incrementLifecycle(stats, "settledAfterCancel");
  }
  const runtime = runtimeFor(stats);
  runtime.unresolved = Math.max(0, runtime.unresolved - 1);
}

export function recordCodeModeWorkerRun(
  stats: CodeModeStats | undefined,
  kind: CodeModeWorkerKind,
  elapsedMs: number,
): void {
  if (!stats) {
    return;
  }
  const current = stats.workerRuns[kind] ?? { count: 0, elapsedMs: 0 };
  current.count += 1;
  current.elapsedMs += Math.max(0, elapsedMs);
  stats.workerRuns[kind] = current;
}

export function recordCodeModeSnapshot(
  stats: CodeModeStats | undefined,
  bytes: number,
  serializationMs?: number,
): void {
  if (!stats) {
    return;
  }
  const current = stats.snapshots ?? { count: 0, totalBytes: 0, maxBytes: 0 };
  current.count += 1;
  current.totalBytes += bytes;
  current.maxBytes = Math.max(current.maxBytes, bytes);
  if (serializationMs !== undefined) {
    current.serializationMs = (current.serializationMs ?? 0) + Math.max(0, serializationMs);
  }
  stats.snapshots = current;
}

export function recordCodeModeOutcome(
  stats: CodeModeStats | undefined,
  outcome: keyof CodeModeStats["outcomes"],
): void {
  if (stats) {
    incrementCounter(stats.outcomes, outcome);
  }
}
