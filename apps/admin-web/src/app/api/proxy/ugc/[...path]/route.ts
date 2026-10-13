import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const UGC_SERVICE_URL = process.env.UGC_SERVICE_URL ?? 'http://localhost:3030';

// 시안 인쇄 파일·미리보기는 gs 변환이 직렬로 줄을 서서 30초를 넘길 수 있다. CloudFront 가 60초에서
// 끊으므로 그 직전까지만 기다린다. 넘겨도 ugc 는 끝까지 만들어 캐시하므로 다시 누르면 받는다.
const ALMOND_RENDER_TIMEOUT_MS = 55_000;

type Params = { params: Promise<{ path: string[] }> };

function isAlmondRender(path: string[]) {
  return (
    path[0] === 'admin' &&
    path[1] === 'almond-designs' &&
    (path[3] === 'print-link' || path[3] === 'preview')
  );
}

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(
    request,
    UGC_SERVICE_URL,
    path,
    isAlmondRender(path) ? { timeoutMs: ALMOND_RENDER_TIMEOUT_MS } : {}
  );
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, UGC_SERVICE_URL, path);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, UGC_SERVICE_URL, path);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, UGC_SERVICE_URL, path);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, UGC_SERVICE_URL, path);
}
