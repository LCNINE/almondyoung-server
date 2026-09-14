import { readSseData } from './sse';

describe('SSE frame decoding', () => {
  it('decodes Korean UTF-8 split at every byte and CRLF/data lines', async () => {
    const bytes = new TextEncoder().encode(
      ': ping\r\nevent: delta\r\ndata: 안녕\r\ndata: 하세요\r\n\r\ndata: done\n\n',
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const data of readSseData(body)) events.push(data);
    expect(events).toEqual(['안녕\n하세요', 'done']);
  });
  it('does not treat a truncated final event as complete', async () => {
    const body = new Response('data: {"type":"done"}').body!;
    const events: string[] = [];
    for await (const data of readSseData(body)) events.push(data);
    expect(events).toEqual([]);
  });
});
