import { getTokenPayload } from '@/lib/auth/get-token-payload';
import {
  CORE_API_URL,
  PROMPT_SCOPE,
  coreAuthHeaders,
  coreErrorResponse,
} from './_lib/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const payload = await getTokenPayload();
  if (!payload) {
    return Response.json({ message: '인증이 필요합니다.' }, { status: 401 });
  }

  const res = await fetch(
    `${CORE_API_URL}/ai-prompts?scope=${encodeURIComponent(PROMPT_SCOPE)}`,
    { cache: 'no-store', headers: await coreAuthHeaders() }
  );
  if (!res.ok) return coreErrorResponse(res, '양식 목록을 불러오지 못했습니다.');

  // isMine 은 서버가 판정한다 — 클라이언트가 ownerId 를 직접 비교하면 신원을 내려보내야 한다.
  const presets = (await res.json()) as { ownerId: string }[];
  return Response.json(
    presets.map((preset) => ({ ...preset, isMine: preset.ownerId === payload.sub }))
  );
}

export async function POST(request: Request): Promise<Response> {
  const payload = await getTokenPayload();
  if (!payload) {
    return Response.json({ message: '인증이 필요합니다.' }, { status: 401 });
  }

  const body = (await request.json()) as { title?: string; content?: string };

  // ownerId 는 검증된 토큰에서만 온다 — 클라이언트가 보낸 값은 쓰지 않는다.
  const res = await fetch(
    `${CORE_API_URL}/ai-prompts?scope=${encodeURIComponent(PROMPT_SCOPE)}`,
    {
      method: 'POST',
      headers: await coreAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        title: body.title ?? '',
        content: body.content ?? '',
        ownerId: payload.sub,
        ownerName: payload.login_id || payload.email || null,
      }),
    }
  );
  if (!res.ok) return coreErrorResponse(res, '양식 저장에 실패했습니다.');

  return Response.json(await res.json(), { status: 201 });
}
