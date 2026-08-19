// src/lib/api/domains/channel/order-collection-failures.shape.ts
//
// 격리 큐 응답의 **순수 정형화 함수**들. axios 나 react-query 를 import 하지 않는다 —
// admin-web 은 컴포넌트 테스트가 불가능하므로(렌더러 없음 + `.tsx` transform 밖), 검증 가능한
// 판정을 `.ts` 순수 함수로 뽑아 두는 것이 유일한 자동 방어선이다.
//
// ## 왜 이 파일이 필요한가 (#640 회귀)
//
// 공용 axios 인스턴스(`lib/api/client.ts`)의 응답 인터셉터가 `{ success: true, data, … }` 를
// **이미 한 번 벗긴다**. 도메인 client 가 `response.data.data` 로 한 번 더 벗기면 런타임 값과
// 타입이 어긋난다 — 실제로 `list()` 는 배열을 돌려주는데 타입은 `{ count, data }` 라고 말했고,
// 그래서 표는 `data.data`(=undefined)를 읽어 **영구히 빈 목록**, 배지는 `data.count`(=undefined)
// 를 읽어 **영구히 0** 이었다. 타입이 맞으니 컴파일도 통과했다.
//
// 컨트롤러(`apps/channel-adapter/src/controllers/order-collection-failures.controller.ts`)의
// 응답 본문과 인터셉터 통과 후의 값:
//
// | 호출 | 서버 본문 | 인터셉터 통과 후 (`response.data`) |
// |---|---|---|
// | `GET /`      | `{ success, count, data, timestamp }`      | `data` (배열) — `count` 는 유실 |
// | `GET /:id`   | `{ success, data, replayPath, timestamp }` | `data` (행) — `replayPath` 는 유실 |
// | `POST /:id/replay` | `{ success, result, timestamp }`    | 그대로 (`data` 키가 없어 벗겨지지 않는다) |
//
// 그래서 `count` 는 **배열 길이에서 되살리고**, `replayPath` 는 되살리지 않는다 — 그 안내문은
// 서버가 영어로 주는 Medusa 전용 문구였고, 화면은 `features/mall/quarantine/guidance.ts` 가
// 사유별로 더 정확한 한국어 안내를 이미 갖고 있다.
//
// 아래 함수들은 **인터셉터가 벗긴 모양과 안 벗긴 모양을 모두** 받는다. 인터셉터의 술어
// (`success === true && 'data' in body`)가 바뀌어도 화면이 조용히 비지 않게 하기 위함이다.

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

/**
 * 목록 한 판의 상한. 서버 기본값이 50 인데 클라이언트가 아무것도 보내지 않아, 개통 직후 수백
 * 건이 격리되는 구간에서 **말없이 50건만** 보이고 있었다. 명시적으로 보내고, 상한에 닿았다는
 * 사실을 `truncated` 로 화면에 올린다 — 운영자가 "이게 전부" 라고 오해하면 남은 주문의 출고가
 * 멈춘 채 방치된다 (lazy 매핑 전략의 급소).
 */
export const QUARANTINE_LIST_LIMIT = 200;

export interface FailureListResult {
  data: OrderCollectionFailureDto[];
  /** 이 판에 담긴 행 수. 서버가 주는 `count` 도 `data.length` 다. */
  count: number;
  limit: number;
  /** 상한에 닿았다 — 뒤에 더 있을 수 있다. */
  truncated: boolean;
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/**
 * 목록 응답 → `{ count, data, limit, truncated }`.
 *
 * 배열(인터셉터 통과 후)과 `{ count, data }`(안 벗겨진 경우) 양쪽을 받는다. 그 외에는 빈 판을
 * 돌려준다 — 화면이 터지는 대신 "격리된 주문이 없습니다" 를 그리게 하기 위함이다.
 */
export function toFailureListResult(body: unknown, limit: number = QUARANTINE_LIST_LIMIT): FailureListResult {
  const rows = Array.isArray(body)
    ? (body as OrderCollectionFailureDto[])
    : Array.isArray(asRecord(body)?.data)
      ? (asRecord(body)!.data as OrderCollectionFailureDto[])
      : [];

  return {
    data: rows,
    // 서버의 `count` 는 인터셉터가 버렸으므로 길이에서 되살린다. 서버도 `data.length` 를 넣는다.
    count: rows.length,
    limit,
    truncated: rows.length >= limit,
  };
}

/**
 * 상세 응답 → 행 하나. 배열이 아닌 객체이되 `{ data: … }` 로 한 겹 더 싸여 있으면 벗긴다.
 * 행 자체에는 `data` 키가 없으므로 두 모양이 섞이지 않는다.
 */
export function toFailureDetail(body: unknown): OrderCollectionFailureDto | null {
  const record = asRecord(body);
  if (!record) return null;
  const inner = asRecord(record.data);
  if (inner) return inner as unknown as OrderCollectionFailureDto;
  return typeof record.id === 'string' ? (record as unknown as OrderCollectionFailureDto) : null;
}

/**
 * 재처리 응답 → 결과.
 *
 * 이 응답만 인터셉터를 통과하지 못한다(`data` 키가 없다). 그래서 `result` 를 여기서 벗기지만,
 * 서버가 언젠가 `data` 로 감싸도 화면이 조용히 죽지 않도록 벗겨진 모양도 함께 받는다.
 */
export function toReplayResult(body: unknown): ReplayResultDto | null {
  const record = asRecord(body);
  if (!record) return null;
  const inner = asRecord(record.result);
  if (inner) return inner as unknown as ReplayResultDto;
  return typeof record.status === 'string' ? (record as unknown as ReplayResultDto) : null;
}

/** 배지·헤더에 쓸 건수 표기. 상한에 닿았으면 "더 있다" 는 사실을 숫자에 실어 보낸다. */
export function formatQuarantineCount(result: Pick<FailureListResult, 'count' | 'truncated'>): string {
  return result.truncated ? `${result.count}+` : String(result.count);
}
