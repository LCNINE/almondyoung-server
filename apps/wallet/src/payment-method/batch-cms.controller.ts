import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  ParseIntPipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BnplService } from './services/bnpl.service';
import { CreateBnplPaymentMethodDto } from './dto/create-payment-method.dto';
import { DeactivateBNPLDto } from './dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from './dto/bnpl-account.response.dto';
import { PaymentMethodWithDetails } from './payment-method.service';
import { BNPLActor } from './dto/activate-bnpl.dto';

@Controller('payment-methods/batch-cms')
export class BatchCmsController {
  constructor(private readonly bnplService: BnplService) {}

  /**
   * 배치 CMS 계좌 등록 (BNPL 활성화)
   * - PG사(HMS)에 회원 등록
   * - 내부 DB에 BNPL 계정 생성
   */
  @Post()
  async createBatchCmsAccount(@Body() dto: CreateBnplPaymentMethodDto) {
    return this.bnplService.createBatchCmsAccount(dto);
  }

  /**
   * 사용자의 배치 CMS 계좌 정보 조회
   */
  @Get(':userId')
  async getBatchCmsAccount(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<BNPLAccountResponseDto | null> {
    return this.bnplService.getBatchCmsAccount(userId);
  }

  /**
   * 사용자의 모든 배치 CMS 계좌 목록 조회
   */
  @Get(':userId/accounts')
  async getBatchCmsAccounts(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PaymentMethodWithDetails[]> {
    return this.bnplService.getBatchCmsPaymentMethods(userId);
  }

  /**
   * 배치 CMS 계좌 비활성화
   * - PG사(HMS)에서 회원 삭제
   * - 내부 DB에서 비활성화 처리 (삭제 아님)
   * - 이벤트 기록 남김
   */
  @Delete(':paymentMethodId')
  async deactivateBatchCmsAccount(
    @Param('paymentMethodId') paymentMethodId: string,
    @Body() dto: { actor?: string },
  ): Promise<{ success: boolean }> {
    // 문자열을 BNPLActor enum으로 변환
    const actorValue = dto.actor as keyof typeof BNPLActor;
    const actor = BNPLActor[actorValue] || BNPLActor.USER;

    const deactivateDto: DeactivateBNPLDto = {
      paymentMethodId,
      actor,
    };
    return this.bnplService.deactivateBatchCmsAccount(deactivateDto);
  }

  /**
   * 배치 CMS 이벤트 히스토리 조회
   */
  @Get(':userId/history')
  async getBatchCmsHistory(
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.bnplService.getBatchCmsEventHistory(userId);
  }

  /**
   * 배치 CMS 상태 확인 (목업서버 연결 테스트)
   */
  @Get('test/health')
  async checkBatchCmsHealth() {
    return this.bnplService.checkBatchCmsHealth();
  }

  /**
   * 배치 CMS 동의자료 등록 테스트
   */
  @Post('test/agreement')
  async testBatchCmsAgreement(@Body() agreementData: any) {
    // BatchCmsAgreementService를 직접 사용
    return { message: 'Agreement endpoint - to be implemented' };
  }

  /**
   * 배치 CMS 출금신청 테스트
   */
  @Post('test/withdrawal')
  async testBatchCmsWithdrawal(@Body() withdrawalData: any) {
    // BatchCmsWithdrawalService를 직접 사용
    return { message: 'Withdrawal endpoint - to be implemented' };
  }
}