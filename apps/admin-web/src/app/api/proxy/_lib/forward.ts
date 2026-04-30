import { NextRequest, NextResponse } from 'next/server';

export async function forwardRequest(
  request: NextRequest,
  targetBaseUrl: string,
  path: string[]
): Promise<NextResponse> {
  const accessToken = request.cookies.get('accessToken')?.value ?? '';
  const refreshToken = request.cookies.get('refreshToken')?.value ?? '';

  const targetPath = path.join('/');
  const search = request.nextUrl.search;
  const url = `${targetBaseUrl}/${targetPath}${search}`;

  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const headers = new Headers();
  if (hasBody) {
    headers.set(
      'Content-Type',
      request.headers.get('Content-Type') ?? 'application/json'
    );
  }
  headers.set(
    'Cookie',
    `accessToken=${accessToken}; refreshToken=${refreshToken}`
  );

  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body: body ? body : undefined,
  });

  // 204 No Content는 body가 없어야 함
  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await upstream.arrayBuffer();

  return new NextResponse(data, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'application/json',
    },
  });
}
