import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { armShutdownDeadline } from './shutdown-deadline';

describe('armShutdownDeadline', () => {
  let source: EventEmitter;
  let exit: jest.Mock;
  let disarm: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    source = new EventEmitter();
    exit = jest.fn();
    disarm = armShutdownDeadline(
      ['SIGINT', 'SIGTERM'],
      10_000,
      exit,
      source as unknown as NodeJS.Process,
    );
  });

  afterEach(() => {
    disarm();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does nothing without a signal', () => {
    jest.advanceTimersByTime(60_000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits with code 1 when shutdown is still running after the timeout', () => {
    source.emit('SIGINT', 'SIGINT');
    jest.advanceTimersByTime(9_999);
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('counts from the first signal; repeated signals neither restart nor shorten it', () => {
    source.emit('SIGINT', 'SIGINT');
    jest.advanceTimersByTime(4_000);
    // nest start --watch: the same Ctrl+C arrives again via the CLI.
    source.emit('SIGINT', 'SIGINT');
    source.emit('SIGTERM', 'SIGTERM');
    jest.advanceTimersByTime(5_999);
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners and timer when disarmed', () => {
    source.emit('SIGTERM', 'SIGTERM');
    disarm();
    jest.advanceTimersByTime(60_000);
    expect(exit).not.toHaveBeenCalled();
    expect(source.listenerCount('SIGINT')).toBe(0);
  });
});
