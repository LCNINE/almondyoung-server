import { describe, it, expect } from 'vitest';
import { createWorkScanQueue } from './workScanQueue';

describe('work scan queue', () => {
  it('preserves every scan and order while lookup is delayed', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((r) => {
      release = r;
    });
    const q = createWorkScanQueue<string>(async (code) => {
      await first;
      seen.push(code);
    });
    q.enqueue('A');
    q.enqueue('A');
    q.enqueue('B');
    expect(q.size()).toBe(3);
    release();
    await q.drain();
    expect(seen).toEqual(['A', 'A', 'B']);
    expect(q.size()).toBe(0);
  });
  it('retains failed input and blocks later input until retry succeeds', async () => {
    let fail = true;
    const seen: number[] = [];
    const q = createWorkScanQueue<number>(async (n) => {
      if (fail) throw new Error('offline');
      seen.push(n);
    });
    q.enqueue(1);
    q.enqueue(2);
    await expect(q.drain()).rejects.toThrow('offline');
    expect(q.size()).toBe(2);
    fail = false;
    await q.retryHead();
    await q.drain();
    expect(seen).toEqual([1, 2]);
  });
});
it('preserves one hundred consecutive physical inputs including repeated SKUs', async () => {
  const received: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const queue = createWorkScanQueue<string>(async (code) => {
    if (!received.length) await gate;
    received.push(code);
  });
  const input = Array.from({ length: 100 }, (_, i) =>
    i % 3 === 0 ? 'B' : 'A'
  );
  input.forEach((code) => queue.enqueue(code));
  expect(queue.size()).toBe(100);
  release();
  await queue.drain();
  expect(received).toEqual(input);
  expect(queue.size()).toBe(0);
});
