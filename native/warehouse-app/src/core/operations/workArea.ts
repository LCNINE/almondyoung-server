import { createContext, useContext } from 'react';
import type { StoredOperation } from './operationStore';
import { isBoxCheck, shipmentOf } from './boxChecks';

export interface WorkAreaState {
  operations: StoredOperation[];
  scope: string | null;
  problem: boolean;
  restoring: boolean;
  recheck(): Promise<void>;
}

export const AreaContext = createContext<WorkAreaState>({
  operations: [],
  scope: null,
  problem: false,
  restoring: false,
  recheck: async () => {},
});

/**
 * 이 계정에 남은 «결과를 아직 확인하지 못한 작업»과 경계 패널의 「처리 내역 확인」.
 * 저장된 작업을 아직 불러오지 못했으면(`unknown`) 0건이라고 단정하지 않는다.
 */
export function useUnresolvedWork() {
  const { operations, problem, restoring, recheck } = useContext(AreaContext);
  return {
    count: operations.length,
    unknown: problem || restoring,
    recheck,
  };
}

/** 박스에 묶인 결과 모름(확인할 일). `shipmentId` 를 주면 그 박스 것만 */
export function useBoxChecks(shipmentId?: string): StoredOperation[] {
  const { operations } = useContext(AreaContext);
  return operations.filter(
    (op) =>
      isBoxCheck(op) &&
      (shipmentId === undefined || shipmentOf(op.path) === shipmentId)
  );
}
