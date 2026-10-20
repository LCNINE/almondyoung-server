import { staffClientOf } from './staff-client';

describe('staffClientOf', () => {
  it('reads the claimed ip and forwarded chain from the proxy headers', () => {
    expect(
      staffClientOf({
        headers: { 'x-staff-client-ip': '203.0.113.7', 'x-staff-forwarded-for': '198.51.100.1, 203.0.113.7' },
        ip: '10.0.0.5',
      }),
    ).toEqual({ claimedIp: '203.0.113.7', forwardedFor: '198.51.100.1, 203.0.113.7', peerIp: '10.0.0.5' });
  });

  it('falls back to null when headers are absent', () => {
    expect(staffClientOf({ headers: {} })).toEqual({ claimedIp: null, forwardedFor: null, peerIp: null });
  });

  it('returns the socket address as peer ip when the framework gives no ip', () => {
    expect(staffClientOf({ headers: {}, socket: { remoteAddress: '::1' } }).peerIp).toBe('::1');
  });

  it('ignores a claimed ip that is not an address', () => {
    expect(staffClientOf({ headers: { 'x-staff-client-ip': '<script>' } }).claimedIp).toBeNull();
  });

  it('cuts an oversized forwarded chain', () => {
    const long = Array.from({ length: 200 }, () => '198.51.100.1').join(', ');
    expect(staffClientOf({ headers: { 'x-staff-forwarded-for': long } }).forwardedFor?.length).toBe(500);
  });
});
