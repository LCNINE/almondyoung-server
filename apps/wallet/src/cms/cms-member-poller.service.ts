import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronOnce } from '@app/cron-once';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { UserContactClient } from '@app/shared';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams';
import { eq } from 'drizzle-orm';
import { WalletSchema, cmsMembers } from '../schema';
import { CmsMemberService } from './cms-member.service';
import { getCmsBankName } from './cms-banks';
import { CmsApiClient } from './cms-api.client';
import { interpretLiveCmsMemberStatus } from './cms-member-status';
import { InvoiceOutcomeService } from '../invoices/invoice-outcome.service';

@Injectable()
export class CmsMemberPollerService {
  private readonly logger = new Logger(CmsMemberPollerService.name);

  constructor(
    private readonly cmsMemberService: CmsMemberService,
    private readonly cmsApi: CmsApiClient,
    private readonly dbService: DbService<WalletSchema>,
    private readonly invoiceOutcomeService: InvoiceOutcomeService,
    private readonly userContactClient: UserContactClient,
    private readonly configService: ConfigService,
    @InjectPublisher(PAYMENT_STREAM)
    private readonly publisher: PublisherFor<typeof PAYMENT_STREAM>,
  ) {}

  /**
   * 특정 cms_member UUID로 단건 폴링 (admin trigger).
   */
  async pollMemberById(id: string): Promise<void> {
    const rows = await this.dbService.db.select().from(cmsMembers).where(eq(cmsMembers.id, id)).limit(1);
    const member = rows[0];
    if (!member) throw new Error('CMS member not found: ' + id);
    await this.pollOneMember(member);
  }

  /**
   * 회원등록 결과 폴링.
   * 회원등록은 영업일 12:00 마감, 결과는 D+1에 확인 가능.
   * 평일 09:00, 12:00, 15:00 실행.
   */
  @CronOnce('0 0 9,12,15 * * 1-5', { name: 'cms-member-poll' })
  async pollPendingMembers(): Promise<void> {
    const pendingMembers = await this.cmsMemberService.findPendingMembers();
    if (pendingMembers.length === 0) return;

    this.logger.log(`Polling ${pendingMembers.length} pending CMS member(s)`);

    await Promise.all(pendingMembers.map((member) => this.pollOneMember(member)));
  }

  private async pollOneMember(
    member: Awaited<ReturnType<CmsMemberService['findPendingMembers']>>[number],
  ): Promise<void> {
    try {
      const result = await this.cmsApi.getMember(member.cmsMemberId);
      if (!result.ok) {
        this.logger.warn(
          `CMS member query failed for ${member.cmsMemberId}: ${result.error.code} ${result.error.message}`,
        );
        return;
      }

      const memberData = result.data.member;
      const resultCode = memberData.result?.code ?? undefined;
      const resultMessage = memberData.result?.message ?? undefined;

      const liveStatus = interpretLiveCmsMemberStatus(memberData.status);
      if (liveStatus === 'REGISTERED') {
        // 선점에 진 실행은 후속 처리를 건너뛴다 — 다른 인스턴스가 이미 끝냈다 (#707).
        if (!(await this.cmsMemberService.updateStatus(member.id, 'REGISTERED', resultCode, resultMessage))) {
          return;
        }
        // ADR-0027: 심사 통과 — MANDATE_PENDING 인보이스의 다음 시도를 즉시로 당겨 출금을 앞당긴다.
        // 인보이스 후속과 통지를 격리한다: 상태는 이미 REGISTERED 로 확정됐고 다음 폴링은
        // PENDING 만 다시 가져오므로, 여기서 예외가 새면 승인 통지가 영구 누락된다.
        try {
          await this.invoiceOutcomeService.pullForwardMandatePending(member.billingMethodId);
        } catch (error) {
          this.logger.error(
            `승인 후 인보이스 당기기 실패 — 통지는 계속한다. cmsMemberId=${member.cmsMemberId}: ${String(error)}`,
          );
        }
        this.logger.log(`CMS member ${member.cmsMemberId} registered successfully`);
        await this.notifyRegistered(member);
      } else if (liveStatus === 'FAILED') {
        if (!(await this.cmsMemberService.updateStatus(member.id, 'FAILED', resultCode, resultMessage))) {
          return;
        }
        // ADR-0027 §7. 심사 최종 거절 — 이 결제수단에 걸린 인보이스를 MANDATE_REJECTED 로 종결하고
        // mandate.rejected 를 발행해 subscriber(membership)가 선적용 자격을 회수하게 한다.
        try {
          await this.invoiceOutcomeService.rejectMandateForBillingMethod(
            member.billingMethodId,
            resultCode ?? 'CMS_MEMBER_FAILED',
            resultMessage ?? 'CMS 계좌 심사 거절',
          );
        } catch (error) {
          // 거절은 고객이 «재등록»해야 하는 상태다. 통지를 놓치면 그 신호가 사라진다.
          this.logger.error(
            `거절 후 인보이스 종결 실패 — 통지는 계속한다. cmsMemberId=${member.cmsMemberId}: ${String(error)}`,
          );
        }
        this.logger.warn(`CMS member ${member.cmsMemberId} registration failed: ${resultMessage}`);
        await this.notifyRejected(member, resultCode, resultMessage);
      }
      // IN_FLIGHT(신청중 등): 다음 주기에 재조회
    } catch (err) {
      this.logger.error(`Error polling CMS member ${member.cmsMemberId}: ${err}`);
    }
  }

  /**
   * 심사 거절을 고객에게 알린다. `mandate.rejected` 로는 부족하다 — 그건 인보이스를 훑어서
   * 발행하므로 구독 없이 계좌만 등록한 사람(가입 전 단계)은 아무 통지도 못 받는다.
   *
   * 발행 실패가 심사 결과 반영을 되돌리면 안 되므로 여기서 삼킨다. 통지가 없으면 고객이
   * 마이페이지를 직접 열어보기 전까지 거절을 모르지만, 상태 자체는 이미 확정돼 있다.
   */
  /**
   * 심사 통과를 알린다. 승인만 조용하면 고객은 「된 건가?」 하고 결제수단 화면을 다시 열어보거나
   * 문의한다 — 거절만 메일이 가던 비대칭을 메운다.
   *
   * 거절 통지와 같은 이유로 발행 실패는 삼킨다. 통지가 없어도 상태는 이미 확정돼 있고,
   * 통지 실패가 심사 결과 반영을 되돌리면 안 된다.
   */
  private async notifyRegistered(member: {
    id: string;
    cmsMemberId: string;
    billingMethodId: string;
    userId: string;
    paymentCompany: string;
    payerName: string;
  }): Promise<void> {
    if (
      !this.configService.get<string>('USER_SERVICE_URL') ||
      !this.configService.get<string>('USER_SERVICE_INTERNAL_KEY')
    ) {
      this.logger.warn(`계좌 심사 승인 통지 스킵 — user-service 연동 미설정 (cmsMemberId=${member.cmsMemberId})`);
      return;
    }

    try {
      const contacts = await this.userContactClient.findContacts([member.userId]);
      const contact = contacts.get(member.userId);
      if (!contact?.email) {
        this.logger.warn(`계좌 심사 승인 통지 스킵 — 연락처 없음 (userId=${member.userId})`);
        return;
      }

      await this.dbService.run(async (trx) => {
        await this.publisher.enqueue(
          {
            eventType: 'cms.member.registered',
            aggregateId: member.id,
            partitionKey: member.userId,
            // 거절과 같은 이유 — 선점과 통지가 다른 트랜잭션이라 재시도로 두 번 들어올 수 있다.
            idempotencyKey: `cms:member-registered:${member.id}`,
            payload: {
              cmsMemberId: member.cmsMemberId,
              billingMethodId: member.billingMethodId,
              userId: member.userId,
              email: contact.email,
              userName: contact.username,
              paymentCompany: member.paymentCompany,
              bankName: getCmsBankName(member.paymentCompany),
              payerName: member.payerName,
              occurredAt: new Date().toISOString(),
            },
          },
          trx,
        );
      });
    } catch (err) {
      this.logger.error(`계좌 심사 승인 통지 발행 실패 (cmsMemberId=${member.cmsMemberId}): ${err}`);
    }
  }

  private async notifyRejected(
    member: { id: string; cmsMemberId: string; billingMethodId: string; userId: string },
    resultCode: string | undefined,
    resultMessage: string | undefined,
  ): Promise<void> {
    // user-service 연동은 옵셔널 설정이다(env.ts). 안 붙인 환경에서 통지를 못 보내는 건
    // 고장이 아니라 그 환경의 구성이므로, error 로 올려 운영 알람을 울리지 않는다.
    if (
      !this.configService.get<string>('USER_SERVICE_URL') ||
      !this.configService.get<string>('USER_SERVICE_INTERNAL_KEY')
    ) {
      this.logger.warn(`계좌 심사 거절 통지 스킵 — user-service 연동 미설정 (cmsMemberId=${member.cmsMemberId})`);
      return;
    }

    try {
      const contacts = await this.userContactClient.findContacts([member.userId]);
      const contact = contacts.get(member.userId);
      if (!contact?.email) {
        this.logger.warn(`계좌 심사 거절 통지 스킵 — 연락처 없음 (userId=${member.userId})`);
        return;
      }

      await this.dbService.run(async (trx) => {
        await this.publisher.enqueue(
          {
            eventType: 'cms.member.rejected',
            aggregateId: member.id,
            partitionKey: member.userId,
            // 🔴 2차 방어선 (#707). 위 선점이 이미 한 쪽만 통과시키지만, 통지는 선점과 다른
            // 트랜잭션이라 그 사이에 죽으면 재시도로 다시 들어올 수 있다. 아웃박스의
            // `uq_event_outbox_topic_event_idempotency` 는 키가 있어야 발동한다 — NULL 은
            // 서로 다르게 취급되므로(NULLS DISTINCT) 키 없는 행은 그대로 두 벌 적재된다.
            idempotencyKey: `cms:member-rejected:${member.id}`,
            payload: {
              cmsMemberId: member.cmsMemberId,
              billingMethodId: member.billingMethodId,
              userId: member.userId,
              email: contact.email,
              userName: contact.username,
              reasonCode: resultCode ?? null,
              reasonMessage: resultMessage ?? null,
              occurredAt: new Date().toISOString(),
            },
          },
          trx,
        );
      });
    } catch (err) {
      this.logger.error(`계좌 심사 거절 통지 발행 실패 (cmsMemberId=${member.cmsMemberId}): ${err}`);
    }
  }
}
