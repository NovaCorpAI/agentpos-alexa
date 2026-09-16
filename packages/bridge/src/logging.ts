/**
 * Structured JSON logs, one object per line, always carrying the traceId that crosses the
 * MCP call, the checkout session, the Store request and the settlement. Never PII.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  msg: string;
  traceId?: string;
  at: string;
  [key: string]: unknown;
}

export interface Logger {
  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export type LogSink = (record: LogRecord) => void;

export function createLogger(sink: LogSink, base: Record<string, unknown> = {}): Logger {
  return {
    log(level, msg, fields = {}) {
      sink({ ...base, ...fields, level, msg, at: new Date().toISOString() } as LogRecord);
    },
    child(fields) {
      return createLogger(sink, { ...base, ...fields });
    },
  };
}

/** Default sink: one JSON line per record on stdout. */
export const stdoutSink: LogSink = (record) => {
  process.stdout.write(JSON.stringify(record) + "\n");
};

/** Sink for tests: keeps records in memory. */
export function memorySink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { sink: (r) => void records.push(r), records };
}
