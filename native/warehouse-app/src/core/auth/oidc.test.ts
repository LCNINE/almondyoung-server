import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl, parseCallback, discover } from './oidc';

const cfg = {
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
  clientId: 'warehouse-app',
  redirectUri: 'almondwms://oauth/callback',
  scope: 'openid profile email offline_access',
};

describe('buildAuthorizeUrl', () => {
  it('includes PKCE + response_type=code + nonce/state', () => {
    const url = new URL(
      buildAuthorizeUrl(cfg, {
        state: 'ST',
        nonce: 'NO',
        challenge: 'CH',
      })
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('warehouse-app');
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(url.searchParams.get('code_challenge')).toBe('CH');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('ST');
    expect(url.searchParams.get('nonce')).toBe('NO');
  });
});

describe('parseCallback', () => {
  it('extracts code and state', () => {
    const r = parseCallback('almondwms://oauth/callback?code=abc&state=ST');
    expect(r).toEqual({ code: 'abc', state: 'ST' });
  });
  it('throws on an error param', () => {
    expect(() =>
      parseCallback('almondwms://oauth/callback?error=access_denied')
    ).toThrow(/access_denied/);
  });
});

describe('discover', () => {
  it('reads the well-known document', async () => {
    const endpoints = {
      authorization_endpoint: 'https://a/authz',
      token_endpoint: 'https://a/token',
      userinfo_endpoint: 'https://a/userinfo',
      jwks_uri: 'https://a/jwks',
    };
    const getJson = async (u: string) => {
      expect(u).toBe(
        'https://auth.example.com/.well-known/openid-configuration'
      );
      return endpoints;
    };
    expect(await discover(cfg.issuer, getJson)).toEqual(endpoints);
  });
});
