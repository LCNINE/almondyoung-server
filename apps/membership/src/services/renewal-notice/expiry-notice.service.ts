import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { UserContactClient } from '@app/shared';
import { addDays, format } from 'date-fns';
import { eq } from 'drizzle-orm';
import { BillingReader, ExpiryNoticeTarget } from '../billing/billing.reader';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { membershipSchema, subscriptionEntitlement } from '../../shared/schemas/entities/schema';

/**
 * 만료 사전 고지 일수. 갱신 고지와 같은 7일 — 회원 입장에서 "끝나기 일주일 전 알림"으로 동일하게 읽힌다.
 */
const NOTICE_DAYS_BEFORE = 7;

/**
 * 계약이 없어 플랜명을 특정할 수 없는 이용권(관리자 부여 등)이 섞이므로 표기는 하나로 둔다.
 */
const PLAN_LABEL = '아몬드영 멤버십';

/**
 * 만료 사전 고지 스케줄러.
 *
 * 자동갱신이 예정돼 있지 않은 이용권이 7일 뒤 끝나면 MembershipExpiryUpcoming 을 발행한다.
 * 자동갱신 대상은 RenewalNoticeService 가 결제일 기준으로 이미 고지하므로 여기서 빠진다.
 */
@Injectable()
export class ExpiryNoticeService {
  private readonly logger = new Logger(ExpiryNoticeService.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly billingReader: BillingReader,
    private readonly membershipEventPublisher: MembershipEventPublisher,
    private readonly userContactClient: UserContactClient,
  ) {}

  /**
   * 매일 10시 30분 — 갱신 고지(10시)가 끝난 뒤에 돈다.
   */
  @Cron('30 10 * * *')
  async runExpiryNoticeScheduler(): Promise<void> {
    const targetDate = format(addDays(new Date(), NOTICE_DAYS_BEFORE), 'yyyy-MM-dd');
    try {
      const sent = await this.notifyForExpiryDate(targetDate);
      this.logger.log(`만료 사전 고지 완료 — 종료일 ${targetDate}, 발행 ${sent}건`);
    } catch (error) {
      this.logger.error(
        `만료 사전 고지 실패 (targetDate=${targetDate}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * 특정 종료일에 대한 고지 발행 (관리자 수동 트리거 및 테스트용).
   * 이미 고지한 이용권은 조회 단계에서 빠지므로 다시 불러도 중복 발송되지 않는다.
   */
  async notifyForExpiryDate(expiryDate: string): Promise<number> {
    const targets = await this.billingReader.findEntitlementsForExpiryNotice(expiryDate);
    if (targets.length === 0) return 0;

    const contacts = await this.userContactClient.findContacts(targets.map((t) => t.userId));

    let sent = 0;
    for (const target of targets) {
      const contact = contacts.get(target.userId);
      if (!contact) {
        // 탈퇴 등으로 연락처가 없으면 보낼 곳이 없다. 마커도 남기지 않아 다음 날 재시도된다.
        this.logger.warn(`연락처 없음 — 고지 건너뜀 (entitlementId=${target.entitlementId})`);
        continue;
      }

      try {
        await this.publishOne(target, contact.email, contact.username);
        sent += 1;
      } catch (error) {
        this.logger.error(
          `만료 고지 발행 실패 (entitlementId=${target.entitlementId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return sent;
  }

  /**
   * 아웃박스 적재와 마커 기록을 같은 트랜잭션에 묶는다 — 마커만 남고 이벤트가 유실되면
   * 그 회원은 고지를 영영 못 받고, 반대로 이벤트만 나가면 다음 날 다시 발송된다.
   */
  private async publishOne(target: ExpiryNoticeTarget, email: string, userName: string): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.membershipEventPublisher.saveExpiryUpcoming(
        {
          userId: target.userId,
          email,
          userName,
          entitlementId: target.entitlementId,
          planName: PLAN_LABEL,
          expiresAt: target.endsAt,
          noticeDaysBefore: NOTICE_DAYS_BEFORE,
          occurredAt: new Date().toISOString(),
        },
        tx,
      );

      await tx
        .update(subscriptionEntitlement)
        .set({ expiryNoticeSentAt: new Date() })
        .where(eq(subscriptionEntitlement.id, target.entitlementId));
    });
  }
}
