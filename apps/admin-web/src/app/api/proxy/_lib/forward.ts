import { NextRequest, NextResponse } from 'next/server';

export async function forwardRequest(
  request: NextRequest,
  targetBaseUrl: string,
  path: string[]
): Promise<NextResponse> {
  const accessToken = request.cookies.get('admin_access_token')?.value ?? '';
  const refreshToken = request.cookies.get('admin_refresh_token')?.value ?? '';

  const targetPath = path.join('/');
  const search = request.nextUrl.search;
  const url = `${targetBaseUrl}/${targetPath}${search}`;

  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') ?? 'application/json');
  headers.set('Cookie', `accessToken=${accessToken}; refreshToken=${refreshToken}`);

  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body: body ? body : undefined,
  });

  const data = await upstream.arrayBuffer();

  return new NextResponse(data, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
    },
  });
}
