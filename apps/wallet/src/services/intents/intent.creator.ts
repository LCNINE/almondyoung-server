import { Injectable, Logger } from '@nestjs/common';
import { IntentRepository } from './intent.repository';
import type {
  PaymentIntent,
  NewPaymentIntent,
} from '../../shared/database/types';
import type { PaymentIntentType } from '../../shared/database/schema';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import type { WalletExecutor } from '../../shared/database';

export interface CreateIntentParams {
  customerId: string;
  amount: number;
  type: PaymentIntentType;
  expiresInMinutes?: number;
  metadata?: Record<string, any>;
}

/**
 * IntentCreator - Intent 생성 (Implementation Layer)
 *
 * 책임: Intent 생성 로직 (검증 + 데이터 생성 + DB 저장)
 */
@Injectable()
export class IntentCreator {
  private readonly logger = new Logger(IntentCreator.name);

  constructor(private readonly repo: IntentRepository) {}

  async create(
    params: CreateIntentParams,
    tx?: WalletExecutor,
  ): Promise<PaymentIntent> {
    // 1. 검증
    if (params.amount <= 0) throw new Error('Invalid amount');
    if (!params.customerId) throw new Error('Customer ID required');

    // 2. Intent 데이터 생성
    const newIntent: NewPaymentIntent = {
      id: generateUUIDv7(),
      customerId: params.customerId,
      amount: params.amount,
      totalAmount: params.amount,
      finalAmount: params.amount,
      type: params.type,
      status: 'PENDING',
      expiresAt: new Date(
        Date.now() + (params.expiresInMinutes || 30) * 60 * 1000,
      ),
      metadata: params.metadata,
    };

    // 3. DB 저장
    const created = await this.repo.create(newIntent, tx);

    this.logger.log(
      `Intent created: ${created.id} for customer ${params.customerId}`,
    );
    return created;
  }
}
