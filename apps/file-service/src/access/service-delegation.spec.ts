import { DelegationClaims, delegationOf } from './service-delegation';

const token = (claims: DelegationClaims): DelegationClaims => ({ roles: [], ...claims });

describe('delegationOf', () => {
  it('reads an on-behalf-of token from core', () => {
    expect(delegationOf(token({ act: { sub: 'core' }, aud: 'file-service' }))).toBe('core');
  });

  it('reads a service-only token from ugc', () => {
    expect(delegationOf(token({ client_id: 'ugc-service', aud: ['file-service'] }))).toBe('ugc-service');
  });

  it('ignores a standard token addressed to another service', () => {
    expect(delegationOf(token({ act: { sub: 'core' }, aud: 'core' }))).toBeNull();
    expect(delegationOf(token({ act: { sub: 'core' } }))).toBeNull();
  });

  it('ignores an unknown delegate', () => {
    expect(delegationOf(token({ act: { sub: 'search' }, aud: 'file-service' }))).toBeNull();
    expect(delegationOf(token({ client_id: 'search', aud: 'file-service' }))).toBeNull();
    expect(delegationOf(token({ act: { sub: 42 }, aud: 'file-service' }))).toBeNull();
  });

  it('ignores a delegation claim on a token that carries roles', () => {
    expect(delegationOf(token({ roles: ['admin'], act: { sub: 'core' }, aud: 'file-service' }))).toBeNull();
    expect(delegationOf(token({ roles: {}, act: { sub: 'core' }, aud: 'file-service' }))).toBeNull();
  });

  it('rejects a token without the file-service audience', () => {
    expect(delegationOf(token({ client_id: 'ugc-service' }))).toBeNull();
  });

  it('returns null for a person token', () => {
    expect(delegationOf(token({ roles: ['admin'] }))).toBeNull();
    expect(delegationOf(token({}))).toBeNull();
  });
});
