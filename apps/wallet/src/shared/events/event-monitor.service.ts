import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../schemas/schema';
import { ulid } from 'ulid';

/**
 * 통합 이벤트 모니터링 서비스
 * 모든 도메인의 이벤트를 중앙에서 수집하고 모니터링합니다.
 */
@Injectable()
export class EventMonitorService {
  private readonly logger = new Logger(EventMonitorService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 모든 Payment 이벤트 모니터링
   */
  @OnEvent('payment.*', { async: true })
  async monitorPaymentEvents(event: any, eventName: string) {
    await this.recordEvent('PAYMENT', eventName, event);
  }

  /**
   * 모든 Refund 이벤트 모니터링
   */
  @OnEvent('refund.*', { async: true })
  async monitorRefundEvents(event: any, eventName: string) {
    await this.recordEvent('REFUND', eventName, event);
  }

  /**
   * 모든 BNPL 이벤트 모니터링
   */
  @OnEvent('bnpl.*', { async: true })
  async monitorBnplEvents(event: any, eventName: string) {
    await this.recordEvent('BNPL', eventName, event);
  }

  /**
   * 모든 Invoice 이벤트 모니터링
   */
  @OnEvent('invoice.*', { async: true })
  async monitorInvoiceEvents(event: any, eventName: string) {
    await this.recordEvent('INVOICE', eventName, event);
  }

  /**
   * 모든 Settlement 이벤트 모니터링
   */
  @OnEvent('settlement.*', { async: true })
  async monitorSettlementEvents(event: any, eventName: string) {
    await this.recordEvent('SETTLEMENT', eventName, event);
  }

  /**
   * 이벤트를 중앙 모니터링 테이블에 기록
   */
  private async recordEvent(domain: string, eventName: string, eventData: any) {
    try {
      // 이벤트 모니터링 테이블이 있다면 기록
      // 현재는 로깅만 수행
      this.logger.log(`📊 [${domain}] ${eventName}`, {
        domain,
        eventName,
        timestamp: new Date().toISOString(),
        eventId: eventData.id || eventData.invoiceId || eventData.refundId || eventData.bnplAccountId || 'unknown',
        summary: this.generateEventSummary(eventName, eventData),
      });

      // TODO: 실제 모니터링 테이블에 기록하는 로직 추가
      // await this.dbService.db.insert(schema.eventMonitor).values({
      //   id: ulid(),
      //   domain,
      //   eventName,
      //   eventData: JSON.stringify(eventData),
      //   createdAt: new Date(),
      // });

    } catch (error) {
      this.logger.error(`이벤트 모니터링 기록 실패: ${domain}.${eventName}`, error);
    }
  }

  /**
   * 이벤트 요약 정보 생성
   */
  private generateEventSummary(eventName: string, eventData: any): string {
    switch (eventName) {
      case 'payment.authorized':
        return `결제 승인: ${eventData.amount}원`;
      case 'payment.captured':
        return `결제 완료: ${eventData.amount}원`;
      case 'payment.failed':
        return `결제 실패: ${eventData.reason}`;
      
      case 'refund.requested':
        return `환불 요청: ${eventData.data?.amount}원`;
      case 'refund.completed':
        return `환불 완료: ${eventData.refundId}`;
      
      case 'bnpl.account.created':
        return `BNPL 계정 생성: 한도 ${eventData.approvedLimit}원`;
      case 'bnpl.credit.used':
        return `신용 한도 사용: ${eventData.amount}원`;
      case 'bnpl.credit.restored':
        return `신용 한도 복원: ${eventData.amount}원`;
      
      case 'invoice.issued':
        return `청구서 발행: ${eventData.amount}원`;
      case 'invoice.paid':
        return `청구서 결제: ${eventData.amount}원`;
      
      case 'settlement.batch.created':
        return `정산 배치 생성: ${eventData.totalAmount}원 (${eventData.transactionCount}건)`;
      case 'settlement.batch.completed':
        return `정산 완료: ${eventData.totalAmount}원 (${eventData.status})`;
      
      default:
        return `이벤트 발생: ${eventName}`;
    }
  }

  /**
   * 실시간 이벤트 통계 조회
   */
  async getEventStats(hours: number = 24) {
    const stats = {
      totalEvents: 0,
      byDomain: {
        PAYMENT: 0,
        REFUND: 0,
        BNPL: 0,
        INVOICE: 0,
        SETTLEMENT: 0,
      },
      recentEvents: [] as any[],
    };

    // TODO: 실제 DB에서 통계 조회 로직 구현
    // const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    // const events = await this.dbService.db.query.eventMonitor.findMany({
    //   where: gte(schema.eventMonitor.createdAt, since),
    //   orderBy: desc(schema.eventMonitor.createdAt),
    //   limit: 100,
    // });

    return stats;
  }

  /**
   * 이벤트 처리 지연 감지
   */
  async detectEventProcessingDelays() {
    // TODO: 이벤트 처리 지연을 감지하는 로직 구현
    // 예: 특정 이벤트가 발행된 후 일정 시간 내에 후속 이벤트가 발생하지 않으면 알림
    this.logger.log('이벤트 처리 지연 감지 실행');
  }

  /**
   * 이벤트 처리 실패 감지
   */
  async detectEventProcessingFailures() {
    // TODO: 이벤트 처리 실패를 감지하는 로직 구현
    // 예: 에러 로그 패턴 분석, 재시도 로직 등
    this.logger.log('이벤트 처리 실패 감지 실행');
  }
}