import type { WorkRuntime } from '../../core/operations/OperationContext';
import type { FreshLine } from './types';

/** Rebuild from durable confirmations, including the crash before the UI callback. */
export async function confirmedPutawayQuantity(
  runtime: WorkRuntime,
  lineId: string
) {
  const operations = await runtime.store.confirmedForResource(
    await runtime.getScope(),
    `receipt:${lineId}`
  );
  return operations.reduce((quantity, operation) => {
    if (operation.path !== '/inbound/putaway') return quantity;
    const body = JSON.parse(operation.bodyJson);
    if (
      body.lineId !== lineId ||
      !Number.isSafeInteger(body.quantity) ||
      body.quantity < 1
    )
      throw new Error('저장된 적치 수량을 확인하지 못했어요.');
    return quantity + body.quantity;
  }, 0);
}

export function withConfirmedPutaway(
  line: FreshLine,
  quantity: number
): FreshLine {
  return { ...line, putawayDoneQty: Math.max(line.putawayDoneQty, quantity) };
}

/** Confirmed reversals remain visible even if the later history read is unavailable. */
export async function confirmedCanceledQuantity(
  runtime: WorkRuntime,
  lineId: string
) {
  const operations = await runtime.store.confirmedForResource(
    await runtime.getScope(),
    `receipt:${lineId}`
  );
  return operations.reduce((quantity, operation) => {
    if (operation.path !== '/inbound/cancel') return quantity;
    const body = JSON.parse(operation.bodyJson);
    if (
      body.lineId !== lineId ||
      !Number.isSafeInteger(body.quantity) ||
      body.quantity < 1
    )
      throw new Error('저장된 취소 수량을 확인하지 못했어요.');
    return quantity + body.quantity;
  }, 0);
}
