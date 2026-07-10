import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { userServiceSchema, UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, eq, lt } from 'drizzle-orm';

@Injectable()
export class ExpireEmailCodesService {
  private readonly logger = new Logger(ExpireEmailCodesService.name);
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  // 새 코드 발급 전에 해당 이메일의 미검증 코드를 만료 처리
  async expireExistingCodes(email: string) {
    await this.dbService.db
      .update(userServiceSchema.emailVerifications)
      .set({ isExpired: true })
      .where(
        and(
          eq(userServiceSchema.emailVerifications.email, email),
          eq(userServiceSchema.emailVerifications.isVerified, false),
        ),
      );
  }

  @Cron('0 0 * * *') // 매일 자정
  async cleanupExpiredVerifications() {
    this.logger.log('만료된 이메일 인증 코드 삭제 작업 시작');
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.dbService.db
      .delete(userServiceSchema.emailVerifications)
      .where(lt(userServiceSchema.emailVerifications.expiresAt, twentyFourHoursAgo));
    this.logger.log('만료된 이메일 인증 코드 삭제 작업 완료');
  }
}
