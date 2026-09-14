'use client';

import { client } from '../../client';

export type ProductAiSession = {
  id: string;
  title: string;
  revision: number;
  replyStatus: 'idle' | 'pending' | 'running' | 'failed';
  lastUserMessageId: string | null;
  replyLeaseUntil: string | null;
  replyError: string | null;
  updatedAt: string;
};
export type ProductAiMessage = {
  id: string;
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
};
const RESPONSE_REQUEST_CONFIG = { timeout: 25_000, retry: 0 };
const BASE = '/proxy/api/product-ai/sessions';

export const productAiClient = {
  async list(page: number) {
    return (
      await client.get<{ items: ProductAiSession[]; hasMore: boolean }>(BASE, {
        params: { page, limit: 20 },
      })
    ).data;
  },
  async create(requestId: string, title: string) {
    return (await client.post<ProductAiSession>(BASE, { requestId, title }))
      .data;
  },
  async get(id: string) {
    return (await client.get<ProductAiSession>(`${BASE}/${id}`)).data;
  },
  async messages(id: string) {
    const items: ProductAiMessage[] = [];
    let after = 0;
    // 서버 대화 상한은 200개. 이전 자료를 누락하지 않고 이력을 모두 읽는다.
    for (let page = 0; page < 3; page += 1) {
      const { data } = await client.get<{
        items: ProductAiMessage[];
        nextAfter: number;
        hasMore: boolean;
      }>(`${BASE}/${id}/messages`, { params: { after, limit: 100 } });
      items.push(...data.items);
      if (!data.hasMore) return items;
      after = data.nextAfter;
    }
    throw new Error(
      '대화가 너무 길어 전체 이력을 읽지 못했습니다. 새 대화를 시작해 주세요.'
    );
  },
  async send(
    id: string,
    input: { requestId: string; expectedRevision: number; content: string }
  ) {
    return (
      await client.post<{ message: ProductAiMessage; revision: number }>(
        `${BASE}/${id}/messages`,
        input
      )
    ).data;
  },
  async respond(id: string, messageId: string) {
    return (
      await client.post<{ status: 'idle' | 'running' }>(
        `${BASE}/${id}/respond`,
        { messageId },
        RESPONSE_REQUEST_CONFIG
      )
    ).data;
  },
};
