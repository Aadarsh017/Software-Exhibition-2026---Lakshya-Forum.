// Server-sent events. One writer per response. A comment line goes out first (so proxies that wait
// for the first bytes flush at once) and then every `heartbeatMs`, so idle connections stay open
// while the slow steps run. If the browser goes away, `send` becomes a no-op and `closed` is true;
// the turn itself keeps going so the answer is still saved.

export type SseWriter = {
  send(event: string, data: unknown): boolean;
  close(): void;
  readonly closed: boolean;
};

export function createSse(options: { heartbeatMs?: number } = {}): { stream: ReadableStream<Uint8Array>; writer: SseWriter } {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const write = (text: string): boolean => {
    if (closed || !controller) return false;
    try {
      controller.enqueue(encoder.encode(text));
      return true;
    } catch {
      finish();
      return false;
    }
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    try {
      controller?.close();
    } catch {
      // already closed or cancelled
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      write(": connected\n\n");
      heartbeat = setInterval(() => write(": ping\n\n"), options.heartbeatMs ?? 15_000);
    },
    cancel() {
      closed = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  });

  const writer: SseWriter = {
    send(event, data) {
      return write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close: finish,
    get closed() {
      return closed;
    },
  };
  return { stream, writer };
}

export function sseResponse(stream: ReadableStream<Uint8Array>, headers: Record<string, string>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
