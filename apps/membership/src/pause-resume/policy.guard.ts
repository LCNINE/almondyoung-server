/**
 * 정책 검증 가드
 * 파라미터로 전달받은 정책 액션을 기반으로 검증을 수행합니다.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
  Logger,
  Type,
  mixin,
} from '@nestjs/common';
import { PolicyEngineService } from '../policy-management/policy-engine.service';

/**
 * 정책 가드 팩토리 함수
 * 특정 정책 액션을 검증하는 Guard를 생성합니다.
 * 
 * @param action - 검증할 정책 액션 (예: 'PAUSE_SUBSCRIPTION')
 * @param options - 추가 옵션 (선택사항)
 * 
 * @example
 * ```typescript
 * @UseGuards(PolicyGuard('PAUSE_SUBSCRIPTION'))
 * pauseSubscription() {}
 * 
 * @UseGuards(PolicyGuard('PLAN_CHANGE', { warningOnly: true }))
 * changePlan() {}
 * ```
 */
export function PolicyGuard(
  action: string,
  options?: { warningOnly?: boolean }
): Type<CanActivate> {
  @Injectable()
  class PolicyGuardMixin implements CanActivate {
    private readonly logger = new Logger(`PolicyGuard(${action})`);

    constructor(private readonly policyEngine: PolicyEngineService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest();
      const userId = this.extractUserId(request);

      if (!userId) {
        throw new BadRequestException('사용자 ID를 찾을 수 없습니다.');
      }

      try {
        this.logger.debug(`정책 검증 시작: userId=${userId}, action=${action}`);

        // 정책 검증 실행
        const validationResult = await this.policyEngine.validateRequest(
          userId,
          action,
          this.buildContext(request),
        );

        // 검증 결과를 request에 첨부
        request.policyValidation = {
          isValid: validationResult.isValid,
          violations: validationResult.violations || [],
          warnings: validationResult.warnings || [],
          appliedPolicies: validationResult.appliedPolicies || [],
          executionTime: validationResult.executionTime,
          remainingQuota: this.extractRemainingQuota(validationResult),
        };

        // 정책 위반 처리
        if (!validationResult.isValid) {
          // warningOnly 옵션 처리
          if (options?.warningOnly) {
            this.logger.warn(
              `정책 위반 (경고만): userId=${userId}, action=${action}, violations=${JSON.stringify(validationResult.violations)}`,
            );
            return true;
          }

          this.logger.error(
            `정책 위반: userId=${userId}, action=${action}, violations=${JSON.stringify(validationResult.violations)}`,
          );

          throw new ForbiddenException({
            message: '정책 위반으로 요청이 거부되었습니다.',
            violations: validationResult.violations,
            action,
          });
        }

        this.logger.debug(
          `정책 검증 통과: userId=${userId}, action=${action}, executionTime=${validationResult.executionTime}ms`,
        );

        return true;
      } catch (error) {
        if (error instanceof ForbiddenException) {
          throw error;
        }

        this.logger.error(
          `정책 검증 중 오류 발생: userId=${userId}, action=${action}`,
          error.stack,
        );
        throw new BadRequestException('정책 검증 중 오류가 발생했습니다.');
      }
    }

    /**
     * 요청에서 사용자 ID를 추출합니다.
     */
    private extractUserId(request: any): string | null {
      // JWT에서 추출하는 경우
      if (request.user?.id) {
        return request.user.id;
      }

      // 쿼리 파라미터에서 추출하는 경우 (임시)
      if (request.query?.userId) {
        return request.query.userId;
      }

      // 바디에서 추출하는 경우
      if (request.body?.userId) {
        return request.body.userId;
      }

      return null;
    }

    /**
     * 정책 검증을 위한 컨텍스트를 구성합니다.
     */
    private buildContext(request: any): Record<string, any> {
      const context = {
        ...request.body,
        ...request.params,
        ...request.query,
      };

      // 민감한 정보 제거
      delete context.password;
      delete context.token;

      return context;
    }

    /**
     * 검증 결과에서 남은 할당량 정보를 추출합니다.
     */
    private extractRemainingQuota(validationResult: any): Record<string, number> {
      const quota: Record<string, number> = {};

      validationResult.appliedPolicies?.forEach((policy: any) => {
        if (policy.ruleType === 'MAX_PAUSES_PER_YEAR') {
          const maxPauses = policy.appliedValue;
          const usedPauses = policy.context?.currentUsage || 0;
          quota.remainingPauses = Math.max(0, maxPauses - usedPauses);
        }
      });

      return quota;
    }
  }

  return mixin(PolicyGuardMixin);
}
