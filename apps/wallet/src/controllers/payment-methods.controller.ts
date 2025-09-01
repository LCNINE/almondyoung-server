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
import { PaymentMethodService } from '../services/payment-methods.service';

/**
 * 결제수단 관리 컨트롤러
 * - 카드, 포인트 등 일반 결제수단 관리
 * - BNPL은 /bnpl 엔드포인트 사용 (별도 프로세스)
 * - 모든 비즈니스 로직은 Service로 위임
 */
@ApiTags('결제수단 관리')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: '결제수단 등록',
    description:
      '카드, 포인트 결제수단을 등록합니다. BNPL은 /bnpl/register를 사용하세요.',
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
  async createPaymentMethod(
    @Body() dto: CreateGeneralPaymentMethodDto,
    @Headers('idempotency-key') idemKey?: string,
  ): Promise<PaymentMethodResponseDto> {
    // 📝 지원하는 타입: CARD, REWARD_POINT만 (BNPL은 /bnpl/register 사용)

    return await this.paymentMethodService.createWithAdapter(dto, idemKey);
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
    return await this.paymentMethodService.deleteWithAdapter(methodId);
  }

  @Get(':id/verify')
  @ApiOperation({
    summary: '결제수단 검증',
    description: '외부 시스템에서 결제수단 유효성 확인',
  })
  async verifyPaymentMethod(@Param('id') methodId: string) {
    return await this.paymentMethodService.verifyWithAdapter(methodId);
  }
}
