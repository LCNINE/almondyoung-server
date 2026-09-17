import { parsePracticeFile, practiceEndpoint } from './prepare-practice';
describe('practice CLI safety boundary', () => {
  const env = { APP_STAGE: 'demo', EXTERNAL_INTEGRATIONS_MODE: 'mock' };
  it('only sends credentials to the exact demo origin', () => {
    expect(practiceEndpoint(env)).toBe('https://core.almondyoung-next.com/demo/practice');
    for (const url of [
      'https://core.example.com',
      'https://core.almondyoung-next.com.evil.example',
      'http://core.almondyoung-next.com',
      'https://user:secret@core.almondyoung-next.com',
    ]) {
      expect(() => practiceEndpoint({ ...env, DEMO_CORE_URL: url })).toThrow();
    }
    expect(() => practiceEndpoint({ ...env, APP_STAGE: 'live' })).toThrow();
  });
  it('requires an explicit stable request identity and rejects duplicate physical quantities', () => {
    const line = { skuId: '11111111-1111-4111-8111-111111111111', quantity: 20 };
    expect(() => parsePracticeFile({ items: [line] })).toThrow();
    expect(() => parsePracticeFile({ requestId: line.skuId, items: [line, line] })).toThrow();
    expect(parsePracticeFile({ requestId: line.skuId, items: [line] }).prepareDemand).toBe(false);
  });
});
