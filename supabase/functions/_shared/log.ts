// Structured logs with an allow-list of fields. Message text, answers, sources, names, emails and
// tokens can never reach a log line: any key not listed here is dropped, and strings are short.

const ALLOWED = new Set([
  "user",
  "guest",
  "conversation",
  "message",
  "ms",
  "status",
  "code",
  "reason",
  "rule_ids",
  "level",
  "source",
  "mode",
  "degraded",
  "replayed",
  "saved",
  "raised",
  "tokens_in",
  "tokens_out",
  "model",
  "step",
  "state",
  "attempt",
  "cache",
  "count",
  "dose_hits",
  "dropped_citations",
  "softened",
  "grade",
  "language",
  "via",
  "missing",
]);

type Value = string | number | boolean | null | undefined | readonly (string | number | boolean)[];
export type LogFields = Record<string, Value>;
export type Logger = {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
};

function clean(value: Value): Value {
  if (typeof value === "string") return value.slice(0, 80);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => (typeof item === "string" ? item.slice(0, 60) : item));
  return value;
}

export function createLogger(fn: string, sink: (line: string) => void = (line) => console.log(line)): Logger {
  const write = (level: string, event: string, fields: LogFields = {}) => {
    const out: Record<string, Value> = { level, fn, event: event.slice(0, 60), t: new Date().toISOString() };
    for (const [key, value] of Object.entries(fields)) {
      if (ALLOWED.has(key) && value !== undefined) out[key] = clean(value);
    }
    sink(JSON.stringify(out));
  };
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}
