// One JSON object per line on stdout/stderr, so `docker logs` output can be filtered (jq) or shipped as is.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = Exclude<keyof typeof LEVELS, 'silent'>;

export type LogFields = Record<string, unknown>;

function write(level: Level, event: string, fields: LogFields = {}) {
  const configured = (process.env.LOG_LEVEL?.trim().toLowerCase() ?? 'info') as keyof typeof LEVELS;
  if (LEVELS[level] < (LEVELS[configured] ?? LEVELS.info)) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields?: LogFields) => write('debug', event, fields),
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
};

export function errorFields(e: unknown): LogFields {
  return e instanceof Error ? { error: e.message, stack: e.stack } : { error: String(e) };
}
