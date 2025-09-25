import {
  Controller,
  Post,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Param,
  Query,
} from '@nestjs/common';
import {
  RecurringBillingService,
  BillingResult,
} from './recurring-billing.service';
import { PaymentClientService } from './payment-client.service';
import { DevAuthGuard } from '../auth/dev-auth.guard';
import { SubscriptionExceptionFilter } from '../shared/filters/subscription-exception.filter';
import { UseFilters } from '@nestjs/common';

/**
 * 정기결제 관리 컨트롤러 (관리자 전용)
 */
@Controller('admin/billing')
@UseGuards(DevAuthGuard) // 관리자 권한 필요
@UseFilters(SubscriptionExceptionFilter)
export class BillingController {
  constructor(
    private readonly recurringBillingService: RecurringBillingService,
    private readonly paymentClientService: PaymentClientService,
  ) {}

  /**
   * 정기결제 스케줄러 수동 실행
   */
  @Post('process-due')
  @HttpCode(HttpStatus.OK)
  async processDueBillings(): Promise<{
    message: string;
    results: BillingResult[];
    summary: {
      total: number;
      successful: number;
      failed: number;
    };
  }> {
    const results = await this.recurringBillingService.processDueBillings();

    const summary = {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };

    return {
      message: 'Billing processing completed',
      results,
      summary,
    };
  }

  /**
   * 사용자의 결제 프로필 조회
   */
  @Get('payment-profiles/:userId')
  async getUserPaymentProfile(@Param('userId') userId: string) {
    try {
      const profile =
        await this.paymentClientService.getDefaultPaymentProfile(userId);
      return {
        message: 'Payment profile retrieved successfully',
        profile,
      };
    } catch (error) {
      return {
        message: 'Failed to retrieve payment profile',
        error: error.message,
      };
    }
  }

  /**
   * 특정 결제 Intent 상태 조회
   */
  @Get('payment-intents/:intentId')
  async getPaymentIntent(@Param('intentId') intentId: string) {
    try {
      const intent = await this.paymentClientService.getPaymentIntent(intentId);
      return {
        message: 'Payment intent retrieved successfully',
        intent,
      };
    } catch (error) {
      return {
        message: 'Failed to retrieve payment intent',
        error: error.message,
      };
    }
  }

  /**
   * 특정 결제 Attempt 상태 조회
   */
  @Get('payment-attempts/:attemptId')
  async getPaymentAttempt(@Param('attemptId') attemptId: string) {
    try {
      const attempt =
        await this.paymentClientService.getPaymentAttempt(attemptId);
      return {
        message: 'Payment attempt retrieved successfully',
        attempt,
      };
    } catch (error) {
      return {
        message: 'Failed to retrieve payment attempt',
        error: error.message,
      };
    }
  }

  /**
   * 정기결제 시스템 상태 확인
   */
  @Get('health')
  async getHealthStatus() {
    // 결제 서버 연결 상태 확인
    try {
      // 임시 사용자로 연결 테스트
      await this.paymentClientService.getDefaultPaymentProfile(
        'health-check-user',
      );
      return {
        status: 'healthy',
        paymentServerConnection: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'degraded',
        paymentServerConnection: 'disconnected',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
