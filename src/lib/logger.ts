import { config } from "./config";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const SECRET_KEYS = /(api[_-]?key|token|secret|password|authorization|bearer)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+)/g;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") {
    let s = value.replace(SECRET_VALUE, "[redacted]");
    for (const [name, v] of Object.entries(process.env)) {
      if (v && v.length >= 12 && SECRET_KEYS.test(name) && s.includes(v)) {
        s = s.split(v).join("[redacted]");
      }
    }
    return s;
  }
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function log(level: Level, scope: string, msg: string, meta?: unknown) {
  const min = LEVELS[(config.logLevel as Level) in LEVELS ? (config.logLevel as Level) : "info"];
  if (LEVELS[level] < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${redact(msg)}`;
  const extra = meta === undefined ? "" : " " + JSON.stringify(redact(meta));
  if (level === "error") console.error(line + extra);
  else if (level === "warn") console.warn(line + extra);
  else console.log(line + extra);
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, meta?: unknown) => log("debug", scope, m, meta),
    info: (m: string, meta?: unknown) => log("info", scope, m, meta),
    warn: (m: string, meta?: unknown) => log("warn", scope, m, meta),
    error: (m: string, meta?: unknown) => log("error", scope, m, meta),
  };
}
