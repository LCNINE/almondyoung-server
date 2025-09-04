// services/method-services/point-method.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PointMethodGateway } from '../../interfaces/payment-method-gateways.interface';
import { INTERNAL_POINT_PAYMENT_ADAPTER } from '../../shared/tokens/gateway.tokens';
import { ulid } from 'ulid';
import { Money } from '../../shared/utils/money.util';

/**
 * 포인트 결제수단 전용 서비스
 * - 적립포인트 관리 (구매적립, 이벤트지급, 잔액조회)
 * - 회원가입 시 자동으로 포인트 계정 생성 (별도 등록 불필요)
 * - 소비자 직접 충전 불가능, 관리자/시스템에서만 지급
 */
@Injectable()
export class PointMethodService {
  private readonly logger = new Logger(PointMethodService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    @Inject(INTERNAL_POINT_PAYMENT_ADAPTER)
    private readonly pointGateway: PointMethodGateway,
  ) {}

  /**
   * 포인트 적립/지급 (관리자/시스템 전용)
   * - 구매 적립, 이벤트 지급, 환불 복원 등
   */
  async awardPoints(
    userId: string,
    amount: number,
    sourceType: 'PURCHASE_REWARD' | 'EVENT_BONUS' | 'REFUND' | 'ADMIN_GRANT',
    metadata?: Record<string, any>,
  ) {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `포인트 적립: ${userId}, 금액: ${amountKRW}KRW, 타입: ${sourceType}`,
    );

    return await this.db.db.transaction(async (tx) => {
      try {
        // 1. 포인트 계정 확인 (없으면 자동 생성)
        await this.ensurePointAccount(userId, tx);

        // 2. 포인트 계정 조회
        const [pointAccount] = await tx
          .select()
          .from(schema.points)
          .where(eq(schema.points.userId, userId))
          .limit(1);

        if (!pointAccount) {
          throw new Error('포인트 계정을 찾을 수 없습니다');
        }

        // 3. 적립 트랜잭션 생성
        const transactionId = ulid();
        await tx.insert(schema.pointTransactions).values({
          id: transactionId,
          pointId: pointAccount.id,
          type: 'EARN',
          amount: amountKRW,
          reason: `포인트 적립 (${sourceType})`,
          relatedEventId: metadata?.relatedId || null,
        });

        // 4. 포인트 잔액 업데이트
        const newBalance = pointAccount.balance + amountKRW;
        await tx
          .update(schema.points)
          .set({
            balance: newBalance,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.userId, userId));

        this.logger.log(`포인트 적립 완료: ${transactionId}`);

        return {
          success: true,
          transactionId,
          newBalance,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`포인트 적립 실패: ${errorMessage}`);

        return {
          success: false,
          error: `포인트 적립 처리 중 오류: ${errorMessage}`,
        };
      }
    });
  }

  /**
   * 포인트 잔액 조회
   */
  async getPointBalance(userId: string) {
    this.logger.log(`포인트 잔액 조회: ${userId}`);

    try {
      const [pointAccount] = await this.db.db
        .select()
        .from(schema.points)
        .where(eq(schema.points.userId, userId))
        .limit(1);

      if (!pointAccount) {
        // 계정이 없으면 자동 생성 후 0원 반환
        await this.ensurePointAccount(userId);
        return {
          balance: 0,
          freezeAmount: 0,
          availableAmount: 0,
        };
      }

      const balance = pointAccount.balance;
      const freezeAmount = 0; // 스키마에 freezeAmount 없음

      return {
        balance,
        freezeAmount,
        availableAmount: balance - freezeAmount,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`포인트 잔액 조회 실패: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 포인트 계정 자동 생성 (회원가입 시 호출 또는 lazy 생성)
   */
  async ensurePointAccount(
    userId: string,
    tx?: typeof this.db.db,
  ): Promise<void> {
    const dbInstance = tx || this.db.db;

    try {
      // 기존 계정 확인
      const [existingAccount] = await dbInstance
        .select()
        .from(schema.points)
        .where(eq(schema.points.userId, userId))
        .limit(1);

      if (existingAccount) {
        return; // 이미 존재함
      }

      // 포인트 계정 생성
      await dbInstance.insert(schema.points).values({
        userId,
        balance: 0,
      });

      this.logger.log(`포인트 계정 자동 생성: ${userId}`);
    } catch (error) {
      // 중복 생성 시도는 무시 (race condition 대응)
      if ((error as any)?.code !== '23505') {
        throw error;
      }
    }
  }

  /**
   * 포인트 사용 내역 조회
   */
  async getTransactionHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ) {
    this.logger.log(`포인트 사용내역 조회: ${userId}`);

    try {
      // 포인트 계정 조회 후 트랜잭션 조회
      const [pointAccount] = await this.db.db
        .select()
        .from(schema.points)
        .where(eq(schema.points.userId, userId))
        .limit(1);

      if (!pointAccount) {
        return {
          success: true,
          transactions: [],
          pagination: { limit, offset, hasMore: false },
        };
      }

      const transactions = await this.db.db
        .select()
        .from(schema.pointTransactions)
        .where(eq(schema.pointTransactions.pointId, pointAccount.id))
        .orderBy(schema.pointTransactions.createdAt)
        .limit(limit)
        .offset(offset);

      return {
        success: true,
        transactions: transactions.map((tx) => ({
          id: tx.id,
          type: tx.type,
          amount: tx.amount,
          description: tx.reason,
          createdAt: tx.createdAt,
          relatedId: tx.relatedEventId,
        })),
        pagination: {
          limit,
          offset,
          hasMore: transactions.length === limit,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`포인트 사용내역 조회 실패: ${errorMessage}`);

      return {
        success: false,
        transactions: [],
        error: errorMessage,
      };
    }
  }
}
