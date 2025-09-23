import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';

import { NewPaymentIntent, PaymentIntent } from '../../shared/database/types'; // Drizzle 타입
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { WalletExecutor } from '../../shared/database';

/**
 * PaymentIntentService - 결제 의도(Intent)의 생명주기 관리
 *
 * 책임:
 * - 새로운 결제 의도(Intent) 생성
 * - Intent 조회 및 상태 검증
 * - 만료된 Intent 처리 등
 */
@Injectable()
export class PaymentIntentService {
  private readonly logger = new Logger(PaymentIntentService.name);

  constructor(private readonly db: DbService<typeof schema>) {}

  /**
   * 새로운 결제 의도를 생성하고 DB에 저장합니다.
   * @param params Intent 생성에 필요한 정보
   * @returns 생성된 PaymentIntent 객체
   */
  async createIntent(
    params: {
      customerId: string;
      amount: number;
      type: schema.PaymentIntentType;
      expiresInMinutes?: number;
      metadata?: Record<string, any>;
    },
    tx?: WalletExecutor, // ✨ [개선] 트랜잭션 객체를 받을 수 있도록 tx 인자 추가
  ): Promise<PaymentIntent> {
    const executor = tx || this.db.db; // tx가 없으면 기본 DB 인스턴스 사용

    const newIntent: NewPaymentIntent = {
      id: generateUUIDv7(),
      customerId: params.customerId,
      amount: params.amount,
      type: params.type,
      status: 'PENDING',
      expiresAt: new Date(
        Date.now() + (params.expiresInMinutes || 30) * 60 * 1000,
      ),
      metadata: params.metadata,
    };

    const [createdIntent] = await executor
      .insert(schema.paymentIntents)
      .values(newIntent)
      .returning();

    this.logger.log(`New Payment Intent created: ${createdIntent.id}`);
    return createdIntent;
  }

  /**
   * Intent 상태를 업데이트합니다.
   * @param intentId 업데이트할 Intent의 ID
   * @param status 새로운 상태
   * @param tx 트랜잭션 객체 (선택사항)
   */
  async updateIntentStatus(
    intentId: string,
    status: schema.PaymentSessionStatus,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    await executor
      .update(schema.paymentIntents)
      .set({
        status: status,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));

    this.logger.log(`Intent ${intentId} status updated to: ${status}`);
  }

  /**
   * ID로 Intent를 조회합니다.
   * @param intentId 조회할 Intent의 ID
   * @returns PaymentIntent 객체 또는 null
   */
  async findIntentById(intentId: string): Promise<PaymentIntent | null> {
    const intent = await this.db.db.query.paymentIntents.findFirst({
      where: (intents, { eq }) => eq(intents.id, intentId),
    });
    return intent ?? null;
  }

  // ... (만료된 Intent를 CANCELLED로 변경하는 스케줄링 잡 등 추가 기능 구현)
}
