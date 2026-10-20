import { getMyPermissions } from '@/lib/auth/my-permissions.server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getTokenPayload();
  const state = user ? await getMyPermissions() : null;

  if (!user || !state || state.state === 'unauthenticated') {
    return NextResponse.json(
      { userId: null },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (
    state.state === 'unavailable' ||
    !state.permissions.has('attendance.own.write')
  ) {
    return NextResponse.json(
      { userId: null },
      {
        status: state.state === 'unavailable' ? 503 : 403,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }

  return NextResponse.json(
    { userId: user.sub },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
