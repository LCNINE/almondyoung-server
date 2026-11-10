/**
 * 관리자가 직접 입력한 주문의 판매채널. 외부 연동이 없는 채널이라 취소·정산은 core 가 하고 채널로 송장을 보내지 않는다
 * (`channel-cancellation-capability.ts`). 화면에는 «수기·기타»로 보인다.
 */
export const MANUAL_ORDER_SALES_CHANNEL = '3pl';

const UNIQUE_VIOLATION = '23505';
const CHANNEL_ORDER_UNIQUE = 'sales_orders_sales_channel_channel_order_id_unique';
const MAX_CAUSE_DEPTH = 5;

/** drizzle 은 드라이버 오류를 감싸므로 `.cause` 를 따라 내려가며 채널 주문번호 유일 제약 위반을 찾는다 */
export function isChannelOrderNumberConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    const row = current as { code?: string; constraint_name?: string; cause?: unknown };
    if (row.code === UNIQUE_VIOLATION && row.constraint_name === CHANNEL_ORDER_UNIQUE) {
      return true;
    }
    current = row.cause;
  }
  return false;
}

export function manualOrderNumberConflictMessage(channelOrderId: string): string {
  return `주문번호 ${channelOrderId} 로 저장된 주문이 이미 있습니다. 주문내역에서 확인하거나 다른 주문번호로 저장해 주세요.`;
}
