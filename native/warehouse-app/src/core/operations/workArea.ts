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

// 기기에 남는 작업은 실행기가 저장해 두는 쓰기 경로뿐이다 — 출고 상자 경로는 따로 본다
const WORK_NAMES: Array<[prefixes: string[], name: string]> = [
  [['/inbound/putaway', '/movement/'], '적치·이동'],
  [['/inbound/', '/purchase-orders/', '/inventory/inbound-shipments/'], '입고'],
  [['/inventory/stocks/adjust'], '재고 조정'],
  [['/stocktaking/'], '실사'],
];

function workNameOf(path: string): string | null {
  return (
    WORK_NAMES.find(([prefixes]) =>
      prefixes.some((p) => path.startsWith(p))
    )?.[1] ?? null
  );
}

/**
 * 상자에 묶이지 않은 남은 작업(입고·적치 등)의 이름 — 출고 상자를 막는 까닭을 알릴 때 쓴다.
 * 없으면 null, 여러 종류이거나 모르는 작업이면 «다른».
 */
export function otherWorkName(operations: StoredOperation[]): string | null {
  const names = new Set(
    operations
      .filter((op) => shipmentOf(op.path) === null)
      .map((op) => workNameOf(op.path))
  );
  if (names.size === 0) return null;
  const [only] = names;
  return names.size === 1 && only ? only : '다른';
}

export function useOtherWorkName(): string | null {
  return otherWorkName(useContext(AreaContext).operations);
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
