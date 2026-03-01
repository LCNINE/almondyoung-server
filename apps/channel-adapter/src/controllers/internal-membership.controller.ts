import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InboxService } from '../services/inbox.service';
import { MembershipDailySyncService } from '../services/membership-daily-sync.service';

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
@Controller('internal/membership')
export class InternalMembershipController {
  private readonly logger = new Logger(InternalMembershipController.name);

  constructor(
    private readonly inboxService: InboxService,
    private readonly configService: ConfigService,
    private readonly membershipDailySyncService: MembershipDailySyncService,
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
  async runDailySync(
    @Headers('authorization') authorization: string,
  ): Promise<{ processed: number }> {
    this.verifyInternalKey(authorization);
    this.logger.log('멤버십 일일 정합성 수동 실행 요청');
    return this.membershipDailySyncService.runManually();
  }
}
