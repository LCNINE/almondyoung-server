import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq, and } from 'drizzle-orm';
import {
  CreatePaymentMethodDto,
  CreateBnplPaymentMethodDto,
} from './dto/create-payment-method.dto';
import { ActivateBNPLDto, BNPLActor } from './dto/activate-bnpl.dto';
import { DeactivateBNPLDto } from './dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from './dto/bnpl-account.response.dto';
import * as schema from './schema';
import { PaymentMethodStrategy } from './strategies/payment.strategy';
import { BnplService } from './bnpl.service';
import { PAYMENT_STRATEGY_REGISTRY } from './strategies/payment.strategy';

type PaymentMethod = typeof schema.paymentMethod.$inferSelect;
export type PaymentMethodWithDetails = PaymentMethod & {
  card: typeof schema.cardMethod.$inferSelect | null;
  bankAccount: typeof schema.bankAccountMethod.$inferSelect | null;
  prepaidWallet: typeof schema.prepaidWalletMethod.$inferSelect | null;
  rewardPoint: typeof schema.rewardPointMethod.$inferSelect | null;
};

/**
 * Payment method service handling CRUD operations and strategy coordination
 */
@Injectable()
export class PaymentMethodService {
  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    @Inject(PAYMENT_STRATEGY_REGISTRY)
    private readonly strategyRegistry: Map<string, PaymentMethodStrategy>,
    private readonly bnplService: BnplService,
  ) {}

  /**
   * 외부 PG사 연동이 필요한 결제수단을 생성합니다.
   * (카드, 은행계좌 등)
   */
  async createPaymentMethod(dto: CreatePaymentMethodDto): Promise<unknown> {
    // BNPL은 별도 처리 (외부 PG사 연동 불필요)
    if (dto.methodType === 'BNPL') {
      return this.bnplService.create(dto);
    }

    const strategy = this.strategyRegistry.get(dto.methodType);

    if (!strategy) {
      throw new BadRequestException(
        `Unsupported payment method: ${dto.methodType}`,
      );
    }

    return this.dbService.db.transaction(async (tx) => {
      return strategy.register(dto, tx);
    });
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

  // ────────────────────────────────────────────
  // BNPL 관련 메서드들
  // ────────────────────────────────────────────

  /**
   * 결제수단에 BNPL 기능을 활성화합니다.
   * @param dto - BNPL 활성화 정보
   * @returns BNPL 계정 정보
   */
  async activateBNPL(dto: ActivateBNPLDto): Promise<BNPLAccountResponseDto> {
    return this.bnplService.activate(dto);
  }

  /**
   * 결제수단의 BNPL 기능을 비활성화합니다.
   * @param dto - BNPL 비활성화 정보
   * @returns 비활성화 결과
   */
  async deactivateBNPL(dto: DeactivateBNPLDto): Promise<{ success: boolean }> {
    return this.bnplService.deactivate(dto);
  }

  /**
   * 사용자의 BNPL 계정 정보를 조회합니다.
   * @param userId - 사용자 ID
   * @returns BNPL 계정 정보
   */
  async getBNPLAccount(userId: number): Promise<BNPLAccountResponseDto | null> {
    return this.bnplService.getAccount(userId);
  }

  /**
   * BNPL 활성화된 결제수단 목록을 조회합니다.
   * @param userId - 사용자 ID
   * @returns BNPL 활성화된 결제수단 목록
   */
  async getBNPLPaymentMethods(
    userId: number,
  ): Promise<PaymentMethodWithDetails[]> {
    return this.bnplService.findAllByUser(userId);
  }
}
