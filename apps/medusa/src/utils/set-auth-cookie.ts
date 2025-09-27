import { Response } from 'express';

export const COOKIE_NAME = 'connect.sid';
export const TWO_WEEKS_IN_MS = 14 * 24 * 60 * 60 * 1000; // 14일 (2주)

interface SetAuthCookieOptions {
  maxAge?: number;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  httpOnly?: boolean;
}

export const setAuthCookie = (
  res: Response,
  token: string,
  options: SetAuthCookieOptions = {},
): void => {
  const {
    maxAge = TWO_WEEKS_IN_MS,
    secure = process.env.NODE_ENV === 'production',
    sameSite = 'lax',
    httpOnly = true,
  } = options;

  res.cookie(COOKIE_NAME, token, {
    httpOnly,
    secure,
    sameSite,
    maxAge,
  });
};
