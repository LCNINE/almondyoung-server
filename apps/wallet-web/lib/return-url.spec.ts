import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  const prevSuffixes = process.env.ALLOWED_RETURN_HOST_SUFFIXES;
  const prevOrigins = process.env.WALLET_ALLOWED_RETURN_ORIGINS;

  afterEach(() => {
    process.env.ALLOWED_RETURN_HOST_SUFFIXES = prevSuffixes;
    process.env.WALLET_ALLOWED_RETURN_ORIGINS = prevOrigins;
  });

  it('allows relative paths but blocks protocol-relative and non-http schemes', () => {
    expect(safeReturnUrl('/kr/mypage/membership/payment-method')).toBe(
      '/kr/mypage/membership/payment-method',
    );
    expect(safeReturnUrl('//evil.com')).toBe('/');
    expect(safeReturnUrl('javascript:alert(1)')).toBe('/');
    expect(safeReturnUrl('data:text/html,<script>1</script>')).toBe('/');
  });

  it('blocks backslash protocol-relative bypass that URL parsers normalize to //host', () => {
    expect(safeReturnUrl('/\\evil.com')).toBe('/');
    expect(safeReturnUrl('/\\/evil.com')).toBe('/');
    expect(safeReturnUrl('//\\evil.com')).toBe('/');
  });

  it('fails closed for cross-origin when no allowlist env is configured', () => {
    delete process.env.ALLOWED_RETURN_HOST_SUFFIXES;
    delete process.env.WALLET_ALLOWED_RETURN_ORIGINS;
    expect(safeReturnUrl('https://almondyoung.com/kr/mypage')).toBe('/');
  });

  it('allows configured host suffixes (apex + subdomain), incl. multi-part TLDs', () => {
    process.env.ALLOWED_RETURN_HOST_SUFFIXES = '.almondyoung.com,.almondyoung.co.kr';
    expect(safeReturnUrl('https://almondyoung.com/kr/mypage')).toBe('https://almondyoung.com/kr/mypage');
    expect(safeReturnUrl('https://www.almondyoung.com/kr')).toBe('https://www.almondyoung.com/kr');
    expect(safeReturnUrl('https://shop.almondyoung.co.kr/kr')).toBe('https://shop.almondyoung.co.kr/kr');
  });

  it('blocks look-alike hosts and public-suffix siblings even with suffixes set', () => {
    process.env.ALLOWED_RETURN_HOST_SUFFIXES = '.almondyoung.com,.almondyoung.co.kr';
    expect(safeReturnUrl('https://evilalmondyoung.com/x')).toBe('/');
    expect(safeReturnUrl('https://almondyoung.com.evil.com/x')).toBe('/');
    expect(safeReturnUrl('https://evil.co.kr/x')).toBe('/');
    expect(safeReturnUrl('https://evil.com/x')).toBe('/');
  });

  it('allows exact origins from WALLET_ALLOWED_RETURN_ORIGINS', () => {
    process.env.WALLET_ALLOWED_RETURN_ORIGINS = 'http://localhost:8001';
    expect(safeReturnUrl('http://localhost:8001/kr/mypage')).toBe('http://localhost:8001/kr/mypage');
    expect(safeReturnUrl('http://localhost:9999/x')).toBe('/');
  });

  it('falls back on empty or malformed input', () => {
    expect(safeReturnUrl(undefined)).toBe('/');
    expect(safeReturnUrl(null)).toBe('/');
    expect(safeReturnUrl('')).toBe('/');
    expect(safeReturnUrl('not a url')).toBe('/');
  });
});
