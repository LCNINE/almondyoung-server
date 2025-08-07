import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PolicyService } from './policy.service';
import { POLICY_ACTION_KEY } from './policy.decorator';
import { PolicyValidationContext } from '../shared/schemas/policy.type';
import { SubscriptionService } from '../subscription/subscription.service';
import { DbService } from '@app/db';
import * as schema from '../shared/schemas/entities/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policyService: PolicyService,
    private readonly subscriptionService: SubscriptionService,
    private readonly dbService: DbService<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<string>(
      POLICY_ACTION_KEY,
      context.getHandler(),
    );
    if (!action) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request.user;

    if (!user || !user.userId) {
      return false;
    }

    const validationContext = await this.buildValidationContext(
      user.userId,
      action,
      request.body,
    );

    await this.policyService.validate(action, validationContext);

    return true;
  }

  /**
   * action과 요청 데이터를 기반으로 정책 검증에 필요한 컨텍스트를 동적으로 구성합니다.
   * @param userId - 현재 사용자 ID
   * @param action - 검증할 액션
   * @param body - HTTP 요청의 body
   */
  private async buildValidationContext(
    userId: string,
    action: string,
    body: any,
  ): Promise<PolicyValidationContext> {
    // 1. 기본 컨텍스트 객체를 생성합니다.
    const baseContext: PolicyValidationContext = { userId };

    // 2. 사용자의 현재 구독 정보를 조회하여 tierId를 컨텍스트에 추가합니다.
    const currentSubscription =
      await this.subscriptionService.getCurrentSubscriptionDetails(userId);
    if (currentSubscription) {
      baseContext.tierId = currentSubscription.tier.id;
    }

    // 3. action의 종류에 따라 필요한 추가 데이터를 조회하고 컨텍스트에 추가합니다.
    switch (action) {
      case 'PAUSE_SUBSCRIPTION': {
        // '연간 일시정지 횟수' 정책 검증을 위해 DB에서 올해 일시정지 횟수를 조회합니다.
        const currentYear = new Date().getFullYear();
        const yearStart = new Date(currentYear, 0, 1);

        const [result] = await this.dbService.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.pausePeriods)
          .where(
            and(
              eq(schema.pausePeriods.userId, userId),
              // [수정] 타입 에러를 유발하는 sql 함수 대신 gte 연산자를 사용합니다.
              gte(schema.pausePeriods.createdAt, yearStart),
            ),
          );

        baseContext.pauseCount = result?.count || 0;

        // '최소 일시정지 기간' 정책 검증을 위해 요청 body에서 날짜 정보를 가져옵니다.
        baseContext.pauseStartDate = body.startDate;
        baseContext.pauseEndDate = body.endDate;
        break;
      }

      case 'CHANGE_PLAN': {
        // '플랜 변경 쿨다운' 정책 검증을 위해 마지막 플랜 변경일을 조회하는 로직을 추가할 수 있습니다.
        // const lastChange = ...;
        // baseContext.lastPlanChangeDate = lastChange?.createdAt;
        break;
      }

      // ... 다른 action들에 대한 case를 추가할 수 있습니다.
    }

    return baseContext;
  }
}
