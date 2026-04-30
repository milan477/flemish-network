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
