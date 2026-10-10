import { vi } from 'vitest';

// jsdom has no layout: every element measures 0×0, so Recharts' responsive
// container would never draw the chart. Give elements a fixed size and make
// ResizeObserver report it, like a browser does after the first layout.

export const CHART_WIDTH = 800;
export const CHART_HEIGHT = 360;

export function installDomShims(): void {
  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const entry = {
        target,
        contentRect: { width: CHART_WIDTH, height: CHART_HEIGHT, top: 0, left: 0, bottom: CHART_HEIGHT, right: CHART_WIDTH, x: 0, y: 0 },
        borderBoxSize: [{ inlineSize: CHART_WIDTH, blockSize: CHART_HEIGHT }],
        contentBoxSize: [{ inlineSize: CHART_WIDTH, blockSize: CHART_HEIGHT }],
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    top: 0,
    left: 0,
    bottom: CHART_HEIGHT,
    right: CHART_WIDTH,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  for (const prop of ['clientWidth', 'offsetWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => CHART_WIDTH });
  }
  for (const prop of ['clientHeight', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => CHART_HEIGHT });
  }

  // Mantine reads the color scheme preference.
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

// Node's setImmediate, which vi.useFakeTimers({ toFake: [...timers] }) leaves real.
// (The app tsconfig has no Node types, hence the cast.)
const realSetImmediate = (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate;

/** Lets real async work finish (e.g. undici parsing a fetch Response body) while timers are fake. */
export async function flushRealTasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => realSetImmediate(resolve));
  }
}
