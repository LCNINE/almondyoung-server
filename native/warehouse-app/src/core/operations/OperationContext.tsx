import { createContext, useContext } from 'react';
import type { OperationRunner } from './operationRunner';
import type { OperationStore } from './operationStore';
export interface WorkCapabilities {
  inboundWorkflowConsistency?: boolean;
  stocktakingAddCountItem?: boolean;
  locationOutbound?: boolean;
}
export interface WorkPermissions {
  forceDispatch?: boolean;
  /** 스테이션 강제출고(F10, core A3). 관리자 `forceDispatch` 와 다른 뜻이다 */
  stationForceDispatch?: boolean;
  /** 결품 보고(F9, core A2) */
  shortPick?: boolean;
}
export interface WorkRuntime {
  getPermissions?: () => Promise<WorkPermissions>;
  getCapabilities?: () => Promise<WorkCapabilities>;
  runner: OperationRunner;
  store: OperationStore;
  getScope: () => Promise<string>;
}
export const OperationContext = createContext<WorkRuntime | null>(null);
export const useWorkRuntime = () => useContext(OperationContext);
