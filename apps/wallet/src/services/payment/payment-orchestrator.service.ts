import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// ✨ [변경] Executor만 주입받고, Validator는 제거합니다.
import { PaymentExecutorService } from './payment-executor.service';
import {
  PaymentRequest,
  PaymentResult,
  PaymentType,
  ProviderType,
} from '../../providers/payment-provider.interface';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

/**
 * [리팩토링] PaymentOrchestrator - 얇은 외피(Facade) 역할
 *
 * 책임:
 * - 기존 호출부와의 호환성 유지 (점진적 폐지 예정)
 * - Intent 조회 후, 새로운 PaymentExecutorService 호출
 * - 결제 시도(Attempt) 결과 기록
 */
@Injectable()
export class PaymentOrchestratorService {
  private readonly logger = new Logger(PaymentOrchestratorService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly paymentExecutor: PaymentExecutorService, // ✨ [변경] 새로운 Executor 주입
  ) {}

  /**
   * 결제 실행 - 모든 로직을 새로운 Executor에게 위임합니다.
   */
  async executePayment(
    intentId: string,
    providerType: ProviderType,
    options: {
      profileId?: string;
      instrumentRef?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Orchestrating payment for Intent: ${intentId} via ${providerType}`,
    );

    // 트랜잭션은 이제 Executor가 관리하므로, Orchestrator는 트랜잭션을 시작하지 않습니다.
    // 1. Intent 조회 (Executor에게 넘겨줄 정보를 위해)
    const intent = await this.db.db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, intentId),
    });

    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    // 2. 새로운 Executor가 요구하는 PaymentRequest 형식으로 변환
    const paymentRequest: PaymentRequest = {
      intentId: intent.id,
      attemptId: generateUUIDv7(), // 고유한 Attempt ID 생성
      amount: intent.amount,
      paymentType: intent.type as PaymentType,
      userId: intent.customerId,
      instrumentType: options.profileId ? 'PROFILE' : 'ONE_TIME',
      profileId: options.profileId,
      instrumentRef: options.instrumentRef,
      metadata: {
        intentType: intent.type,
        source: options.source || 'api',
        actor: options.actor || 'SYSTEM',
      },
    };

    try {
      // 3. ✨ 핵심: 모든 복잡한 로직을 새로운 Executor에게 위임
      const result = await this.paymentExecutor.execute(
        paymentRequest,
        providerType,
        intent,
      );

      // 4. 결과(Attempt) 기록 (이 책임은 당분간 Orchestrator에 유지)
      await this.saveAttemptRecord(paymentRequest, result, providerType);
      await this.updateIntentStatus(intentId, result);

      this.logger.log(
        `Orchestration successful for Intent: ${intentId}, Success: ${result.success}`,
      );
      return result;
    } catch (error: any) {
      this.logger.error(
        `Orchestration failed for Intent: ${intentId}`,
        error.stack,
      );
      // 실패 시에도 Attempt 기록
      const failedResult: PaymentResult = {
        success: false,
        code: error.code,
        message: error.message,
        raw: error,
      };
      await this.saveAttemptRecord(paymentRequest, failedResult, providerType);
      await this.updateIntentStatus(intentId, failedResult);
      throw error; // 에러를 다시 던져서 호출자에게 알림
    }
  }

  private async saveAttemptRecord(
    request: PaymentRequest,
    result: PaymentResult,
    providerType: ProviderType,
  ): Promise<void> {
    await this.db.db.insert(schema.paymentAttempts).values({
      id: request.attemptId,
      intentId: request.intentId,
      provider: providerType,
      instrumentType: request.instrumentType,
      profileId: request.profileId || null,
      amount: request.amount,
      status: result.success ? 'CAPTURED' : 'FAILED',
      // ... (기타 필드)
    });
  }

  private async updateIntentStatus(
    intentId: string,
    result: PaymentResult,
  ): Promise<void> {
    await this.db.db
      .update(schema.paymentIntents)
      .set({
        status: result.success ? 'CAPTURED' : 'FAILED',
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));
  }
}
