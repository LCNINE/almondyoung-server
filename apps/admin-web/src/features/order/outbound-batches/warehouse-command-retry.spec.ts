import {
  retainOriginalWarehouseCommand,
  warehouseCommandAfterResponse,
} from './warehouse-command-model';

describe('warehouse command retry snapshot', () => {
  it('retains both original payload and idempotency key after an uncertain response', () => {
    const original = { idempotencyKey: 'key-1', payload: { quantity: 1 } };
    const changed = { idempotencyKey: 'key-2', payload: { quantity: 9 } };
    expect(retainOriginalWarehouseCommand(original, changed)).toEqual(original);
  });

  it('uses the new snapshot only when no command is pending', () => {
    const command = { idempotencyKey: 'key-1', payload: { quantity: 1 } };
    expect(retainOriginalWarehouseCommand(undefined, command)).toEqual(command);
  });

  it('retains the original snapshot when the HTTP response still requires retry', () => {
    const command = { idempotencyKey: 'key-1', payload: { quantity: 1 } };
    expect(warehouseCommandAfterResponse(command, true)).toBe(command);
  });

  it('clears the snapshot only after the response reaches a terminal state', () => {
    const command = { idempotencyKey: 'key-1', payload: { quantity: 1 } };
    expect(warehouseCommandAfterResponse(command, false)).toBeUndefined();
  });
});
