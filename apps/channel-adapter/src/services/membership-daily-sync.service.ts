import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { AlmondAuthClient } from '../adapters/almond-auth/almond-auth.client';
import { FirebaseMembershipSyncService } from '../adapters/medusa/firebase-membership-sync.service';
import { cafe24MemberMappings } from '../schema';
import type { ChannelAdapterSchema } from '../types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * MembershipDailySyncService
 *
 * 매일 새벽 2시 전체 정합성 확인:
 * - almond-auth에서 활성 멤버십 목록 조회
 * - 로컬 cafe24_member_mappings 테이블에서 전체 연동 목록 조회
 * - 각 연동 유저에 대해 add/remove 결정 (자연 만료 포함)
 */
@Injectable()
export class MembershipDailySyncService {
  private readonly logger = new Logger(MembershipDailySyncService.name);

  constructor(
    private readonly almondAuthClient: AlmondAuthClient,
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly firebaseMembershipSyncService: FirebaseMembershipSyncService,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Seoul' })
  async reconcileMembership(): Promise<void> {
    this.logger.log('일일 멤버십 정합성 크론 시작');

    try {
      const [activeCafe24Ids, allMappings] = await Promise.all([
        this.almondAuthClient.getActiveCafe24Members(),
        this.dbService.db.select().from(cafe24MemberMappings),
      ]);

      this.logger.log(`정합성 확인: 활성 멤버=${activeCafe24Ids.length}명, 연동 유저=${allMappings.length}명`);

      const activeSet = new Set(activeCafe24Ids);

      for (const { cafe24MemberId } of allMappings) {
        const shouldBeActive = activeSet.has(cafe24MemberId);
        try {
          await this.firebaseMembershipSyncService.syncByFirebase(cafe24MemberId, shouldBeActive);
        } catch (err) {
          this.logger.error(`cafe24MemberId=${cafe24MemberId} 동기화 실패: ${err?.message}`);
        }
        await sleep(200);
      }

      this.logger.log(`일일 멤버십 정합성 크론 완료: ${allMappings.length}명 처리`);
    } catch (error) {
      this.logger.error('일일 멤버십 정합성 크론 실패', error?.stack);
    }
  }

  /**
   * 수동 실행 (테스트 및 관리자용)
   */
  async runManually(): Promise<{ processed: number }> {
    this.logger.log('멤버십 정합성 수동 실행');
    await this.reconcileMembership();
    const allMappings = await this.dbService.db.select().from(cafe24MemberMappings);
    return { processed: allMappings.length };
  }
}
