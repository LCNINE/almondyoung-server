import { Injectable } from '@nestjs/common';
import { IntentRepository } from './intent.repository';
import type { PaymentIntent } from '../../shared/database/types';

/**
 * IntentReader - Intent 조회 (Implementation Layer)
 *
 * 책임: Service와 Repository 사이의 레이어 (규칙 3 준수)
 */
@Injectable()
export class IntentReader {
  constructor(private readonly repo: IntentRepository) {}

  async findById(intentId: string): Promise<PaymentIntent | null> {
    return await this.repo.findById(intentId);
  }

  async findByIdOrFail(intentId: string): Promise<PaymentIntent> {
    const intent = await this.repo.findById(intentId);
    if (!intent) throw new Error('Intent not found');
    return intent;
  }
}
