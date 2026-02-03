import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  userServiceSchema,
  UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { and, eq, lt } from 'drizzle-orm';

@Injectable()
export class ExpireExistingCodesService {
  private readonly logger = new Logger(ExpireExistingCodesService.name);
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async expireExistingCodes(phoneNumber: string, tx?: DbTransaction) {
    const client = this.getClient(tx);

    await client
      .update(userServiceSchema.phoneVerifications)
      .set({
        isExpired: true,
      })
      .where(
        and(
          eq(userServiceSchema.phoneVerifications.phoneNumber, phoneNumber),
          eq(userServiceSchema.phoneVerifications.isVerified, false),
        ),
      );
  }

  @Cron('0 0 * * *') // 매일 자정 실행
  async cleanupExpiredVerifications(tx?: DbTransaction) {
    this.logger.log('만료된 핸드폰 번호 인증 코드 삭제 작업 시작');
    const client = this.getClient(tx);

    // 24시간 전 시간
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 24시간 이전에 만료된 레코드들만 삭제
    await client
      .delete(userServiceSchema.phoneVerifications)
      .where(
        lt(userServiceSchema.phoneVerifications.expiresAt, twentyFourHoursAgo),
      );

    this.logger.log('만료된 핸드폰 번호 인증 코드 삭제 작업 완료');
  }
}
