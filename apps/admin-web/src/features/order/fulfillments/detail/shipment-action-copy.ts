import {
  getServerDenyMessage,
  knownConflictMessage,
  parseServerError,
} from '@/lib/api/server-error';
import type {
  FulfillmentOperationStatus,
  FulfillmentRequestOutcome,
  ShipmentDispatchAttemptHistory,
  ShipmentWaybillHistory,
} from '@/lib/types/dto/fulfillment';
import type { ShipmentAction } from './shipment-owner';

export const ACTION_TITLE: Record<ShipmentAction, string> = {
  split: '상자 분할',
  recipient: '수령인 변경',
  plan: '계획 확정',
  recall: '출고 되돌리기',
};

export const SUBMIT_LABEL: Record<ShipmentAction, string> = {
  split: '분할하기',
  recipient: '변경하기',
  plan: '확정하기',
  recall: '되돌리기',
};

const OPERATION_STATUS_LABEL: Record<FulfillmentOperationStatus, string> = {
  pending: '접수됨',
  in_progress: '처리 중',
  completed: '완료',
  succeeded: '완료',
  failed: '실패',
  recovery_required: '확인 필요',
};

export function operationStatusLabel(
  status: FulfillmentOperationStatus | undefined
): string {
  return status ? OPERATION_STATUS_LABEL[status] : '응답 대기';
}

/** 같은 요청 키로 다시 보내므로 서버가 두 번 처리하지 않는다 */
export function retryNotice(
  operationId: string,
  status: FulfillmentOperationStatus | undefined
): string {
  if (!operationId) {
    return '서버 응답을 받지 못해 처리됐는지 알 수 없어요. 다시 시도해도 같은 요청으로 보내서 두 번 처리되지 않아요.';
  }
  if (status === 'recovery_required') {
    return '서버가 이 작업을 끝내지 못했어요. 다시 시도해도 같은 요청으로 보내서 두 번 처리되지 않아요.';
  }
  return '서버가 처리하고 있어요. 끝나면 이 안내가 사라져요.';
}

/** 되돌릴 출고 선택지: 회차 · 송장 번호 · 출고 시각 */
export function dispatchAttemptLabel(
  attempt: ShipmentDispatchAttemptHistory,
  waybills: readonly ShipmentWaybillHistory[]
): string {
  const trackingNo = waybills.find(
    (waybill) => waybill.id === attempt.waybillId
  )?.trackingNo;
  return [
    `${attempt.attemptNo}차 출고`,
    trackingNo ? `송장 ${trackingNo}` : null,
    attempt.dispatchedAt
      ? new Date(attempt.dispatchedAt).toLocaleString('ko-KR')
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const HANGUL = /[가-힣]/;

// 받침이 있으면 «을», 없으면 «를»
function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '을' : '를';
}

const NOT_DRAFT_VERB: Record<ShipmentAction, string> = {
  split: '나눌',
  recipient: '받는 분을 바꿀',
  plan: '계획을 확정할',
  recall: '되돌릴',
};

const CHANGED_MESSAGE =
  '그사이 다른 작업으로 상자가 바뀌었어요. 새로고침한 뒤 다시 해 주세요.';
const NOT_RECALLABLE_MESSAGE =
  '고른 출고는 지금 되돌릴 수 없는 상태예요. 새로고침해 출고 기록을 확인해 주세요.';

// 상자 작업 네 가지가 받을 수 있는 거절 코드 — 서버 문장은 개발용 영어라 보이지 않는다
const REJECTION_MESSAGE: Record<string, (action: ShipmentAction) => string> = {
  SHIPMENT_NOT_DRAFT: (action) =>
    `계획 전 상자만 ${NOT_DRAFT_VERB[action]} 수 있어요. 새로고침해 상자 상태를 확인해 주세요.`,
  SHIPMENT_REOPEN_REQUIRED: () =>
    '계획을 확정한 상자라 여기서 받는 분을 바꿀 수 없어요. 새로고침해 상자 상태를 확인해 주세요.',
  SHIPMENT_STALE_MANIFEST_VERSION: () => CHANGED_MESSAGE,
  SHIPMENT_RECALL_STALE_MANIFEST: () => CHANGED_MESSAGE,
  SHIPMENT_RECALL_SHIPMENT_CHANGED: () => CHANGED_MESSAGE,
  SHIPMENT_STALE_RESERVATION_VERSION: () =>
    '그사이 재고 확보 상태가 바뀌었어요. 새로고침한 뒤 다시 해 주세요.',
  SHIPMENT_RECIPIENT_INCOMPLETE: () =>
    '받는 분 이름·전화번호·우편번호·주소를 모두 채워 주세요.',
  SHIPMENT_PROFILE_INCOMPATIBLE: () =>
    '고른 배송 프로필로는 이 상자를 보낼 수 없어요. 상품에 지정된 배송 프로필을 골라 주세요.',
  SHIPMENT_DROP_SHIP_NOT_SUPPORTED: () =>
    '입점사가 직접 보내는 상품이 있어 여기서 계획을 확정할 수 없어요.',
  SUPPLIER_SHIPMENT_PARTIAL_SPLIT: () =>
    '입점사 상자는 한 줄의 일부 수량만 나눌 수 없어요. 그 줄의 수량 전체로 나눠 주세요.',
  FULFILLMENT_IDEMPOTENCY_MISMATCH: () =>
    '같은 요청을 다른 내용으로 다시 보냈어요. 창을 닫고 새로 연 뒤 다시 해 주세요.',
  SHIPMENT_RECALL_CARRIER_ACCEPTED: () =>
    '택배사가 이미 상자를 받아 되돌릴 수 없어요. 반품으로 처리해 주세요.',
  SHIPMENT_RECALL_CARRIER_PROGRESS_EXISTS: () =>
    '택배사가 이미 상자를 받아 되돌릴 수 없어요. 반품으로 처리해 주세요.',
  SHIPMENT_RECALL_ATTEMPT_NOT_DISPATCHED: () => NOT_RECALLABLE_MESSAGE,
  SHIPMENT_RECALL_ATTEMPT_CHANGED: () => NOT_RECALLABLE_MESSAGE,
  SHIPMENT_RECALL_NOT_SHIPPED: () => NOT_RECALLABLE_MESSAGE,
};

/** 응답이 없어 같은 요청으로 다시 보낼 수 있을 때 — 바로 아래 «다시 시도» 안내를 가리킨다 */
export const NO_ANSWER_MESSAGE =
  '응답을 받지 못했어요. 아래 «다시 시도»로 같은 요청을 다시 보낼 수 있어요.';

/** 상자 작업이 실패했을 때 관리자에게 보일 문장 */
export function actionFailureMessage(
  error: unknown,
  action: ShipmentAction
): string {
  const title = ACTION_TITLE[action];
  const fallback = `${title}${objectParticle(title)} 하지 못했어요. 새로고침해 상자 상태를 확인한 뒤 다시 해 주세요.`;
  const parsed = parseServerError(error, fallback);
  const known = parsed.code ? REJECTION_MESSAGE[parsed.code] : undefined;
  if (known) return known(action);
  if (knownConflictMessage(parsed.code) || HANGUL.test(parsed.message)) {
    return getServerDenyMessage(error, fallback);
  }
  return fallback;
}

export type PendingOutcomeNotice = {
  tone: 'checking' | 'done' | 'attention' | 'not_processed';
  text: string;
};

// 응답을 못 받은 요청이 서버에 늦게 닿았을 수 있으니, 이보다 이르면 «처리 안 됨»으로 단정하지 않는다
export const PENDING_SETTLE_MS = 30_000;

function when(value: string | number): string {
  return new Date(value).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** 새로고침 뒤에도 남은 «응답 대기» 요청의 결과 안내 */
export function pendingOutcomeNotice(
  action: ShipmentAction,
  sentAt: number,
  outcome: FulfillmentRequestOutcome,
  now = Date.now()
): PendingOutcomeNotice {
  const subject = `앞서 보낸 ${ACTION_TITLE[action]} 요청`;
  if (!outcome.processed) {
    return now - sentAt < PENDING_SETTLE_MS
      ? { tone: 'checking', text: `${subject}의 결과를 확인하고 있어요.` }
      : {
          tone: 'not_processed',
          text: `${subject}은 처리되지 않았어요. 필요하면 다시 해 주세요.`,
        };
  }
  if (outcome.status === 'pending' || outcome.status === 'in_progress') {
    return { tone: 'checking', text: `${subject}을 서버가 처리하고 있어요.` };
  }
  if (outcome.status === 'failed' || outcome.status === 'recovery_required') {
    return {
      tone: 'attention',
      text: `${subject}은 서버가 끝내지 못했어요. 아래 작업 기록에서 상태를 확인해 주세요.`,
    };
  }
  return {
    tone: 'done',
    text: `${subject}은 처리됐어요(${when(outcome.completedAt ?? sentAt)}). 아래 작업 기록에서 내용을 볼 수 있어요.`,
  };
}
