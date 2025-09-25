import {
  Controller,
  Get,
  Param,
  UseFilters,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PlanService } from '../services/plan.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { z } from 'zod';

// Zod 스키마 정의 (컨트롤러 내부에 위치)
const uuidSchema = z.uuid('유효하지 않은 UUID 형식입니다');

/**
 * 플랜 및 티어 관리 컨트롤러
 */
@Controller()
@UseFilters(SubscriptionExceptionFilter)
export class PlanController {
  private readonly logger = new Logger(PlanController.name);

  constructor(private readonly planService: PlanService) {}

  /**
   * 파라미터 유효성 검증 헬퍼 메서드
   */
  private validateParam(
    value: string,
    schema: z.ZodSchema<string>,
    paramName: string,
  ): string {
    try {
      return schema.parse(value);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Invalid ${paramName}: ${error.issues[0].message}`);
      }
      throw new Error(`Invalid ${paramName}`);
    }
  }

  /**
   * 모든 활성 플랜 목록 조회
   */
  @Get('plans')
  async getAllPlans() {
    try {
      this.logger.log('모든 활성 플랜 목록 조회 요청');

      const plans = await this.planService.getAllPlans();

      this.logger.log(`✅ 플랜 목록 조회 성공: ${plans.length}건 조회됨`);

      return {
        success: true,
        data: plans,
        count: plans.length,
        meta: {
          retrievedAt: new Date().toISOString(),
          source: 'plan_list_query',
        },
      };
    } catch (error) {
      this.logger.error('❌ 플랜 목록 조회 실패:', error.message);

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          '플랜 목록을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '잘못된 플랜 조회 요청입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '플랜 목록 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 특정 플랜 상세 조회
   */
  @Get('plans/:planId')
  async getPlanDetails(@Param('planId') planId: string) {
    try {
      this.logger.log(`플랜 상세 조회 요청: ${planId}`);

      // Zod로 planId 유효성 검증
      const validatedPlanId = this.validateParam(planId, uuidSchema, 'planId');

      const plan = await this.planService.getPlanDetails(validatedPlanId);

      this.logger.log(`✅ 플랜 상세 조회 성공: ${planId}`);

      return {
        success: true,
        data: plan,
        meta: {
          planId,
          retrievedAt: new Date().toISOString(),
          source: 'plan_detail_query',
        },
      };
    } catch (error) {
      this.logger.error(`❌ 플랜 상세 조회 실패 (${planId}):`, error.message);

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          `플랜을 찾을 수 없습니다: ${planId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '잘못된 플랜 ID입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '플랜 상세 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 모든 티어 목록 조회
   */
  @Get('tiers')
  async getAllTiers() {
    try {
      this.logger.log('모든 티어 목록 조회 요청');

      const tiers = await this.planService.getAllTiers();

      this.logger.log(`✅ 티어 목록 조회 성공: ${tiers.length}건 조회됨`);

      return {
        success: true,
        data: tiers,
        count: tiers.length,
        meta: {
          retrievedAt: new Date().toISOString(),
          source: 'tier_list_query',
        },
      };
    } catch (error) {
      this.logger.error('❌ 티어 목록 조회 실패:', error.message);

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          '티어 목록을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '잘못된 티어 조회 요청입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '티어 목록 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 특정 티어의 모든 플랜 조회
   */
  @Get('tiers/:tierId/plans')
  async getPlansByTier(@Param('tierId') tierId: string) {
    try {
      this.logger.log(`티어별 플랜 조회 요청: ${tierId}`);

      // Zod로 tierId 유효성 검증
      const validatedTierId = this.validateParam(tierId, uuidSchema, 'tierId');

      const plans = await this.planService.getPlansByTier(validatedTierId);

      this.logger.log(
        `✅ 티어별 플랜 조회 성공: ${tierId} → ${plans.length}건 조회됨`,
      );

      return {
        success: true,
        data: plans,
        count: plans.length,
        meta: {
          tierId,
          retrievedAt: new Date().toISOString(),
          source: 'tier_plans_query',
        },
      };
    } catch (error) {
      this.logger.error(`❌ 티어별 플랜 조회 실패 (${tierId}):`, error.message);

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          `티어를 찾을 수 없습니다: ${tierId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '잘못된 티어 ID입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '티어별 플랜 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 티어별 혜택 조회
   */
  @Get('tiers/:tierId/benefits')
  async getTierBenefits(@Param('tierId') tierId: string) {
    try {
      this.logger.log(`티어별 혜택 조회 요청: ${tierId}`);

      // Zod로 tierId 유효성 검증
      const validatedTierId = this.validateParam(tierId, uuidSchema, 'tierId');

      const tierWithPlans =
        await this.planService.getTierWithPlans(validatedTierId);

      this.logger.log(`✅ 티어별 혜택 조회 성공: ${tierId}`);

      return {
        success: true,
        data: tierWithPlans,
        meta: {
          tierId,
          retrievedAt: new Date().toISOString(),
          source: 'tier_benefits_query',
        },
      };
    } catch (error) {
      this.logger.error(`❌ 티어별 혜택 조회 실패 (${tierId}):`, error.message);

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          `티어를 찾을 수 없습니다: ${tierId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '잘못된 티어 ID입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '티어별 혜택 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
