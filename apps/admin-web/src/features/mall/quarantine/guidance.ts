import type { ListingResolutionCause } from '@packages/domain-types';

export type QuarantineStatus =
  | 'quarantined'
  | 'replayed'
  | 'closed_lifecycle'
  | 'closed_already_collected';

export type QuarantineReason =
  | 'channel_product_identification_failed'
  | 'collected_order_modification_not_accepted';

export type ReplayStatus =
  | 'replayed'
  | 'already_processed'
  | 'still_quarantined'
  | 'closed_terminal'
  | 'closed_already_collected'
  | 'not_replayable';

export interface CauseGuidance {
  label: string;
  action: 'create-listing' | 'activate-listing' | 'activate-channel' | 'none';
  description: string;
}

const GUIDANCE: Record<ListingResolutionCause, CauseGuidance> = {
  listing_not_found: {
    label: '매핑 생성',
    action: 'create-listing',
    description: '이 채널상품에 대응하는 채널 리스팅을 만드세요.',
  },
  listing_inactive: {
    label: '리스팅 활성화',
    action: 'activate-listing',
    description: '리스팅이 비활성 상태입니다. 활성화하세요.',
  },
  channel_inactive: {
    label: '채널 활성화',
    action: 'activate-channel',
    description: '판매채널이 비활성 상태입니다. 활성화하세요.',
  },
  variant_inactive: {
    label: '품목 확인',
    action: 'none',
    description:
      '연결된 품목이 판매중지 상태입니다. 상품 화면에서 품목을 활성화하세요.',
  },
  no_active_version: {
    label: '버전 확인',
    action: 'none',
    description:
      '활성 버전이 없습니다. 판매를 재개하려면 publish 하고, 판매중지가 맞다면 네이버에서 해당 상품을 내리세요.',
  },
  product_deleted: {
    label: '재매핑',
    action: 'create-listing',
    description: '연결된 상품이 삭제됐습니다. 다른 상품으로 다시 매핑하세요.',
  },
  no_embedded_ids: {
    label: '상품 재생성',
    action: 'none',
    description:
      '채널에 우리 식별자가 없습니다. Core 를 통해 상품을 다시 만드세요.',
  },
  no_lookup_key: {
    label: '채널 데이터 확인',
    action: 'none',
    description:
      '주문 라인에 조회 키가 없습니다. 채널 원본 데이터를 확인하세요.',
  },
  unknown: {
    label: '판정 불가',
    action: 'none',
    description: '사유를 알 수 없는 격리입니다. 원본을 확인하세요.',
  },
};

export function actionForCause(cause: ListingResolutionCause): CauseGuidance {
  return GUIDANCE[cause] ?? GUIDANCE.unknown;
}

/**
 * 재처리 가능 여부. **상태를 먼저 본다** — 닫힌 행에 버튼을 주면 운영자가 헛수고를 반복한다.
 * `collected_order_modification_not_accepted` 는 서버가 `not_replayable` 로 응답하는 사유다.
 */
export function canReplay(status: string, reason: string): boolean {
  if (status !== 'quarantined') return false;
  return reason !== 'collected_order_modification_not_accepted';
}

const REPLAY_MESSAGES: Record<ReplayStatus, string> = {
  replayed: '재처리했습니다. 판매주문이 생성됐습니다.',
  already_processed: '이미 처리된 주문이라 새로 발행할 것이 없었습니다.',
  still_quarantined: '아직 해소되지 않았습니다. 조치가 반영됐는지 확인하세요.',
  closed_terminal:
    '채널에서 취소·환불되어 더 이상 수집할 수 없습니다. 격리를 닫았습니다.',
  closed_already_collected: '이미 판매주문이 있어 격리를 닫았습니다.',
  not_replayable:
    '수집 후 변경 건이라 재처리할 수 없습니다. CS/주문정정으로 처리하세요.',
};

/**
 * 서버 응답 문자열을 그대로 받는다. `ReplayStatus` 로 좁혀 받으면 클라이언트 DTO 의 `status: string`
 * 과 어긋나 호출부에 캐스팅이 생긴다 — 모르는 값이 오면 폴백 문구를 준다.
 */
export function replayResultMessage(status: string): string {
  return REPLAY_MESSAGES[status as ReplayStatus] ?? '알 수 없는 결과입니다.';
}
