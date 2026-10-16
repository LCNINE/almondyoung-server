'use client';

// 이벤트 실패 출구 API (#1016 7·8번). core 와 channel-adapter 의 라우트 모양이 같아 접두사만 다르다.
// 응답은 envelope 없이 오므로 `response.data` 가 곧 본문이다 — 한 번 더 벗기지 말 것(#640).

import { ALMONDYOUNG_API_BASE_URL, CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CursorPage,
  DeadLetterDetail,
  DeadLetterSequenceItem,
  EventFailureService,
  EventFailuresSummary,
  OutboxFailedItem,
  OutboxFailureDetail,
  RedriveAllResult,
  RedriveResult,
  ResendAllResult,
  ResendResult,
} from './failures.types';

const BASE: Record<EventFailureService, string> = {
  core: `${ALMONDYOUNG_API_BASE_URL}/event-failures`,
  'channel-adapter': `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/event-failures`,
};

/** 커서 0 은 «처음부터»다(서버가 0 이하를 무시한다) */
function cursorParams(cursor: number) {
  return cursor > 0 ? { cursor } : undefined;
}

export const eventFailuresClient = {
  summary: async (service: EventFailureService): Promise<EventFailuresSummary> =>
    (await client.get<EventFailuresSummary>(`${BASE[service]}/summary`)).data,

  deadLetters: async (
    service: EventFailureService,
    cursor: number
  ): Promise<CursorPage<DeadLetterSequenceItem>> =>
    (
      await client.get<CursorPage<DeadLetterSequenceItem>>(`${BASE[service]}/dead-letters`, {
        params: cursorParams(cursor),
      })
    ).data,

  deadLetter: async (service: EventFailureService, id: number): Promise<DeadLetterDetail> =>
    (await client.get<DeadLetterDetail>(`${BASE[service]}/dead-letters/${id}`)).data,

  redrive: async (service: EventFailureService, id: number): Promise<RedriveResult> =>
    (await client.post<RedriveResult>(`${BASE[service]}/dead-letters/${id}/redrive`)).data,

  discardDeadLetter: async (
    service: EventFailureService,
    id: number,
    reason: string
  ): Promise<RedriveResult> =>
    (await client.post<RedriveResult>(`${BASE[service]}/dead-letters/${id}/discard`, { reason }))
      .data,

  redriveAll: async (service: EventFailureService): Promise<RedriveAllResult> =>
    (await client.post<RedriveAllResult>(`${BASE[service]}/dead-letters/redrive-all`)).data,

  outboxFailed: async (
    service: EventFailureService,
    cursor: number
  ): Promise<CursorPage<OutboxFailedItem>> =>
    (
      await client.get<CursorPage<OutboxFailedItem>>(`${BASE[service]}/outbox/failed`, {
        params: cursorParams(cursor),
      })
    ).data,

  outboxRow: async (service: EventFailureService, id: number): Promise<OutboxFailureDetail> =>
    (await client.get<OutboxFailureDetail>(`${BASE[service]}/outbox/${id}`)).data,

  resend: async (service: EventFailureService, id: number): Promise<ResendResult> =>
    (await client.post<ResendResult>(`${BASE[service]}/outbox/${id}/resend`)).data,

  discardOutbox: async (
    service: EventFailureService,
    id: number,
    reason: string
  ): Promise<{ status: 'DISCARDED' }> =>
    (await client.post<{ status: 'DISCARDED' }>(`${BASE[service]}/outbox/${id}/discard`, { reason }))
      .data,

  resendAll: async (service: EventFailureService): Promise<ResendAllResult> =>
    (await client.post<ResendAllResult>(`${BASE[service]}/outbox/resend-all`)).data,
};
