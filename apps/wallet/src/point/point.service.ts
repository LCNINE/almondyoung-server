import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import {
  POINT_TRANSACTION_TYPE,
  PointTransactionType,
} from '../shared/schemas/schema';
import { eq, desc, and } from 'drizzle-orm';
import { ulid } from 'ulid';

// 포인트 적립 요청 데이터
export interface AddPointsRequest {
  userId: string;
  amount: number;
  reason: string;
  relatedEventId?: string;
  expiresAt?: Date;
}

// 포인트 사용 요청 데이터
export interface RedeemPointsRequest {
  userId: string;
  amount: number;
  reason: string;
  relatedEventId?: string;
}

// 포인트 차감(회수) 요청 데이터
export interface DeductPointsRequest {
  userId: string;
  amount: number;
  reason: string;
  relatedEventId?: string;
}

// 포인트 처리 결과
export interface PointResult {
  success: boolean;
  message?: string;
  currentBalance?: number;
  transactionId?: string;
}

// 포인트 내역 조회 옵션
export interface PointHistoryOptions {
  userId: string;
  limit?: number;
  offset?: number;
  type?: PointTransactionType;
}

/**
 * 포인트(Point) 서비스 - Medusa.js 스타일 상태+로그 모델
 *
 * 핵심 원칙:
 * - 모든 포인트 변경은 반드시 DB 트랜잭션으로 처리
 * - points 테이블(현재 잔액) + pointTransactions 테이블(변동 내역) 동시 업데이트
 * - 이벤트 기반으로 다른 시스템과 느슨한 결합
 */
@Injectable()
export class PointService {
  private readonly logger = new Logger(PointService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 포인트 적립
   * 구매 완료, 이벤트 참여 등으로 포인트를 적립합니다.
   */
  async addPoints(request: AddPointsRequest): Promise<PointResult> {
    this.logger.log(
      `포인트 적립: userId=${request.userId}, amount=${request.amount}`,
    );

    try {
      const result = await this.dbService.db.transaction(async (tx) => {
        // 1. 사용자 포인트 계정 조회 또는 생성
        let pointAccount = await tx.query.points.findFirst({
          where: eq(schema.points.userId, request.userId),
        });

        if (!pointAccount) {
          // 포인트 계정이 없으면 생성
          const [newAccount] = await tx
            .insert(schema.points)
            .values({
              id: ulid(),
              userId: request.userId,
              balance: 0,
              version: 1,
            })
            .returning();
          pointAccount = newAccount;
        }

        // 2. 포인트 잔액 업데이트
        const newBalance = pointAccount.balance + request.amount;
        await tx
          .update(schema.points)
          .set({
            balance: newBalance,
            version: pointAccount.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.id, pointAccount.id));

        // 3. 포인트 변동 내역 기록
        const transactionId = ulid();
        await tx.insert(schema.pointTransactions).values({
          id: transactionId,
          pointId: pointAccount.id,
          type: POINT_TRANSACTION_TYPE.EARN,
          amount: request.amount,
          relatedEventId: request.relatedEventId,
          reason: request.reason,
          expiresAt: request.expiresAt,
        });

        return { newBalance, transactionId };
      });

      this.logger.log(
        `포인트 적립 완료: userId=${request.userId}, 새 잔액=${result.newBalance}`,
      );

      return {
        success: true,
        message: `${request.amount}P가 적립되었습니다.`,
        currentBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    } catch (error) {
      this.logger.error(`포인트 적립 실패: userId=${request.userId}`, error);
      return {
        success: false,
        message: '포인트 적립에 실패했습니다.',
      };
    }
  }

  /**
   * 포인트 사용
   * 결제 시 포인트로 할인하는 등 포인트를 사용합니다.
   */
  async redeemPoints(request: RedeemPointsRequest): Promise<PointResult> {
    this.logger.log(
      `포인트 사용: userId=${request.userId}, amount=${request.amount}`,
    );

    try {
      const result = await this.dbService.db.transaction(async (tx) => {
        // 1. 사용자 포인트 계정 조회
        const pointAccount = await tx.query.points.findFirst({
          where: eq(schema.points.userId, request.userId),
        });

        if (!pointAccount) {
          throw new Error('포인트 계정을 찾을 수 없습니다.');
        }

        // 2. 잔액 부족 확인
        if (pointAccount.balance < request.amount) {
          throw new Error(
            `포인트 잔액이 부족합니다. (보유: ${pointAccount.balance}P, 사용: ${request.amount}P)`,
          );
        }

        // 3. 포인트 잔액 차감
        const newBalance = pointAccount.balance - request.amount;
        await tx
          .update(schema.points)
          .set({
            balance: newBalance,
            version: pointAccount.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.id, pointAccount.id));

        // 4. 포인트 변동 내역 기록 (음수로 기록)
        const transactionId = ulid();
        await tx.insert(schema.pointTransactions).values({
          id: transactionId,
          pointId: pointAccount.id,
          type: POINT_TRANSACTION_TYPE.REDEEM,
          amount: -request.amount, // 사용은 음수로 기록
          relatedEventId: request.relatedEventId,
          reason: request.reason,
        });

        return { newBalance, transactionId };
      });

      this.logger.log(
        `포인트 사용 완료: userId=${request.userId}, 새 잔액=${result.newBalance}`,
      );

      return {
        success: true,
        message: `${request.amount}P가 사용되었습니다.`,
        currentBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    } catch (error) {
      this.logger.error(`포인트 사용 실패: userId=${request.userId}`, error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : '포인트 사용에 실패했습니다.',
      };
    }
  }

  /**
   * 포인트 차감 (회수)
   * 환불 등으로 인해 이전에 적립된 포인트를 회수합니다.
   */
  async deductPoints(request: DeductPointsRequest): Promise<PointResult> {
    this.logger.log(
      `포인트 차감: userId=${request.userId}, amount=${request.amount}`,
    );

    try {
      const result = await this.dbService.db.transaction(async (tx) => {
        // 1. 사용자 포인트 계정 조회
        const pointAccount = await tx.query.points.findFirst({
          where: eq(schema.points.userId, request.userId),
        });

        if (!pointAccount) {
          throw new Error('포인트 계정을 찾을 수 없습니다.');
        }

        // 2. 포인트 잔액 차감 (음수도 허용 - 환불 시나리오)
        const newBalance = pointAccount.balance - request.amount;
        await tx
          .update(schema.points)
          .set({
            balance: newBalance,
            version: pointAccount.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.points.id, pointAccount.id));

        // 3. 포인트 변동 내역 기록 (음수로 기록)
        const transactionId = ulid();
        await tx.insert(schema.pointTransactions).values({
          id: transactionId,
          pointId: pointAccount.id,
          type: POINT_TRANSACTION_TYPE.EARN_CANCEL,
          amount: -request.amount, // 차감은 음수로 기록
          relatedEventId: request.relatedEventId,
          reason: request.reason,
        });

        return { newBalance, transactionId };
      });

      this.logger.log(
        `포인트 차감 완료: userId=${request.userId}, 새 잔액=${result.newBalance}`,
      );

      return {
        success: true,
        message: `${request.amount}P가 차감되었습니다.`,
        currentBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    } catch (error) {
      this.logger.error(`포인트 차감 실패: userId=${request.userId}`, error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : '포인트 차감에 실패했습니다.',
      };
    }
  }

  /**
   * 포인트 잔액 조회
   * 매우 빠른 조회를 위해 points 테이블만 조회합니다.
   */
  async getPointBalance(userId: string): Promise<number> {
    const pointAccount = await this.dbService.db.query.points.findFirst({
      where: eq(schema.points.userId, userId),
    });

    return pointAccount?.balance ?? 0;
  }

  /**
   * 포인트 변동 내역 조회
   * 사용자의 포인트 적립/사용 히스토리를 조회합니다.
   */
  async getPointHistory(options: PointHistoryOptions) {
    const { userId, limit = 20, offset = 0, type } = options;

    // 사용자의 포인트 계정 조회
    const pointAccount = await this.dbService.db.query.points.findFirst({
      where: eq(schema.points.userId, userId),
    });

    if (!pointAccount) {
      return {
        success: true,
        data: {
          currentBalance: 0,
          transactions: [],
          total: 0,
        },
      };
    }

    // 조건 설정
    const whereConditions = [
      eq(schema.pointTransactions.pointId, pointAccount.id),
    ];
    if (type) {
      whereConditions.push(eq(schema.pointTransactions.type, type));
    }

    // 포인트 변동 내역 조회
    const transactions =
      await this.dbService.db.query.pointTransactions.findMany({
        where: and(...whereConditions),
        limit,
        offset,
        orderBy: [desc(schema.pointTransactions.createdAt)],
      });

    // 총 개수 조회 (간단히 추정)
    const totalCount = transactions.length; // 실제로는 별도 카운트 쿼리 필요

    return {
      success: true,
      data: {
        currentBalance: pointAccount.balance,
        transactions,
        total: totalCount,
      },
    };
  }
}
