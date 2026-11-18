import { sanitizeInternalRedirect } from './internal-redirect';

describe('sanitizeInternalRedirect', () => {
  it.each([
    ['/pay/intent-1?region=kr', '/pay/intent-1?region=kr'],
    ['/billing-change?returnUrl=https%3A%2F%2Fshop.example%2Fkr', '/billing-change?returnUrl=https%3A%2F%2Fshop.example%2Fkr'],
  ])('keeps internal path %s', (input, expected) => {
    expect(sanitizeInternalRedirect(input)).toBe(expected);
  });

  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\\/evil.example', '\\evil.example'])(
    'rejects %p',
    (input) => {
      expect(sanitizeInternalRedirect(input)).toBe('/');
    },
  );
});
