/** @jest-environment jsdom */

import { installBrowserTracePropagation } from '@packages/web-observability/browser';

const sent: (HeadersInit | undefined)[] = [];
const traceparentOf = (headers: HeadersInit | undefined) =>
  headers instanceof Headers ? headers.get('traceparent') : null;

beforeAll(() => {
  Object.defineProperty(window, 'Request', {
    configurable: true,
    writable: true,
    value: class {},
  });
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    writable: true,
    value: jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(init?.headers);
    }),
  });
  installBrowserTracePropagation();
});

beforeEach(() => {
  sent.length = 0;
});

it('adds traceparent to same-origin API calls', async () => {
  await window.fetch('/api/proxy/core/inventory/skus');

  expect(traceparentOf(sent[0])).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

it('leaves public file requests plain because they redirect to another origin', async () => {
  await window.fetch('/api/proxy/file/files/public/abc', { cache: 'no-store' });

  expect(traceparentOf(sent[0])).toBeNull();
});
