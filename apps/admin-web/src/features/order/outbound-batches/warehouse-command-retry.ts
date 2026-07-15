import { useRef, useState } from 'react';
import { createIdempotentCommand } from '@/lib/services/orders';
import {
  type PendingWarehouseCommand,
  retainOriginalWarehouseCommand,
  warehouseCommandAfterResponse,
} from './warehouse-command-model';

interface WarehouseCommandRetryOptions<R> {
  retainAfterResponse?: (result: R) => boolean;
}

export function useWarehouseCommandRetry() {
  const commands = useRef<Record<string, PendingWarehouseCommand>>({});
  const [, redraw] = useState(0);

  const execute = async <T, R>(
    action: string,
    payload: T,
    run: (payload: T, idempotencyKey: string) => Promise<R>,
    options?: WarehouseCommandRetryOptions<R>
  ): Promise<R> => {
    const generated = createIdempotentCommand(payload);
    const pending = retainOriginalWarehouseCommand(
      commands.current[action] as PendingWarehouseCommand<T> | undefined,
      { idempotencyKey: generated.idempotencyKey, payload: generated.data }
    );
    commands.current[action] = pending;
    redraw((value) => value + 1);
    try {
      const result = await run(pending.payload, pending.idempotencyKey);
      const retained = warehouseCommandAfterResponse(
        pending,
        options?.retainAfterResponse?.(result) ?? false
      );
      if (retained) {
        commands.current[action] = retained;
      } else {
        delete commands.current[action];
      }
      redraw((value) => value + 1);
      return result;
    } catch (error) {
      throw error;
    }
  };

  return {
    execute,
    hasPending: (action: string) => Boolean(commands.current[action]),
    pendingActions: () => Object.keys(commands.current),
  };
}
