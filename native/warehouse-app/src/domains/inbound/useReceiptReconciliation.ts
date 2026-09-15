import type { WorkRuntime } from '../../core/operations/OperationContext';
import { assertInboundWorkflowCapability } from '../../core/operations/useWorkCapabilities';
import { ReceiptStateError, useReceiptLineState } from './receiptState';

async function prepareReceiptRead(runtime: WorkRuntime, reconcile: boolean) {
  const scope = await runtime.getScope();
  if (reconcile && (await runtime.store.pending(scope)).length > 0)
    await runtime.runner.retryPending();
  if ((await runtime.getScope()) !== scope)
    throw new ReceiptStateError('로그인을 다시 확인해 주세요.');
  if ((await runtime.store.pending(scope)).length > 0)
    throw new ReceiptStateError(
      '처리 여부를 아직 확인하지 못했어요. 처리 내역을 다시 확인해 주세요.'
    );
  // Old requests retain their original contract even on an older server.
  await assertInboundWorkflowCapability(runtime);
}
export function useReceiptReconciliation(input: {
  lineId: string | null;
  warehouseId: string | null;
  expectedSource: 'direct' | 'purchase_order';
}) {
  return useReceiptLineState(input.lineId, input.warehouseId, {
    expectedSource: input.expectedSource,
    beforeRead: prepareReceiptRead,
  });
}
