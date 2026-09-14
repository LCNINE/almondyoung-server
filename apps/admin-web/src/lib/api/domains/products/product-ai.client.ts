'use client';

import { client, refreshAccessToken } from '../../client';
import { readSseData } from '@packages/product-ai/sse';
import type { ProductAiSource } from '@packages/product-ai/guides';

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
  feedback: 'up' | 'down' | null;
  sources: ProductAiSource[];
};
const RESPONSE_REQUEST_CONFIG = { timeout: 25_000, retry: 0 };
const BASE = '/proxy/api/product-ai/sessions';

export const productAiClient = {
  async rename(id: string, title: string) {
    return (
      await client.put(
        `${BASE}/${id}/title`,
        { title },
        RESPONSE_REQUEST_CONFIG
      )
    ).data;
  },
  async remove(id: string) {
    await client.delete(`${BASE}/${id}`, RESPONSE_REQUEST_CONFIG);
  },
  async feedback(id: string, messageId: string, rating: 'up' | 'down' | null) {
    return (
      await client.put(
        `${BASE}/${id}/messages/${messageId}/feedback`,
        { rating },
        RESPONSE_REQUEST_CONFIG
      )
    ).data;
  },
  async cancel(id: string, messageId: string) {
    return (
      await client.post(
        `${BASE}/${id}/cancel`,
        { messageId },
        RESPONSE_REQUEST_CONFIG
      )
    ).data;
  },
  async respondStream(
    id: string,
    messageId: string,
    onDelta: (text: string) => void,
    signal: AbortSignal
  ) {
    const request = () =>
      fetch(`/api${BASE}/${id}/respond-stream`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ messageId }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
    let response = await request();
    if (response.status === 401) {
      await refreshAccessToken();
      response = await request();
    }
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get('Content-Type')?.includes('text/event-stream')
    )
      throw new Error('AI 답변을 시작하지 못했습니다. 다시 시도해 주세요.');
    let completed = false;
    for await (const data of readSseData(response.body)) {
      const event = JSON.parse(data);
      if (event.type === 'delta' && typeof event.text === 'string')
        onDelta(event.text);
      if (event.type === 'error')
        throw new Error('답변이 중단되었습니다. 다시 시도해 주세요.');
      if (event.type === 'done') {
        completed = true;
        break;
      }
    }
    if (!completed)
      throw new Error(
        '연결이 끊겼습니다. 저장된 대화를 확인하고 다시 시도해 주세요.'
      );
  },
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
