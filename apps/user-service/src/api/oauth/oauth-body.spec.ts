import { BadRequestError } from '@app/shared';
import { normalizeTokenBody } from './oauth-body';

describe('normalizeTokenBody', () => {
  it('예전 payment_handoff grant 는 받지 않는다', () => {
    expect(() =>
      normalizeTokenBody({
        grant_type: 'payment_handoff',
        client_id: 'wallet-web',
        client_secret: 'secret',
        code: 'x'.repeat(181),
      }),
    ).toThrow(BadRequestError);
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
