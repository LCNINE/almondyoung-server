import { Injectable, Logger } from '@nestjs/common';
import { IntentRepository } from './intent.repository';
import type {
  PaymentIntent,
  NewPaymentIntent,
} from '../../shared/database/types';
import type { PaymentIntentType } from '../../shared/database/schema';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import type { WalletExecutor } from '../../shared/database';
export interface DiscountBreakdown {
  amount: number; // 차감액
  type: 'COUPON' | 'POINT' | 'PROMOTION';
  id?: string; // 쿠폰 ID, 프로모션 코드 등
  description?: string; // "신규가입 쿠폰"
}
export interface CreateIntentParams {
  customerId: string;
  originalAmount: number;
  discountBreakdown?: DiscountBreakdown[];
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

  constructor(private readonly repo: IntentRepository) { }

  async create(
    params: CreateIntentParams,
    tx?: WalletExecutor,
  ): Promise<PaymentIntent> {
    // 1. 할인 총액 및 포인트 사용분 계산
    const breakdown = params.discountBreakdown || [];

    // DB의 discountAmount 컬럼용 (총 차감액)
    const totalDiscountAmount = breakdown.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    // 나중에 환불 시 복구해야 할 포인트 금액 추출
    const pointUsage = breakdown.find((d) => d.type === 'POINT');
    const pointAmount = pointUsage?.amount || 0;

    // 2. 검증
    if (params.originalAmount <= 0) throw new Error('Invalid amount');
    if (totalDiscountAmount > params.originalAmount)
      throw new Error('Discount exceeds amount');

    // 3. 메타데이터 구성 (기존 메타데이터 + 할인 상세 내역)
    const metadata = {
      ...(params.metadata || {}),
      discountBreakdown: breakdown, // 상세 내역 통째로 보관 (영수증/감사용)
      pointAmount: pointAmount, // 환불 로직에서 바로 꺼내 쓰기 쉽게 별도 키로 저장
    };

    // 4. Intent 데이터 생성
    const newIntent: NewPaymentIntent = {
      id: generateUUIDv7(),
      customerId: params.customerId,

      originalAmount: params.originalAmount,
      discountAmount: totalDiscountAmount, // DB에는 합계만 저장 (조회/계산 효율성)
      finalAmount: params.originalAmount - totalDiscountAmount,

      status: 'PENDING',
      expiresAt: new Date(
        Date.now() + (params.expiresInMinutes || 30) * 60 * 1000,
      ),
      metadata: metadata, // 상세 정보는 여기에 JSONB로 저장
    };

    // 3. DB 저장
    const created = await this.repo.create(newIntent, tx);

    this.logger.log(
      `Intent created: ${created.id} for customer ${params.customerId}`,
    );
    return created;
  }
}
