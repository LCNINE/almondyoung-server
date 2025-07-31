import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq, desc, inArray, count, sum, sql } from 'drizzle-orm';
import { FINANCIAL_TRANSACTION_STATUS } from '../../shared/schemas/schema';

// --- Drizzle ORM 타입 추론 ---
// 스키마로부터 기본 타입을 추론합니다.
type PaymentEvent = typeof schema.paymentEvents.$inferSelect;
type PaymentMethod = typeof schema.paymentMethod.$inferSelect;
type PaymentSession = typeof schema.paymentSessions.$inferSelect;

// 관계가 포함된 쿼리 결과의 최종 타입을 명시적으로 정의합니다.
type PaymentEventWithRelations = PaymentEvent & {
  paymentMethod: PaymentMethod;
  paymentSession: PaymentSession | null;
};

// --- 응답 인터페이스 정의 ---
// 'invoice'를 'paymentSession'으로 완전히 변경합니다.
export interface PaymentHistoryItem {
  id: string;
  amount: number;
  status: string;
  createdAt: Date;
  paymentMethod: {
    type: string;
    name: string;
  };
  paymentSession: {
    id: string;
    amount: number;
  } | null;
}

export interface AdminPaymentHistoryItem extends PaymentHistoryItem {
  userId: string;
}

export interface PaymentEventDetail {
  id: string;
  amount: number;
  status: string;
  pgTransactionId?: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  paymentMethod: {
    type: string;
    name: string;
  };
  paymentSession: {
    id: string;
    amount: number;
  } | null;
}

export interface PaymentHistoryQueryOptions {
  limit: number;
  offset: number;
}

// [수정] Drizzle의 sum() 함수는 정밀도를 위해 'string'을 반환하므로 타입을 string으로 변경
export interface PaymentStatistics {
  totalPayments: number;
  totalAmount: string;
  successfulPayments: number;
  successRate: number; // 0-100 사이의 백분율
}

// 공통 응답 타입을 정의하여 일관성을 높입니다.
export interface PaymentHistoryResponse<T extends PaymentHistoryItem> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export class PaymentHistoryQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentHistoryQueryError';
  }
}

@Injectable()
export class PaymentHistoryService {
  private readonly logger = new Logger(PaymentHistoryService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 특정 사용자의 결제 내역을 조회합니다.
   */
  async getPaymentHistoryForUser(
    userId: string,
    options: PaymentHistoryQueryOptions,
  ): Promise<PaymentHistoryResponse<PaymentHistoryItem>> {
    try {
      this.logger.log(`결제 내역 조회 시작: 사용자 ${userId}`);

      const paymentMethodIds = await this.getUserPaymentMethodIds(userId);
      if (paymentMethodIds.length === 0) {
        return { items: [], total: 0, hasMore: false };
      }

      const paymentHistory =
        await this.dbService.db.query.paymentEvents.findMany({
          where: inArray(
            schema.paymentEvents.paymentMethodId,
            paymentMethodIds,
          ),
          limit: options.limit,
          offset: options.offset,
          orderBy: desc(schema.paymentEvents.createdAt),
          with: {
            paymentSession: { columns: { id: true, amount: true } },
            paymentMethod: { columns: { methodType: true, methodName: true } },
          },
        });

      const totalCount = await this.getTotalPaymentCount(paymentMethodIds);
      const items = paymentHistory.map((event) =>
        this.transformToPaymentHistoryItem(event as PaymentEventWithRelations),
      );

      this.logger.log(
        `결제 내역 조회 완료: 사용자 ${userId}, 총 ${totalCount}건 중 ${items.length}건 조회`,
      );

      return {
        items,
        total: totalCount,
        hasMore: options.offset + options.limit < totalCount,
      };
    } catch (error) {
      this.logger.error(`결제 내역 조회 실패: 사용자 ${userId}`, error);
      throw new PaymentHistoryQueryError('결제 내역을 조회할 수 없습니다.');
    }
  }

  /**
   * 특정 결제 이벤트의 상세 정보를 조회합니다.
   */
  async getPaymentEventDetail(
    userId: string,
    paymentEventId: string,
  ): Promise<PaymentEventDetail | null> {
    try {
      this.logger.log(
        `결제 상세 조회 시작: 사용자 ${userId}, 이벤트 ${paymentEventId}`,
      );

      const paymentEvent =
        await this.dbService.db.query.paymentEvents.findFirst({
          where: eq(schema.paymentEvents.id, paymentEventId),
          with: { paymentMethod: true, paymentSession: true },
        });

      if (!paymentEvent || paymentEvent.paymentMethod.userId !== userId) {
        this.logger.warn(
          `권한 없는 결제 상세 조회 시도: 사용자 ${userId}, 이벤트 ${paymentEventId}`,
        );
        return null;
      }

      const detail = this.transformToPaymentEventDetail(
        paymentEvent as PaymentEventWithRelations,
      );
      this.logger.log(
        `결제 상세 조회 완료: 사용자 ${userId}, 이벤트 ${paymentEventId}`,
      );
      return detail;
    } catch (error) {
      this.logger.error(`결제 상세 조회 실패: ${paymentEventId}`, error);
      throw new PaymentHistoryQueryError(
        '결제 상세 정보를 조회할 수 없습니다.',
      );
    }
  }

  /**
   * 사용자의 결제 통계 정보를 조회합니다.
   */
  async getPaymentStatistics(userId: string): Promise<PaymentStatistics> {
    try {
      this.logger.log(`결제 통계 조회 시작: 사용자 ${userId}`);
      const paymentMethodIds = await this.getUserPaymentMethodIds(userId);
      if (paymentMethodIds.length === 0) return this.getEmptyStatistics();

      // [수정] 성공 건수를 SQL 레벨에서 계산하여 성능 향상
      const statsResult = await this.dbService.db
        .select({
          totalPayments: count(),
          totalAmount: sum(schema.paymentEvents.amount),
          successfulPayments: count(
            sql`CASE WHEN ${schema.paymentEvents.status} = ${FINANCIAL_TRANSACTION_STATUS.CAPTURED} THEN 1 END`,
          ),
        })
        .from(schema.paymentEvents)
        .where(inArray(schema.paymentEvents.paymentMethodId, paymentMethodIds));

      const stats = statsResult[0];
      const result = this.transformToPaymentStatistics(stats);
      this.logger.log(`결제 통계 조회 완료: 사용자 ${userId}`);
      return result;
    } catch (error) {
      this.logger.error(`결제 통계 조회 실패: 사용자 ${userId}`, error);
      throw new PaymentHistoryQueryError('결제 통계를 조회할 수 없습니다.');
    }
  }

  /**
   * 관리자용: 전체 결제 내역을 조회합니다.
   */
  async getAllPaymentHistory(
    options: PaymentHistoryQueryOptions,
  ): Promise<PaymentHistoryResponse<AdminPaymentHistoryItem>> {
    try {
      this.logger.log(`관리자 전체 결제 내역 조회 시작`);

      const paymentHistory =
        await this.dbService.db.query.paymentEvents.findMany({
          limit: options.limit,
          offset: options.offset,
          orderBy: desc(schema.paymentEvents.createdAt),
          with: {
            paymentSession: { columns: { id: true, amount: true } },
            paymentMethod: true,
          },
        });

      const totalCount = await this.getAllPaymentCount();
      const items = paymentHistory.map((event) =>
        this.transformToAdminPaymentHistoryItem(
          event as PaymentEventWithRelations,
        ),
      );

      this.logger.log(
        `관리자 전체 결제 내역 조회 완료: 총 ${totalCount}건 중 ${items.length}건 조회`,
      );

      return {
        items,
        total: totalCount,
        hasMore: options.offset + options.limit < totalCount,
      };
    } catch (error) {
      this.logger.error(`관리자 전체 결제 내역 조회 실패`, error);
      throw new PaymentHistoryQueryError(
        '전체 결제 내역을 조회할 수 없습니다.',
      );
    }
  }

  // --- Private Helper Methods ---

  private async getUserPaymentMethodIds(userId: string): Promise<string[]> {
    const userPaymentMethods = await this.dbService.db
      .select()
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.userId, userId));

    return userPaymentMethods.map((pm) => pm.id);
  }

  private async getTotalPaymentCount(
    paymentMethodIds: string[],
  ): Promise<number> {
    const result = await this.dbService.db
      .select({ count: count() })
      .from(schema.paymentEvents)
      .where(inArray(schema.paymentEvents.paymentMethodId, paymentMethodIds));
    return result[0]?.count || 0;
  }

  private async getAllPaymentCount(): Promise<number> {
    const result = await this.dbService.db
      .select({ count: count() })
      .from(schema.paymentEvents);
    return result[0]?.count || 0;
  }

  private transformToPaymentHistoryItem = (
    event: PaymentEventWithRelations,
  ): PaymentHistoryItem => ({
    id: event.id,
    amount: event.amount,
    status: event.status,
    createdAt: event.createdAt,
    paymentMethod: {
      type: event.paymentMethod.methodType,
      name: event.paymentMethod.methodName,
    },
    paymentSession: event.paymentSession
      ? { id: event.paymentSession.id, amount: event.paymentSession.amount }
      : null,
  });

  private transformToAdminPaymentHistoryItem = (
    event: PaymentEventWithRelations,
  ): AdminPaymentHistoryItem => ({
    ...this.transformToPaymentHistoryItem(event),
    userId: event.paymentMethod.userId,
  });

  private transformToPaymentEventDetail = (
    event: PaymentEventWithRelations,
  ): PaymentEventDetail => ({
    id: event.id,
    amount: event.amount,
    status: event.status,
    pgTransactionId: event.pgTransactionId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    paymentMethod: {
      type: event.paymentMethod.methodType,
      name: event.paymentMethod.methodName,
    },
    paymentSession: event.paymentSession
      ? { id: event.paymentSession.id, amount: event.paymentSession.amount }
      : null,
  });

  private transformToPaymentStatistics = (raw: {
    totalPayments: number;
    totalAmount: string | null;
    successfulPayments: number;
  }): PaymentStatistics => {
    const totalPayments = raw.totalPayments || 0;
    const successfulPayments = raw.successfulPayments || 0;
    const successRate =
      totalPayments > 0 ? (successfulPayments / totalPayments) * 100 : 0;

    return {
      totalPayments,
      totalAmount: raw.totalAmount || '0.00',
      successfulPayments,
      successRate: parseFloat(successRate.toFixed(2)),
    };
  };

  private getEmptyStatistics = (): PaymentStatistics => ({
    totalPayments: 0,
    totalAmount: '0.00',
    successfulPayments: 0,
    successRate: 0,
  });
}
