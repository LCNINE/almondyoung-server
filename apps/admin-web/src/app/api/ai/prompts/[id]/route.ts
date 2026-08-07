import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { CORE_API_URL, coreAuthHeaders, coreErrorResponse } from '../_lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const payload = await getTokenPayload();
  if (!payload) {
    return Response.json({ message: '인증이 필요합니다.' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json()) as { title?: string; content?: string };

  // requesterId 는 검증된 토큰에서만 온다 — 소유자 판정을 클라이언트가 우회할 수 없다.
  const res = await fetch(`${CORE_API_URL}/ai-prompts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: await coreAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      title: body.title ?? '',
      content: body.content ?? '',
      requesterId: payload.sub,
    }),
  });
  if (!res.ok) return coreErrorResponse(res, '양식 수정에 실패했습니다.');

  return Response.json(await res.json());
}

export async function DELETE(_request: Request, { params }: Params): Promise<Response> {
  const payload = await getTokenPayload();
  if (!payload) {
    return Response.json({ message: '인증이 필요합니다.' }, { status: 401 });
  }

  const { id } = await params;
  const res = await fetch(
    `${CORE_API_URL}/ai-prompts/${encodeURIComponent(id)}?requesterId=${encodeURIComponent(payload.sub)}`,
    { method: 'DELETE', headers: await coreAuthHeaders() }
  );
  if (!res.ok) return coreErrorResponse(res, '양식 삭제에 실패했습니다.');

  return new Response(null, { status: 204 });
}
