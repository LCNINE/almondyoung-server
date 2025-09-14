import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';

import { NewPaymentIntent, PaymentIntent } from '../../shared/database/types'; // Drizzle 타입
import { generateUUIDv7 } from '../../shared/utils/id-generator';

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
  async createIntent(params: {
    customerId: string;
    amount: number;
    type: schema.PaymentIntentType;
    expiresInMinutes?: number;
    metadata?: Record<string, any>;
  }): Promise<PaymentIntent> {
    const {
      customerId,
      amount,
      type,
      expiresInMinutes = 30,
      metadata,
    } = params;

    const newIntent: NewPaymentIntent = {
      id: generateUUIDv7(), // Payment Intent Prefix
      customerId,
      amount,
      type,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      metadata,
    };

    const [createdIntent] = await this.db.db
      .insert(schema.paymentIntents)
      .values(newIntent)
      .returning();

    this.logger.log(`New Payment Intent created: ${createdIntent.id}`);
    return createdIntent;
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
