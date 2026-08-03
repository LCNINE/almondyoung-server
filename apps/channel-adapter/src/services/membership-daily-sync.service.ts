import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { FirebaseMembershipSyncService } from '../adapters/medusa/firebase-membership-sync.service';
import { MembershipMedusaSyncService } from '../adapters/medusa/membership-medusa-sync.service';
import { MembershipServiceClient } from './membership-service.client';
import { cafe24MemberMappings } from '../schema';
import type { ChannelAdapterSchema } from '../types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * MembershipDailySyncService
 *
 * 매일 새벽 2시 전체 정합성 확인:
 * - 멤버십 서비스(현 SSOT)에서 연동 유저들의 활성 여부 조회
 * - 로컬 cafe24_member_mappings 테이블에서 전체 연동 목록 조회
 * - 각 연동 유저에 대해 add/remove 결정 (자연 만료 포함)
 */
@Injectable()
export class MembershipDailySyncService {
  private readonly logger = new Logger(MembershipDailySyncService.name);

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly firebaseMembershipSyncService: FirebaseMembershipSyncService,
    private readonly membershipServiceClient: MembershipServiceClient,
    private readonly membershipMedusaSyncService: MembershipMedusaSyncService,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Seoul' })
  async reconcileMembership(): Promise<void> {
    this.logger.log('일일 멤버십 정합성 크론 시작');

    try {
      const allMappings = await this.dbService.db.select().from(cafe24MemberMappings);
      const userIds = [...new Set(allMappings.map((m) => m.userId))];
      const activeUserIds = await this.membershipServiceClient.getActiveUserIds(userIds);
      const activeSet = new Set(activeUserIds);

      this.logger.log(`정합성 확인: 활성 멤버=${activeSet.size}명, 연동 유저=${allMappings.length}명`);

      for (const { cafe24MemberId, userId } of allMappings) {
        const shouldBeActive = activeSet.has(userId);
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
   * SSOT 활성 회원 전체 → Medusa 그룹 정합화 (매일 새벽 2시 30분).
   *
   * reconcileMembership 은 cafe24_member_mappings(이관 유저)만 순회하므로,
   * cafe24 매핑이 없는 신규 자체가입자는 커버되지 않는다. 실시간 그룹동기화
   * 이벤트(MembershipStatusChanged)는 best-effort 발행이라 유실 가능한데, 그 경우
   * 이 신규가입자들은 어떤 백스톱도 없이 영구히 그룹에 못 들어간다.
   *
   * 이 크론은 SSOT 활성 회원 전수를 받아 그룹 소속을 보장(누락분 추가)해 그 구멍을 메운다.
   * 만료분 제거는 실시간 EXPIRED 이벤트 + reconcileMembership(cafe24) 가 담당하므로
   * 여기서는 add 만 한다(오제거 위험 회피).
   */
  @Cron('30 2 * * *', { timeZone: 'Asia/Seoul' })
  async reconcileAllActiveMembersToGroup(): Promise<void> {
    this.logger.log('전체 활성회원 그룹 정합화 크론 시작');

    try {
      const activeUserIds = await this.membershipServiceClient.getAllActiveUserIds();
      this.logger.log(`정합화 대상 활성회원=${activeUserIds.length}명`);

      let added = 0;
      let noCustomer = 0;
      let failed = 0;
      for (const userId of activeUserIds) {
        try {
          const result = await this.membershipMedusaSyncService.ensureInMembershipGroup(userId);
          if (result === 'added') added += 1;
          else if (result === 'no_customer') noCustomer += 1;
        } catch (err) {
          failed += 1;
          this.logger.error(`userId=${userId} 그룹 정합화 실패: ${err?.message}`);
        }
        await sleep(200);
      }

      this.logger.log(
        `전체 활성회원 그룹 정합화 완료: 대상 ${activeUserIds.length}명 ` +
          `(그룹보장 ${added} / 고객없음 ${noCustomer} / 실패 ${failed})`,
      );
    } catch (error) {
      this.logger.error('전체 활성회원 그룹 정합화 크론 실패', error?.stack);
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
