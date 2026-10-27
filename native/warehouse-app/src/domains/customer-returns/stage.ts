import type { ReturnView } from './types';

export type ReceivingStage =
  | { kind: 'receive' }
  | { kind: 'inspect' }
  | { kind: 'closed'; reason: 'cancelled' | 'inspected' };

/** N8 — 열린 반품이 소포 세기인지 검수인지, 이미 끝났는지. */
export function receivingStageOf(view: ReturnView): ReceivingStage {
  if (view.status === 'cancelled')
    return { kind: 'closed', reason: 'cancelled' };
  if (view.status === 'expected') return { kind: 'receive' };
  if (view.status !== 'arrived') return { kind: 'closed', reason: 'inspected' };
  const missingClosed = view.csResolution?.missing != null;
  const allArrived = view.lines.every((l) =>
    l.items.every((i) => i.arrivedQty >= i.expectedQty)
  );
  return missingClosed || allArrived
    ? { kind: 'inspect' }
    : { kind: 'receive' };
}
