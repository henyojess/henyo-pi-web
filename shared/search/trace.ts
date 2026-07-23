import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Trace logging configuration.
 * - `true`: trace all providers
 * - `string[]`: trace only specified provider names
 * - `undefined` or `false`: no trace logging
 */
export type TraceConfig = boolean | string[];

/** Default trace log path */
const DEFAULT_TRACE_LOG = path.join('/tmp', 'henyo-trace.log');

/** Default max log file size in bytes (10MB) */
const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024;

/** Default number of backup files to keep */
const DEFAULT_MAX_BACKUPS = 3;

interface TraceEntry {
  timestamp: string;
  provider: string;
  query: string;
  durationMs: number;
  resultCount: number;
  error?: string;
  instance?: string;
}

/**
 * Write a trace log entry.
 * Logs to /tmp/henyo-trace.log with rotation.
 */
export function traceLog(entry: Omit<TraceEntry, 'timestamp'>): void {
  const logEntry: TraceEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  const logLine = `[${logEntry.timestamp}] ${logEntry.provider} query="${logEntry.query}" duration=${logEntry.durationMs}ms results=${logEntry.resultCount}${logEntry.error ? ` error="${logEntry.error}"` : ''}${logEntry.instance ? ` instance="${logEntry.instance}"` : ''}\n`;

  try {
    rotateLog();
    fs.appendFileSync(DEFAULT_TRACE_LOG, logLine, 'utf-8');
  } catch {
    // Silently fail — trace logging should never break the extension
  }
}

/**
 * Rotate the log file if it exceeds the max size.
 * Keeps up to DEFAULT_MAX_BACKUPS backup files.
 */
function rotateLog(): void {
  try {
    if (!fs.existsSync(DEFAULT_TRACE_LOG)) return;

    const stats = fs.statSync(DEFAULT_TRACE_LOG);
    if (stats.size < DEFAULT_MAX_LOG_SIZE) return;

    // Rotate: .1 -> .2 -> .3, delete .3 if exists
    for (let i = DEFAULT_MAX_BACKUPS; i >= 1; i--) {
      const src = i === 1 ? DEFAULT_TRACE_LOG : `${DEFAULT_TRACE_LOG}.${i - 1}`;
      const dst = `${DEFAULT_TRACE_LOG}.${i}`;

      if (i === 1) {
        // Move current log to .1
        if (fs.existsSync(DEFAULT_TRACE_LOG)) {
          fs.renameSync(DEFAULT_TRACE_LOG, dst);
        }
      } else {
        // Shift backups
        const prev = `${DEFAULT_TRACE_LOG}.${i - 1}`;
        if (fs.existsSync(prev)) {
          fs.renameSync(prev, dst);
        }
      }

      // Delete oldest if beyond max backups
      if (i > DEFAULT_MAX_BACKUPS && fs.existsSync(dst)) {
        fs.unlinkSync(dst);
      }
    }
  } catch {
    // Silently fail — rotation should never break the extension
  }
}

/**
 * Check if a provider should be traced.
 * @param config Trace configuration (true, string[], or undefined)
 * @param providerName Provider name to check
 * @returns true if the provider should be traced
 */
export function shouldTrace(config: TraceConfig | undefined, providerName: string): boolean {
  if (config === true) return true;
  if (Array.isArray(config)) return config.includes(providerName);
  return false;
}

/**
 * Clear the trace log file.
 */
export function clearTraceLog(): void {
  try {
    if (fs.existsSync(DEFAULT_TRACE_LOG)) {
      fs.unlinkSync(DEFAULT_TRACE_LOG);
    }
  } catch {
    // Silently fail
  }
}

/**
 * Read the trace log contents.
 */
export function readTraceLog(): string {
  try {
    if (!fs.existsSync(DEFAULT_TRACE_LOG)) return '';
    return fs.readFileSync(DEFAULT_TRACE_LOG, 'utf-8');
  } catch {
    return '';
  }
}