import { decode, verify } from 'jsonwebtoken';
import { signFileServiceDelegation } from './file-service-delegation';

describe('signFileServiceDelegation', () => {
  it('signs an on-behalf-of token addressed to file-service', () => {
    const token = signFileServiceDelegation('secret', 'u1', '1m');
    expect(verify(token, 'secret', { algorithms: ['HS256'] })).toMatchObject({
      sub: 'u1',
      act: { sub: 'core' },
      aud: 'file-service',
    });
  });

  it('carries no role or scope claims', () => {
    const payload = decode(signFileServiceDelegation('secret', 'u1', '5m'), { json: true });
    expect(payload).not.toHaveProperty('scopes');
    expect(payload).not.toHaveProperty('roles');
    expect(payload).not.toHaveProperty('userId');
  });

  it('expires after the given lifetime', () => {
    const payload = decode(signFileServiceDelegation('secret', 'u1', '5m'), { json: true });
    expect((payload?.exp ?? 0) - (payload?.iat ?? 0)).toBe(300);
  });
});
