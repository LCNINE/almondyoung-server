// policy.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PolicyValidationService } from '../policy-validation.service';
import { POLICY_ACTION_KEY } from './policy.decorator';
import { PolicyValidationContext } from '../../shared/schemas/policy.type';
import { DbService } from '@app/db';
import * as schema from '../../shared/schemas/entities/schema';
import { eq, and, gte, sql, desc } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policyValidationService: PolicyValidationService, // 검증 서비스만 사용
    private readonly dbService: DbService<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<string>(
      POLICY_ACTION_KEY,
      context.getHandler(),
    );

    if (!action) {
      return true; // 정책 검증이 필요 없는 엔드포인트
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

    // PolicyValidationService를 통해 검증
    await this.policyValidationService.validate(action, validationContext);

    return true;
  }

  /**
   * action과 요청 데이터를 기반으로 정책 검증에 필요한 컨텍스트를 동적으로 구성합니다.
   */
  private async buildValidationContext(
    userId: string,
    action: string,
    body: any,
  ): Promise<PolicyValidationContext> {
    const baseContext: PolicyValidationContext = { userId };

    // 현재 구독 정보 조회
    const currentEntitlement =
      await this.dbService.db.query.subscriptionEntitlement.findFirst({
        where: and(
          eq(schema.subscriptionEntitlement.userId, userId),
          eq(schema.subscriptionEntitlement.isCurrent, true),
        ),
      });

    if (currentEntitlement) {
      baseContext.tierId = currentEntitlement.tierId;
      baseContext.subscriptionStartDate = currentEntitlement.startsAt;
    }

    // action별 추가 데이터 조회
    switch (action) {
      case 'PAUSE_SUBSCRIPTION': {
        // 올해 일시정지 횟수 조회
        const currentYear = new Date().getFullYear();
        const yearStart = new Date(currentYear, 0, 1);

        const pauseCountResult = await this.dbService.db
          .select({ count: sql<number>`count(*)` })
          .from(schema.pauseEvents)
          .where(
            and(
              eq(schema.pauseEvents.userId, userId),
              eq(schema.pauseEvents.eventType, 'START'),
              gte(schema.pauseEvents.createdAt, yearStart),
            ),
          );

        baseContext.pauseCount = pauseCountResult[0]?.count || 0;

        // 마지막 일시정지 종료일 조회 (pauseEventDetails에서)
        const lastPauseDetail =
          await this.dbService.db.query.pauseEventDetails.findFirst({
            where: eq(schema.pauseEventDetails.userId, userId),
            orderBy: [desc(schema.pauseEventDetails.endsAt)],
          });

        if (lastPauseDetail?.endsAt) {
          baseContext.lastPauseEndDate = lastPauseDetail.endsAt;
        }

        // body에서 날짜 정보 추가
        if (body.startDate) {
          baseContext.pauseStartDate = body.startDate;
        }
        if (body.endDate) {
          baseContext.pauseEndDate = body.endDate;
        }
        break;
      }

      case 'CHANGE_PLAN': {
        // 마지막 플랜 변경 이벤트 조회
        const lastUpgrade =
          await this.dbService.db.query.eventBatches.findFirst({
            where: eq(schema.eventBatches.type, 'SUBSCRIPTION_UPGRADED'),
            orderBy: [desc(schema.eventBatches.createdAt)],
          });

        if (lastUpgrade?.createdAt) {
          baseContext.lastPlanChangeDate = lastUpgrade.createdAt;
        }

        // 다운그레이드 여부는 body에서
        if (body.isDowngrade !== undefined) {
          baseContext.isDowngrade = body.isDowngrade;
        }

        if (body.newPlanId) {
          baseContext.newPlanId = body.newPlanId;
        }
        break;
      }

      case 'CANCEL_SUBSCRIPTION': {
        // 취소 사유
        if (body.reason) {
          baseContext.cancellationReason = body.reason;
        }
        break;
      }

      default:
        // 알 수 없는 액션의 경우 body 데이터 그대로 전달
        Object.assign(baseContext, body);
        break;
    }

    return baseContext;
  }
}
