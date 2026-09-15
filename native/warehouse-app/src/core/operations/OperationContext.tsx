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
