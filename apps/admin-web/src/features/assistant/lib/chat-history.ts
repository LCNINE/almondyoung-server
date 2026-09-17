'use client';

import { fetchWithRefresh } from '@/lib/api/fetch-with-refresh';

/**
 * 대화 기록 저장소 (ai 앱).
 *
 * 메시지 저장 은 ai 앱이 직접 한다 — 여기 있는 건 세션 CRUD 와 읽기뿐이다.
 * 조회가 실패해도 대화는 계속 돌아야 하므로 모든 함수가 실패를 삼키고 null 을
 * 돌려준다. 호출부는 성공 여부만 보면 된다.
 */

const BASE = '/api/proxy/ai/assistant/sessions';

export type StoredSession = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string | null;
  contentBlocks: unknown[] | null;
  toolCalls: { name: string; input?: unknown; result?: unknown }[] | null;
  createdAt: string;
};

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetchWithRefresh(`${BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    if (!res.ok) return null;
    if (res.status === 204) return null;

    // 서비스에 따라 전역 ResponseInterceptor 가 { success, data } 를 씌운다.
    // 벗기지 않으면 목록이 배열이 아니라 객체로 와서 렌더링이 터진다.
    const body: unknown = await res.json();
    if (
      body &&
      typeof body === 'object' &&
      'success' in body &&
      'data' in body
    ) {
      return (body as { data: T }).data;
    }
    return body as T;
  } catch {
    return null;
  }
}

/** 제목은 첫 발화에서 딴다. 목록에서 어떤 대화인지 알아볼 정도면 된다. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 40 ? `${line.slice(0, 40)}…` : line || '새 대화';
}

export function createSession(title: string) {
  return call<StoredSession>('', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function listSessions(limit = 20) {
  return call<StoredSession[]>(`?limit=${limit}`);
}

export function loadMessages(sessionId: string) {
  return call<StoredMessage[]>(`/${sessionId}/messages`);
}

export function deleteSession(sessionId: string) {
  return call<{ deleted: boolean }>(`/${sessionId}`, { method: 'DELETE' });
}
