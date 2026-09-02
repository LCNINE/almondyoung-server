import { DbService, InjectDb } from '@app/db';
import { PublisherFor, InjectPublisher } from '@app/events';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import * as schema from '../../../../database/drizzle/schema';
import { userServiceSchema, type UserServiceSchema } from '../../../../database/drizzle/schema';

/**
 * 탈퇴 계정 보관 기간(년). 개인정보처리방침의 "소비자 불만 또는 분쟁처리에 관한 기록 3년" 에 맞춘다.
 * 이 기간이 지나야 껍데기 행과 그에 딸린 동의 이력·블랙리스트가 함께 삭제된다.
 */
export const WITHDRAWN_RETENTION_YEARS = 3;

@Injectable()
export class DormantService {
  private readonly logger = new Logger(DormantService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectPublisher(USER_STREAM)
    private readonly eventPublisher: PublisherFor<typeof USER_STREAM>,
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
            isNull(schema.users.dormantAt),
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
          dormantAt: new Date(),
        })
        .where(and(inArray(schema.users.id, userIds), isNull(schema.users.dormantAt)));

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

  /**
   * 보관 기간이 끝난 탈퇴 계정을 영구 삭제한다.
   *
   * 여기 남아 있는 행은 이미 식별정보가 파기된 껍데기다(`AuthService.softDeleteUser`).
   * 그럼에도 바로 지우지 않고 보관하는 이유는 함께 cascade 되는 두 가지 때문이다 —
   * 동의 이력(소비자 불만·분쟁 처리 기록 3년)과 블랙리스트(자격 상실자 재가입 차단).
   * 그래서 보관 기간은 그중 긴 쪽인 3년에 맞춘다.
   *
   * 계약·결제 기록의 5년 보관은 여기가 아니라 주문 데이터가 담당하므로 이 삭제에 영향받지 않는다.
   */
  private async permanentDelete(): Promise<number> {
    const withdrawnLimit = new Date();
    withdrawnLimit.setFullYear(withdrawnLimit.getFullYear() - WITHDRAWN_RETENTION_YEARS);
    // 휴면은 아직 익명화 대상이 아니라 개인정보를 그대로 들고 있다. 탈퇴와 기간을 섞지 않고
    // 기존 2년을 유지한다 — 휴면 제도 자체의 존치 여부가 정해지면 그때 함께 조정한다.
    const dormantLimit = new Date();
    dormantLimit.setFullYear(dormantLimit.getFullYear() - 2);

    const batchSize = 1000;
    let totalDeleted = 0;

    while (true) {
      const targetUsers = await this.dbService.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          or(
            and(isNotNull(schema.users.deletedAt), lt(schema.users.deletedAt, withdrawnLimit)),
            and(isNotNull(schema.users.dormantAt), lt(schema.users.dormantAt, dormantLimit)),
          ),
        )
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
