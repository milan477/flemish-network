type LogLevel = "log" | "warn" | "error" | "info";

function serialize(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }

  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: LogLevel, fn: string, runId: string | null, event: string, detail?: unknown) {
  const prefix = `[fn:${fn}] [run:${runId || "-"}] [evt:${event}]`;
  const line = detail === undefined ? prefix : `${prefix} ${serialize(detail)}`;
  console[level](line);
}

export interface StructuredLogger {
  log: (event: string, detail?: unknown) => void;
  info: (event: string, detail?: unknown) => void;
  warn: (event: string, detail?: unknown) => void;
  error: (event: string, detail?: unknown) => void;
  withRun: (runId?: string | null) => StructuredLogger;
}

export function createLogger(functionName: string, runId?: string | null): StructuredLogger {
  const normalizedRunId = runId || null;

  return {
    log: (event, detail) => write("log", functionName, normalizedRunId, event, detail),
    info: (event, detail) => write("info", functionName, normalizedRunId, event, detail),
    warn: (event, detail) => write("warn", functionName, normalizedRunId, event, detail),
    error: (event, detail) => write("error", functionName, normalizedRunId, event, detail),
    withRun: (nextRunId) => createLogger(functionName, nextRunId),
  };
}

export interface TimerSpan {
  name: string;
  duration_ms: number;
  detail?: Record<string, unknown>;
}

export interface Timer {
  /** Time an async block; logs and records the span. */
  span<T>(name: string, fn: () => Promise<T> | T, detail?: Record<string, unknown>): Promise<T>;
  /** Record an already-measured duration. */
  record(name: string, durationMs: number, detail?: Record<string, unknown>): void;
  /** Snapshot of recorded spans (in insertion order). */
  spans(): TimerSpan[];
  /** Wall-clock elapsed since timer creation. */
  elapsed(): number;
  /** Summary object suitable for inclusion in a response body. */
  summary(extra?: Record<string, unknown>): {
    total_ms: number;
    spans: TimerSpan[];
    extra?: Record<string, unknown>;
  };
  /** Emit a single info-level log line with the full timing summary. */
  flush(extra?: Record<string, unknown>): void;
}

export function createTimer(functionName: string, label: string, runId?: string | null): Timer {
  const startedAt = performance.now();
  const recorded: TimerSpan[] = [];
  const logger = createLogger(functionName, runId);

  function record(name: string, durationMs: number, detail?: Record<string, unknown>): void {
    const span: TimerSpan = {
      name,
      duration_ms: Math.round(durationMs * 100) / 100,
    };
    if (detail) span.detail = detail;
    recorded.push(span);
    logger.info(`timing:${label}:${name}`, span);
  }

  async function span<T>(name: string, fn: () => Promise<T> | T, detail?: Record<string, unknown>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      record(name, performance.now() - start, detail);
      return result;
    } catch (err) {
      const end = performance.now();
      record(name, end - start, { ...(detail || {}), error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  function elapsed(): number {
    return Math.round((performance.now() - startedAt) * 100) / 100;
  }

  function summary(extra?: Record<string, unknown>) {
    return {
      total_ms: elapsed(),
      spans: recorded.slice(),
      ...(extra ? { extra } : {}),
    };
  }

  function flush(extra?: Record<string, unknown>) {
    logger.info(`timing:${label}:summary`, summary(extra));
  }

  return { span, record, spans: () => recorded.slice(), elapsed, summary, flush };
}
