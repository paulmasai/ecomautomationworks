import type { AppConfig } from "../config/env";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogValue = boolean | number | string | null | undefined;
type LogContext = Readonly<Record<string, LogValue>>;

const levels: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const forbiddenKey = /authorization|cookie|message_text|phone|secret|token|body|payload/i;

function sanitize(context: LogContext): Record<string, Exclude<LogValue, undefined>> {
  return Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) => {
      if (value === undefined) return [];
      if (forbiddenKey.test(key)) return [[key, "[REDACTED]"]];
      return [[key, value]];
    }),
  );
}

export interface Logger {
  debug(operation: string, context?: LogContext): void;
  info(operation: string, context?: LogContext): void;
  warn(operation: string, context?: LogContext): void;
  error(operation: string, context?: LogContext): void;
}

export function createLogger(
  config: Pick<AppConfig, "ENVIRONMENT" | "LOG_LEVEL">,
  baseContext: LogContext = {},
): Logger {
  const write = (level: LogLevel, operation: string, context: LogContext = {}) => {
    if (levels[level] < levels[config.LOG_LEVEL]) return;

    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      environment: config.ENVIRONMENT,
      operation,
      ...sanitize(baseContext),
      ...sanitize(context),
    });

    if (level === "error") console.error(record);
    else if (level === "warn") console.warn(record);
    else console.log(record);
  };

  return {
    debug: (operation, context) => write("debug", operation, context),
    info: (operation, context) => write("info", operation, context),
    warn: (operation, context) => write("warn", operation, context),
    error: (operation, context) => write("error", operation, context),
  };
}
