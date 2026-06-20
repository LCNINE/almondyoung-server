import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, paymentIntents } from '../schema';
import { DbTx } from '../types';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import { ChargeReleaseService } from './charge-release.service';

/**
 * Soft-resets an in-flight checkout action that the customer walked away from
 * (closed/failed Toss checkout, re-entered an expired payment screen).
 *
 * Releases any provider-side holds (points hold, in-flight Toss charge) and
 * returns the intent to CREATED — NOT CANCELED — so Medusa can reuse the same
 * payment session (`getPaymentStatus` reads CREATED as `pending`). Full
 * CANCELED is reserved for explicit user/admin cancellation.
 */
@Injectable()
export class AbandonService {
  private readonly logger = new Logger(AbandonService.name);

  /** Only an in-flight action can be abandoned; finalised/terminal intents are left untouched. */
  private static readonly ABANDONABLE: ReadonlyArray<string> = ['REQUIRES_ACTION', 'PROCESSING'];

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargeReleaseService: ChargeReleaseService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async abandon(intentId: string, correlationId: string): Promise<{ status: string }> {
    return this.dbService.db.transaction(async (tx) => {
      // Wait-lock (no skipLocked) so abandon serialises AFTER any in-flight
      // webhook/confirm — if the webhook already won, we observe AUTHORIZED below.
      const intent = await this.lockIntent(intentId, tx);
      if (!intent) {
        throw new NotFoundException({
          error: 'INTENT_NOT_FOUND',
          message: `Payment intent not found: ${intentId}`,
        });
      }

      if (!AbandonService.ABANDONABLE.includes(intent.status)) {
        // Already finalised (AUTHORIZED/CAPTURED) or idle/terminal — no-op.
        return { status: intent.status };
      }

      // Release provider-side holds (points hold release, in-flight Toss charge → CANCELED).
      await this.chargeReleaseService.releaseIntentCharges(intent, correlationId);

      // Soft reset → CREATED (reusable session), distinct from explicit CANCELED.
      await this.stateTransitionService.transitionIntent(
        intentId,
        'CREATED',
        {
          correlationId,
          reasonCode: 'CHECKOUT_ABANDONED',
          reasonMessage: 'Checkout action abandoned',
        },
        undefined,
        tx,
      );

      return { status: 'CREATED' };
    });
  }

  private async lockIntent(intentId: string, tx: DbTx): Promise<typeof paymentIntents.$inferSelect | null> {
    const [row] = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .for('update')
      .limit(1);
    return row ?? null;
  }
}
