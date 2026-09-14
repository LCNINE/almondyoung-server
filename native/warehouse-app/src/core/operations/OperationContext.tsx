import { createContext, useContext } from 'react';
import type { OperationRunner } from './operationRunner';
import type { OperationStore } from './operationStore';
export interface WorkRuntime {
  runner: OperationRunner;
  store: OperationStore;
  getScope: () => Promise<string>;
}
export const OperationContext = createContext<WorkRuntime | null>(null);
export const useWorkRuntime = () => useContext(OperationContext);
