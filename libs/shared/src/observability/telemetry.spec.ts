import { shouldIgnoreIncomingRequest } from './telemetry';

describe('shouldIgnoreIncomingRequest', () => {
  it('/metrics 를 제외한다', () => {
    expect(shouldIgnoreIncomingRequest('/metrics')).toBe(true);
  });

  it('/metrics?foo=1 를 제외한다 (query string)', () => {
    expect(shouldIgnoreIncomingRequest('/metrics?foo=1')).toBe(true);
  });

  it('/health 는 포함한다 (범위 밖)', () => {
    expect(shouldIgnoreIncomingRequest('/health')).toBe(false);
  });

  it('/api/orders 는 포함한다', () => {
    expect(shouldIgnoreIncomingRequest('/api/orders')).toBe(false);
  });

  it('undefined 는 포함한다', () => {
    expect(shouldIgnoreIncomingRequest(undefined)).toBe(false);
  });
});
