import { isVouchedByAuthWeb, vouchedSiteTenant } from './vouched-site-tenant';

describe('auth-web 이 보증한 화면 테넌트', () => {
  const secret = 'internal-secret';

  it('reads the tenant only when the internal secret matches', () => {
    expect(vouchedSiteTenant({ 'x-tenant-id': '2', 'x-internal-secret': secret }, secret)).toBe('2');
    expect(vouchedSiteTenant({ 'x-tenant-id': '2', 'x-internal-secret': 'guess' }, secret)).toBeUndefined();
    expect(vouchedSiteTenant({ 'x-tenant-id': '2' }, secret)).toBeUndefined();
  });

  it('ignores the headers when this server has no secret configured', () => {
    expect(vouchedSiteTenant({ 'x-tenant-id': '2', 'x-internal-secret': '' }, undefined)).toBeUndefined();
    expect(isVouchedByAuthWeb({ 'x-internal-secret': '' }, '')).toBe(false);
  });

  it('gives nothing for a vouched request that names no tenant', () => {
    expect(vouchedSiteTenant({ 'x-internal-secret': secret }, secret)).toBeUndefined();
    expect(vouchedSiteTenant({ 'x-tenant-id': '  ', 'x-internal-secret': secret }, secret)).toBeUndefined();
  });

  it('does not accept a repeated secret header', () => {
    expect(isVouchedByAuthWeb({ 'x-internal-secret': [secret, secret] }, secret)).toBe(false);
  });
});
