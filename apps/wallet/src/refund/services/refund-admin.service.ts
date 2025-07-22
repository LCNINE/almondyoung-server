import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq, desc, count } from 'drizzle-orm';

export interface RefundListOptions {
  limit: number;
  offset: number;
  status?: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED';
}

/**
 * 관리자용 환불 서비스 - CQRS 조회 모델 구현
 * - 역할: 관리자 페이지를 위한 최적화된 환불 데이터 조회
 * - 여러 테이블을 JOIN하여 '조회 모델(Read Model)'을 동적으로 생성
 * - 새로운 테이블 추가 없이 서비스 계층에서 CQRS 패턴 적용
 */
@Injectable()
export class RefundAdminService {
  private readonly logger = new Logger(RefundAdminService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 관리자 페이지를 위한 환불 목록을 조회합니다.
   * 여러 테이블을 JOIN하여 '조회 모델'을 만듭니다.
   */
  async getRefundListForAdmin(options: RefundListOptions) {
    this.logger.log(
      `관리자용 환불 목록 조회:limit=${options.limit}, offset=${options.offset}, status=${options.status || 'ALL'}`,
    );

    try {
      // WHERE 조건 설정
      const whereCondition = options.status
        ? eq(schema.refundEvents.status, options.status)
        : undefined;

      // 🏦 CQRS 조회 모델: 여러 테이블을 JOIN하여 관리자가 필요한 모든 정보를 한 번에 조회
      const refunds = await this.dbService.db.query.refundEvents.findMany({
        where: whereCondition,
        limit: options.limit,
        offset: options.offset,
        orderBy: [desc(schema.refundEvents.createdAt)],
        with: {
          // 환불 계좌 정보 JOIN
          userRefundAccount: {
            columns: {
              bankCode: true,
              bankName: true,
              accountNumber: true,
              accountHolderName: true,
            },
          },
          // 원본 결제 이벤트 정보 JOIN
          paymentEvent: {
            columns: {
              id: true,
              amount: true,
              status: true,
              pgTransactionId: true,
              createdAt: true,
            },
            with: {
              // 원본 결제 수단 정보 JOIN
              paymentMethod: {
                columns: {
                  id: true,
                  methodType: true,
                  methodName: true,
                  userId: true,
                },
              },
              // 관련 청구서 정보 JOIN
              invoice: {
                columns: {
                  id: true,
                  invoiceType: true,
                  amount: true,
                  status: true,
                  userId: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });

      // 전체 개수 조회 (페이징을 위함)
      const totalCountResult = await this.dbService.db
        .select({ total: count() })
        .from(schema.refundEvents)
        .where(whereCondition);

      const totalCount = totalCountResult[0]?.total || 0;

      // 🎯 관리자 페이지에 최적화된 데이터 구조로 변환 (조회 모델)
      const optimizedRefunds = refunds.map((refund) => ({
        // 환불 기본 정보
        refundId: refund.id,
        refundStatus: refund.status,
        refundAmount: Number(refund.amount),
        refundReason: refund.reason,
        refundRequestedAt: refund.createdAt,
        refundCompletedAt: refund.completedAt,
        refundCompletedBy: refund.completedBy,
        rejectionReason: refund.rejectionReason,

        // 환불 계좌 정보 (CS팀이 돈을 보낼 계좌)
        refundAccount: {
          bankCode: refund.userRefundAccount.bankCode,
          bankName: refund.userRefundAccount.bankName,
          accountNumber: refund.userRefundAccount.accountNumber,
          accountHolderName: refund.userRefundAccount.accountHolderName,
        },

        // 원본 결제 정보 (환불의 근거가 되는 결제)
        originalPayment: {
          paymentEventId: refund.paymentEvent.id,
          originalAmount: Number(refund.paymentEvent.amount),
          paymentStatus: refund.paymentEvent.status,
          pgTransactionId: refund.paymentEvent.pgTransactionId,
          paidAt: refund.paymentEvent.createdAt,
        },

        // 결제 수단 정보
        paymentMethod: {
          methodId: refund.paymentEvent.paymentMethod.id,
          methodType: refund.paymentEvent.paymentMethod.methodType,
          methodName: refund.paymentEvent.paymentMethod.methodName,
        },

        // 관련 청구서 정보
        invoice: {
          invoiceId: refund.paymentEvent.invoice.id,
          invoiceType: refund.paymentEvent.invoice.invoiceType,
          invoiceAmount: Number(refund.paymentEvent.invoice.amount),
          invoiceStatus: refund.paymentEvent.invoice.status,
          invoiceCreatedAt: refund.paymentEvent.invoice.createdAt,
        },

        // 사용자 정보
        userId: refund.paymentEvent.paymentMethod.userId,
      }));

      this.logger.log(
        `관리자용 환불 목록 조회 완료: ${refunds.length}건 조회, 전체 ${totalCount}건`,
      );

      return {
        success: true,
        data: {
          refunds: optimizedRefunds,
          pagination: {
            total: totalCount,
            limit: options.limit,
            offset: options.offset,
            hasNext: options.offset + options.limit < totalCount,
            hasPrev: options.offset > 0,
          },
        },
      };
    } catch (error) {
      this.logger.error('관리자용 환불 목록 조회 실패:', error);
      throw error;
    }
  }

  /**
   * 관리자용 환불 상세 정보를 조회합니다.
   */
  async getRefundDetailForAdmin(refundId: string) {
    this.logger.log(`관리자용 환불 상세 조회: refundId=${refundId}`);

    try {
      // 🏦 CQRS 조회 모델: 환불 상세 정보를 위한 최적화된 JOIN 쿼리
      const refund = await this.dbService.db.query.refundEvents.findFirst({
        where: eq(schema.refundEvents.id, refundId),
        with: {
          // 환불 계좌 정보 (전체 정보)
          userRefundAccount: true,
          // 원본 결제 이벤트 정보 (전체 정보)
          paymentEvent: {
            with: {
              // 결제 수단 정보
              paymentMethod: true,
              // 청구서 정보
              invoice: {
                with: {
                  // 청구서 이벤트 히스토리
                  events: {
                    orderBy: [desc(schema.invoiceEvent.occurredAt)],
                    limit: 10, // 최근 10개 이벤트만
                  },
                },
              },
            },
          },
        },
      });

      if (!refund) {
        return {
          success: false,
          message: '해당 환불 요청을 찾을 수 없습니다.',
          data: null,
        };
      }

      // 🎯 관리자 상세 페이지에 최적화된 데이터 구조 (조회 모델)
      const detailedRefund = {
        // 환불 상세 정보
        refund: {
          id: refund.id,
          status: refund.status,
          amount: Number(refund.amount),
          reason: refund.reason,
          requestedAt: refund.createdAt,
          completedAt: refund.completedAt,
          completedBy: refund.completedBy,
          rejectionReason: refund.rejectionReason,
        },

        // 환불 계좌 상세 정보
        refundAccount: {
          id: refund.userRefundAccount.id,
          bankCode: refund.userRefundAccount.bankCode,
          bankName: refund.userRefundAccount.bankName,
          accountNumber: refund.userRefundAccount.accountNumber,
          accountHolderName: refund.userRefundAccount.accountHolderName,
          isDefault: refund.userRefundAccount.isDefault,
          createdAt: refund.userRefundAccount.createdAt,
        },

        // 원본 결제 상세 정보
        originalPayment: {
          id: refund.paymentEvent.id,
          amount: Number(refund.paymentEvent.amount),
          status: refund.paymentEvent.status,
          pgTransactionId: refund.paymentEvent.pgTransactionId,
          pgResponse: refund.paymentEvent.pgResponse,
          createdAt: refund.paymentEvent.createdAt,
          actor: refund.paymentEvent.actor,
        },

        // 결제 수단 상세 정보
        paymentMethod: {
          id: refund.paymentEvent.paymentMethod.id,
          userId: refund.paymentEvent.paymentMethod.userId,
          methodType: refund.paymentEvent.paymentMethod.methodType,
          methodName: refund.paymentEvent.paymentMethod.methodName,
          institutionCode: refund.paymentEvent.paymentMethod.institutionCode,
          status: refund.paymentEvent.paymentMethod.status,
          createdAt: refund.paymentEvent.paymentMethod.createdAt,
        },

        // 청구서 상세 정보
        invoice: {
          id: refund.paymentEvent.invoice.id,
          userId: refund.paymentEvent.invoice.userId,
          invoiceType: refund.paymentEvent.invoice.invoiceType,
          amount: Number(refund.paymentEvent.invoice.amount),
          refundedAmount: Number(refund.paymentEvent.invoice.refundedAmount),
          currency: refund.paymentEvent.invoice.currency,
          status: refund.paymentEvent.invoice.status,
          issuedAt: refund.paymentEvent.invoice.issuedAt,
          createdAt: refund.paymentEvent.invoice.createdAt,
          // 청구서 이벤트 히스토리 (Event Sourcing 활용)
          eventHistory: refund.paymentEvent.invoice.events.map((event) => ({
            eventType: event.eventType,
            reason: event.reason,
            occurredAt: event.occurredAt,
          })),
        },
      };

      this.logger.log(`관리자용 환불 상세 조회 완료: refundId=${refundId}`);

      return {
        success: true,
        data: detailedRefund,
      };
    } catch (error) {
      this.logger.error(
        `관리자용 환불 상세 조회 실패: refundId=${refundId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * 관리자용 환불 통계 정보를 조회합니다.
   */
  async getRefundStatsForAdmin() {
    this.logger.log('관리자용 환불 통계 조회');

    try {
      // 🏦 CQRS 조회 모델: 통계를 위한 집계 쿼리
      const stats = await this.dbService.db
        .select({
          status: schema.refundEvents.status,
          count: count(),
          totalAmount: schema.refundEvents.amount,
        })
        .from(schema.refundEvents)
        .groupBy(schema.refundEvents.status);

      // 통계 데이터 가공
      const processedStats = {
        totalRefunds: stats.reduce((sum, stat) => sum + stat.count, 0),
        byStatus: {
          requested: stats.find((s) => s.status === 'REQUESTED')?.count || 0,
          processing: stats.find((s) => s.status === 'PROCESSING')?.count || 0,
          completed: stats.find((s) => s.status === 'COMPLETED')?.count || 0,
          rejected: stats.find((s) => s.status === 'REJECTED')?.count || 0,
        },
        totalAmount: {
          requested: Number(
            stats.find((s) => s.status === 'REQUESTED')?.totalAmount || 0,
          ),
          processing: Number(
            stats.find((s) => s.status === 'PROCESSING')?.totalAmount || 0,
          ),
          completed: Number(
            stats.find((s) => s.status === 'COMPLETED')?.totalAmount || 0,
          ),
          rejected: Number(
            stats.find((s) => s.status === 'REJECTED')?.totalAmount || 0,
          ),
        },
      };

      this.logger.log(
        `관리자용 환불 통계 조회 완료: 총 ${processedStats.totalRefunds}건`,
      );

      return {
        success: true,
        data: processedStats,
      };
    } catch (error) {
      this.logger.error('관리자용 환불 통계 조회 실패:', error);
      throw error;
    }
  }
}
