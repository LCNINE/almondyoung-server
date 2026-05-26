import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { inboxEvents } from '../schema';
import { MedusaClient } from '../adapters/medusa/medusa.client';
import type { ChannelAdapterSchema } from '../types';
import type { UserEmailVerifiedPayload } from '@packages/event-contracts/streams/user.stream';

const COUPON_TRIGGER_TYPES = ['UserEmailVerified', 'MembershipStatusChanged'] as const;
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class CouponIssueReconciliationService {
  private readonly logger = new Logger(CouponIssueReconciliationService.name);

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly medusaClient: MedusaClient,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Seoul' })
  async reconcile(): Promise<void> {
    await this.run();
  }

  async runManually(): Promise<{ directIssued: number; reset: number; skipped: number }> {
    return this.run();
  }

  private async run(): Promise<{ directIssued: number; reset: number; skipped: number }> {
    this.logger.log('쿠폰 자동 발급 보정 시작');

    const since = new Date(Date.now() - LOOKBACK_MS);
    const failed = await this.dbService.db
      .select()
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.status, 'failed'),
          inArray(inboxEvents.eventType, [...COUPON_TRIGGER_TYPES]),
          gte(inboxEvents.createdAt, since),
        ),
      );

    if (failed.length === 0) {
      this.logger.log('보정 대상 없음');
      return { directIssued: 0, reset: 0, skipped: 0 };
    }

    this.logger.log(`보정 대상 ${failed.length}건 발견`);
    let directIssued = 0;
    let reset = 0;
    let skipped = 0;

    for (const event of failed) {
      try {
        if (event.eventType === 'UserEmailVerified') {
          const outcome = await this.retryUserEmailVerified(event);
          outcome === 'issued' ? directIssued++ : skipped++;
        } else {
          // MembershipStatusChanged — 원인이 일시적 오류일 가능성이 높으므로 재대기
          await this.resetToPending(event.id);
          reset++;
        }
      } catch (err) {
        this.logger.error(`보정 실패 (eventId=${event.id}, type=${event.eventType}): ${(err as any)?.message}`);
        skipped++;
      }
    }

    this.logger.log(`쿠폰 발급 보정 완료: directIssued=${directIssued}, reset=${reset}, skipped=${skipped}`);
    return { directIssued, reset, skipped };
  }

  private async retryUserEmailVerified(event: any): Promise<'issued' | 'skipped'> {
    const userId = (event.payload as UserEmailVerifiedPayload)?.userId;
    if (!userId) {
      this.logger.warn(`UserEmailVerified event ${event.id}에 userId 없음, 스킵`);
      return 'skipped';
    }

    const customer = await this.medusaClient.findCustomerByAlmondUserId(userId);
    if (!customer) {
      // 스토어프론트에 아직 한 번도 로그인 안 한 회원 — 발급 불가, 다음 보정 주기에 재확인
      this.logger.debug(`userId=${userId} Medusa customer 없음, 스킵`);
      return 'skipped';
    }

    await this.medusaClient.issuePromotionsByTrigger(customer.id, 'customer_registered');

    await this.dbService.db
      .update(inboxEvents)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(inboxEvents.id, event.id));

    this.logger.log(`userId=${userId} → customerId=${customer.id} 쿠폰 발급 보정 완료`);
    return 'issued';
  }

  private async resetToPending(eventId: string): Promise<void> {
    await this.dbService.db
      .update(inboxEvents)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), errorMessage: null })
      .where(eq(inboxEvents.id, eventId));
  }
}
