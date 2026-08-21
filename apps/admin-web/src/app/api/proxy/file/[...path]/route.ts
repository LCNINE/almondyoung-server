import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const FILE_SERVICE_URL = process.env.FILE_SERVICE_URL ?? 'http://localhost:3080';

type Params = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  // /files/public/:id 는 S3 로 302 한다 — 따라가서 본문을 나르면 큰 이미지가
  // Lambda 응답 상한(502)에 걸리므로 브라우저가 직접 따라가게 넘긴다
  return forwardRequest(request, FILE_SERVICE_URL, path, {
    passThroughRedirects: true,
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, FILE_SERVICE_URL, path);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, FILE_SERVICE_URL, path);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, FILE_SERVICE_URL, path);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, FILE_SERVICE_URL, path);
}
