import { BadRequestError } from '@app/shared';
import { normalizeTokenBody } from './oauth-body';

describe('normalizeTokenBody', () => {
  it('payment_handoff grant 는 JWT 크기의 code 를 허용한다', () => {
    const handoffJwt = 'x'.repeat(181);

    const body = normalizeTokenBody({
      grant_type: 'payment_handoff',
      client_id: 'wallet-web',
      client_secret: 'secret',
      code: handoffJwt,
    });

    expect(body).toMatchObject({
      grantType: 'payment_handoff',
      clientId: 'wallet-web',
      clientSecret: 'secret',
      code: handoffJwt,
    });
  });

  it('authorization_code grant 는 기존 code 길이 제한을 유지한다', () => {
    expect(() =>
      normalizeTokenBody({
        grant_type: 'authorization_code',
        client_id: 'admin-web',
        code: 'x'.repeat(129),
      }),
    ).toThrow(BadRequestError);
  });
});
