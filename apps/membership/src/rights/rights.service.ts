import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, isNull } from 'drizzle-orm';
import * as schema from '../shared/schemas/entities/schema';
import { RightsNotFoundException } from '../shared/exceptions/subscription.exceptions';

import { addDays } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import type {
  UserRightsResponse,
  BulkSubscriptionCheckResponse,
  SubscriptionRight,
  NewSubscriptionRight,
} from '../shared/schemas';

@Injectable()
export class RightsService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 사용자 권한 생성
   */
  async createUserRights(
    userId: string,
    subscriptionId: string,
    tierId: string,
    startsAt: Date,
    endsAt: Date,
    createdByEventId?: string,
  ): Promise<SubscriptionRight> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 기존 활성 권한 종료
      await this.terminateActiveRights(tx, userId);

      // 2. 새 권한 생성
      const rightId = uuidv4();
      const newRight: NewSubscriptionRight = {
        id: rightId,
        userId,
        tierId,
        subscriptionId,
        startsAt: startsAt.toISOString().split('T')[0],
        endsAt: endsAt.toISOString().split('T')[0],
        isActive: true,
        createdByEventId,
      };

      await tx.insert(schema.subscriptionRights).values(newRight);

      // 3. 생성된 권한 조회
      const createdRight = await tx
        .select()
        .from(schema.subscriptionRights)
        .where(eq(schema.subscriptionRights.id, rightId))
        .limit(1);

      // 4. 이벤트 기록
      await tx.insert(schema.subscriptionEvents).values({
        id: uuidv4(),
        eventType: 'USER_RIGHTS_CREATED',
        userId,
        subscriptionId,
        effectiveDate: startsAt.toISOString().split('T')[0],
        eventPayload: {
          rightId,
          tierId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          createdByEventId,
        },
      });

      return createdRight[0];
    });
  }

  /**
   * 사용자 권한 종료
   */
  async terminateUserRights(
    userId: string,
    reason: string,
    closedByEventId?: string,
  ): Promise<void> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 활성 권한 조회
      const activeRights = await tx
        .select()
        .from(schema.subscriptionRights)
        .where(
          and(
            eq(schema.subscriptionRights.userId, userId),
            eq(schema.subscriptionRights.isActive, true),
          ),
        );

      if (activeRights.length === 0) {
        throw new RightsNotFoundException();
      }

      // 2. 권한 종료 처리
      const closedAt = new Date();
      for (const right of activeRights) {
        await tx
          .update(schema.subscriptionRights)
          .set({
            isActive: false,
            closedAt,
            closedByEventId,
          })
          .where(eq(schema.subscriptionRights.id, right.id));

        // 3. 이벤트 기록
        await tx.insert(schema.subscriptionEvents).values({
          id: uuidv4(),
          eventType: 'USER_RIGHTS_TERMINATED',
          userId,
          subscriptionId: right.subscriptionId,
          effectiveDate: closedAt.toISOString().split('T')[0],
          eventPayload: {
            rightId: right.id,
            reason,
            closedByEventId,
            originalEndsAt: right.endsAt,
          },
        });
      }
    });
  }

  /**
   * 사용자 권한 일시정지
   */
  async pauseUserRights(userId: string, pausedAt: Date): Promise<void> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 활성 권한 조회
      const activeRights = await tx
        .select()
        .from(schema.subscriptionRights)
        .where(
          and(
            eq(schema.subscriptionRights.userId, userId),
            eq(schema.subscriptionRights.isActive, true),
            isNull(schema.subscriptionRights.pausedAt),
          ),
        );

      if (activeRights.length === 0) {
        throw new RightsNotFoundException();
      }

      // 2. 권한 일시정지 처리
      for (const right of activeRights) {
        await tx
          .update(schema.subscriptionRights)
          .set({
            pausedAt,
          })
          .where(eq(schema.subscriptionRights.id, right.id));

        // 3. 이벤트 기록
        await tx.insert(schema.subscriptionEvents).values({
          id: uuidv4(),
          eventType: 'USER_RIGHTS_PAUSED',
          userId,
          subscriptionId: right.subscriptionId,
          effectiveDate: pausedAt.toISOString().split('T')[0],
          eventPayload: {
            rightId: right.id,
            pausedAt: pausedAt.toISOString(),
          },
        });
      }
    });
  }

  /**
   * 사용자 권한 재개
   */
  async resumeUserRights(userId: string, newEndsAt?: Date): Promise<void> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 일시정지된 권한 조회
      const pausedRights = await tx
        .select()
        .from(schema.subscriptionRights)
        .where(
          and(
            eq(schema.subscriptionRights.userId, userId),
            eq(schema.subscriptionRights.isActive, true),
            // pausedAt이 null이 아닌 경우
          ),
        );

      const actualPausedRights = pausedRights.filter(
        (right) => right.pausedAt !== null,
      );

      if (actualPausedRights.length === 0) {
        throw new RightsNotFoundException();
      }

      // 2. 권한 재개 처리
      const resumedAt = new Date();
      for (const right of actualPausedRights) {
        const updateData = {
          pausedAt: null,
          ...(newEndsAt !== undefined && {
            endsAt: newEndsAt.toISOString().split('T')[0],
          }),
        };

        await tx
          .update(schema.subscriptionRights)
          .set(updateData)
          .where(eq(schema.subscriptionRights.id, right.id));

        // 3. 이벤트 기록
        await tx.insert(schema.subscriptionEvents).values({
          id: uuidv4(),
          eventType: 'USER_RIGHTS_RESUMED',
          userId,
          subscriptionId: right.subscriptionId,
          effectiveDate: resumedAt.toISOString().split('T')[0],
          eventPayload: {
            rightId: right.id,
            resumedAt: resumedAt.toISOString(),
            newEndsAt: newEndsAt?.toISOString(),
            originalEndsAt: right.endsAt,
          },
        });
      }
    });
  }

  /**
   * 사용자 권한 조회
   */
  async getUserRights(userId: string): Promise<UserRightsResponse | null> {
    const result = await this.dbService.db
      .select({
        right: schema.subscriptionRights,
        tier: schema.subscriptionTiers,
      })
      .from(schema.subscriptionRights)
      .innerJoin(
        schema.subscriptionTiers,
        eq(schema.subscriptionRights.tierId, schema.subscriptionTiers.id),
      )
      .where(
        and(
          eq(schema.subscriptionRights.userId, userId),
          eq(schema.subscriptionRights.isActive, true),
        ),
      )
      .limit(1);

    if (!result.length) {
      return null;
    }

    const { right, tier } = result[0];

    return {
      userId: right.userId,
      tierId: right.tierId,
      startsAt: right.startsAt,
      endsAt: right.endsAt,
      isActive: right.isActive,
      pausedAt: right.pausedAt,
      tierCode: tier.code,
      isPaused: right.pausedAt !== null,
    };
  }

  /**
   * 벌크 구독 확인
   */
  async bulkCheckSubscriptions(
    userIds: string[],
  ): Promise<BulkSubscriptionCheckResponse> {
    const results = await this.dbService.db
      .select({
        right: schema.subscriptionRights,
        tier: schema.subscriptionTiers,
      })
      .from(schema.subscriptionRights)
      .innerJoin(
        schema.subscriptionTiers,
        eq(schema.subscriptionRights.tierId, schema.subscriptionTiers.id),
      )
      .where(
        and(
          // userIds 배열에 포함된 사용자들
          eq(schema.subscriptionRights.isActive, true),
        ),
      );

    // userIds에 포함된 사용자들만 필터링
    const filteredResults = results.filter((result) =>
      userIds.includes(result.right.userId),
    );

    const response: BulkSubscriptionCheckResponse = {};

    // 모든 요청된 사용자 ID에 대해 초기화
    userIds.forEach((userId) => {
      response[userId] = {
        hasActiveSubscription: false,
      };
    });

    // 활성 구독이 있는 사용자들 업데이트
    filteredResults.forEach(({ right, tier }) => {
      const today = new Date().toISOString().split('T')[0];
      const isExpired = right.endsAt < today;
      const isPaused = right.pausedAt !== null;

      response[right.userId] = {
        hasActiveSubscription: !isExpired,
        tierCode: tier.code,
        isPaused,
        expiresAt: right.endsAt,
      };
    });

    return response;
  }

  /**
   * 권한 유효성 검증
   */
  async validateUserRights(
    userId: string,
    requiredTierLevel?: number,
  ): Promise<boolean> {
    const userRights = await this.getUserRights(userId);

    if (!userRights) {
      return false;
    }

    // 일시정지 중인 경우
    if (userRights.isPaused) {
      return false;
    }

    // 만료된 경우
    const today = new Date().toISOString().split('T')[0];
    if (userRights.endsAt < today) {
      return false;
    }

    // 특정 티어 레벨이 요구되는 경우
    if (requiredTierLevel !== undefined) {
      const tier = await this.dbService.db
        .select()
        .from(schema.subscriptionTiers)
        .where(eq(schema.subscriptionTiers.id, userRights.tierId))
        .limit(1);

      if (!tier.length || tier[0].priorityLevel < requiredTierLevel) {
        return false;
      }
    }

    return true;
  }

  /**
   * 활성 권한 종료 (내부 메서드)
   */
  private async terminateActiveRights(tx: any, userId: string): Promise<void> {
    const activeRights = await tx
      .select()
      .from(schema.subscriptionRights)
      .where(
        and(
          eq(schema.subscriptionRights.userId, userId),
          eq(schema.subscriptionRights.isActive, true),
        ),
      );

    if (!Array.isArray(activeRights)) {
      return;
    }

    const closedAt = new Date();
    for (const right of activeRights) {
      await tx
        .update(schema.subscriptionRights)
        .set({
          isActive: false,
          closedAt,
        })
        .where(eq(schema.subscriptionRights.id, right.id));
    }
  }

  /**
   * 권한 연장
   */
  async extendUserRights(
    userId: string,
    additionalDays: number,
    reason: string,
  ): Promise<void> {
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 활성 권한 조회
      const activeRights = await tx
        .select()
        .from(schema.subscriptionRights)
        .where(
          and(
            eq(schema.subscriptionRights.userId, userId),
            eq(schema.subscriptionRights.isActive, true),
          ),
        );

      if (activeRights.length === 0) {
        throw new RightsNotFoundException();
      }

      // 2. 권한 연장 처리
      for (const right of activeRights) {
        const currentEndDate = new Date(right.endsAt);
        const newEndDate = addDays(currentEndDate, additionalDays);

        await tx
          .update(schema.subscriptionRights)
          .set({
            endsAt: newEndDate.toISOString().split('T')[0],
          })
          .where(eq(schema.subscriptionRights.id, right.id));

        // 3. 이벤트 기록
        await tx.insert(schema.subscriptionEvents).values({
          id: uuidv4(),
          eventType: 'USER_RIGHTS_EXTENDED',
          userId,
          subscriptionId: right.subscriptionId,
          effectiveDate: new Date().toISOString().split('T')[0],
          eventPayload: {
            rightId: right.id,
            originalEndsAt: right.endsAt,
            newEndsAt: newEndDate.toISOString().split('T')[0],
            additionalDays,
            reason,
          },
        });
      }
    });
  }
}
