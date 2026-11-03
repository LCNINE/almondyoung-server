import { INTERNAL_TOKEN_AUDIENCE } from '../../../constants/auth.constant';
import { JwtAccessStrategy } from './jwt-access.strategy';

describe('JwtAccessStrategy — 토큰의 테넌트', () => {
  const config = {
    get: (key: string) => ({ OAUTH_JWT_PUBLIC_KEY: 'pem', OAUTH_ISSUER_URL: 'https://user.test' })[key],
  };
  const oauthRepository = { findActiveClientById: jest.fn().mockResolvedValue({ clientId: 'admin-web' }) };
  const strategy = new JwtAccessStrategy(config as never, {} as never, oauthRepository as never, '1');
  const base = { sub: 'u-2', email: 'a@b.c', roles: ['catalog_manager'] };

  it("keeps the internal session token's tenant — it is the account's tenant (ADR-0056)", async () => {
    await expect(strategy.validate({}, { ...base, aud: INTERNAL_TOKEN_AUDIENCE, tenant: '2' })).resolves.toEqual(
      expect.objectContaining({ tenant: '2' }),
    );
  });

  it('reads an internal token issued before the tenant claim as the served tenant', async () => {
    await expect(strategy.validate({}, { ...base, aud: INTERNAL_TOKEN_AUDIENCE })).resolves.toEqual(
      expect.objectContaining({ tenant: '1' }),
    );
  });

  it('leaves an OAuth token without a tenant claim without one', async () => {
    await expect(strategy.validate({}, { ...base, aud: 'admin-web' })).resolves.toEqual(
      expect.objectContaining({ tenant: undefined }),
    );
  });
});
