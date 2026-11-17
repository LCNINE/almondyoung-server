// 판매주문 상태(core sales_orders.status)의 CS 화면 이름.
// core 는 결제가 끝난 주문만 받고 pending 으로 만든다 — pending 은 결제 대기가 아니라 접수된 주문이다.
const SALES_ORDER_STATUS: Record<string, string> = {
  pending: '접수',
  confirmed: '확정',
  processing: '처리 중',
  shipped: '외부 출고',
  delivered: '외부 배송완료',
  cancelled: '취소',
  timeout: '시간 초과',
};

export function salesOrderStatusLabel(
  status: string | null | undefined
): string {
  if (!status) return '-';
  return SALES_ORDER_STATUS[status] ?? status;
}
