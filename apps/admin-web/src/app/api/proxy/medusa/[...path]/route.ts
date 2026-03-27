import { NextRequest, NextResponse } from 'next/server';

const MEDUSA_API_URL =
  process.env.MEDUSA_API_URL ?? 'http://localhost:9000';
const MEDUSA_API_KEY = process.env.MEDUSA_API_KEY ?? '';


type Params = { params: Promise<{ path: string[] }> };

async function forwardToMedusa(
  request: NextRequest,
  path: string[]
): Promise<NextResponse> {
  const targetPath = path.join('/');
  const search = request.nextUrl.search;
  const url = `${MEDUSA_API_URL}/${targetPath}${search}`;

  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const headers = new Headers();
  if (hasBody) {
    headers.set(
      'Content-Type',
      request.headers.get('Content-Type') ?? 'application/json'
    );
  }
  // Medusa Admin API Key 인증 (Basic Auth 형식)
  if (MEDUSA_API_KEY) {
    const basicAuth = Buffer.from(`${MEDUSA_API_KEY}:`).toString('base64');
    headers.set('Authorization', `Basic ${basicAuth}`);
  }

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

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardToMedusa(request, path);
}
