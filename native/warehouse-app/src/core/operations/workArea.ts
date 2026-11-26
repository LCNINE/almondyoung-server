import { createContext, useContext } from 'react';
import type { StoredOperation } from './operationStore';
import { isBoxCheck, shipmentOf } from './boxChecks';
import { workNameOf, type PendingWorkPath } from './pendingWork';

/** 라우터 안의 다리(`WorkNavigationBridge`)가 넘기는 지금 경로와 이동 */
export interface WorkNavigator {
  pathname: string;
  station: boolean;
  /** 옮겼으면 true — 지금 화면이 저장 안 한 입력으로 이동을 막으면 false */
  go(to: PendingWorkPath): Promise<boolean>;
}

export interface WorkAreaState {
  operations: StoredOperation[];
  scope: string | null;
  problem: boolean;
  restoring: boolean;
  recheck(): Promise<void>;
  /** 라우터 안의 다리만 쓴다 — 경계가 아닌 값(테스트 등)에는 없어도 된다 */
  registerNavigator?(navigator: WorkNavigator | null): void;
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
