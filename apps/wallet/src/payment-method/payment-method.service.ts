import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq, and } from 'drizzle-orm';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { ActivateBNPLDto, BNPLActor } from './dto/activate-bnpl.dto';
import { DeactivateBNPLDto } from './dto/deactivate-bnpl.dto';
import { BNPLAccountResponseDto } from './dto/bnpl-account.response.dto';
import * as schema from './schema';
import { PaymentMethodStrategy } from './strategies/payment.strategy';

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
    @Inject('PAYMENT_STRATEGIES')
    private readonly strategies: PaymentMethodStrategy[],
  ) {}

  /**
   * 외부 PG사 연동이 필요한 결제수단을 생성합니다.
   * (카드, 은행계좌 등)
   */
  async createPaymentMethod(dto: CreatePaymentMethodDto): Promise<unknown> {
    const strategy = this.findStrategy(dto.methodType);

    // 외부 PG사 연동이 필요한 결제수단만 처리
    switch (dto.methodType) {
      case 'CARD':
        return strategy.register(dto);
      case 'BANK_ACCOUNT':
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

  // ────────────────────────────────────────────
  // BNPL 관련 메서드들
  // ────────────────────────────────────────────

  /**
   * 결제수단에 BNPL 기능을 활성화합니다.
   * @param dto - BNPL 활성화 정보
   * @returns BNPL 계정 정보
   */
  async activateBNPL(dto: ActivateBNPLDto): Promise<BNPLAccountResponseDto> {
    // 1. 결제수단 존재 확인
    const paymentMethod = await this.findById(dto.paymentMethodId);
    if (!paymentMethod) {
      throw new NotFoundException('결제수단을 찾을 수 없습니다.');
    }

    // 2. 정산용 결제수단 존재 확인
    const settlementMethod = await this.findById(dto.settlementPaymentMethodId);
    if (!settlementMethod) {
      throw new NotFoundException('정산용 결제수단을 찾을 수 없습니다.');
    }

    // 3. 이미 BNPL이 활성화되어 있는지 확인
    if (paymentMethod.isBnpl) {
      throw new BadRequestException('이미 BNPL이 활성화되어 있습니다.');
    }

    // 4. 사용자별 BNPL 계정 생성
    const [bnplAccount] = await this.dbService.db
      .insert(schema.bnplAccount)
      .values({
        userId: paymentMethod.userId,
        settlementPaymentMethodId: dto.settlementPaymentMethodId,
        creditLimit: dto.creditLimit,
        currentBalance: 0,
        status: 'ACTIVE',
        billingCycleDay: dto.billingCycleDay,
        version: 1,
      })
      .returning();

    // 5. 결제수단에 BNPL 활성화 표시
    await this.dbService.db
      .update(schema.paymentMethod)
      .set({
        isBnpl: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentMethod.id, dto.paymentMethodId));

    // 6. BNPL 활성화 이벤트 기록
    await this.dbService.db.insert(schema.bnplActivationEvent).values({
      paymentMethodId: dto.paymentMethodId,
      bnplAccountId: bnplAccount.id,
      eventType: 'ACTIVATED',
      actor: dto.actor,
    });

    return {
      id: bnplAccount.id,
      userId: bnplAccount.userId,
      settlementPaymentMethodId: bnplAccount.settlementPaymentMethodId,
      creditLimit: Number(bnplAccount.creditLimit),
      currentBalance: Number(bnplAccount.currentBalance),
      status: bnplAccount.status,
      billingCycleDay: bnplAccount.billingCycleDay,
      version: bnplAccount.version,
      createdAt: bnplAccount.createdAt,
      updatedAt: bnplAccount.updatedAt,
    };
  }

  /**
   * 결제수단의 BNPL 기능을 비활성화합니다.
   * @param dto - BNPL 비활성화 정보
   * @returns 비활성화 결과
   */
  async deactivateBNPL(dto: DeactivateBNPLDto): Promise<{ success: boolean }> {
    // 1. 결제수단 존재 확인
    const paymentMethod = await this.findById(dto.paymentMethodId);
    if (!paymentMethod) {
      throw new NotFoundException('결제수단을 찾을 수 없습니다.');
    }

    // 2. BNPL이 활성화되어 있는지 확인
    if (!paymentMethod.isBnpl) {
      throw new BadRequestException('BNPL이 활성화되어 있지 않습니다.');
    }

    // 3. BNPL 계정 조회
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, paymentMethod.userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
    }

    // 4. 미정산 금액이 있는지 확인
    if (Number(bnplAccount.currentBalance) > 0) {
      throw new BadRequestException(
        '미정산 금액이 있어 BNPL을 비활성화할 수 없습니다.',
      );
    }

    // 5. 결제수단에서 BNPL 비활성화
    await this.dbService.db
      .update(schema.paymentMethod)
      .set({
        isBnpl: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentMethod.id, dto.paymentMethodId));

    // 6. BNPL 비활성화 이벤트 기록
    await this.dbService.db.insert(schema.bnplActivationEvent).values({
      paymentMethodId: dto.paymentMethodId,
      bnplAccountId: bnplAccount.id,
      eventType: 'DEACTIVATED',
      actor: dto.actor,
    });

    return { success: true };
  }

  /**
   * 사용자의 BNPL 계정 정보를 조회합니다.
   * @param userId - 사용자 ID
   * @returns BNPL 계정 정보
   */
  async getBNPLAccount(userId: number): Promise<BNPLAccountResponseDto | null> {
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      return null;
    }

    return {
      id: bnplAccount.id,
      userId: bnplAccount.userId,
      settlementPaymentMethodId: bnplAccount.settlementPaymentMethodId,
      creditLimit: Number(bnplAccount.creditLimit),
      currentBalance: Number(bnplAccount.currentBalance),
      status: bnplAccount.status,
      billingCycleDay: bnplAccount.billingCycleDay,
      version: bnplAccount.version,
      createdAt: bnplAccount.createdAt,
      updatedAt: bnplAccount.updatedAt,
    };
  }

  /**
   * BNPL 활성화된 결제수단 목록을 조회합니다.
   * @param userId - 사용자 ID
   * @returns BNPL 활성화된 결제수단 목록
   */
  async getBNPLPaymentMethods(
    userId: number,
  ): Promise<PaymentMethodWithDetails[]> {
    const results = await this.dbService.db.query.paymentMethod.findMany({
      where: and(
        eq(schema.paymentMethod.userId, userId),
        eq(schema.paymentMethod.isBnpl, true),
        eq(schema.paymentMethod.status, 'ACTIVE'),
      ),
      with: {
        card: true,
        bankAccount: true,
        prepaidWallet: true,
        rewardPoint: true,
      },
    });
    return results as PaymentMethodWithDetails[];
  }
}
