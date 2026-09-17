import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { isDemoConsoleEnabled } from '@/lib/demo/capabilities';

export const runtime = 'nodejs';
const documents = new Set([
  'README.md',
  'retail.md',
  'warehouse.md',
  'workshop.md',
  'operator.md',
]);
const legacy = new Set([
  'index',
  'retail',
  'warehouse',
  'workshop',
  'operator',
]);

/** Employee guides contain internal product screens, so files are served only after JWT verification. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!isDemoConsoleEnabled(process.env))
    return new NextResponse(null, { status: 404 });
  const user = await getTokenPayload();
  if (!user || user.must_change_password) {
    const destination = user?.must_change_password
      ? '/account/change-password'
      : '/auth/ensure';
    const login = new URL(destination, request.url);
    login.searchParams.set('redirect_to', request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  const { path } = await params;
  if (
    !path.length ||
    path.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))
  ) {
    return new NextResponse(null, { status: 404 });
  }
  if (path.length === 1 && path[0].endsWith('.html')) {
    const name = path[0].slice(0, -5);
    if (legacy.has(name)) {
      return NextResponse.redirect(
        new URL(
          `/demo/manual/${name === 'index' ? 'README' : name}`,
          request.url
        )
      );
    }
  }
  const markdown = path.length === 1 && documents.has(path[0]);
  const screenshot =
    path.length === 3 &&
    path[0] === 'assets' &&
    path[1] === 'screens' &&
    path[2].endsWith('.png');
  if (!markdown && !screenshot) return new NextResponse(null, { status: 404 });
  const type = markdown ? 'text/plain; charset=utf-8' : 'image/png';
  try {
    const file = await readFile(join(process.cwd(), 'demo-guides', ...path));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': type,
        ...(markdown && request.nextUrl.searchParams.get('download') === '1'
          ? { 'Content-Disposition': `attachment; filename="${path[0]}"` }
          : {}),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return new NextResponse(null, { status: 404 });
    throw error;
  }
}
