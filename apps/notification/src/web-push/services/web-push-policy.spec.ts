import { validateSubscription, safeAttendanceUrl } from './web-push-policy';

describe('Web Push boundaries', () => {
  const keys = { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };

  it('accepts known browser push providers', () => {
    expect(() => validateSubscription({ endpoint: 'https://web.push.apple.com/token', keys })).not.toThrow();
  });

  it.each([
    'http://fcm.googleapis.com/token',
    'https://127.0.0.1/token',
    'https://fcm.googleapis.com.evil.test/token',
    'https://fcm.googleapis.com:8443/token',
  ])('rejects unsafe push endpoint %s', (endpoint) => {
    expect(() => validateSubscription({ endpoint, keys })).toThrow();
  });

  it('rejects malformed subscription encryption keys', () => {
    expect(() =>
      validateSubscription({ endpoint: 'https://fcm.googleapis.com/token', keys: { auth: 'x', p256dh: 'x' } }),
    ).toThrow();
  });

  it('keeps notification links on attendance pages', () => {
    expect(safeAttendanceUrl('/attendance')).toBe('/attendance');

    expect(safeAttendanceUrl('/company/attendance/requests')).toBe('/company/attendance/requests');

    expect(() => safeAttendanceUrl('//evil.test')).toThrow();

    expect(() => safeAttendanceUrl('/attendance/../users')).toThrow();
  });
});
