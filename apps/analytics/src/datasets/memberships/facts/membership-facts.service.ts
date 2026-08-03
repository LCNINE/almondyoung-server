import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DomainEvent } from '@packages/event-contracts/types';
import { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { analyticsSchema, factMembershipEvents } from '../../../schema';
import { DbTx } from '../../../db.types';
import { MembershipFactResult } from './membership-types';

@Injectable()
export class MembershipFactsService {
  private readonly logger = new Logger(MembershipFactsService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  async recordStatusChanged(
    envelope: DomainEvent<MembershipStatusChangedPayload>,
    payload: MembershipStatusChangedPayload,
    tx?: DbTx,
  ): Promise<MembershipFactResult> {
    const occurredAt = new Date(payload.occurredAt);
    const tierId = payload.tierId ?? 'UNKNOWN';
    const contractId = payload.contractId ?? null;

    return this.dbService.run(async (executor) => {
      const claimed = await executor
        .insert(factMembershipEvents)
        .values({
          messageId: envelope.messageId,
          userId: payload.userId,
          status: payload.status,
          tierId: payload.tierId ?? null,
          planId: payload.planId ?? null,
          contractId,
          reasonCode: payload.reasonCode ?? null,
          reasonText: payload.reasonText ?? null,
          occurredAt,
          payload: envelope.payload,
        })
        .onConflictDoNothing({ target: factMembershipEvents.messageId })
        .returning({ messageId: factMembershipEvents.messageId });

      if (claimed.length === 0) {
        this.logger.debug(`Duplicate MembershipStatusChanged skipped: ${envelope.messageId}`);
        return { claimed: false, userId: payload.userId, status: payload.status, tierId, contractId, occurredAt };
      }

      return { claimed: true, userId: payload.userId, status: payload.status, tierId, contractId, occurredAt };
    }, tx);
  }
}
