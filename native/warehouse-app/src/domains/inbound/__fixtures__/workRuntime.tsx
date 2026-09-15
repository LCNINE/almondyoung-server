import { WorkBoundary } from '../../../core/operations/WorkBoundary';
import 'fake-indexeddb/auto';
import type { ReactNode } from 'react';
import { ApiClientProvider } from '../../../core/data/ApiClientProvider';
import type { ApiClient } from '../../../core/data/httpClient';
import { OperationContext } from '../../../core/operations/OperationContext';
import { createOperationRunner } from '../../../core/operations/operationRunner';
import { createOperationStore } from '../../../core/operations/operationStore';
import type { ReceiptLineState } from '../receiptState';

export function receiptFixture(
  patch: Partial<ReceiptLineState> = {}
): ReceiptLineState {
  return {
    lineId: 'ln-1',
    receiptId: 'r-1',
    warehouseId: 'w-1',
    source: 'direct',
    receiptStatus: 'posted',
    skuId: 's1',
    skuCode: 'CT-001',
    skuName: '코튼셔츠',
    originLocationId: 'l-origin',
    originLocationCode: '입고기본존',
    quantity: 10,
    pendingQty: 10,
    putawayFromOriginQty: 0,
    canceledQty: 0,
    returnedQty: 0,
    canPutaway: true,
    putawayBlockReason: null,
    canCancel: true,
    cancelBlockReason: null,
    ...patch,
  };
}
export function createTestWorkRuntime(api: ApiClient) {
  const store = createOperationStore(crypto.randomUUID());
  return {
    store,
    getScope: async () => 'fixture',
    getCapabilities: async () => ({ inboundWorkflowConsistency: true }),
    runner: createOperationRunner({
      api,
      store,
      getScope: async () => 'fixture',
      wait: async () => {},
    }),
  };
}
export function TestWorkProvider({
  runtime,
  children,
}: {
  runtime: ReturnType<typeof createTestWorkRuntime>;
  children: ReactNode;
}) {
  return (
    <ApiClientProvider client={runtime.runner}>
      <OperationContext.Provider value={runtime}>
        <WorkBoundary>{children}</WorkBoundary>
      </OperationContext.Provider>
    </ApiClientProvider>
  );
}
