import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/create-payment-method.dto';
import { ActivateBNPLDto } from './dto/activate-bnpl.dto';
import { DeactivateBNPLDto } from './dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from './dto/bnpl-account.response.dto';
import {
  PaymentMethodService,
  PaymentMethodWithDetails,
} from './payment-method.service';

@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly paymentMethodService: PaymentMethodService) {}

  /**
   * 외부 PG사 연동이 필요한 결제수단을 생성합니다.
   * (카드, 은행계좌 등)
   *
   * BNPL은 별도 API를 사용해주세요: POST /payment-methods/bnpl/activate
   */
  @Post()
  createPaymentMethod(@Body() dto: CreatePaymentMethodDto): Promise<unknown> {
    return this.paymentMethodService.createPaymentMethod(dto);
  }

  @Get()
  async getPaymentMethodsByUserId(
    @Query('userId') userId: number,
  ): Promise<PaymentMethodWithDetails[]> {
    return this.paymentMethodService.findByUserId(userId);
  }

  @Get(':id')
  async getPaymentMethod(
    @Param('id') id: string,
  ): Promise<PaymentMethodWithDetails | null> {
    return this.paymentMethodService.findById(id);
  }

  @Patch(':id')
  async updatePaymentMethod(
    @Param('id') id: string,
    @Body() updates: UpdatePaymentMethodDto,
  ) {
    return this.paymentMethodService.update(id, updates);
  }

  @Delete(':id')
  async deletePaymentMethod(@Param('id') id: string) {
    return this.paymentMethodService.delete(id);
  }

  // ────────────────────────────────────────────
  // BNPL 관련 엔드포인트들
  // ────────────────────────────────────────────

  /**
   * 결제수단에 BNPL 기능을 활성화합니다.
   */
  @Post('bnpl/activate')
  async activateBNPL(
    @Body() dto: ActivateBNPLDto,
  ): Promise<BNPLAccountResponseDto> {
    return this.paymentMethodService.activateBNPL(dto);
  }

  /**
   * 결제수단의 BNPL 기능을 비활성화합니다.
   */
  @Post('bnpl/deactivate')
  async deactivateBNPL(
    @Body() dto: DeactivateBNPLDto,
  ): Promise<{ success: boolean }> {
    return this.paymentMethodService.deactivateBNPL(dto);
  }

  /**
   * 사용자의 BNPL 계정 정보를 조회합니다.
   */
  @Get('bnpl/account/:userId')
  async getBNPLAccount(
    @Param('userId') userId: number,
  ): Promise<BNPLAccountResponseDto | null> {
    return this.paymentMethodService.getBNPLAccount(userId);
  }

  /**
   * 사용자의 BNPL 활성화된 결제수단 목록을 조회합니다.
   */
  @Get('bnpl/methods/:userId')
  async getBNPLPaymentMethods(
    @Param('userId') userId: number,
  ): Promise<PaymentMethodWithDetails[]> {
    return this.paymentMethodService.getBNPLPaymentMethods(userId);
  }

  // ────────────────────────────────────────────
  // HMS API 테스트 엔드포인트들
  // ────────────────────────────────────────────

  /**
   * HMS API 설정 정보 조회
   */
  @Get('hms/config')
  async getHmsConfig() {
    return this.paymentMethodService.getHmsApiConfig();
  }

  /**
   * 목업서버 상태 확인 (배치 CMS 목업 사용시에만)
   */
  @Get('hms/health')
  async checkMockServerHealth() {
    return this.paymentMethodService.checkMockServerHealth();
  }

  /**
   * 배치 CMS 회원 생성 테스트 (목업서버)
   */
  @Post('test/batch-cms/member')
  async testCreateBatchCmsMember(@Body() memberData: any) {
    return this.paymentMethodService.createBatchCmsMember(memberData);
  }

  /**
   * 배치 CMS 출금 요청 테스트 (목업서버)
   */
  @Post('test/batch-cms/withdrawal')
  async testBatchCmsWithdrawal(@Body() paymentData: any) {
    return this.paymentMethodService.requestBatchCmsWithdrawal(paymentData);
  }
}
