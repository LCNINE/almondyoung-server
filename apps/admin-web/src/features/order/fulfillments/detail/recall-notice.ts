import type {
  ShipmentDispatchAttemptHistory,
  ShipmentOperationHistory,
} from '@/lib/types/dto/fulfillment';
import { operationReasonLabel } from './operation-reasons';

type RecallNoticeShipment = {
  status: string;
  supplierId?: string | null;
  dispatchAttempts: Pick<
    ShipmentDispatchAttemptHistory,
    'attemptNo' | 'status' | 'recalledAt'
  >[];
  operations: Pick<
    ShipmentOperationHistory,
    'type' | 'status' | 'reason' | 'reasonCode' | 'completedAt'
  >[];
};

export interface RecallNotice {
  title: string;
  lines: string[];
}

// 창고 상자의 마지막 출고를 되돌려 다시 보낼 차례일 때 — 되돌린 사실과 다음 할 일. 다시 출고하면 사라진다
export function recallNoticeOf(
  shipment: RecallNoticeShipment
): RecallNotice | null {
  if (
    shipment.supplierId ||
    (shipment.status !== 'draft' && shipment.status !== 'planned')
  ) {
    return null;
  }

  const last = shipment.dispatchAttempts.reduce<
    RecallNoticeShipment['dispatchAttempts'][number] | null
  >(
    (latest, attempt) =>
      !latest || attempt.attemptNo > latest.attemptNo ? attempt : latest,
    null
  );

  if (last?.status !== 'recalled' || !last.recalledAt) {
    return null;
  }

  const recall = shipment.operations
    .filter(
      (operation) =>
        operation.type === 'recall' && operation.status === 'completed'
    )
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''))
    .at(-1);
  const reason = recall
    ? operationReasonLabel('recall', recall.reasonCode, recall.reason ?? '')
    : '';
  const lines = ['돌려받은 상품은 «출고 재작업존» 재고로 잡혀 있어요.'];

  if (recall?.reasonCode === 'address_correction') {
    lines.push(
      '주소 수정으로 되돌렸어요 — 받는 분 주소를 고쳤는지 확인해 주세요.'
    );
  }

  lines.push(
    shipment.status === 'draft'
      ? '출고 준비에서 다시 준비하면 새 송장을 받아 다시 배치에 담아요.'
      : '다시 준비를 마쳤어요 — 배치에 담겨 나가면 이 안내가 사라져요.'
  );

  return {
    title: `${new Date(last.recalledAt).toLocaleString('ko-KR')} 출고를 되돌렸어요${
      reason ? ` · ${reason}` : ''
    }`,
    lines,
  };
}
