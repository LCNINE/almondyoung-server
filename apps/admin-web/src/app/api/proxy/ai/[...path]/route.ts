import { NextRequest } from 'next/server';
import { forwardRequest } from '../../_lib/forward';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:3070';

/**
 * 어시스턴트 채팅은 도구를 여러 번 돌며 40초까지 쓴다. 기본 30초 타임아웃으로는
 * 헤더가 오기 전에 끊길 수 있으므로 여유를 둔다 — 스트리밍 모드에서 이 값은
 * 응답 헤더까지만 적용되고, 본문이 흐르는 동안에는 관여하지 않는다.
 */
const TIMEOUT_MS = 60_000;

type Params = { params: Promise<{ path: string[] }> };

/** SSE 경로만 스트리밍으로 넘긴다 — 나머지는 버퍼링이 더 단순하고 안전하다. */
function isStreaming(path: string[], method: string) {
  return (
    method === 'POST' && path[0] === 'assistant' && path.at(-1) === 'messages'
  );
}

export const runtime = 'nodejs';
// 스트리밍 응답은 정적 최적화 대상이 아니다. 이걸 빠뜨리면 빌드가 라우트를 접으려다 실패한다.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, AI_SERVICE_URL, path, {
    timeoutMs: TIMEOUT_MS,
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, AI_SERVICE_URL, path, {
    timeoutMs: TIMEOUT_MS,
    streaming: isStreaming(path, 'POST'),
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, AI_SERVICE_URL, path, {
    timeoutMs: TIMEOUT_MS,
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { path } = await params;
  return forwardRequest(request, AI_SERVICE_URL, path, {
    timeoutMs: TIMEOUT_MS,
  });
}
