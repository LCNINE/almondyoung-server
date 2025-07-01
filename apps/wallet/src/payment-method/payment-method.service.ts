import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethodStrategy } from './strategies/payment.strategy';
import { PaymentProfileResponse } from 'hms-api-wrapper/dist/services/PaymentProfile/types';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from './schema';
import { eq, and } from 'drizzle-orm';

/**
 * Payment method service handling CRUD operations and strategy coordination
 */
@Injectable()
export class PaymentMethodService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    @Inject('PAYMENT_STRATEGIES')
    private readonly strategies: PaymentMethodStrategy[],
  ) {}

  /**
   * Create new payment method using appropriate strategy
   */
  async createPaymentMethod(
    dto: CreatePaymentMethodDto,
  ): Promise<PaymentProfileResponse> {
    const strategy = this.findStrategy(dto.methodType);

    // Discriminated Union으로 타입 자동 추론
    switch (dto.methodType) {
      case 'CARD':
        return strategy.register(dto) as Promise<PaymentProfileResponse>;
      case 'BANK_ACCOUNT':
        return strategy.register(dto) as Promise<PaymentProfileResponse>;
      default: {
        // exhaustive check - 새로운 타입 추가 시 컴파일 에러 발생
        const _exhaustiveCheck: never = dto;
        return _exhaustiveCheck;
      }
    }
  }

  /**
   * Find payment method by ID
   */
  async findById(id: string) {
    const paymentMethod = await this.dbService.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.id, id))
      .limit(1);

    return paymentMethod[0] || null;
  }

  /**
   * Find active payment methods by user ID
   */
  async findByUserId(userId: number) {
    return this.dbService.db
      .select()
      .from(schema.paymentMethod)
      .where(
        and(
          eq(schema.paymentMethod.userId, userId),
          eq(schema.paymentMethod.status, 'ACTIVE'),
        ),
      );
  }

  /**
   * Delete payment method using appropriate strategy
   */
  async deleteById(id: string) {
    const paymentMethod = await this.findById(id);

    if (!paymentMethod) {
      throw new NotFoundException(`Payment method with ID ${id} not found`);
    }

    const strategy = this.findStrategy(paymentMethod.methodType);
    await strategy.delete(id);
  }

  /**
   * Set payment method as default
   */
  async setAsDefault(id: string, userId: number) {
    return this.dbService.db.transaction(async (tx) => {
      // 기존 기본 결제수단 해제
      await tx
        .update(schema.paymentMethod)
        .set({ isDefault: 'N' })
        .where(eq(schema.paymentMethod.userId, userId));

      // 새로운 기본 결제수단 설정
      await tx
        .update(schema.paymentMethod)
        .set({ isDefault: 'Y' })
        .where(eq(schema.paymentMethod.id, id));
    });
  }

  /**
   * Find appropriate strategy for payment method type
   */
  private findStrategy(methodType: string): PaymentMethodStrategy {
    const strategy = this.strategies.find((s) => s.supports(methodType));

    if (!strategy) {
      throw new BadRequestException(
        `Unsupported payment method type: ${methodType}`,
      );
    }

    return strategy;
  }
}
