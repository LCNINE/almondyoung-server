import jwt, { JwtPayload } from 'jsonwebtoken';

interface MyTokenPayload extends JwtPayload {
  sub: string;
  scopes: string[];
  email: string;
  iat: number;
  exp: number;
}

export const jwtVerify = (almond_token: string, secret: string) =>
  jwt.verify(almond_token, secret) as MyTokenPayload;
