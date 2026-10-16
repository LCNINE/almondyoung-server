import { webcrypto } from 'node:crypto';
import { createRequestId } from './request-id';

describe('request IDs on an HTTP mobile origin', () => {
  const originalCrypto = global.crypto;

  afterEach(() => {
    Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto });
  });

  it('creates distinct UUID v4 IDs when randomUUID is unavailable', () => {
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
    });
    const ids = Array.from({ length: 100 }, () => createRequestId());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(
      true,
    );
  });
});
