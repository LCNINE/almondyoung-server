import { parseServerError } from '@/lib/api/server-error';
import { createIdempotentCommand } from '@/lib/services/orders/idempotency';
import type {
  ConsolidationOption,
  ConsolidationOptionShipment,
  CreateShipmentConsolidationRequest,
} from '@/lib/types/dto/fulfillment';

// 서버 consolidate 가 원본으로 받지 않는 상태와 복구 중인 상자
const HIDDEN_STATUSES = new Set([
  'open',
  'shipped',
  'in_transit',
  'delivered',
  'failed',
  'canceled',
  'superseded',
  'recovery_required',
]);

const STALE_VERSION_CODES = new Set([
  'SHIPMENT_STALE_MANIFEST_VERSION',
  'SHIPMENT_STALE_RESERVATION_VERSION',
]);

export function showsConsolidationButton(
  shipment: { status: string; supplierId: string | null },
  permissions: { canConsolidate: boolean; canReopen: boolean }
): boolean {
  if (shipment.supplierId || HIDDEN_STATUSES.has(shipment.status)) {
    return false;
  }

  if (!permissions.canConsolidate) {
    return false;
  }

  return shipment.status === 'draft' || permissions.canReopen;
}

export type OptionCard = {
  pickable: boolean;
  tone: 'ok' | 'memo' | 'blocked';
  note: string;
  addressMark: '(같음)' | '(다름)' | '';
  memoMark: '(같음)' | '(다름)' | '';
};

// 표시와 선택 가능 여부는 서버 reason 으로만 정한다. 받는 사람 문자열은 가려져 올 수 있다.
export function optionCard(
  option: ConsolidationOption,
  canOverrideRecipient: boolean
): OptionCard {
  switch (option.reason) {
    case 'ok':
      return {
        pickable: option.selectable,
        tone: 'ok',
        note: '같이 보낼 수 있어요.',
        addressMark: '(같음)',
        memoMark: '(같음)',
      };

    case 'memo_differs':
      if (!canOverrideRecipient) {
        return {
          pickable: false,
          tone: 'blocked',
          note: '배송 메모가 달라 합치려면 수령인 변경 권한이 필요해요',
          addressMark: '(같음)',
          memoMark: '(다름)',
        };
      }

      return {
        pickable: option.selectable,
        tone: 'memo',
        note: '같이 보낼 수 있어요. 메모가 달라서 다음 단계에서 하나를 골라요.',
        addressMark: '(같음)',
        memoMark: '(다름)',
      };

    case 'address_differs':
      return {
        pickable: false,
        tone: 'blocked',
        note: '배송지가 달라서 같이 보낼 수 없어요.',
        addressMark: '(다름)',
        memoMark: '',
      };

    case 'incomplete_recipient':
    case 'unknown_customer':
      return {
        pickable: false,
        tone: 'blocked',
        note: '정보가 부족해 합칠 수 없어요.',
        addressMark: '',
        memoMark: '',
      };
  }
}

export function togglePick(
  picked: readonly string[],
  option: ConsolidationOption,
  canOverrideRecipient: boolean
): string[] {
  if (!optionCard(option, canOverrideRecipient).pickable) {
    return [...picked];
  }

  if (picked.includes(option.shipmentId)) {
    return picked.filter((id) => id !== option.shipmentId);
  }

  return [...picked, option.shipmentId];
}

export function step2Blocker(input: {
  hasLostCommand: boolean;
  pickedCount: number;
  hasMemoChoices: boolean;
  memoFrom: string;
  reason: string;
}): string | null {
  if (input.hasLostCommand) {
    return '응답을 받지 못한 요청을 먼저 다시 보내 주세요';
  }

  // 다시 읽은 뒤 고른 주문이 모두 빠지면 원본 하나짜리 요청이 나가지 않게 막는다.
  if (input.pickedCount === 0) {
    return '같이 보낼 주문이 없어졌어요. 다시 골라 주세요';
  }

  if (input.hasMemoChoices && !input.memoFrom) {
    return '합친 상자의 배송 메모를 골라 주세요';
  }

  if (!input.reason.trim()) {
    return '작업 사유를 적어 주세요';
  }

  return null;
}

export function needsUnwindSteps(source: ConsolidationOptionShipment): boolean {
  return (
    source.status !== 'draft' ||
    source.batchId !== null ||
    source.waybillTrackingNo !== null
  );
}

export function progressLabel(source: ConsolidationOptionShipment): string {
  if (source.batchId) {
    return '창고에서 작업 중';
  }

  if (source.waybillTrackingNo) {
    return '송장 발급됨';
  }

  if (source.status === 'draft') {
    return '창고 작업 전';
  }

  if (source.status === 'planned') {
    return '출고 계획 확정';
  }

  return source.status;
}

export function isStaleVersionConflict(error: unknown): boolean {
  const parsed = parseServerError(error);

  return parsed.status === 409 && STALE_VERSION_CODES.has(parsed.code ?? '');
}

export type PendingCommand = {
  idempotencyKey: string;
  data: CreateShipmentConsolidationRequest;
};

export function freshCommand(
  data: CreateShipmentConsolidationRequest
): PendingCommand {
  return createIdempotentCommand(data);
}

// 서버 판정 없이 실패한 요청은 서버가 처리했을 수 있어 본문과 키를 그대로 보존한다.
// 클라이언트가 응답 없는 네트워크 오류를 500 으로 바꿔 던지므로 5xx 도 판정 없음으로 본다.
// 다시 보낼 때는 지금 화면 상태로 본문을 새로 만들지 않고 보존한 것을 그대로 보낸다.
export function keptAfterFailure(
  sent: PendingCommand,
  error: unknown
): PendingCommand | null {
  const status = parseServerError(error).status;

  return status === null || status >= 500 ? sent : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function recipientView(snapshot: Record<string, unknown>): {
  name: string;
  address: string;
  memo: string;
} {
  const address = [text(snapshot.roadAddress), text(snapshot.detailAddress)]
    .filter((part) => part !== '')
    .join(', ');

  return {
    name: text(snapshot.recipientName),
    address: address || '-',
    memo: text(snapshot.deliveryNote) || '없음',
  };
}

export function orderNoText(shipment: ConsolidationOptionShipment): string {
  if (shipment.salesOrderNos.length === 0) {
    return `상자 ${shipment.shipmentId.slice(0, 8)}`;
  }

  return shipment.salesOrderNos.map((no) => `#${no}`).join(', ');
}
