import { DbService, InjectDb } from '@app/db';
import { StreamPublisher, InjectStreamPublisher } from '@app/events';
import { UserEvents } from '@packages/event-contracts/streams';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';
import { userServiceSchema, type UserServiceSchema } from '../../../../database/drizzle/schema';

@Injectable()
export class DormantService {
  private readonly logger = new Logger(DormantService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectStreamPublisher('users.events.v1')
    private readonly eventPublisher: StreamPublisher<UserEvents>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDormantAccounts() {
    this.logger.log('휴면 계정 전환/삭제 점검 시작');

    try {
      const dormantCount = await this.markDormantUsersAndNotify();
      const deletedCount = await this.permanentDelete();

      this.logger.log(`휴면 계정 전환/삭제 완료 - 휴면 전환: ${dormantCount}건, 영구 삭제: ${deletedCount}건`);
    } catch (error) {
      this.logger.error('휴면 계정 처리 중 오류 발생', error);
    }
  }

  private async markDormantUsersAndNotify(): Promise<number> {
    const oneMinuteAgo = new Date();
    oneMinuteAgo.setFullYear(oneMinuteAgo.getFullYear() - 1);

    const batchSize = 1000;
    let totalProcessed = 0;

    while (true) {
      const targetUsers = await this.dbService.db
        .select({
          id: schema.users.id,
          email: schema.users.email,
        })
        .from(schema.users)
        .innerJoin(schema.userRoleAssignments, eq(schema.userRoleAssignments.userId, schema.users.id))
        .innerJoin(schema.roles, eq(schema.roles.roleId, schema.userRoleAssignments.roleId))
        .where(
          and(
            lt(schema.users.lastActivityAt, oneMinuteAgo),
            isNull(schema.users.deletedAt),
            eq(schema.roles.name, 'user'),
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
        .where(and(inArray(schema.users.id, userIds), isNull(schema.users.deletedAt)));

      // 각 사용자에 대해 휴면 계정 전환이 되었다는 안내 이벤트 발행
      for (const user of targetUsers) {
        try {
          await this.eventPublisher.publishEvent({
            eventType: 'UserDormantConverted',
            aggregateId: user.id,
            payload: {
              userId: user.id,
              email: user.email,
              convertedAt: new Date().toISOString(),
            },
          });
        } catch (error) {
          this.logger.error(`휴면 계정 전환 이벤트 발행 실패 (사용자 ID: ${user.id})`, error);
        }
      }

      totalProcessed += targetUsers.length;
      this.logger.log(`휴면 전환 진행 중: ${totalProcessed}건 처리됨`);

      if (targetUsers.length < batchSize) {
        break;
      }
    }

    return totalProcessed;
  }

  // 휴면 상태에서(deletedAt) 2년 이상 지난 사용자를 영구 삭제
  private async permanentDelete(): Promise<number> {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const batchSize = 1000;
    let totalDeleted = 0;

    while (true) {
      const targetUsers = await this.dbService.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(isNotNull(schema.users.deletedAt), lt(schema.users.deletedAt, twoYearsAgo)))
        .limit(batchSize);

      if (targetUsers.length === 0) {
        break;
      }

      const userIds = targetUsers.map((user) => user.id);

      await this.dbService.db.delete(schema.users).where(inArray(schema.users.id, userIds));

      // 각 사용자에 대해 영구 삭제가 되었다는 안내 이벤트 발행
      for (const user of targetUsers) {
        await this.eventPublisher.publishEvent({
          eventType: 'UserPermanentDeleted',
          aggregateId: user.id,
          payload: {
            userId: user.id,
            deletedAt: new Date().toISOString(),
          },
        });
      }

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
