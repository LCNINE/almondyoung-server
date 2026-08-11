import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { addDays, format, parseISO } from 'date-fns';
import { BillingReader, RENEWAL_NOTICE_EVENT_TYPE, RenewalNoticeTarget } from '../billing/billing.reader';
import { ContractEventManager } from '../subscription/contract-event.manager';
import { MembershipEventPublisher } from '../membership-event.publisher';
import { UserContactClient } from './user-contact.client';
import { membershipSchema } from '../../shared/schemas/entities/schema';

/**
 * 자동갱신 결제 사전 고지 일수.
 *
 * 전자상거래법상 계속거래는 갱신 전에 소비자가 해지를 판단할 시간을 실질적으로 가져야 한다.
 * 결제일이 이용 기간 마지막 날이라 고지가 없으면 사실상 해지 기회가 없다.
 */
const NOTICE_DAYS_BEFORE = 7;

/**
 * 결제 수단 표기. 정기결제 계약은 전부 효성 CMS 자동이체다(약관 문구와 동일).
 * ponytail: 결제수단이 카드 빌링 등으로 늘어나면 계약에서 실제 수단을 읽어 분기한다.
 */
const PAYMENT_METHOD_LABEL = '자동이체(CMS)';

/**
 * 갱신 사전 고지 스케줄러.
 *
 * 결제 예정일 7일 전 계약을 모아 MembershipRenewalUpcoming 을 발행한다.
 * 실제 메일 발송은 notification 서비스가 담당하고, 여기서는 "고지했다"는 사실만 계약 이벤트로 남긴다.
 */
@Injectable()
export class RenewalNoticeService {
  private readonly logger = new Logger(RenewalNoticeService.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly billingReader: BillingReader,
    private readonly contractEventManager: ContractEventManager,
    private readonly membershipEventPublisher: MembershipEventPublisher,
    private readonly userContactClient: UserContactClient,
  ) {}

  /**
   * 매일 10시 — 정기결제 스케줄러(09시)와 겹치지 않게 한 시간 뒤에 돈다.
   */
  @Cron('0 10 * * *')
  async runRenewalNoticeScheduler(): Promise<void> {
    const targetDate = format(addDays(new Date(), NOTICE_DAYS_BEFORE), 'yyyy-MM-dd');
    try {
      const sent = await this.notifyForBillingDate(targetDate);
      this.logger.log(`갱신 사전 고지 완료 — 결제예정일 ${targetDate}, 발행 ${sent}건`);
    } catch (error) {
      this.logger.error(
        `갱신 사전 고지 실패 (targetDate=${targetDate}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * 특정 결제 예정일에 대한 고지 발행 (관리자 수동 트리거 및 테스트용).
   * 이미 고지한 계약은 조회 단계에서 빠지므로 다시 불러도 중복 발송되지 않는다.
   */
  async notifyForBillingDate(billingDate: string): Promise<number> {
    const targets = await this.billingReader.findContractsForRenewalNotice(billingDate);
    if (targets.length === 0) return 0;

    const contacts = await this.userContactClient.findContacts(targets.map((t) => t.userId));

    let sent = 0;
    for (const target of targets) {
      const contact = contacts.get(target.userId);
      if (!contact) {
        // 탈퇴 등으로 연락처가 없으면 보낼 곳이 없다. 마커도 남기지 않아 다음 날 재시도된다.
        this.logger.warn(`연락처 없음 — 고지 건너뜀 (contractId=${target.contractId})`);
        continue;
      }

      try {
        await this.publishOne(target, billingDate, contact.email, contact.username);
        sent += 1;
      } catch (error) {
        this.logger.error(
          `갱신 고지 발행 실패 (contractId=${target.contractId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return sent;
  }

  /**
   * 한 계약의 고지를 발행한다.
   *
   * 아웃박스 적재와 마커 기록을 같은 트랜잭션에 묶는다 — 마커만 남고 이벤트가 유실되면
   * 그 회원은 고지를 영영 못 받고, 반대로 이벤트만 나가면 다음 날 다시 발송된다.
   */
  private async publishOne(
    target: RenewalNoticeTarget,
    billingDate: string,
    email: string,
    userName: string,
  ): Promise<void> {
    const nextPeriodEnd = format(addDays(parseISO(billingDate), target.durationDays), 'yyyy-MM-dd');

    await this.dbService.db.transaction(async (tx) => {
      await this.membershipEventPublisher.saveRenewalUpcoming(
        {
          userId: target.userId,
          email,
          userName,
          contractId: target.contractId,
          planName: this.planName(target.durationDays),
          nextBillingDate: billingDate,
          amount: target.amount,
          paymentMethodLabel: PAYMENT_METHOD_LABEL,
          currentPeriodEnd: target.currentPeriodEnd,
          nextPeriodEnd,
          noticeDaysBefore: NOTICE_DAYS_BEFORE,
          occurredAt: new Date().toISOString(),
        },
        tx,
      );

      await this.contractEventManager.addEvent(
        tx,
        target.contractId,
        RENEWAL_NOTICE_EVENT_TYPE,
        { nextBillingDate: billingDate, noticeDaysBefore: NOTICE_DAYS_BEFORE, channel: 'EMAIL' },
        'SYSTEM',
        target.userId,
      );
    });
  }

  private planName(durationDays: number): string {
    return durationDays >= 300 ? '아몬드영 멤버십 (연간)' : '아몬드영 멤버십 (월간)';
  }
}
