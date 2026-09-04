import { Body, Controller, HttpCode, HttpStatus, Logger, Post, UnauthorizedException, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '@app/authorization';
import { DbService } from '@app/db';
import { InboxService } from '../services/inbox.service';
import { MembershipDailySyncService } from '../services/membership-daily-sync.service';
import { CouponIssueReconciliationService } from '../services/coupon-issue-reconciliation.service';
import { UserServiceClient } from '../services/user-service.client';
import { cafe24MemberMappings } from '../schema';
import type { ChannelAdapterSchema } from '../types';

interface FirebaseSyncBody {
  cafe24MemberId: string;
  active: boolean;
}

/**
 * Internal Membership Controller
 *
 * almond-auth Firestore trigger의 멤버십 변경 콜백을 수신합니다.
 * Inbox 패턴으로 즉시 ACK 후 비동기 처리합니다.
 */
// 호출자는 almond-auth Firestore 트리거 / 운영 스크립트라 사용자 JWT 가 없다. 전역 JwtAuthGuard 를
// 면제하는 대신 **모든 핸들러가** `verifyInternalKey()` 로 CHANNEL_ADAPTER_INTERNAL_KEY 를 직접
// 검증한다 — 이 클래스에 핸들러를 추가할 때 그 호출을 빠뜨리면 무인증으로 열린다.
@Public()
@Controller('internal/membership')
export class InternalMembershipController {
  private readonly logger = new Logger(InternalMembershipController.name);

  constructor(
    private readonly inboxService: InboxService,
    private readonly configService: ConfigService,
    private readonly membershipDailySyncService: MembershipDailySyncService,
    private readonly couponIssueReconciliationService: CouponIssueReconciliationService,
    private readonly userServiceClient: UserServiceClient,
    private readonly dbService: DbService<ChannelAdapterSchema>,
  ) {}

  private verifyInternalKey(authorization: string | undefined): void {
    const internalKey = this.configService.get<string>('CHANNEL_ADAPTER_INTERNAL_KEY');
    if (!internalKey) {
      this.logger.error('CHANNEL_ADAPTER_INTERNAL_KEY가 설정되지 않았습니다.');
      throw new UnauthorizedException('Internal key not configured');
    }

    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (token !== internalKey) {
      throw new UnauthorizedException('Invalid internal key');
    }
  }

  @Post('firebase-sync')
  @HttpCode(HttpStatus.OK)
  async handleFirebaseSync(
    @Headers('authorization') authorization: string,
    @Body() body: FirebaseSyncBody,
  ): Promise<{ received: true }> {
    this.verifyInternalKey(authorization);

    const { cafe24MemberId, active } = body;

    if (!cafe24MemberId || typeof active !== 'boolean') {
      this.logger.warn('firebase-sync: cafe24MemberId 또는 active가 누락되었습니다.');
      return { received: true };
    }

    this.logger.log(`firebase-sync 수신: cafe24MemberId=${cafe24MemberId}, active=${active}`);

    await this.inboxService.enqueue({
      eventType: 'FirebaseMembershipSynced',
      aggregateType: 'FirebaseMembership',
      aggregateId: cafe24MemberId,
      partitionKey: cafe24MemberId,
      payload: { cafe24MemberId, active },
    });

    return { received: true };
  }

  /**
   * 일일 정합성 크론 수동 실행 (테스트용)
   * POST /internal/membership/run-daily-sync
   */
  @Post('run-daily-sync')
  @HttpCode(HttpStatus.OK)
  async runDailySync(@Headers('authorization') authorization: string): Promise<{ processed: number }> {
    this.verifyInternalKey(authorization);
    this.logger.log('멤버십 일일 정합성 수동 실행 요청');
    return this.membershipDailySyncService.runManually();
  }

  /**
   * 쿠폰 자동 발급 보정 수동 실행
   * POST /internal/membership/run-coupon-reconciliation
   *
   * failed 상태의 MembershipStatusChanged inbox 이벤트를 pending 으로 리셋해 inbox worker 가 재시도하게 한다.
   * (customer_registered 는 Medusa 안에서 발화하고 inbox 를 지나지 않는다 — #775.)
   */
  @Post('run-coupon-reconciliation')
  @HttpCode(HttpStatus.OK)
  async runCouponReconciliation(
    @Headers('authorization') authorization: string,
  ): Promise<{ reset: number; skipped: number }> {
    this.verifyInternalKey(authorization);
    this.logger.log('쿠폰 발급 보정 수동 실행 요청');
    return this.couponIssueReconciliationService.runManually();
  }

  /**
   * 기존 연동 회원 매핑 백필 (배포 직후 1회 실행)
   * POST /internal/membership/backfill-mappings
   *
   * user-service에서 전체 연동 목록을 조회하여 cafe24_member_mappings 테이블에 upsert.
   * 이 엔드포인트는 일회성 마이그레이션용이며, Kafka 이벤트로 소급 불가능한 기존 데이터를 채웁니다.
   */
  @Post('backfill-mappings')
  @HttpCode(HttpStatus.OK)
  async backfillMappings(@Headers('authorization') authorization: string): Promise<{ upserted: number }> {
    this.verifyInternalKey(authorization);
    this.logger.log('cafe24_member_mappings 백필 시작');

    const links = await this.userServiceClient.getAllLinks();
    const db = this.dbService.db;

    for (const { cafe24MemberId, userId, email } of links) {
      await db
        .insert(cafe24MemberMappings)
        .values({ cafe24MemberId, userId, email, createdAt: new Date(), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: cafe24MemberMappings.cafe24MemberId,
          set: { userId, email, updatedAt: new Date() },
        });
    }

    this.logger.log(`cafe24_member_mappings 백필 완료: ${links.length}건 upsert`);
    return { upserted: links.length };
  }
}
