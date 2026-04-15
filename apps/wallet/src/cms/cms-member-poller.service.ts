import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CmsMemberService } from './cms-member.service';
import { CmsApiClient } from './cms-api.client';

@Injectable()
export class CmsMemberPollerService {
  private readonly logger = new Logger(CmsMemberPollerService.name);

  constructor(
    private readonly cmsMemberService: CmsMemberService,
    private readonly cmsApi: CmsApiClient,
  ) {}

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

    for (const member of pendingMembers) {
      try {
        const result = await this.cmsApi.getMember(member.cmsMemberId);
        if (!result.ok) {
          this.logger.warn(
            `CMS member query failed for ${member.cmsMemberId}: ${result.error.code} ${result.error.message}`,
          );
          continue;
        }

        const apiStatus = result.data.status ?? '';

        if (apiStatus === '신청완료' || apiStatus === 'REGISTERED') {
          await this.cmsMemberService.updateStatus(
            member.id,
            'REGISTERED',
            result.data.resultCode,
            result.data.resultMsg,
          );
          this.logger.log(`CMS member ${member.cmsMemberId} registered successfully`);
        } else if (apiStatus === '신청실패' || apiStatus === 'FAILED') {
          await this.cmsMemberService.updateStatus(
            member.id,
            'FAILED',
            result.data.resultCode,
            result.data.resultMsg,
          );
          this.logger.warn(`CMS member ${member.cmsMemberId} registration failed: ${result.data.resultMsg}`);
        }
        // 그 외(신청중 등): 다음 주기에 재조회
      } catch (err) {
        this.logger.error(`Error polling CMS member ${member.cmsMemberId}: ${err}`);
      }
    }
  }
}
