import { describe, it, expect, vi } from 'vitest';
import { wrapReadableStream } from './progress.js';

function createStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function consume(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

describe('wrapReadableStream', () => {
  it('counts bytes over synthetic stream', async () => {
    const chunk1 = new Uint8Array([1, 2, 3]); // 3 bytes
    const chunk2 = new Uint8Array([4, 5]);     // 2 bytes
    const events: Array<{ loaded: number; total?: number; percent?: number }> = [];

    const wrapped = wrapReadableStream(
      createStream([chunk1, chunk2]),
      5,
      (e) => events.push({ ...e }),
    );

    await consume(wrapped);

    expect(events).toHaveLength(3); // chunk1, chunk2, flush
    expect(events[0]!.loaded).toBe(3);
    expect(events[0]!.total).toBe(5);
    expect(events[0]!.percent).toBe(60);

    expect(events[1]!.loaded).toBe(5);
    expect(events[1]!.total).toBe(5);
    expect(events[1]!.percent).toBe(100);

    // terminal event
    expect(events[2]!.loaded).toBe(5);
    expect(events[2]!.percent).toBe(100);
  });

  it('emits terminal callback even when stream is empty', async () => {
    const events: Array<{ loaded: number }> = [];
    const wrapped = wrapReadableStream(
      createStream([]),
      undefined,
      (e) => events.push({ loaded: e.loaded }),
    );

    await consume(wrapped);

    expect(events).toHaveLength(1);
    expect(events[0]!.loaded).toBe(0);
  });

  it('omits total and percent when totalBytes is undefined', async () => {
    const events: Array<{ loaded: number; total?: number; percent?: number }> = [];
    const wrapped = wrapReadableStream(
      createStream([new Uint8Array([1, 2])]),
      undefined,
      (e) => events.push({ ...e }),
    );

    await consume(wrapped);

    // Should have loaded but no total/percent
    expect(events[0]!.loaded).toBe(2);
    expect(events[0]!.total).toBeUndefined();
    expect(events[0]!.percent).toBeUndefined();
  });

  it('preserves chunk data through the stream', async () => {
    const data = new Uint8Array([10, 20, 30, 40]);
    const wrapped = wrapReadableStream(
      createStream([data]),
      undefined,
      () => {},
    );

    const chunks = await consume(wrapped);
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!)).toEqual([10, 20, 30, 40]);
  });
});
