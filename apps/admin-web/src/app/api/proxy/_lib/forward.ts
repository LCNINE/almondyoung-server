import { NextRequest, NextResponse } from 'next/server';

const FORWARDED_REQUEST_HEADERS = [
  'x-request-id',
  'accept',
  'accept-language',
  'user-agent',
  'idempotency-key',
] as const;

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ForwardOptions {
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  // Medusa 등 자체 인증을 쓰는 업스트림은 false 로 끈다. 기본값은 true.
  forwardAuthCookie?: boolean;
}

export async function forwardRequest(
  request: NextRequest,
  targetBaseUrl: string,
  path: string[],
  options: ForwardOptions = {}
): Promise<NextResponse> {
  const {
    extraHeaders,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    forwardAuthCookie = true,
  } = options;

  const targetPath = path.join('/');
  const search = request.nextUrl.search;
  const url = `${targetBaseUrl}/${targetPath}${search}`;

  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const rawBody = hasBody ? await request.arrayBuffer() : undefined;
  // 삭제할때 body값이 빈값으로되면 에러남
  const body = rawBody && rawBody.byteLength > 0 ? rawBody : undefined;

  const headers = new Headers();

  if (body) {
    headers.set(
      'Content-Type',
      request.headers.get('Content-Type') ?? 'application/json'
    );
  }

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (forwardAuthCookie) {
    const accessToken = request.cookies.get('accessToken')?.value ?? '';
    const refreshToken = request.cookies.get('refreshToken')?.value ?? '';
    headers.set(
      'Cookie',
      `accessToken=${accessToken}; refreshToken=${refreshToken}`
    );
  }

  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body: body ? body : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return NextResponse.json(
        { message: `Upstream request timed out after ${timeoutMs}ms` },
        { status: 504 }
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

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
