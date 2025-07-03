import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, isNull, isNotNull, lt, inArray } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';

@Injectable()
export class DormantService {
  private readonly logger = new Logger(DormantService.name);

  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDormantAccounts() {
    this.logger.log('휴면 계정 전환/삭제 점검 시작');

    try {
      const dormantCount = await this.convertToDormant();
      const deletedCount = await this.permanentDelete();

      this.logger.log(
        `휴면 계정 전환/삭제 완료 - 휴면 전환: ${dormantCount}건, 영구 삭제: ${deletedCount}건`,
      );
    } catch (error) {
      this.logger.error('휴면 계정 처리 중 오류 발생', error);
    }
  }

  private async convertToDormant(): Promise<number> {
    const oneMinuteAgo = new Date();
    oneMinuteAgo.setFullYear(oneMinuteAgo.getFullYear() - 1);

    const batchSize = 1000;
    let totalProcessed = 0;

    while (true) {
      const targetUsers = await this.dbService.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            lt(schema.users.lastActivityAt, oneMinuteAgo),
            isNull(schema.users.deletedAt),
          ),
        )
        .limit(batchSize);

      if (targetUsers.length === 0) {
        break;
      }

      const userIds = targetUsers.map((user) => user.id);

      await this.dbService.db
        .update(schema.users)
        .set({
          deletedAt: new Date(),
        })
        .where(
          and(
            inArray(schema.users.id, userIds),
            isNull(schema.users.deletedAt),
          ),
        );

      totalProcessed += targetUsers.length;
      this.logger.log(`휴면 전환 진행 중: ${totalProcessed}건 처리됨`);

      if (targetUsers.length < batchSize) {
        break;
      }
    }

    return totalProcessed;
  }

  private async permanentDelete(): Promise<number> {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const batchSize = 1000;
    let totalDeleted = 0;

    while (true) {
      const targetUsers = await this.dbService.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            isNotNull(schema.users.deletedAt),
            lt(schema.users.deletedAt, twoYearsAgo),
          ),
        )
        .limit(batchSize);

      if (targetUsers.length === 0) {
        break;
      }

      const userIds = targetUsers.map((user) => user.id);

      await this.dbService.db
        .delete(schema.users)
        .where(inArray(schema.users.id, userIds));

      totalDeleted += targetUsers.length;
      this.logger.log(`영구 삭제 진행 중: ${totalDeleted}건 삭제됨`);

      if (targetUsers.length < batchSize) {
        break;
      }
    }

    return totalDeleted;
  }

  async processDormantAccountsManually() {
    this.logger.log('수동 휴면 계정 처리 시작');
    return await this.handleDormantAccounts();
  }
}
