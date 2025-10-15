import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import type { PaymentIntent } from '../../shared/database/types';
import {
  assertIntentIsPending,
  assertIntentIsNotExpired,
} from './intent.assets';

/**
 * IntentRepository
 *
 * 책임:
 * - Intent 조회
 * - Intent 상태 업데이트
 * - Intent 검증 (상태, 만료)
 */
@Injectable()
export class IntentRepository {
  private readonly logger = new Logger(IntentRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * Intent를 조회하고 기본 검증을 수행합니다.
   */
  async findById(intentId: string): Promise<PaymentIntent | undefined> {
    return this.db.db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, intentId),
    });
  }

  /**
   * Intent를 조회하고 존재하지 않으면 에러를 던집니다.
   */
  async findByIdOrFail(intentId: string): Promise<PaymentIntent> {
    const intent = await this.findById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }
    return intent;
  }

  /**
   * Intent를 조회하고 결제 가능한 상태인지 검증합니다.
   * - 존재 여부
   * - PENDING 상태 확인
   * - 만료 여부 확인
   */
  async findAndValidateForPayment(intentId: string): Promise<PaymentIntent> {
    const intent = await this.findByIdOrFail(intentId);

    // 상태 및 만료 검증 (Assert 함수 사용)
    assertIntentIsPending(intent);
    assertIntentIsNotExpired(intent);

    return intent;
  }

  /**
   * Intent 상태를 업데이트합니다.
   */
  async updateStatus(
    intentId: string,
    status: string,
    tx?: any,
  ): Promise<void> {
    const executor = tx ?? this.db.db;

    await executor
      .update(schema.paymentIntents)
      .set({
        status: status as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));

    this.logger.log(`Intent ${intentId} status updated to ${status}`);
  }

  /**
   * Intent에 할인 정보를 업데이트합니다.
   */
  async updateDiscounts(
    intentId: string,
    discounts: any[],
    discountsTotal: string,
    finalAmount: string,
    tx?: any,
  ): Promise<void> {
    const executor = tx ?? this.db.db;

    await executor
      .update(schema.paymentIntents)
      .set({
        discounts: discounts as any,
        discountsTotal,
        finalAmount,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));

    this.logger.log(`Intent ${intentId} discounts updated`);
  }

  /**
   * Intent를 CAPTURED 상태로 업데이트합니다.
   */
  async markAsCaptured(intentId: string, tx?: any): Promise<void> {
    const executor = tx ?? this.db.db;

    await executor
      .update(schema.paymentIntents)
      .set({
        status: 'CAPTURED',
        capturedAt: new Date(),
        authorizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));

    this.logger.log(`Intent ${intentId} marked as CAPTURED`);
  }

  /**
   * Intent를 UNKNOWN 상태로 업데이트합니다.
   * (외부 결제는 성공했지만 내부 처리 중 에러 발생 시)
   */
  async markAsUnknown(intentId: string): Promise<void> {
    await this.db.db
      .update(schema.paymentIntents)
      .set({
        status: 'UNKNOWN' as any,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));

    this.logger.warn(`Intent ${intentId} marked as UNKNOWN for recovery`);
  }
}
