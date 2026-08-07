'use client';

import { fetchWithRefresh } from '../../fetch-with-refresh';

/**
 * AI 프롬프트 양식은 axios client(`/api/proxy/api` → Core 직통) 대신 admin-web 자체
 * route handler 를 거친다. 작성자(ownerId)를 검증된 토큰에서 서버가 주입해야 하기 때문 —
 * 클라이언트가 보낸 값을 믿으면 남의 양식을 수정·삭제할 수 있다.
 */
const BASE = '/api/ai/prompts';

export type AiPromptPresetDto = {
  id: string;
  scope: string;
  title: string;
  content: string;
  ownerId: string;
  ownerName: string | null;
  updatedAt: string;
  /** 서버가 판정한 소유 여부. false 면 수정·삭제 불가(읽고 쓰는 건 자유). */
  isMine: boolean;
};

async function parse<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? fallback);
  }
  return (await res.json()) as T;
}

export const aiPromptsClient = {
  list: async (): Promise<AiPromptPresetDto[]> => {
    const res = await fetchWithRefresh(BASE, { credentials: 'include' });
    return parse(res, '양식 목록을 불러오지 못했습니다.');
  },

  create: async (title: string, content: string): Promise<AiPromptPresetDto> => {
    const res = await fetchWithRefresh(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, content }),
    });
    return parse(res, '양식 저장에 실패했습니다.');
  },

  update: async (
    id: string,
    title: string,
    content: string
  ): Promise<AiPromptPresetDto> => {
    const res = await fetchWithRefresh(`${BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, content }),
    });
    return parse(res, '양식 수정에 실패했습니다.');
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetchWithRefresh(`${BASE}/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? '양식 삭제에 실패했습니다.');
    }
  },
};
