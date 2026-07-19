import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, cmsMembers } from '../schema';
import { CmsMemberService } from './cms-member.service';
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
  ) {}

  /**
   * 특정 cms_member UUID로 단건 폴링 (admin trigger).
   */
  async pollMemberById(id: string): Promise<void> {
    const rows = await this.dbService.db
      .select()
      .from(cmsMembers)
      .where(eq(cmsMembers.id, id))
      .limit(1);
    const member = rows[0];
    if (!member) throw new Error('CMS member not found: ' + id);
    await this.pollOneMember(member);
  }

  /**
   * 회원등록 결과 폴링.
   * 회원등록은 영업일 12:00 마감, 결과는 D+1에 확인 가능.
   * 평일 09:00, 12:00, 15:00 실행.
   */
  @Cron('0 0 9,12,15 * * 1-5')
  async pollPendingMembers(): Promise<void> {
    const pendingMembers = await this.cmsMemberService.findPendingMembers();
    if (pendingMembers.length === 0) return;

    this.logger.log(`Polling ${pendingMembers.length} pending CMS member(s)`);

    await Promise.all(pendingMembers.map((member) => this.pollOneMember(member)));
  }

  private async pollOneMember(member: Awaited<ReturnType<CmsMemberService['findPendingMembers']>>[number]): Promise<void> {
    try {
      const result = await this.cmsApi.getMember(member.cmsMemberId);
      if (!result.ok) {
        this.logger.warn(`CMS member query failed for ${member.cmsMemberId}: ${result.error.code} ${result.error.message}`);
        return;
      }

      const memberData = result.data.member;
      const resultCode = memberData.result?.code ?? undefined;
      const resultMessage = memberData.result?.message ?? undefined;

      const liveStatus = interpretLiveCmsMemberStatus(memberData.status);
      if (liveStatus === 'REGISTERED') {
        await this.cmsMemberService.updateStatus(member.id, 'REGISTERED', resultCode, resultMessage);
        // ADR-0027: 심사 통과 — MANDATE_PENDING 인보이스의 다음 시도를 즉시로 당겨 출금을 앞당긴다.
        await this.invoiceOutcomeService.pullForwardMandatePending(member.billingMethodId);
        this.logger.log(`CMS member ${member.cmsMemberId} registered successfully`);
      } else if (liveStatus === 'FAILED') {
        await this.cmsMemberService.updateStatus(member.id, 'FAILED', resultCode, resultMessage);
        // ADR-0027 §7. 심사 최종 거절 — 이 결제수단에 걸린 인보이스를 MANDATE_REJECTED 로 종결하고
        // mandate.rejected 를 발행해 subscriber(membership)가 선적용 자격을 회수하게 한다.
        await this.invoiceOutcomeService.rejectMandateForBillingMethod(
          member.billingMethodId,
          resultCode ?? 'CMS_MEMBER_FAILED',
          resultMessage ?? 'CMS 계좌 심사 거절',
        );
        this.logger.warn(`CMS member ${member.cmsMemberId} registration failed: ${resultMessage}`);
      }
      // IN_FLIGHT(신청중 등): 다음 주기에 재조회
    } catch (err) {
      this.logger.error(`Error polling CMS member ${member.cmsMemberId}: ${err}`);
    }
  }
}
