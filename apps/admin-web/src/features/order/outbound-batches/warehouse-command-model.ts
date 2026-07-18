export interface PendingWarehouseCommand<T = unknown> {
  idempotencyKey: string;
  payload: T;
}

export function retainOriginalWarehouseCommand<T>(
  pending: PendingWarehouseCommand<T> | undefined,
  next: PendingWarehouseCommand<T>
): PendingWarehouseCommand<T> {
  return pending ?? next;
}

export function warehouseCommandAfterResponse<T>(
  pending: PendingWarehouseCommand<T>,
  responseRequiresRetry: boolean
): PendingWarehouseCommand<T> | undefined {
  return responseRequiresRetry ? pending : undefined;
}
