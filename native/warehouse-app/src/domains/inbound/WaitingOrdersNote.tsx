import type { WaitingOrders } from './waitingOrders';
import { waitingOrdersLabel } from './waitingOrders';

/** 상품 줄 아래 «기다리는 주문 N건 · M개». 없으면 그리지 않는다. */
export function WaitingOrdersNote({
  waiting,
  detail,
}: {
  waiting: WaitingOrders | null;
  detail?: string;
}) {
  if (!waiting) return null;
  return (
    <span className="block text-xs font-semibold text-amber-700">
      {waitingOrdersLabel(waiting)}
      {detail ? <span className="font-normal"> — {detail}</span> : null}
    </span>
  );
}

export function WaitingOrdersFailed({ failed }: { failed: boolean }) {
  return failed ? (
    <p className="text-xs text-gray-500">기다리는 주문을 확인하지 못했어요.</p>
  ) : null;
}
