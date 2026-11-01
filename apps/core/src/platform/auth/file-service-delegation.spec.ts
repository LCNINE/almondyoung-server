import { decode, verify } from 'jsonwebtoken';
import { signFileServiceDelegation } from './file-service-delegation';

describe('signFileServiceDelegation', () => {
  it('signs an on-behalf-of token addressed to file-service', () => {
    const token = signFileServiceDelegation('secret', 'u1', '1m', '2');
    expect(verify(token, 'secret', { algorithms: ['HS256'] })).toMatchObject({
      sub: 'u1',
      act: { sub: 'core' },
      aud: 'file-service',
    });
  });

  it('carries the context tenant — file-service picks the bucket and opens exceptions only for that tenant', () => {
    expect(decode(signFileServiceDelegation('secret', 'u1', '1m', '2'), { json: true })).toMatchObject({ tenant: '2' });
  });

  it('omits the tenant claim when the context has none (deployment ① only — never a default tenant)', () => {
    expect(decode(signFileServiceDelegation('secret', 'u1', '1m', undefined), { json: true })).not.toHaveProperty(
      'tenant',
    );
  });

  it('carries no role or scope claims', () => {
    const payload = decode(signFileServiceDelegation('secret', 'u1', '5m', '2'), { json: true });
    expect(payload).not.toHaveProperty('scopes');
    expect(payload).not.toHaveProperty('roles');
    expect(payload).not.toHaveProperty('userId');
  });

  it('expires after the given lifetime', () => {
    const payload = decode(signFileServiceDelegation('secret', 'u1', '5m', '2'), { json: true });
    expect((payload?.exp ?? 0) - (payload?.iat ?? 0)).toBe(300);
  });
});
