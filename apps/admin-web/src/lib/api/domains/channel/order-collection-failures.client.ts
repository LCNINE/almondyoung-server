'use client';

// src/lib/api/domains/channel/order-collection-failures.client.ts
// 네이버 주문 수집 실패(미매핑 주문) 격리 큐 API 클라이언트
//
// 응답 envelope 은 channel-adapter 의
// apps/channel-adapter/src/controllers/order-collection-failures.controller.ts 를 그대로 따른다:
//   GET  /adapter/order-collection-failures       -> { success, count, data, timestamp }
//   GET  /adapter/order-collection-failures/:id   -> { success, data, replayPath, timestamp }
//   POST /adapter/order-collection-failures/:id/replay -> { success, result, timestamp }
// `success`/`timestamp` 는 이 화면이 쓰지 않으므로 DTO 에서 생략한다.

import { CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type { AffectedLine } from '@packages/domain-types';

/**
 * `order_collection_failures` 행 하나 (apps/channel-adapter/src/schema.ts).
 * `sourceUpdatedAt`/`replayedAt`/`replayedWmsOrderId`/`errorMessage` 도 실제 응답에 실려
 * 온다 — 특히 `errorMessage` 는 종결(closed_*) 사유를 담으므로 격리 큐 화면에서 "왜 닫혔는지"를
 * 보여주는 데 필요하다.
 */
export interface OrderCollectionFailureDto {
  id: string;
  channel: string;
  externalOrderId: string;
  reason: string;
  status: string;
  affectedLineIds: string[];
  affectedLines: AffectedLine[] | null;
  rawOrder: Record<string, unknown>;
  sourceUpdatedAt: string;
  replayedAt: string | null;
  replayedWmsOrderId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `OrderPollerOrchestrator.replayFailure` 가 반환하는 정확한 status 어휘
 * (apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts).
 */
export type ReplayResultStatus =
  | 'replayed'
  | 'already_processed'
  | 'still_quarantined'
  | 'closed_terminal'
  | 'closed_already_collected'
  | 'not_found_or_not_payment_accepted'
  | 'not_replayable';

export interface ReplayResultDto {
  status: ReplayResultStatus;
  failureId: string;
  externalOrderId: string;
  emitted: number;
  dedupedUnchanged: number;
}

/** 상세 조회가 함께 주는 "다음 행동" 안내 (컨트롤러의 `buildReplayPath`). */
export interface ReplayPathDto {
  fix: string;
  endpoint: string | null;
}

export const orderCollectionFailuresClient = {
  list: async (params: {
    channel?: string;
    reason?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const response = await client.get<{
      count: number;
      data: OrderCollectionFailureDto[];
    }>(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures`,
      { params }
    );
    return response.data;
  },

  get: async (id: string) => {
    const response = await client.get<{
      data: OrderCollectionFailureDto;
      replayPath: ReplayPathDto;
    }>(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures/${encodeURIComponent(id)}`
    );
    return response.data;
  },

  replay: async (id: string) => {
    const response = await client.post<{ result: ReplayResultDto }>(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures/${encodeURIComponent(id)}/replay`
    );
    return response.data.result;
  },
};
