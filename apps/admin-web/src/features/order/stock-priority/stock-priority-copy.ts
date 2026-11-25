import { parseServerError } from '@/lib/api/server-error';
import type {
  StockGiven,
  StockPriorityHeld,
  StockPriorityPlan,
  StockPriorityTake,
} from '@/lib/types/dto/fulfillment';

const BLOCKED: Record<string, string> = {
  NOT_DRAFT: '이미 출고 준비가 진행된 상자예요. 재고가 다 잡혀 있어요.',
  SUPPLIER_BOX: '입점사가 보내는 상자라 우리 재고를 배정하지 않아요.',
  SELLMATE_BOX: '셀메이트에 넘긴 주문이라 여기서 재고를 배정하지 않아요.',
  IN_RECOVERY:
    '복구 중인 상자예요. 상자 상세에서 복구를 마친 뒤 다시 해 주세요.',
  IN_BATCH: '출고 배치에서 작업 중인 상자예요. 배치에서 뺀 뒤 다시 해 주세요.',
  NOTHING_MISSING:
    '이 상자는 재고를 이미 다 잡았어요. 출고 준비에서 바로 보낼 수 있어요.',
};

const FALLBACK =
  '우선할당하지 못했어요. 새로고침해 상자 상태를 확인한 뒤 다시 해 주세요.';

export function stockPriorityBlockedText(blocked: string): string {
  return BLOCKED[blocked] ?? FALLBACK;
}

export const PLAN_CHANGED_TEXT =
  '그 사이 재고나 다른 주문이 바뀌었어요. 아래 내용을 다시 확인해 주세요.';

export function isPlanChanged(error: unknown): boolean {
  return parseServerError(error).code === 'STOCK_PRIORITY_PLAN_CHANGED';
}

export function stockPriorityErrorText(error: unknown): string {
  const { code } = parseServerError(error);
  if (code === 'STOCK_PRIORITY_PLAN_CHANGED') return PLAN_CHANGED_TEXT;
  if (code?.startsWith('STOCK_PRIORITY_')) {
    return stockPriorityBlockedText(code.slice('STOCK_PRIORITY_'.length));
  }
  return FALLBACK;
}

/** 재고를 내준 주문이 어떻게 되는지 */
export function takeOutcomeText(take: StockPriorityTake): string {
  const after = take.emptied ? '출고불가' : '부분출고';
  return take.ready
    ? `완전출고에서 ${after}로 바뀌어요`
    : take.emptied
      ? '잡은 재고가 없어져 출고불가로 다음 재고를 기다려요'
      : '부분출고로 남아요';
}

/** 이대로 하면 이 주문이 어떻게 되는지 */
export function planOutcomeText(plan: StockPriorityPlan): string {
  if (plan.missingQty === 0)
    return '재고가 다 차서 바로 출고 준비를 할 수 있어요.';
  const gained =
    plan.freeQty + plan.takes.reduce((total, take) => total + take.qty, 0);
  return gained > 0
    ? `그래도 ${plan.missingQty}개가 모자라요. 다음에 들어오는 재고를 먼저 받아요.`
    : `지금 옮길 재고가 없어요. 모자란 ${plan.missingQty}개는 다음에 들어오는 재고를 먼저 받아요.`;
}

export function resultText(
  orderText: string,
  result: { movedQty: number; freeQty: number; missingQty: number }
): string {
  if (result.missingQty === 0) {
    return `${orderText} 재고를 다 잡았어요. 완전출고에서 바로 보낼 수 있어요.`;
  }
  const gained = result.movedQty + result.freeQty;
  return gained > 0
    ? `${orderText}에 ${gained}개를 먼저 잡았어요. 모자란 ${result.missingQty}개는 다음 재고를 먼저 받아요.`
    : `${orderText} 우선할당을 했어요. 다음에 들어오는 재고를 먼저 받아요.`;
}

const orderList = (orderNos: string[]) =>
  orderNos.length === 0
    ? '다른 주문'
    : orderNos.length > 3
      ? `${orderNos
          .slice(0, 3)
          .map((no) => `#${no}`)
          .join(', ')} 외 ${orderNos.length - 3}건`
      : orderNos.map((no) => `#${no}`).join(', ');

/** 여기서 가져오지 않는 재고를 누가 잡고 있고 어떻게 하면 되는지 */
export function heldText(held: StockPriorityHeld): string {
  const orders = orderList(held.orderNos);
  if (held.reason === 'priority') {
    return `우선할당한 주문(${orders})이 ${held.qty}개를 잡고 있어요. 먼저 보낼 필요가 없으면 그 주문의 우선할당을 취소한 뒤 다시 열어 보세요.`;
  }
  if (held.reason === 'ready') {
    return `바로 나갈 수 있는 주문(${orders})이 ${held.qty}개를 잡고 있어요. 다 가져와도 이 주문을 채우지 못해 그대로 둬요.`;
  }
  if (held.reason === 'other') {
    return `복구 중이거나 따로 처리하는 상자(${orders})가 ${held.qty}개를 잡고 있어요. 여기서는 가져오지 않아요.`;
  }
  return `송장·배치까지 간 상자(${orders})가 ${held.qty}개를 잡고 있어요. 여기서는 가져오지 않아요.`;
}

/** 재고를 내준 주문에 보이는 이유 */
export function stockGivenText(given: StockGiven): string {
  const at = new Date(given.at).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  });
  return `${at}에 우선할당한 주문(${orderList(given.orderNos)})에 재고를 내줬어요`;
}
