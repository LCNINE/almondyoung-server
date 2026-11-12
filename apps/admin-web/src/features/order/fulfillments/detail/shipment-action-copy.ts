import type {
  FulfillmentOperationStatus,
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
