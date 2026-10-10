import { Logger } from '@nestjs/common';

type SignalSource = Pick<NodeJS.Process, 'on' | 'removeListener'>;

/**
 * Puts an upper bound on graceful shutdown: on the first shutdown signal a
 * timer starts, and if the process is still alive when it fires, it exits
 * with code 1. The timer is unref'd, so a shutdown that finishes in time is
 * never delayed by it.
 *
 * Repeated signals do not restart or shorten the timer: under `nest start
 * --watch` a single Ctrl+C reaches the app twice (once from the terminal, once
 * forwarded by the CLI), so "second signal = exit now" would skip the graceful
 * shutdown entirely.
 *
 * Returns a function that removes the signal listeners and the timer.
 */
export function armShutdownDeadline(
  signals: readonly NodeJS.Signals[],
  timeoutMs: number,
  exit: (code: number) => void = (code) => process.exit(code),
  source: SignalSource = process,
): () => void {
  const logger = new Logger('Shutdown');
  let timer: NodeJS.Timeout | undefined;

  const onSignal = (signal: NodeJS.Signals) => {
    if (timer) return;
    timer = setTimeout(() => {
      logger.error(
        `shutdown after ${signal} did not finish within ${timeoutMs} ms; exiting`,
      );
      exit(1);
    }, timeoutMs);
    timer.unref();
  };

  signals.forEach((signal) => source.on(signal, onSignal));
  return () => {
    clearTimeout(timer);
    signals.forEach((signal) => source.removeListener(signal, onSignal));
  };
}
