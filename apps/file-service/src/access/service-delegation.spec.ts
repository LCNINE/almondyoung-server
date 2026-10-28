import { DelegationClaims, delegationOf } from './service-delegation';

const UGC_SUBJECT = '00000000-0000-4000-8000-000000a1d001';

const token = (claims: DelegationClaims): DelegationClaims => ({ userId: 'u1', roles: [], ...claims });

describe('delegationOf', () => {
  it('reads an on-behalf-of token from core', () => {
    expect(delegationOf(token({ act: { sub: 'core' }, aud: 'file-service' }))).toEqual({
      delegate: 'core',
      notation: 'standard',
    });
  });

  it('reads a service-only token from ugc', () => {
    expect(delegationOf(token({ userId: UGC_SUBJECT, client_id: 'ugc-service', aud: ['file-service'] }))).toEqual({
      delegate: 'ugc-service',
      notation: 'standard',
    });
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
  });

  it('still reads the legacy master-scope token', () => {
    expect(delegationOf(token({ userId: 'core-library-service', scopes: ['master'] }))).toEqual({
      delegate: 'core',
      notation: 'legacy',
    });
    expect(delegationOf(token({ userId: 'u1', scopes: ['master'] }))).toEqual({ delegate: 'core', notation: 'legacy' });
    expect(delegationOf(token({ userId: UGC_SUBJECT, scopes: ['master'] }))).toEqual({
      delegate: 'ugc-service',
      notation: 'legacy',
    });
  });

  it('keeps the legacy reading on a master-scope token that also names file-service', () => {
    expect(delegationOf(token({ scopes: ['master'], aud: 'file-service' }))).toEqual({
      delegate: 'core',
      notation: 'legacy',
    });
    expect(delegationOf(token({ scopes: ['master'], aud: 'file-service', client_id: 'search' }))).toEqual({
      delegate: 'core',
      notation: 'legacy',
    });
  });

  it('reads malformed role and scope claims the way the legacy check did, without throwing', () => {
    expect(delegationOf(token({ roles: {}, scopes: ['master'] }))).toBeNull();
    expect(delegationOf(token({ roles: 1, scopes: ['master'] }))).toBeNull();
    expect(delegationOf(token({ scopes: 123 }))).toBeNull();
    expect(delegationOf(token({ roles: {}, act: { sub: 'core' }, aud: 'file-service' }))).toBeNull();
  });

  it('keeps the legacy reading for empty role values the legacy check accepted', () => {
    expect(delegationOf(token({ roles: '', scopes: ['master'] }))).toEqual({ delegate: 'core', notation: 'legacy' });
    expect(delegationOf(token({ roles: { length: 0 }, scopes: ['master'] }))).toEqual({
      delegate: 'core',
      notation: 'legacy',
    });
  });

  it('no longer reads a scope string that merely contains master', () => {
    expect(delegationOf(token({ scopes: 'master' }))).toBeNull();
    expect(delegationOf(token({ scopes: 'xmasterx' }))).toBeNull();
  });

  it('returns null for a person token', () => {
    expect(delegationOf(token({ roles: ['admin'] }))).toBeNull();
    expect(delegationOf(token({ roles: ['master'], scopes: ['master'] }))).toBeNull();
    expect(delegationOf(token({}))).toBeNull();
  });
});
