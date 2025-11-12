import {
  Controller,
  Get,
  Post,
  Body,
  UseFilters,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
// import { AuthGuard } from '@nestjs/passport'; // 실제 AuthGuard 대신 DevAuthGuard를 사용합니다.
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionCancellationService } from '../services/subscription-cancellation.service';
import { CancellationReasonReader } from '../services/subscription/cancellation-reason.reader';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import {
  CreateSubscriptionRequestSchema,
  CreateSubscriptionRequest,
  UpgradeSubscriptionRequestSchema,
  UpgradeSubscriptionRequest,
  DowngradeSubscriptionRequestSchema,
  DowngradeSubscriptionRequest,
  CancelSubscriptionRequestSchema,
  CancelSubscriptionRequest,
} from '../shared/schemas';

import {
  SubscriptionDetailsResponseDto,
  SubscriptionHistoryResponseDto,
  ErrorResponseDto,
  CancellationResultDto,
  CancellationReasonsResponseDto,
} from '../shared/dto/response.dto';
import {
  CreateSubscriptionRequestDto,
  UpgradeSubscriptionRequestDto,
  DowngradeSubscriptionRequestDto,
  CancelSubscriptionRequestDto,
} from '../shared/dto/request.dto';
import { ZodValidationPipe } from '../shared/pipes/zod-validation.pipe';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../../../libs/auth-core/src/guards/jwt-auth.guard';
import { User } from '../../../../libs/auth-core/src/decorators/user.decorator';
/**
 * 구독 관리 컨트롤러
 * 🚨 [주의] 현재 개발용 임시 인증 가드(DevAuthGuard)를 사용하고 있습니다.
 * 실제 프로덕션 배포 전 반드시 실제 인증 가드(AuthGuard('jwt'))로 교체해야 합니다.
 */
@ApiTags('subscriptions')
@Controller('subscriptions')
@UseFilters(SubscriptionExceptionFilter)
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly cancellationService: SubscriptionCancellationService,
    private readonly cancellationReasonReader: CancellationReasonReader,
  ) {}

  /**
   * 현재 구독 상태 조회 (Lazy Expiration 적용)
   *
   * @description 사용자의 현재 구독 상태를 조회합니다.
   * 만료된 구독의 경우 상태를 자동으로 정규화합니다.
   *
   * @sideEffect 만료된 구독의 isCurrent 플래그를 false로 업데이트
   * @rationale 데이터 정합성 보장 및 성능 최적화
   * @httpMethod GET (데이터 정규화는 허용되는 사이드 이펙트)
   */
  @Get('current')
  @ApiOperation({
    summary: '현재 구독 상태 조회',
    description:
      '사용자의 현재 활성 구독 정보를 플랜 및 티어 정보와 함께 조회합니다. 만료된 구독은 자동으로 정규화됩니다.',
  })
  @ApiQuery({
    name: 'userId',
    description: '사용자 ID (개발용)',
    required: false,
    example: 'test_user_001',
  })
  @ApiResponse({
    status: 200,
    description: '구독 상태 조회 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '활성 구독을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  async getCurrentSubscriptionDetails(@User('userId') userId: string) {
    return this.subscriptionService.getCurrentSubscriptionDetails(userId);
  }
  /**
   * 구독 생성
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '새 구독 생성',
    description: '지정된 플랜으로 새로운 구독을 생성합니다.',
  })
  @ApiQuery({
    name: 'userId',
    description: '사용자 ID (개발용)',
    required: false,
    example: 'test_user_001',
  })
  @ApiBody({ type: CreateSubscriptionRequestDto })
  @ApiResponse({
    status: 201,
    description: '구독 생성 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 데이터',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '플랜을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  // @UseGuards(DevAuthGuard) // 🚨 임시로 비활성화
  async createSubscription(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(CreateSubscriptionRequestSchema))
    createSubscriptionDto: CreateSubscriptionRequest,
  ) {
    return this.subscriptionService.createSubscription(
      userId,
      createSubscriptionDto.planId,
    );
  }

  /**
   * 구독 업그레이드
   */
  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '구독 업그레이드',
    description: '현재 구독을 더 높은 등급의 플랜으로 업그레이드합니다.',
  })
  @ApiSecurity('dev-user-id')
  @ApiBody({ type: UpgradeSubscriptionRequestDto })
  @ApiResponse({
    status: 200,
    description: '구독 업그레이드 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '업그레이드 불가능한 플랜',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '활성 구독 또는 플랜을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async upgradeSubscription(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(UpgradeSubscriptionRequestSchema))
    upgradeSubscriptionDto: UpgradeSubscriptionRequest,
  ) {
    return this.subscriptionService.upgradeSubscription(
      userId,
      upgradeSubscriptionDto.newPlanId,
    );
  }

  /**
   * 구독 다운그레이드
   */
  @Post('downgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '구독 다운그레이드',
    description: '현재 구독을 더 낮은 등급의 플랜으로 다운그레이드합니다.',
  })
  @ApiSecurity('dev-user-id')
  @ApiBody({ type: DowngradeSubscriptionRequestDto })
  @ApiResponse({
    status: 200,
    description: '구독 다운그레이드 성공',
    type: SubscriptionDetailsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '다운그레이드 불가능한 플랜',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '활성 구독 또는 플랜을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async downgradeSubscription(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(DowngradeSubscriptionRequestSchema))
    downgradeSubscriptionDto: DowngradeSubscriptionRequest,
  ) {
    // 참고: 서비스 로직에 downgradeSubscription 메소드가 필요합니다.
    return this.subscriptionService.upgradeSubscription(
      userId,
      downgradeSubscriptionDto.newPlanId,
    );
  }

  /**
   * 구독 취소
   */
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '구독 취소',
    description: '현재 활성 구독을 취소합니다.',
  })
  @ApiBody({ type: CancelSubscriptionRequestDto })
  @ApiResponse({
    status: 200,
    description: '구독 취소 성공',
    type: CancellationResultDto,
  })
  @ApiResponse({
    status: 404,
    description: '취소할 활성 구독을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async cancelSubscription(
    @User('userId') userId: string,
    @Body(new ZodValidationPipe(CancelSubscriptionRequestSchema))
    cancelSubscriptionDto: CancelSubscriptionRequest,
  ) {
    try {
      return await this.cancellationService.cancelSubscription(
        userId,
        cancelSubscriptionDto.reasonCode,
        cancelSubscriptionDto.reasonText,
      );
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) {
        throw new NotFoundException(e.message);
      }
      if (msg.includes('already cancelled')) {
        throw new BadRequestException(e.message);
      }
      throw new InternalServerErrorException(e.message);
    }
  }

  /**
   * 구독 이력 조회
   */
  @Get('history')
  @ApiOperation({
    summary: '구독 이력 조회',
    description: '사용자의 모든 구독 이력을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '구독 이력 조회 성공',
    type: SubscriptionHistoryResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '구독 이력을 찾을 수 없음',
    type: ErrorResponseDto,
  })
  @UseGuards(JwtAuthGuard) // 🚨 임시 가드 사용
  async getSubscriptionHistory(@User('userId') userId: string) {
    return this.subscriptionService.getSubscriptionHistory(userId);
  }

  /**
   * 취소 이유 목록 조회
   */
  @Get('cancellation-reasons')
  @ApiOperation({
    summary: '취소 이유 목록 조회',
    description: '활성화된 구독 취소 이유 목록을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '취소 이유 목록 조회 성공',
    type: CancellationReasonsResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  async getCancellationReasons(@User('userId') userId: string) {
    const reasons = await this.cancellationReasonReader.findActiveReasons();
    return {
      reasons,
    };
  }
}
