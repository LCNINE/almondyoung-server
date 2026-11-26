import type { DirectDeliveryBlocker } from '@/lib/api/domains/orders/direct-delivery.client';
import { parseServerError } from '@/lib/api/server-error';

export const NO_ANSWER_TEXT =
  '응답을 받지 못했어요. «같은 내용 다시 보내기»를 누르면 한 번만 처리돼요.';

/** 막는 것마다 왜 안 되는지와 어디서 풀면 되는지. 링크는 화면이 붙인다. */
export function blockerText(
  blocker: DirectDeliveryBlocker,
  owner: 'warehouse' | 'supplier'
): string {
  switch (blocker.code) {
    case 'active_work':
      return `배치 ${blocker.batchNo ?? ''}에서 작업 중인 상자예요. 배치에서 빼면 맡길 수 있어요.`;
    case 'not_draft':
      return owner === 'warehouse'
        ? '출고 작업에 들어간 상자예요(배치에 담김). 배치에서 빼면 맡길 수 있어요.'
        : '이미 발송했거나 끝난 상자예요. 발송을 되돌린 뒤에 창고로 보낼 수 있어요.';
    case 'active_waybill':
      return owner === 'warehouse'
        ? '송장이 이미 발급된 상자예요. 상자 상세에서 송장을 무효화하면 맡길 수 있어요.'
        : '송장이 있는 상자예요. 상자 상세에서 발송을 되돌린 뒤에 창고로 보낼 수 있어요.';
    case 'recovery':
      return '확인이 필요한 상자예요. 상자 상세에서 먼저 정리해 주세요.';
    case 'drop_shipped':
      return '원래 공급처가 보내는 상품이 들어 있어요. 직배 운영 화면에서 처리해 주세요.';
    case 'sellmate_handed_over':
      return '셀메이트로 넘긴 주문이라 셀메이트가 보내요. 공급처에도 맡기면 두 번 나가요.';
    case 'recipient_incomplete':
      return '받는 분 이름·연락처·주소가 다 있어야 공급처가 보낼 수 있어요. 상자 상세에서 받는 분을 고친 뒤 맡겨 주세요.';
    case 'no_warehouse':
      return '창고가 정해지지 않은 주문이라 창고 출고로 되돌릴 수 없어요.';
  }
}

/** 명령이 거절됐을 때 — `refetch` 가 참이면 창이 새로 읽어 막는 것을 다시 보여 준다. */
export function directDeliveryErrorText(error: unknown): {
  text: string;
  refetch: boolean;
} {
  const { code } = parseServerError(error);
  switch (code) {
    case 'TRACKING_IN_USE':
      return {
        text: '이 송장번호는 이미 다른 상자에 쓰였어요. 번호를 다시 확인해 주세요.',
        refetch: false,
      };
    case 'DIRECT_DELIVERY_CHANGED':
      return {
        text: '창을 연 사이 상자가 바뀌었어요. 새로 읽었으니 다시 확인해 주세요.',
        refetch: true,
      };
    case 'DIRECT_DELIVERY_SELLMATE_HANDED_OVER':
      return {
        text: '셀메이트로 넘긴 주문이라 맡기지 않았어요.',
        refetch: true,
      };
    case 'DIRECT_DELIVERY_RECIPIENT_INCOMPLETE':
      return {
        text: '받는 분 정보가 모자라 맡기지 않았어요. 상자 상세에서 받는 분을 고쳐 주세요.',
        refetch: true,
      };
    case 'DIRECT_DELIVERY_NOT_ELIGIBLE':
    case 'DIRECT_DELIVERY_RETURN_NOT_ELIGIBLE':
    case 'SUPPLIER_SHIPMENT_NOT_SHIPPABLE':
    case 'SHIPMENT_ACTIVE_INVOICE':
    case 'SHIPMENT_ACTIVE_WORK_ITEM':
    case 'SHIPMENT_CUSTODY_EXISTS':
      return {
        text: '그 사이 상자 상태가 바뀌어 처리하지 않았어요. 새로 읽은 내용을 확인해 주세요.',
        refetch: true,
      };
    case 'FULFILLMENT_COMMAND_IN_PROGRESS':
      return {
        text: '같은 요청을 처리하는 중이에요. 잠시 뒤 다시 열어 확인해 주세요.',
        refetch: true,
      };
    default:
      return {
        text: '처리하지 못했어요. 창을 닫고 다시 열어 상태를 확인해 주세요.',
        refetch: true,
      };
  }
}

/** 공급처에 불러 줄 한 덩어리 — 비어 있는 칸은 뺀다. */
export function recipientClipboardText(recipient: {
  name: string;
  phone: string;
  address: string;
  memo: string;
  entrancePassword: string;
}): string {
  return [
    `받는 분: ${recipient.name}`,
    `연락처: ${recipient.phone}`,
    `주소: ${recipient.address}`,
    recipient.entrancePassword ? `공동현관: ${recipient.entrancePassword}` : '',
    recipient.memo ? `요청사항: ${recipient.memo}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 가린 값(«*»)이 섞였는가 — 그대로 복사하면 공급처가 못 보낸다. */
export function isMaskedRecipient(recipient: {
  name: string;
  phone: string;
  address: string;
}): boolean {
  return [recipient.name, recipient.phone, recipient.address].some((value) =>
    value.includes('*')
  );
}

/** «상품 A 외 2종 · 4개» */
export function awaitingItemsText(item: {
  firstSkuName: string;
  lineCount: number;
  totalQty: number;
}): string {
  const more = item.lineCount > 1 ? ` 외 ${item.lineCount - 1}종` : '';
  return `${item.firstSkuName}${more} · ${item.totalQty}개`;
}

/** 맡긴 뒤 지난 시간 — 하루가 넘으면 일, 아니면 시간. */
export function awaitingAgeText(handedOffAt: string, now: Date): string {
  const hours = Math.max(
    0,
    Math.floor((now.getTime() - new Date(handedOffAt).getTime()) / 3_600_000)
  );
  if (hours >= 24) return `맡긴 지 ${Math.floor(hours / 24)}일`;
  if (hours >= 1) return `맡긴 지 ${hours}시간`;
  return '방금 맡김';
}
