import { decode, verify } from 'jsonwebtoken';
import { ALMOND_PRINT_SERVICE_SUBJECT, mintServiceToken } from './service-token';

describe('mintServiceToken', () => {
  it('mints a service-only token addressed to file-service', () => {
    expect(verify(mintServiceToken('secret'), 'secret', { algorithms: ['HS256'] })).toMatchObject({
      sub: ALMOND_PRINT_SERVICE_SUBJECT,
      client_id: 'ugc-service',
      aud: 'file-service',
    });
  });

  it('keeps the subject the print files are uploaded under', () => {
    expect(ALMOND_PRINT_SERVICE_SUBJECT).toBe('00000000-0000-4000-8000-000000a1d001');
  });

  it('carries no scope claim and lives five minutes', () => {
    const payload = decode(mintServiceToken('secret'), { json: true });
    expect(payload).not.toHaveProperty('scopes');
    expect((payload?.exp ?? 0) - (payload?.iat ?? 0)).toBe(300);
  });
});
