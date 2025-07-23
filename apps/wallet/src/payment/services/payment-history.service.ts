import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq, desc, inArray, count, sum } from 'drizzle-orm';

// 조회 요청 옵션 인터페이스
export interface PaymentHistoryQueryOptions {
  limit: number;
  offset: number;
}

// 조회 응답 인터페이스들
export interface PaymentHistoryResponse {
  items: PaymentHistoryItem[];
  total: number;
  hasMore: boolean;
}

export interface PaymentHistoryItem {
  id: string;
  amount: number;
  status: string;
  createdAt: Date;
  paymentMethod: {
    type: string;
    name: string;
  };
  invoice: {
    id: string;
    type: string;
    amount: number;
  } | null;
}

// 관리자용 결제 내역 아이템 (userId 포함)
export interface AdminPaymentHistoryItem extends PaymentHistoryItem {
  userId: string;
}

export interface PaymentEventDetail {
  id: string;
  amount: number;
  status: string;
  pgTransactionId?: string;
  createdAt: Date;
  updatedAt: Date;
  paymentMethod: {
    type: string;
    name: string;
  };
  invoice: {
    id: string;
    type: string;
    amount: number;
  } | null;
}

export interface PaymentStatistics {
  totalPayments: number;
  totalAmount: number;
  successfulPayments: number;
  successRate: number; // 백분율
}

// 커스텀 예외 클래스
export class PaymentHistoryQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentHistoryQueryError';
  }
}

/**
 * 결제 내역 조회 전담 서비스
 * CQRS 패턴에 따라 조회(Query) 책임만을 담당합니다.
 */
@Injectable()
export class PaymentHistoryService {
  private readonly logger = new Logger(PaymentHistoryService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>
  ) {}

  /**
   * 특정 사용자의 결제 내역을 조회합니다.
   * 여러 테이블을 JOIN하여 풍부한 정보를 제공합니다.
   */
  async getPaymentHistoryForUser(
    userId: string,
    options: PaymentHistoryQueryOptions,
  ): Promise<PaymentHistoryResponse> {
    try {
      this.logger.log(`결제 내역 조회 시작: 사용자 ${userId}`);

      // 1. 사용자와 관련된 PaymentMethod ID 목록을 먼저 찾습니다.
      const userPaymentMethods = await this.dbService.db.query.paymentMethod.findMany({
        where: eq(schema.paymentMethod.userId, userId),
        columns: { id: true },
      });

      if (userPaymentMethods.length === 0) {
        this.logger.log(`결제수단이 없는 사용자: ${userId}`);
        return { items: [], total: 0, hasMore: false };
      }

      const paymentMethodIds = userPaymentMethods.map((pm) => pm.id);

      // 2. 해당 결제수단들로 발생한 PaymentEvent들을 조회합니다.
      const paymentHistory = await this.dbService.db.query.paymentEvents.findMany({
        where: inArray(schema.paymentEvents.paymentMethodId, paymentMethodIds),
        limit: options.limit,
        offset: options.offset,
        orderBy: desc(schema.paymentEvents.createdAt),
        with: {
          // 관련된 청구서 정보 JOIN
          invoice: {
            columns: {
              id: true,
              invoiceType: true,
              amount: true,
            },
          },
          // 관련된 결제수단 정보 JOIN
          paymentMethod: {
            columns: {
              id: true,
              methodType: true,
              methodName: true,
            },
          },
        },
      });

      // 3. 전체 카운트 조회 (페이징을 위해)
      const totalCount = await this.getTotalPaymentCount(paymentMethodIds);

      // 4. 응답 데이터 변환
      const items = paymentHistory.map(this.transformToPaymentHistoryItem);

      this.logger.log(`결제 내역 조회 완료: 사용자 ${userId}, 총 ${totalCount}건 중 ${items.length}건 조회`);

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
      this.logger.log(`결제 상세 조회 시작: 사용자 ${userId}, 이벤트 ${paymentEventId}`);

      // 사용자 권한 확인을 위해 paymentMethod를 통해 검증
      const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
        where: eq(schema.paymentEvents.id, paymentEventId),
        with: {
          paymentMethod: {
            columns: { userId: true, methodType: true, methodName: true },
          },
          invoice: {
            columns: { id: true, invoiceType: true, amount: true },
          },
        },
      });

      if (!paymentEvent || paymentEvent.paymentMethod.userId !== userId) {
        this.logger.warn(`권한 없는 결제 상세 조회 시도: 사용자 ${userId}, 이벤트 ${paymentEventId}`);
        return null;
      }

      const detail = this.transformToPaymentEventDetail(paymentEvent);
      this.logger.log(`결제 상세 조회 완료: 사용자 ${userId}, 이벤트 ${paymentEventId}`);

      return detail;

    } catch (error) {
      this.logger.error(`결제 상세 조회 실패: ${paymentEventId}`, error);
      throw new PaymentHistoryQueryError('결제 상세 정보를 조회할 수 없습니다.');
    }
  }

  /**
   * 사용자의 결제 통계 정보를 조회합니다.
   */
  async getPaymentStatistics(userId: string): Promise<PaymentStatistics> {
    try {
      this.logger.log(`결제 통계 조회 시작: 사용자 ${userId}`);

      const userPaymentMethods = await this.dbService.db.query.paymentMethod.findMany({
        where: eq(schema.paymentMethod.userId, userId),
        columns: { id: true },
      });

      if (userPaymentMethods.length === 0) {
        return this.getEmptyStatistics();
      }

      const paymentMethodIds = userPaymentMethods.map((pm) => pm.id);

      // 집계 쿼리 실행
      const statistics = await this.dbService.db
        .select({
          totalCount: count(),
          totalAmount: sum(schema.paymentEvents.amount),
        })
        .from(schema.paymentEvents)
        .where(inArray(schema.paymentEvents.paymentMethodId, paymentMethodIds));

      const result = this.transformToPaymentStatistics(statistics[0]);
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
  ): Promise<PaymentHistoryResponse> {
    try {
      this.logger.log(`관리자 전체 결제 내역 조회 시작`);

      // 모든 PaymentEvent들을 조회합니다 (사용자 필터링 없이)
      const paymentHistory = await this.dbService.db.query.paymentEvents.findMany({
        limit: options.limit,
        offset: options.offset,
        orderBy: desc(schema.paymentEvents.createdAt),
        with: {
          // 관련된 청구서 정보 JOIN
          invoice: {
            columns: {
              id: true,
              invoiceType: true,
              amount: true,
            },
          },
          // 관련된 결제수단 정보 JOIN
          paymentMethod: {
            columns: {
              id: true,
              userId: true, // 관리자용이므로 userId도 포함
              methodType: true,
              methodName: true,
            },
          },
        },
      });

      // 전체 카운트 조회
      const totalCount = await this.getAllPaymentCount();

      // 응답 데이터 변환 (관리자용이므로 userId 포함)
      const items = paymentHistory.map(this.transformToAdminPaymentHistoryItem);

      this.logger.log(`관리자 전체 결제 내역 조회 완료: 총 ${totalCount}건 중 ${items.length}건 조회`);

      return {
        items,
        total: totalCount,
        hasMore: options.offset + options.limit < totalCount,
      };

    } catch (error) {
      this.logger.error(`관리자 전체 결제 내역 조회 실패`, error);
      throw new PaymentHistoryQueryError('전체 결제 내역을 조회할 수 없습니다.');
    }
  }

  // Private helper methods
  private async getTotalPaymentCount(paymentMethodIds: string[]): Promise<number> {
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

  private transformToPaymentHistoryItem = (paymentEvent: any): PaymentHistoryItem => {
    return {
      id: paymentEvent.id,
      amount: paymentEvent.amount,
      status: paymentEvent.status,
      createdAt: paymentEvent.createdAt,
      paymentMethod: {
        type: paymentEvent.paymentMethod.methodType,
        name: paymentEvent.paymentMethod.methodName,
      },
      invoice: paymentEvent.invoice ? {
        id: paymentEvent.invoice.id,
        type: paymentEvent.invoice.invoiceType,
        amount: paymentEvent.invoice.amount,
      } : null,
    };
  }

  private transformToAdminPaymentHistoryItem = (paymentEvent: any): AdminPaymentHistoryItem => {
    return {
      id: paymentEvent.id,
      amount: paymentEvent.amount,
      status: paymentEvent.status,
      createdAt: paymentEvent.createdAt,
      userId: paymentEvent.paymentMethod.userId, // 관리자용이므로 userId 포함
      paymentMethod: {
        type: paymentEvent.paymentMethod.methodType,
        name: paymentEvent.paymentMethod.methodName,
      },
      invoice: paymentEvent.invoice ? {
        id: paymentEvent.invoice.id,
        type: paymentEvent.invoice.invoiceType,
        amount: paymentEvent.invoice.amount,
      } : null,
    };
  }

  private transformToPaymentEventDetail = (paymentEvent: any): PaymentEventDetail => {
    return {
      id: paymentEvent.id,
      amount: paymentEvent.amount,
      status: paymentEvent.status,
      pgTransactionId: paymentEvent.pgTransactionId,
      createdAt: paymentEvent.createdAt,
      updatedAt: paymentEvent.updatedAt,
      paymentMethod: {
        type: paymentEvent.paymentMethod.methodType,
        name: paymentEvent.paymentMethod.methodName,
      },
      invoice: paymentEvent.invoice ? {
        id: paymentEvent.invoice.id,
        type: paymentEvent.invoice.invoiceType,
        amount: paymentEvent.invoice.amount,
      } : null,
    };
  }

  private transformToPaymentStatistics = (raw: any): PaymentStatistics => {
    const totalCount = raw.totalCount || 0;
    const totalAmount = raw.totalAmount || 0;

    return {
      totalPayments: totalCount,
      totalAmount: totalAmount,
      successfulPayments: 0, // 나중에 구현
      successRate: 0, // 나중에 구현
    };
  }

  private getEmptyStatistics(): PaymentStatistics {
    return {
      totalPayments: 0,
      totalAmount: 0,
      successfulPayments: 0,
      successRate: 0,
    };
  }
}