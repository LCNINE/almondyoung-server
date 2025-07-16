import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import { eq, and } from 'drizzle-orm';
import * as schema from '../schema';
import { CreateBnplAccountDto } from '../dto/create-bnpl-account.dto';
import { DeactivateBnplAccountDto } from '../dto/deactivate-bnpl-account.dto';

/**
 * BNPL 계정 관리 서비스
 * 
 * 주요 기능:
 * 1. BNPL 계정 생성/조회/비활성화
 * 2. BNPL 이벤트 기록 관리
 */
@Injectable()
export class BnplAccountService {
  private readonly logger = new Logger(BnplAccountService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {
    this.logger.log('🚀 BNPL 계정 서비스 초기화 완료');
  }

  /**
   * BNPL 계정 생성
   */
  async createAccount(dto: CreateBnplAccountDto, hmsResult: any) {
    this.logger.log(`[DB] BNPL 계정 생성 시작: ${dto.userId}`);
    
    return await this.dbService.db.transaction(async (tx) => {
      // 1. 결제수단 생성
      const [paymentMethod] = await tx
        .insert(schema.paymentMethod)
        .values({
          userId: dto.userId,
          methodType: 'BNPL',
          methodName: dto.methodName,
          isDefault: dto.isDefault || false,
          institutionCode: dto.institutionCode,
          status: 'ACTIVE',
        })
        .returning();

      this.logger.log(`[DB] 결제수단 생성 완료: ${paymentMethod.id}`);

      // 2. BNPL 계정 생성
      const [bnplAccount] = await tx
        .insert(schema.bnplAccount)
        .values({
          userId: dto.userId,
          paymentMethodId: paymentMethod.id, // 결제수단 ID 연결
          creditLimit: dto.creditLimit || 0,
          approvedLimit: dto.approvedLimit || dto.creditLimit || 0,
          currentBalance: 0,
          status: 'ACTIVE',
          billingCycleDay: dto.billingCycleDay,
          termsUrl: dto.termsUrl || null,
          version: 1,
        })
        .returning();

      this.logger.log(`[DB] BNPL 계정 생성 완료: ${bnplAccount.id}`);

      // 3. 활성화 이벤트 기록
      const [activationEvent] = await tx
        .insert(schema.bnplActivationEvent)
        .values({
          paymentMethodId: paymentMethod.id,
          bnplAccountId: bnplAccount.id,
          eventType: 'ACTIVATED',
          actor: 'SYSTEM',
        })
        .returning();

      this.logger.log(`[DB] 활성화 이벤트 기록 완료: ${activationEvent.id}`);
      
      return {
        paymentMethod,
        bnplAccount,
      };
    });
  }

  /**
   * BNPL 계정 비활성화
   */
  async deactivateAccount(dto: DeactivateBnplAccountDto & { accountId: string }) {
    this.logger.log(`[DB] BNPL 계정 비활성화 시작: ${dto.accountId}`);
    
    return await this.dbService.db.transaction(async (tx) => {
      // 1. BNPL 계정 조회
      const bnplAccount = await tx.query.bnplAccount.findFirst({
        where: eq(schema.bnplAccount.id, dto.accountId),
      });

      if (!bnplAccount) {
        throw new NotFoundException('BNPL 계정을 찾을 수 없습니다.');
      }

      // 2. 결제수단 조회 (methodType='BNPL'로 구분)
      const paymentMethod = await tx.query.paymentMethod.findFirst({
        where: and(
          eq(schema.paymentMethod.userId, bnplAccount.userId),
          eq(schema.paymentMethod.methodType, 'BNPL'),
          eq(schema.paymentMethod.status, 'ACTIVE')
        ),
      });

      if (!paymentMethod) {
        throw new NotFoundException('BNPL 결제수단을 찾을 수 없습니다.');
      }

      // 3. 미정산 금액 확인
      if (Number(bnplAccount.currentBalance) > 0) {
        throw new BadRequestException(
          `미정산 금액이 ${bnplAccount.currentBalance}원 있어 비활성화할 수 없습니다.`
        );
      }

      // 4. 결제수단 비활성화
      await tx
        .update(schema.paymentMethod)
        .set({ 
          status: 'INACTIVE',
          updatedAt: new Date() 
        })
        .where(eq(schema.paymentMethod.id, paymentMethod.id));

      // 5. BNPL 계정 비활성화
      await tx
        .update(schema.bnplAccount)
        .set({ 
          status: 'INACTIVE',
          updatedAt: new Date() 
        })
        .where(eq(schema.bnplAccount.id, bnplAccount.id));

      // 6. 비활성화 이벤트 기록
      const [deactivationEvent] = await tx
        .insert(schema.bnplActivationEvent)
        .values({
          paymentMethodId: paymentMethod.id,
          bnplAccountId: bnplAccount.id,
          eventType: 'DEACTIVATED',
          actor: dto.actor,
        })
        .returning();

      this.logger.log(`[DB] 비활성화 이벤트 기록 완료: ${deactivationEvent.id}`);
      
      return { success: true };
    });
  }

  /**
   * 사용자 ID로 BNPL 계정 조회
   */
  async getAccountByUserId(userId: number) {
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: and(
        eq(schema.bnplAccount.userId, userId),
        eq(schema.bnplAccount.status, 'ACTIVE')
      ),
    });

    if (!bnplAccount) {
      return null;
    }

    return {
      id: bnplAccount.id,
      userId: bnplAccount.userId,
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
   * 계정 ID로 BNPL 계정 조회
   */
  async getAccountById(accountId: string) {
    const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.id, accountId),
    });

    if (!bnplAccount) {
      return null;
    }

    return {
      id: bnplAccount.id,
      userId: bnplAccount.userId,
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
   * 사용자 ID로 모든 BNPL 계정 조회
   */
  async getAllAccountsByUserId(userId: number) {
    const results = await this.dbService.db.query.paymentMethod.findMany({
      where: and(
        eq(schema.paymentMethod.userId, userId),
        eq(schema.paymentMethod.methodType, 'BNPL'),
        eq(schema.paymentMethod.status, 'ACTIVE')
      ),
      with: {
        card: true,
        bankAccount: true,
        rewardPoint: true,
      },
    });

    return results;
  }

  /**
   * BNPL 이벤트 히스토리 조회
   */
  async getEventHistory(userId: number) {
    // 사용자의 BNPL 결제수단들을 먼저 조회
    const paymentMethods = await this.dbService.db.query.paymentMethod.findMany({
      where: and(
        eq(schema.paymentMethod.userId, userId),
        eq(schema.paymentMethod.methodType, 'BNPL')
      ),
    });

    if (paymentMethods.length === 0) {
      return [];
    }

    // 해당 결제수단들의 이벤트 조회
    const events = await this.dbService.db.query.bnplActivationEvent.findMany({
      where: eq(
        schema.bnplActivationEvent.paymentMethodId, 
        paymentMethods[0].id // 첫 번째 결제수단의 이벤트만 조회 (실제로는 IN 조건 사용)
      ),
      orderBy: (events, { desc }) => [desc(events.createdAt)],
    });

    return events.map(event => ({
      id: event.id,
      paymentMethodId: event.paymentMethodId,
      eventType: event.eventType,
      actor: event.actor,
      createdAt: event.createdAt,
    }));
  }

  /**
   * 계정 통계 정보 조회
   * TODO: 실제 통계 로직 구현 필요
   */
  async getAccountStatistics(accountId: string) {
    // TODO: 실제 거래 내역 기반 통계 계산
    return {
      totalTransactions: 0,
      totalAmount: 0,
      averageAmount: 0,
      lastTransactionDate: null,
    };
  }

  /**
   * 거래 내역 조회
   * TODO: 실제 거래 내역 조회 로직 구현 필요
   */
  async getTransactionHistory(accountId: string, limit: number = 100) {
    // TODO: 실제 DB에서 거래 내역 조회
    // 현재는 빈 배열 반환
    return [];
  }
}