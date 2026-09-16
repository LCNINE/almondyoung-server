import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { isDemoConsoleEnabled } from '@/lib/demo/capabilities';

export const runtime = 'nodejs';
const mimeTypes: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  woff2: 'font/woff2',
  woff: 'font/woff',
};

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
  const extension = path.at(-1)?.split('.').at(-1) ?? '';
  const type = mimeTypes[extension];
  if (!type) return new NextResponse(null, { status: 404 });
  try {
    const file = await readFile(join(process.cwd(), 'demo-guides', ...path));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': type,
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
