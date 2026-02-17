import { ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import { WalletSchema } from '../../schema';
import { DbTx } from '../../types';
import { StateTransitionService } from './state-transition.service';

describe('StateTransitionService', () => {
  let service: StateTransitionService;

  beforeEach(() => {
    const dbService = {
      db: {
        transaction: jest.fn(),
      },
    } as unknown as DbService<WalletSchema>;

    service = new StateTransitionService(dbService);
  });

  it('maps intent optimistic-lock mismatch to 409 conflict', async () => {
    const tx = {
      execute: jest.fn().mockResolvedValue([{ status: 'PENDING', version: 2 }]),
      update: jest.fn(),
      insert: jest.fn(),
    } as unknown as DbTx;

    let thrown: unknown;
    try {
      await service.transitionIntent(
        'intent-1',
        'IN_PROGRESS',
        {
          correlationId: 'corr-1',
          expectedVersion: 1,
        },
        undefined,
        tx,
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect((thrown as ConflictException).getStatus()).toBe(409);
    expect((thrown as ConflictException).getResponse()).toMatchObject({
      error: 'OPTIMISTIC_LOCK_CONFLICT',
    });
    expect((tx.update as jest.Mock)).not.toHaveBeenCalled();
    expect((tx.insert as jest.Mock)).not.toHaveBeenCalled();
  });
});
