import { TENANT_ONE_ONLY_UPSTREAMS, unavailableUpstreamsOf } from './shell-brand';

describe('unavailableUpstreamsOf — the shell tells the body which upstreams it cannot call', () => {
  it('lets the existing shell use every upstream', () => {
    expect([...unavailableUpstreamsOf({ kind: 'default' })]).toEqual([]);
  });

  it('closes every tenant-1-only upstream in the tenant shell', () => {
    const closed = unavailableUpstreamsOf({ kind: 'tenant', displayName: '리허설 상사', logoUrl: null });
    expect([...closed].sort()).toEqual([...TENANT_ONE_ONLY_UPSTREAMS].sort());
    expect(closed.has('medusa')).toBe(true);
    expect(closed.has('channel-adapter')).toBe(true);
  });

  it('closes them on the neutral page too — no tenant is known there', () => {
    expect(unavailableUpstreamsOf({ kind: 'neutral' }).size).toBe(TENANT_ONE_ONLY_UPSTREAMS.length);
  });
});
