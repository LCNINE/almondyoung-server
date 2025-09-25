import {
  Controller,
  Post,
  Get,
  Body,
  UseFilters,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  HttpException,
  Logger,
} from '@nestjs/common';
import { PauseService } from '../services/pause.service';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { DevAuthGuard } from '../auth/dev-auth.guard'; // 🚨 개발용 임시 가드
import { PolicyGuard } from '../services/policy/policy.guard';
import { CheckPolicies } from '../services/policy/policy.decorator';
import {
  PauseSubscriptionRequestSchema,
  PauseSubscriptionRequest,
  ResumeSubscriptionRequestSchema,
  ResumeSubscriptionRequest,
} from '../shared/schemas';
import { FastifyRequest } from 'fastify';

/**
 * 일시정지 관리 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 */
@Controller('subscriptions/pause')
@UseFilters(SubscriptionExceptionFilter)
export class PauseController {
  private readonly logger = new Logger(PauseController.name);

  constructor(private readonly pauseService: PauseService) {}

  /**
   * 구독 일시정지
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevAuthGuard, PolicyGuard)
  @CheckPolicies('PAUSE_SUBSCRIPTION')
  async pauseSubscription(
    @Req() req: FastifyRequest,
    @Body(new ZodValidationPipe(PauseSubscriptionRequestSchema))
    pauseDto: PauseSubscriptionRequest,
  ) {
    try {
      const userId = req.user!.userId;
      this.logger.log(`구독 일시정지 요청: ${userId}`);

      const result = await this.pauseService.pauseSubscription(
        userId,
        new Date(pauseDto.startDate),
        new Date(pauseDto.endDate),
        pauseDto.reason,
      );

      this.logger.log(`✅ 구독 일시정지 성공: ${userId}`);

      return {
        success: true,
        data: result,
        meta: {
          userId,
          action: 'pause_subscription',
          startDate: pauseDto.startDate,
          endDate: pauseDto.endDate,
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(
        `❌ 구독 일시정지 실패 (${req.user!.userId}):`,
        error.message,
      );

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          '일시정지할 수 있는 활성 구독을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('already') ||
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '일시정지 요청이 유효하지 않습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '구독 일시정지 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 구독 재개
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DevAuthGuard, PolicyGuard)
  @CheckPolicies('RESUME_SUBSCRIPTION')
  async resumeSubscription(
    @Req() req: FastifyRequest,
    // 참고: resumeRequest DTO는 현재 사용되지 않지만, Zod 유효성 검사를 위해 유지합니다.
    @Body(new ZodValidationPipe(ResumeSubscriptionRequestSchema))
    resumeRequest: ResumeSubscriptionRequest,
  ) {
    try {
      const userId = req.user!.userId;
      this.logger.log(`구독 재개 요청: ${userId}`);

      const result = await this.pauseService.resumeSubscription(userId);

      this.logger.log(`✅ 구독 재개 성공: ${userId}`);

      return {
        success: true,
        data: result,
        meta: {
          userId,
          action: 'resume_subscription',
          processedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(
        `❌ 구독 재개 실패 (${req.user!.userId}):`,
        error.message,
      );

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          '재개할 수 있는 일시정지된 구독을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('already') ||
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '구독 재개 요청이 유효하지 않습니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '구독 재개 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 일시정지 이력 조회
   */
  @Get('history')
  @UseGuards(DevAuthGuard)
  async getPauseHistory(@Req() req: FastifyRequest) {
    try {
      const userId = req.user!.userId;
      this.logger.log(`일시정지 이력 조회 요청: ${userId}`);

      const history = await this.pauseService.getPauseHistory(userId);

      this.logger.log(
        `✅ 일시정지 이력 조회 성공: ${userId} → ${history.length}건`,
      );

      return {
        success: true,
        data: history,
        count: history.length,
        meta: {
          userId,
          action: 'get_pause_history',
          retrievedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error(
        `❌ 일시정지 이력 조회 실패 (${req.user!.userId}):`,
        error.message,
      );

      // CTO 스타일: 에러 메시지 패턴 기반 HTTP 응답 변환
      if (
        error.message.includes('not found') ||
        error.message.includes('찾을 수 없')
      ) {
        throw new HttpException(
          '사용자의 일시정지 이력을 찾을 수 없습니다.',
          HttpStatus.NOT_FOUND,
        );
      }

      if (
        error.message.includes('invalid') ||
        error.message.includes('잘못된')
      ) {
        throw new HttpException(
          '잘못된 사용자 정보입니다.',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 기타 모든 오류는 500으로 처리
      throw new HttpException(
        '일시정지 이력 조회 중 오류가 발생했습니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
