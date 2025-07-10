import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq } from 'drizzle-orm';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import * as schema from './schema';
import { PaymentMethodStrategy } from './strategies/payment.strategy';

type PaymentMethod = typeof schema.paymentMethod.$inferSelect;
export type PaymentMethodWithDetails = PaymentMethod & {
  card: typeof schema.cardMethod.$inferSelect | null;
  bankAccount: typeof schema.bankAccountMethod.$inferSelect | null;
  prepaidWallet: typeof schema.prepaidWalletMethod.$inferSelect | null;
  bnpl: typeof schema.bnplMethod.$inferSelect | null;
  rewardPoint: typeof schema.rewardPointMethod.$inferSelect | null;
};

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
  async createPaymentMethod(dto: CreatePaymentMethodDto): Promise<unknown> {
    const strategy = this.findStrategy(dto.methodType);

    // Discriminated Union으로 타입 자동 추론
    switch (dto.methodType) {
      case 'CARD':
        return strategy.register(dto);
      case 'BANK_ACCOUNT':
        return strategy.register(dto);
      case 'BNPL':
        return strategy.register(dto);
      default: {
        // exhaustive check - 새로운 타입 추가 시 컴파일 에러 발생
        const _exhaustiveCheck: never = dto;
        return _exhaustiveCheck;
      }
    }
  }

  /**
   * ID로 결제 수단을 조회합니다.
   *
   * @param id - 결제 수단 ID
   * @returns
   */
  async findById(id: string): Promise<PaymentMethodWithDetails | null> {
    const result = await this.dbService.db.query.paymentMethod.findFirst({
      where: eq(schema.paymentMethod.id, id),
      with: {
        card: true,
        bankAccount: true,
        prepaidWallet: true,
        bnpl: true,
        rewardPoint: true,
      },
    });

    return result as PaymentMethodWithDetails | null;
  }

  /**
   * 사용자의 모든 결제 수단을 조회합니다.
   * @param userId - 사용자 ID
   * @returns
   */
  async findByUserId(userId: number): Promise<PaymentMethodWithDetails[]> {
    const results = await this.dbService.db.query.paymentMethod.findMany({
      where: eq(schema.paymentMethod.userId, userId),
      with: {
        card: true,
        bankAccount: true,
        prepaidWallet: true,
        bnpl: true,
        rewardPoint: true,
      },
    });
    return results as PaymentMethodWithDetails[];
  }

  /**
   * 결제 수단 정보를 업데이트합니다.
   * @param id - 결제 수단 ID
   * @param updates - 업데이트할 정보
   * @returns
   */
  async update(
    id: string,
    updates: Partial<{ methodName: string; isDefault: boolean }>,
  ): Promise<PaymentMethod | null> {
    const [updated] = await this.dbService.db
      .update(schema.paymentMethod)
      .set(updates)
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    return updated || null;
  }

  /**
   * 결제 수단을 삭제합니다. (Soft delete)
   * @param id
   * @returns
   */
  async delete(id: string): Promise<PaymentMethod | null> {
    const [deleted] = await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status: 'DELETED', updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    return deleted || null;
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
