/** Incrementally decode SSE data frames, including split UTF-8 and CRLF boundaries. */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 131_072) throw new Error('SSE frame too large');
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
          if (data.reduce((sum, value) => sum + value.length, 0) > 131_072) throw new Error('SSE frame too large');
        }
      }
      if (chunk.done) break;
    }
    // An unterminated last frame is not a completed event.
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
