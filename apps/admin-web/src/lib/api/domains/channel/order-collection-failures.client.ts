'use client';

// src/lib/api/domains/channel/order-collection-failures.client.ts
// 네이버 주문 수집 실패(미매핑 주문) 격리 큐 API 클라이언트
//
// 🔴 **여기서 envelope 를 벗기지 않는다.** 공용 axios 인스턴스(`lib/api/client.ts`)의 응답
// 인터셉터가 `{ success: true, data, … }` 를 이미 한 번 벗긴다. 두 번 벗기면 런타임 값과 타입이
// 어긋나 표가 영구히 비고 배지가 영구히 0 이 된다 — 타입이 거짓말을 하므로 컴파일도 통과한다.
// 모양 맞추기는 전부 `./order-collection-failures.shape` 의 순수 함수가 하고, 그 함수들만
// 스펙으로 검증된다(admin-web 은 컴포넌트 테스트가 불가능하다).
//
// 서버 응답 원형은 apps/channel-adapter/src/controllers/order-collection-failures.controller.ts:
//   GET  /adapter/order-collection-failures       -> { success, count, data, timestamp }
//   GET  /adapter/order-collection-failures/:id   -> { success, data, replayPath, timestamp }
//   POST /adapter/order-collection-failures/:id/replay -> { success, result, timestamp }
//
// `replayPath` 는 인터셉터가 버리며 되살리지 않는다 — 서버 문구는 Medusa 전용 영어 안내이고,
// 화면은 `features/mall/quarantine/guidance.ts` 가 사유별 한국어 안내를 이미 갖고 있다.

import { CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import {
  QUARANTINE_LIST_LIMIT,
  toFailureDetail,
  toFailureListResult,
  toReplayResult,
} from './order-collection-failures.shape';
import type { FailureListResult, OrderCollectionFailureDto, ReplayResultDto } from './order-collection-failures.shape';

export type {
  FailureListResult,
  OrderCollectionFailureDto,
  ReplayResultDto,
  ReplayResultStatus,
} from './order-collection-failures.shape';
export { QUARANTINE_LIST_LIMIT, formatQuarantineCount } from './order-collection-failures.shape';

export const orderCollectionFailuresClient = {
  list: async (params: {
    channel?: string;
    reason?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<FailureListResult> => {
    // 서버 기본값은 50 이다. 개통 직후엔 수백 건이 격리될 수 있으므로 명시적으로 올려 보내고,
    // 그래도 상한에 닿으면 `truncated` 로 화면에 알린다.
    const limit = params.limit ?? QUARANTINE_LIST_LIMIT;
    const response = await client.get(`${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures`, {
      params: { ...params, limit },
    });
    return toFailureListResult(response.data, limit);
  },

  get: async (id: string): Promise<OrderCollectionFailureDto | null> => {
    const response = await client.get(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures/${encodeURIComponent(id)}`
    );
    return toFailureDetail(response.data);
  },

  replay: async (id: string): Promise<ReplayResultDto | null> => {
    const response = await client.post(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures/${encodeURIComponent(id)}/replay`
    );
    return toReplayResult(response.data);
  },
};
