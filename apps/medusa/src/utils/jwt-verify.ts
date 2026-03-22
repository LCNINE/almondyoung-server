import jwt, { JwtPayload } from 'jsonwebtoken';

interface MyTokenPayload extends JwtPayload {
  sub: string;
  roles: string[];
  email: string;
  login_id?: string;
  iat: number;
  exp: number;
}

export const jwtVerify = (almond_token: string, secret: string) =>
  jwt.verify(almond_token, secret) as MyTokenPayload;
