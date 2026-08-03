import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { analyticsSchema, dimCustomerMembership } from '../../../schema';
import { DbTx } from '../../../db.types';
import { MembershipFactResult, closesInterval, opensInterval } from '../facts/membership-types';

@Injectable()
export class MembershipDimensionsService {
  private readonly logger = new Logger(MembershipDimensionsService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  async applyStatusChanged(result: MembershipFactResult, tx?: DbTx): Promise<void> {
    await this.dbService.run(async (executor) => {
      const now = new Date();

      // Neither opening nor closing: the status changed, but the member's entitlement (and
      // therefore the tier attribution this dimension exists to serve) did not. Today the
      // only such status is RECURRING_CANCELLED — auto-renewal stopped, entitlement kept
      // until period end, real close arriving later as EXPIRED. See MEMBERSHIP_NEUTRAL_STATUSES
      // for the evidence trail in the membership service.
      //
      // This returns *before* the SELECT deliberately: there is nothing to decide, so there
      // is no reason to read. The fact row is already written by the caller
      // (MembershipFactsService), so churn analysis still sees the event — only the
      // dimension stays untouched.
      if (!opensInterval(result.status) && !closesInterval(result.status)) {
        this.logger.debug(
          `MembershipStatusChanged (${result.status}) for ${result.userId} is dimension-neutral — ` +
            `interval left as is (entitlement retained until the period ends)`,
        );
        return;
      }

      // The single most recent interval for this user — open or already closed. Ordering
      // by validFrom (not validTo, which is null for the open case) is what lets one query
      // and one boundary comparison cover both "is there an open interval" and "does this
      // event overlap a closed one" (see the two guards below).
      const latestRows = await executor
        .select({ validFrom: dimCustomerMembership.validFrom, validTo: dimCustomerMembership.validTo })
        .from(dimCustomerMembership)
        .where(eq(dimCustomerMembership.userId, result.userId))
        .orderBy(desc(dimCustomerMembership.validFrom))
        .limit(1);

      const latest = latestRows[0] ?? null;

      if (latest) {
        // If latest is still open, validTo is null and the boundary is where it started.
        // If latest is closed, the boundary is where it ended — an event landing anywhere
        // inside [validFrom, validTo) of an already-closed interval is out of order too,
        // not just events predating an open one.
        const boundary = latest.validTo ?? latest.validFrom;

        // Stale/out-of-order: this event does not advance past everything already known
        // about this user. Kafka redelivery/reordering is normal operation here, not an
        // edge case — e.g. a late CANCELLED from last month landing after this month's
        // ACTIVE, or a DLQ re-publish landing inside an interval that has since closed.
        // Applying it now would invert an open interval (validTo before its own validFrom)
        // or open a second interval that overlaps an already-closed one. This mirrors the
        // LEAST/GREATEST guard in customer-lifetime.service.ts and is the opposite of the
        // known bug in product-dimensions.service.ts (`lastEventAt` written unconditionally,
        // letting a stale event overwrite newer state).
        if (result.occurredAt < boundary) {
          this.logger.warn(
            `Stale MembershipStatusChanged ignored: user=${result.userId} status=${result.status} ` +
              `occurredAt=${result.occurredAt.toISOString()} < known boundary=${boundary.toISOString()}`,
          );
          return;
        }

        // Duplicate *opening* event at the exact same instant the latest interval opened —
        // e.g. two independently-claimed ACTIVE messages with identical occurredAt (not
        // blocked by the upstream messageId claim, since they're distinct messages).
        // Proceeding would close the interval to zero width and then silently fail to
        // reopen it via onConflictDoNothing, leaving no open interval at all — worse than
        // doing nothing. This check is deliberately scoped to *opening* statuses only: a
        // closing status at the same instant (e.g. CANCELLED at the same millisecond as the
        // ACTIVE that opened the interval) is a legitimate zero-width close, not a
        // duplicate, and must fall through to the close below.
        if (result.occurredAt.getTime() === latest.validFrom.getTime() && opensInterval(result.status)) {
          this.logger.warn(
            `Duplicate opening MembershipStatusChanged ignored: user=${result.userId} status=${result.status} ` +
              `occurredAt=${result.occurredAt.toISOString()} === latest interval validFrom`,
          );
          return;
        }
      }

      // Close whatever is open for this user — blanket on userId, not a specific row id.
      // This is deliberately self-healing: if more than one row were ever left open (it
      // shouldn't happen given the guards above, but this statement doesn't depend on that
      // invariant holding), all of them close here rather than just the one the guard
      // reasoned about.
      const closedRows = await executor
        .update(dimCustomerMembership)
        .set({ validTo: result.occurredAt, updatedAt: now })
        .where(and(eq(dimCustomerMembership.userId, result.userId), isNull(dimCustomerMembership.validTo)))
        .returning({ id: dimCustomerMembership.id });

      if (!opensInterval(result.status)) {
        if (closedRows.length === 0) {
          // Not an error by itself (e.g. a CANCELLED racing a prior CANCELLED), but this is
          // exactly the state an out-of-order overlap defect grows from, so it stays
          // visible rather than a silent no-op.
          this.logger.debug(
            `MembershipStatusChanged (${result.status}) for ${result.userId} had no open interval to close`,
          );
        }
        return;
      }

      await executor
        .insert(dimCustomerMembership)
        .values({
          userId: result.userId,
          tierId: result.tierId,
          // dim_customer_membership.contract_id 는 스키마에 있었으나 채워지지 않고 있었다.
          // 백필(계획 2)이 멤버십을 contractId 로 키잉하므로 이 값이 없으면 백필이 만든
          // 구간과 실시간 구간을 대조할 방법이 없다. contract 상 optional 이라 null 가능.
          contractId: result.contractId,
          validFrom: result.occurredAt,
          validTo: null,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [dimCustomerMembership.userId, dimCustomerMembership.validFrom],
        });
    }, tx);
  }
}
