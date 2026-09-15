import { createContext, useContext } from 'react';
import type { OperationRunner } from './operationRunner';
import type { OperationStore } from './operationStore';
export interface WorkCapabilities {
  stocktakingAddCountItem?: boolean;
  locationOutbound?: boolean;
}
export interface WorkRuntime {
  getCapabilities?: () => Promise<WorkCapabilities>;
  runner: OperationRunner;
  store: OperationStore;
  getScope: () => Promise<string>;
}
export const OperationContext = createContext<WorkRuntime | null>(null);
export const useWorkRuntime = () => useContext(OperationContext);
