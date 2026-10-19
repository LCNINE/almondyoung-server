import {
  clearPiiNotices,
  consumeReveal,
  markReveal,
  parsePiiHeaders,
  piiBannerText,
  piiNotices,
  reportPiiResponse,
  subscribePiiNotices,
} from './pii-notices';

const headers = (values: Record<string, string>) => (name: string) => values[name];

describe('parsePiiHeaders', () => {
  it('parses pii headers into meta', () => {
    expect(
      parsePiiHeaders(
        headers({ 'x-pii-masked': 'name,phone', 'x-pii-mask-reason': 'no-permission', 'x-pii-redacted': 'deltas', 'x-pii-revealable': '1' }),
      ),
    ).toEqual({ maskedKinds: ['name', 'phone'], reason: 'no-permission', redactedPaths: ['deltas'], revealable: true });
  });

  it('treats a missing or none header as not masked', () => {
    expect(parsePiiHeaders(headers({}))).toBeNull();
    expect(parsePiiHeaders(headers({ 'x-pii-masked': 'none' }))).toBeNull();
  });
});

describe('pii notices', () => {
  beforeEach(() => clearPiiNotices());

  it('keeps one notice per request url and tells subscribers', () => {
    const listener = jest.fn();
    const unsubscribe = subscribePiiNotices(listener);
    reportPiiResponse('/api/proxy/core/sales-orders/1', { maskedKinds: ['name'], reason: 'no-permission', redactedPaths: [], revealable: false });
    reportPiiResponse('/api/proxy/core/sales-orders/1', { maskedKinds: ['name'], reason: 'no-permission', redactedPaths: [], revealable: false });
    expect(piiNotices()).toHaveLength(1);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it('forgets a url once it answers unmasked', () => {
    reportPiiResponse('/a', { maskedKinds: ['name'], reason: 'reveal-required', redactedPaths: [], revealable: true });
    reportPiiResponse('/a', null);
    expect(piiNotices()).toEqual([]);
  });

  it('adds the reveal header to the next request of a marked url only once', () => {
    markReveal(['/a']);
    expect(consumeReveal('/a')).toBe(true);
    expect(consumeReveal('/a')).toBe(false);
    expect(consumeReveal('/b')).toBe(false);
  });
});

describe('piiBannerText', () => {
  it('says why values are hidden without blurring them into empty values', () => {
    expect(piiBannerText([{ url: '/a', maskedKinds: ['name'], reason: 'no-permission', redactedPaths: [], revealable: false }])).toBe(
      '이 화면의 개인정보 일부가 가려져 있습니다 — 개인정보 보기 권한이 없습니다.',
    );
    expect(piiBannerText([{ url: '/a', maskedKinds: ['name'], reason: 'unavailable', redactedPaths: [], revealable: false }])).toBe(
      '이 화면의 개인정보 일부가 가려져 있습니다 — 권한을 확인하지 못했습니다(잠시 뒤 다시 시도).',
    );
    expect(piiBannerText([{ url: '/a', maskedKinds: ['name'], reason: 'reveal-required', redactedPaths: [], revealable: true }])).toBe(
      '이 화면의 개인정보 일부가 가려져 있습니다 — [보기]를 누르면 원문이 열리고 열람 기록이 남습니다.',
    );
    expect(piiBannerText([])).toBeNull();
  });
});
