// ---------------------------------------------------------------------------
// postalservice — progress tracking via ReadableStream wrapping
// ---------------------------------------------------------------------------

import type { ProgressEvent } from './types.js';

/**
 * Wrap a ReadableStream to count bytes and emit progress events.
 *
 * - If totalBytes is provided, `total` and `percent` are included.
 * - Emits a terminal event even when stream is empty.
 */
export function wrapReadableStream(
  stream: ReadableStream<Uint8Array>,
  totalBytes: number | undefined,
  onProgress: (event: ProgressEvent) => void,
): ReadableStream<Uint8Array> {
  let loaded = 0;
  let emittedTerminal = false;

  const transformer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      controller.enqueue(chunk);
      emitProgress(loaded, totalBytes, onProgress);
    },
    flush() {
      // Emit a terminal event — even if no data was read (empty stream)
      if (!emittedTerminal) {
        emittedTerminal = true;
        emitProgress(loaded, totalBytes, onProgress);
      }
    },
  });

  return stream.pipeThrough(transformer);
}

function emitProgress(
  loaded: number,
  total: number | undefined,
  onProgress: (event: ProgressEvent) => void,
): void {
  const event: ProgressEvent = { loaded };
  if (total !== undefined) {
    event.total = total;
    event.percent = total > 0 ? Math.round((loaded / total) * 100) : 100;
  }
  onProgress(event);
}
