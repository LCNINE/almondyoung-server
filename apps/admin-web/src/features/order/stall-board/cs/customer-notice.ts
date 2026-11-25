import type {
  BoardStageKey,
  ProgressItem,
} from '@/lib/api/domains/orders/order-progress.shape';
import { canSplitShortage } from '@/lib/api/domains/orders/order-progress.shape';
import type { CsBox } from '@/lib/api/domains/orders/order-cs.shape';
import { carrierLabel } from '@/features/order/fulfillments/detail/fulfillment-labels';

const dateText = (ymd: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : ymd;
};

function shortageLines(item: ProgressItem, today: string): string[] {
  const s = item.shortage;
  if (!s) return ['주문하신 상품 중 일부의 재고를 기다리고 있습니다.'];
  const waiting = s.items.map((i) => {
    const arrival =
      i.expectedArrival && i.expectedArrival >= today
        ? `${dateText(i.expectedArrival)} 입고 예정`
        : '입고 일정 확인 중';
    return `- ${i.skuName} ${i.shortQty.toLocaleString('ko-KR')}개 (${arrival})`;
  });
  return [
    '주문하신 상품 중 아래 상품의 재고를 기다리고 있습니다.',
    ...waiting,
    canSplitShortage(s)
      ? '준비된 상품을 먼저 보내 드릴 수 있습니다. 먼저 받으시겠어요, 다 모이면 한 번에 받으시겠어요?'
      : '입고되는 대로 준비해 보내 드리겠습니다.',
  ];
}

function trackingLines(boxes: CsBox[] | undefined): string[] {
  const sent = (boxes ?? []).filter((b) => b.trackingNo && b.shippedAt);
  return sent.map(
    (b) => `- ${b.carrier ? `${carrierLabel(b.carrier)} ` : ''}${b.trackingNo}`
  );
}

/**
 * 지금 상태로 만든 고객 안내문. 화면이 아는 사실만 적고 약속(언제까지 보낸다)은 하지 않는다.
 * 사람이 판단해야 하는 단계(환불이 막힘·분류 안 됨)는 만들지 않는다 → null.
 */
export function customerNotice(
  stage: BoardStageKey,
  item: ProgressItem,
  boxes: CsBox[] | undefined,
  today: string
): string | null {
  const body = (() => {
    switch (stage) {
      case 'accept':
      case 'fo':
        return [
          '주문을 확인하고 출고를 준비하고 있습니다. 확인이 늦어져 죄송합니다.',
        ];
      case 'reserve':
        return shortageLines(item, today);
      case 'plan':
      case 'waybill':
      case 'pick':
      case 'dispatch':
        return ['상품 재고를 확보해 출고 작업을 하고 있습니다.'];
      case 'track': {
        const lines = trackingLines(boxes);
        return lines.length > 0
          ? [
              '상품을 보내 드렸습니다. 배송 조회는 아래 송장번호로 하실 수 있습니다.',
              ...lines,
            ]
          : null;
      }
      case 'cancel_request':
        return item.settlement && item.settlement.phase !== 'in_progress'
          ? null
          : ['취소 요청을 받아 처리하고 있습니다.'];
      case 'cancel':
        return ['취소 요청을 처리하고 있습니다.'];
      case 'return_exchange':
        return ['반품·교환 요청을 처리하고 있습니다.'];
      default:
        return null;
    }
  })();
  if (!body) return null;
  return [`안녕하세요, 주문번호 ${item.orderNo} 안내드립니다.`, ...body].join(
    '\n'
  );
}
