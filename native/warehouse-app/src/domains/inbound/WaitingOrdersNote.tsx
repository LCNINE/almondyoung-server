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
    <span className="mt-[3px] block text-[11px] font-semibold text-[#9a681c]">
      {waitingOrdersLabel(waiting)}
      {detail ? <span className="font-normal"> — {detail}</span> : null}
    </span>
  );
}

export function WaitingOrdersFailed({ failed }: { failed: boolean }) {
  return failed ? (
    <p className="text-xs text-[#71717a]">기다리는 주문을 확인하지 못했어요.</p>
  ) : null;
}
