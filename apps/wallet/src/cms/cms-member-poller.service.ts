import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema, cmsMembers } from '../schema';
import { CmsMemberService } from './cms-member.service';
import { CmsApiClient } from './cms-api.client';

@Injectable()
export class CmsMemberPollerService {
  private readonly logger = new Logger(CmsMemberPollerService.name);

  constructor(
    private readonly cmsMemberService: CmsMemberService,
    private readonly cmsApi: CmsApiClient,
    private readonly dbService: DbService<WalletSchema>,
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
      const apiStatus = memberData.status ?? '';
      const resultCode = memberData.result?.code ?? undefined;
      const resultMessage = memberData.result?.message ?? undefined;

      if (apiStatus === '신청완료') {
        await this.cmsMemberService.updateStatus(member.id, 'REGISTERED', resultCode, resultMessage);
        this.logger.log(`CMS member ${member.cmsMemberId} registered successfully`);
      } else if (apiStatus === '신청실패') {
        await this.cmsMemberService.updateStatus(member.id, 'FAILED', resultCode, resultMessage);
        this.logger.warn(`CMS member ${member.cmsMemberId} registration failed: ${resultMessage}`);
      }
      // 그 외(신청중 등): 다음 주기에 재조회
    } catch (err) {
      this.logger.error(`Error polling CMS member ${member.cmsMemberId}: ${err}`);
    }
  }
}
