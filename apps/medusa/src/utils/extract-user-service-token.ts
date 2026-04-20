const ACCESS_TOKEN_COOKIE = 'accessToken=';

export const extractUserServiceToken = (headers?: Record<string, string>, query?: Record<string, unknown>): string | undefined => {
  const authHeader = headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim() || undefined;
  }

  const cookies = headers?.cookie;
  if (cookies) {
    const tokenCookie = cookies.split(';').find((cookie) => cookie.trim().startsWith(ACCESS_TOKEN_COOKIE));
    if (tokenCookie) {
      const value = tokenCookie.split('=')[1];
      if (value) return decodeURIComponent(value);
    }
  }

  const token = query?.token;
  if (typeof token === 'string') return token;
  if (Array.isArray(token) && token.length) return String(token[0]);
  if (token !== undefined && token !== null) return String(token);

  return undefined;
};
