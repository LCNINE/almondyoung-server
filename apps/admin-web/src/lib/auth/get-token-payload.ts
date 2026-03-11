import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

export interface TokenPayload {
  sub: string;
  roles: string[];
  email: string;
  login_id: string;
}

export async function getTokenPayload(): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_access_token')?.value;

  if (!token) return null;

  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));

    return {
      sub: payload.sub as string,
      roles: (payload.roles as string[]) ?? [],
      email: payload.email as string,
      login_id: payload.login_id as string,
    };
  } catch {
    return null;
  }
}
