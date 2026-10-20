import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getTokenPayload();

  if (
    !user ||
    !user.roles.some((role) => role === 'admin' || role === 'master')
  ) {
    return NextResponse.json(
      { userId: null },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { userId: user.sub },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
