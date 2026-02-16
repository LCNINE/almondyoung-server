import { Injectable } from '@nestjs/common';
import { IntentRepository } from '../intents/intent.repository';
import { PaymentAttemptRepository } from './payment-attempt.repository';
import type { PaymentIntent } from '../../shared/database/types';

/**
 * PaymentReader (Implementation Layer)
 *
 * 책임: Payment 관련 데이터 조회 (레이어 규칙 준수)
 */
@Injectable()
export class PaymentReader {
  constructor(
    private readonly intentRepo: IntentRepository,
    private readonly attemptRepo: PaymentAttemptRepository,
  ) {}

  async findIntent(intentId: string): Promise<PaymentIntent> {
    const intent = await this.intentRepo.findById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }
    return intent;
  }

  async findAttempt(attemptId: string) {
    const attempt = await this.attemptRepo.findById(attemptId);
    if (!attempt) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }
    return attempt;
  }
}
