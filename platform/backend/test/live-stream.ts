// Reads /api/stream with fetch and parses it into events (shared by the e2e specs).

export interface SseEvent {
  type: string;
  data: unknown;
}

/** An open /api/stream response, parsed into events as they arrive. */
export interface LiveStream {
  events: SseEvent[];
  /** Resolves when the server ends the response ('completed') or it breaks. */
  ended: Promise<'completed' | 'cut off'>;
  /** The first event of `type` at or after index `from`. */
  waitFor(type: string, timeoutMs?: number, from?: number): Promise<SseEvent>;
  close(): void;
}

export async function openStream(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<LiveStream> {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}/api/stream`, {
    headers,
    signal: abort.signal,
  });
  expect(response.status).toBe(200);

  const events: SseEvent[] = [];
  const ended = (async () => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return 'completed' as const;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let type: string | undefined;
        let data: string | undefined;
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          if (line.startsWith('data:')) data = line.slice(5).trim();
        }
        if (type) {
          events.push({ type, data: data ? JSON.parse(data) : undefined });
        }
      }
    }
  })().catch(() => 'cut off' as const);

  const waitFor = async (type: string, timeoutMs = 2_000, from = 0) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const event = events.slice(from).find((e) => e.type === type);
      if (event) return event;
      if (Date.now() > deadline) {
        throw new Error(
          `no ${type} event within ${timeoutMs} ms; got: ${events.map((e) => e.type).join(', ')}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  // Every stream starts with the snapshot.
  await waitFor('snapshot');
  return { events, ended, waitFor, close: () => abort.abort() };
}
