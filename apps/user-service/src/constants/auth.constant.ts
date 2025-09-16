export enum JwtToken {
  AccessToken = 'access-token',
  RefreshToken = 'refresh-token',
  EmailVerificationToken = 'email-verification-token',
}

export const AUTH_INSTANCE_KEY = 'AUTH_INSTANCE';

export const REDIRECT_TO =
  process.env.SIGNUP_REDIRECT_URL ?? 'http://localhost:3000';
