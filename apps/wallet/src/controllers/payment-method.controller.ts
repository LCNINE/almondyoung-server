// controllers/payment-methods.controller.ts
import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Headers,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from '@nestjs/swagger';
import { CreateGeneralPaymentMethodDto } from '../shared/dtos/create-general-payment-method.dto';
import {
  PaymentMethodResponseDto,
  UserPaymentMethodsResponseDto,
  SetDefaultPaymentMethodDto,
} from '../shared/dtos/payment-methods/payment-method-response.dto';
import { PaymentService } from '../services/payment.service';
import { PaymentMethodService } from '../services/payment-method.service';

/**
 * 결제수단 관리 컨트롤러 v3.2
 * - Hybrid Approach: 용도(recurring/one-time)와 타입(card/bnpl)을 URL에 명시
 * - 개발자 직관성 향상 및 API 일관성 확보
 * - PaymentService Facade Pattern으로 통합 처리
 * - 모든 비즈니스 로직은 Service로 위임
 */
@ApiTags('결제수단 관리')
@Controller('payment-methods')
export class PaymentMethodController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly paymentMethodService: PaymentMethodService,
  ) {}

  @Post('one-time/point')
  @HttpCode(201)
  @ApiOperation({
    summary: '포인트 결제수단 등록',
    description: '내부 리워드 포인트 결제수단을 등록합니다',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: '멱등성 키 (선택사항)',
  })
  @ApiResponse({
    status: 201,
    description: '결제수단 등록 성공',
    type: PaymentMethodResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'BNPL 또는 잘못된 요청 데이터',
  })
  async registerPointMethod(
    @Body() dto: CreateGeneralPaymentMethodDto,
    @Headers('idempotency-key') idemKey?: string,
  ): Promise<PaymentMethodResponseDto> {
    // 📝 지원하는 타입: CARD (HMS CMS 정기결제), REWARD_POINT만 (BNPL은 /bnpl/register 사용)

    // PaymentService를 통해 포인트 등록 처리
    const result = await this.paymentService.registerPaymentMethod(
      'REWARD_POINT',
      dto,
      idemKey,
    );

    if (!result.success) {
      throw new BadRequestException(result.error);
    }

    // PaymentMethodService를 통해 등록된 결제수단 정보 조회 후 반환
    const method = await this.paymentMethodService.get(result.paymentMethodId!);
    return {
      id: method.id,
      userId: method.userId,
      methodType: method.methodType,
      methodName: method.methodName,
      status: method.status,
      isDefault: method.isDefault,
      hmsMemberId: result.hmsMemberId,
      createdAt: method.createdAt.toISOString(),
    };
  }

  @Post('recurring/card')
  @HttpCode(201)
  @ApiOperation({
    summary: '정기결제용 카드 등록',
    description:
      'HMS CMS를 통한 카드 정기결제 회원을 등록합니다. 빌링키를 발급받아 저장합니다.',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: false,
    description: '멱등성 키 (선택사항)',
  })
  @ApiResponse({
    status: 201,
    description: 'HMS CMS 회원 등록 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        paymentMethodId: {
          type: 'string',
          example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
        },
        hmsMemberId: { type: 'string', example: 'HMS_123456789' },
        status: { type: 'string', example: 'PENDING' },
        message: { type: 'string', example: 'HMS CMS 정기결제 회원 등록 완료' },
        maskedCardNumber: { type: 'string', example: '1234-****-****-5678' },
        billingCycleDay: { type: 'number', example: 15 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '카드 정보 누락 또는 HMS API 에러',
  })
  async registerRecurringCard(
    @Body() dto: CreateGeneralPaymentMethodDto,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    // HMS CMS 전용 검증
    if (dto.methodType !== 'CARD' || !dto.cardInfo) {
      throw new BadRequestException('HMS CMS 등록은 카드 정보가 필요합니다');
    }

    // PaymentService를 통해 정기결제 카드 등록 처리 (HMS CMS)
    const result = await this.paymentService.registerPaymentMethod(
      'CARD',
      dto,
      idemKey,
      'RECURRING', // usage 파라미터 추가
    );

    if (!result.success) {
      throw new BadRequestException(result.error);
    }

    // PaymentMethodService를 통해 등록된 결제수단 정보 조회 후 반환
    const method = await this.paymentMethodService.get(result.paymentMethodId!);
    return {
      id: method.id,
      userId: method.userId,
      methodType: method.methodType,
      methodName: method.methodName,
      status: method.status,
      hmsMemberId: result.hmsMemberId,
      createdAt: method.createdAt.toISOString(),
    };
  }

  @Get('users/:userId')
  @ApiOperation({
    summary: '사용자 결제수단 목록 조회',
    description:
      'PENDING 상태 BNPL 포함, 모든 결제수단을 상태별로 분류하여 반환',
  })
  @ApiParam({
    name: 'userId',
    description: '사용자 ID',
    example: 'user_123456789',
  })
  @ApiResponse({
    status: 200,
    description: '결제수단 목록 조회 성공',
    type: UserPaymentMethodsResponseDto,
  })
  async getUserPaymentMethods(
    @Param('userId') userId: string,
  ): Promise<UserPaymentMethodsResponseDto> {
    return await this.paymentMethodService.getUserMethodsWithStatus(userId);
  }

  @Put(':id/set-default')
  @ApiOperation({
    summary: '기본 결제수단 설정',
    description: 'ACTIVE 상태의 결제수단만 기본으로 설정 가능',
  })
  @ApiParam({
    name: 'id',
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: '기본 결제수단 설정 성공',
    type: PaymentMethodResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'PENDING 상태 결제수단은 기본으로 설정 불가',
  })
  async setDefaultPaymentMethod(
    @Param('id') methodId: string,
    @Body() dto: SetDefaultPaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return await this.paymentMethodService.setAsDefault(methodId, dto.userId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '결제수단 삭제',
    description: '외부 시스템 정리 후 DB에서 삭제',
  })
  @ApiParam({
    name: 'id',
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @ApiResponse({
    status: 200,
    description: '결제수단 삭제 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: '결제수단이 삭제되었습니다' },
      },
    },
  })
  async deletePaymentMethod(@Param('id') methodId: string) {
    return await this.paymentMethodService.delete(methodId);
  }

  @Get(':id/verify')
  @ApiOperation({
    summary: '결제수단 검증',
    description: '외부 시스템에서 결제수단 유효성 확인',
  })
  async verifyPaymentMethod(@Param('id') methodId: string) {
    // 검증은 각 MethodService에서 처리
    throw new BadRequestException(
      '결제수단별 검증 API를 사용하세요 (/bnpl/status, /hms-cms/validate 등)',
    );
  }

  @Get('hms-cms/:hmsMemberId/validate')
  @ApiOperation({
    summary: 'HMS CMS Member ID 검증',
    description: '등록된 HMS CMS 회원 ID의 유효성을 확인합니다.',
  })
  @ApiParam({
    name: 'hmsMemberId',
    description: 'HMS Member ID',
    example: 'HMS_123456789',
  })
  @ApiResponse({
    status: 200,
    description: 'HMS Member ID 검증 결과',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', example: true },
        memberId: { type: 'string', example: 'HMS_123456789' },
        status: { type: 'string', example: 'ACTIVE' },
        message: { type: 'string', example: 'HMS Member ID 유효' },
      },
    },
  })
  async validateHmsCmsMember(@Param('hmsMemberId') hmsMemberId: string) {
    // PaymentService를 통해 카드 전략의 검증 기능 사용
    const statusResult = await this.paymentService.getMemberStatus(
      'CARD',
      hmsMemberId,
    );
    const isValid = statusResult.success && statusResult.status === 'ACTIVE';

    return {
      valid: isValid,
      memberId: hmsMemberId,
      status: isValid ? 'ACTIVE' : 'INVALID',
      message: isValid ? 'HMS Member ID 유효' : 'HMS Member ID 무효 또는 만료',
    };
  }

  @Get('hms-cms/:hmsMemberId/info')
  @ApiOperation({
    summary: 'HMS CMS 회원 정보 조회',
    description: 'HMS CMS 정기결제 회원의 상세 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'hmsMemberId',
    description: 'HMS Member ID',
    example: 'HMS_123456789',
  })
  async getHmsCmsMemberInfo(@Param('hmsMemberId') hmsMemberId: string) {
    // PaymentService를 통해 카드 전략의 정보 조회 기능 사용
    const statusResult = await this.paymentService.getMemberStatus(
      'CARD',
      hmsMemberId,
    );

    if (!statusResult.success) {
      throw new BadRequestException(statusResult.error);
    }

    return {
      memberId: hmsMemberId,
      status: statusResult.status,
      hmsStatus: statusResult.hmsStatus,
      metadata: statusResult.metadata,
    };
  }
}
