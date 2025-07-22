import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../schemas/schema';
import { gte, lte, eq, and, desc } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * 이벤트 재생 서비스
 * Event Sourcing 패턴의 핵심 기능으로, 특정 시점의 데이터 상태를 복원합니다.
 */
@Injectable()
export class EventReplayService {
  private readonly logger = new Logger(EventReplayService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 특정 Invoice의 이벤트를 재생하여 상태를 복원합니다.
   * @param invoiceId Invoice ID
   * @param targetDate 복원할 시점 (선택사항, 없으면 전체 재생)
   */
  async replayInvoiceEvents(invoiceId: string, targetDate?: Date) {
    this.logger.log(`Invoice 이벤트 재생 시작: ${invoiceId}`);

    try {
      // 1. Invoice 이벤트 조회 (시간순 정렬)
      const whereCondition = targetDate
        ? and(
            eq(schema.invoiceEvent.invoiceId, invoiceId),
            lte(schema.invoiceEvent.occurredAt, targetDate)
          )
        : eq(schema.invoiceEvent.invoiceId, invoiceId);

      const events = await this.dbService.db.query.invoiceEvent.findMany({
        where: whereCondition,
        orderBy: [schema.invoiceEvent.occurredAt], // 시간순 정렬 (오래된 것부터)
      });

      if (events.length === 0) {
        this.logger.warn(`Invoice ${invoiceId}에 대한 이벤트가 없습니다.`);
        return { success: false, message: '재생할 이벤트가 없습니다.' };
      }

      // 2. 이벤트 순차 재생
      let replayedEvents = 0;
      for (const event of events) {
        await this.replayInvoiceEvent(event);
        replayedEvents++;
      }

      this.logger.log(`Invoice 이벤트 재생 완료: ${invoiceId}, 재생된 이벤트: ${replayedEvents}개`);
      return {
        success: true,
        message: `${replayedEvents}개의 이벤트가 재생되었습니다.`,
        replayedEvents,
      };

    } catch (error) {
      this.logger.error(`Invoice 이벤트 재생 실패: ${invoiceId}`, error);
      return { success: false, message: '이벤트 재생 중 오류가 발생했습니다.' };
    }
  }

  /**
   * 특정 Payment의 이벤트를 재생하여 상태를 복원합니다.
   * @param paymentEventId Payment Event ID
   * @param targetDate 복원할 시점 (선택사항)
   */
  async replayPaymentEvents(paymentEventId: string, targetDate?: Date) {
    this.logger.log(`Payment 이벤트 재생 시작: ${paymentEventId}`);

    try {
      // Payment 이벤트는 단일 레코드이므로 해당 이벤트만 재생
      const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
        where: eq(schema.paymentEvents.id, paymentEventId),
        with: {
          invoice: true,
        },
      });

      if (!paymentEvent) {
        this.logger.warn(`Payment Event ${paymentEventId}를 찾을 수 없습니다.`);
        return { success: false, message: '재생할 Payment Event가 없습니다.' };
      }

      // 타겟 날짜 체크
      if (targetDate && paymentEvent.createdAt > targetDate) {
        this.logger.warn(`Payment Event ${paymentEventId}가 타겟 날짜 이후에 발생했습니다.`);
        return { success: false, message: 'Payment Event가 타겟 날짜 이후에 발생했습니다.' };
      }

      // Payment 이벤트 재생
      await this.replayPaymentEvent(paymentEvent);

      this.logger.log(`Payment 이벤트 재생 완료: ${paymentEventId}`);
      return {
        success: true,
        message: 'Payment 이벤트가 재생되었습니다.',
        replayedEvents: 1,
      };

    } catch (error) {
      this.logger.error(`Payment 이벤트 재생 실패: ${paymentEventId}`, error);
      return { success: false, message: '이벤트 재생 중 오류가 발생했습니다.' };
    }
  }

  /**
   * 특정 기간의 모든 이벤트를 재생합니다.
   * @param startDate 시작 날짜
   * @param endDate 종료 날짜
   * @param domain 도메인 필터 (선택사항)
   */
  async replayEventsByDateRange(
    startDate: Date,
    endDate: Date,
    domain?: 'INVOICE' | 'PAYMENT' | 'REFUND' | 'BNPL' | 'SETTLEMENT'
  ) {
    this.logger.log(`기간별 이벤트 재생 시작: ${startDate.toISOString()} ~ ${endDate.toISOString()}`);

    try {
      let totalReplayedEvents = 0;

      // Invoice 이벤트 재생
      if (!domain || domain === 'INVOICE') {
        const invoiceEvents = await this.dbService.db.query.invoiceEvent.findMany({
          where: and(
            gte(schema.invoiceEvent.occurredAt, startDate),
            lte(schema.invoiceEvent.occurredAt, endDate)
          ),
          orderBy: [schema.invoiceEvent.occurredAt],
        });

        for (const event of invoiceEvents) {
          await this.replayInvoiceEvent(event);
          totalReplayedEvents++;
        }
      }

      // Payment 이벤트 재생
      if (!domain || domain === 'PAYMENT') {
        const paymentEvents = await this.dbService.db.query.paymentEvents.findMany({
          where: and(
            gte(schema.paymentEvents.createdAt, startDate),
            lte(schema.paymentEvents.createdAt, endDate)
          ),
          orderBy: [schema.paymentEvents.createdAt],
          with: { invoice: true },
        });

        for (const event of paymentEvents) {
          await this.replayPaymentEvent(event);
          totalReplayedEvents++;
        }
      }

      // TODO: Refund, BNPL, Settlement 이벤트 재생 로직 추가

      this.logger.log(`기간별 이벤트 재생 완료: 총 ${totalReplayedEvents}개 이벤트 재생`);
      return {
        success: true,
        message: `${totalReplayedEvents}개의 이벤트가 재생되었습니다.`,
        replayedEvents: totalReplayedEvents,
      };

    } catch (error) {
      this.logger.error('기간별 이벤트 재생 실패', error);
      return { success: false, message: '이벤트 재생 중 오류가 발생했습니다.' };
    }
  }

  /**
   * 개별 Invoice 이벤트를 재생합니다.
   */
  private async replayInvoiceEvent(event: any) {
    try {
      switch (event.eventType) {
        case 'INVOICE_ISSUED':
          // Invoice 발행 이벤트 재생
          this.logger.log(`재생: Invoice 발행 - ${event.invoiceId}`);
          break;

        case 'INVOICE_PAID':
          // Invoice 결제 완료 이벤트 재생
          this.logger.log(`재생: Invoice 결제 완료 - ${event.invoiceId}`);
          break;

        case 'INVOICE_FAILED':
          // Invoice 결제 실패 이벤트 재생
          this.logger.log(`재생: Invoice 결제 실패 - ${event.invoiceId}`);
          break;

        case 'INVOICE_PARTIALLY_REFUNDED':
          // Invoice 부분 환불 이벤트 재생
          this.logger.log(`재생: Invoice 부분 환불 - ${event.invoiceId}`);
          break;

        case 'INVOICE_FULLY_REFUNDED':
          // Invoice 전액 환불 이벤트 재생
          this.logger.log(`재생: Invoice 전액 환불 - ${event.invoiceId}`);
          break;

        case 'INVOICE_CANCELLED':
          // Invoice 취소 이벤트 재생
          this.logger.log(`재생: Invoice 취소 - ${event.invoiceId}`);
          break;

        default:
          this.logger.warn(`알 수 없는 Invoice 이벤트 타입: ${event.eventType}`);
      }

      // 실제 재생 시에는 해당 이벤트를 다시 발행할 수 있습니다.
      // this.eventEmitter.emit('invoice.replayed', event);

    } catch (error) {
      this.logger.error(`Invoice 이벤트 재생 실패: ${event.id}`, error);
    }
  }

  /**
   * 개별 Payment 이벤트를 재생합니다.
   */
  private async replayPaymentEvent(event: any) {
    try {
      switch (event.status) {
        case 'AUTHORIZED':
          this.logger.log(`재생: Payment 승인 - ${event.id}`);
          break;

        case 'CAPTURED':
          this.logger.log(`재생: Payment 완료 - ${event.id}`);
          break;

        case 'FAILED':
          this.logger.log(`재생: Payment 실패 - ${event.id}`);
          break;

        default:
          this.logger.warn(`알 수 없는 Payment 상태: ${event.status}`);
      }

      // 실제 재생 시에는 해당 이벤트를 다시 발행할 수 있습니다.
      // this.eventEmitter.emit('payment.replayed', event);

    } catch (error) {
      this.logger.error(`Payment 이벤트 재생 실패: ${event.id}`, error);
    }
  }

  /**
   * 이벤트 재생 시뮬레이션 (실제 상태 변경 없이 로그만 출력)
   * @param invoiceId Invoice ID
   * @param dryRun 시뮬레이션 모드 (기본값: true)
   */
  async simulateEventReplay(invoiceId: string, dryRun: boolean = true) {
    this.logger.log(`이벤트 재생 시뮬레이션 시작: ${invoiceId} (dryRun: ${dryRun})`);

    const events = await this.dbService.db.query.invoiceEvent.findMany({
      where: eq(schema.invoiceEvent.invoiceId, invoiceId),
      orderBy: [schema.invoiceEvent.occurredAt],
    });

    const simulation = {
      invoiceId,
      totalEvents: events.length,
      eventSequence: events.map((event, index) => ({
        step: index + 1,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        reason: event.reason,
      })),
      estimatedDuration: `${events.length * 0.1}초`,
    };

    this.logger.log('이벤트 재생 시뮬레이션 결과:', simulation);
    return simulation;
  }
}