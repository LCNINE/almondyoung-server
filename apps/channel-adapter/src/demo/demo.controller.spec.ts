import { BadRequestException } from '@nestjs/common';
import { authorizationForCore } from './demo.controller';

describe('demo controller Core authorization forwarding', () => {
  it('preserves an incoming bearer authorization header', () => {
    expect(authorizationForCore('Bearer direct-token', 'accessToken=cookie-token')).toBe('Bearer direct-token');
  });

  it('converts the admin proxy access-token cookie to a bearer header', () => {
    expect(authorizationForCore(undefined, 'refreshToken=refresh; accessToken=header.payload.signature')).toBe(
      'Bearer header.payload.signature',
    );
  });

  it('fails closed when no user credential can be forwarded to Core', () => {
    expect(() => authorizationForCore(undefined, 'refreshToken=refresh')).toThrow(BadRequestException);
  });
});
